// Yerel yakalama (deneysel): ekranı ffmpeg ile doğrudan Windows'tan (Desktop Duplication) yakalar,
// donanım kodlayıcıyla H.264'e çevirir ve kareleri WebSocket üzerinden telefona gönderir.
// Telefon tarafı bunları WebCodecs ile çözer (src/client/native.js).
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUD = Buffer.from([0, 0, 0, 1, 0x09]);
const MAX_BUFFERED = 8 * 1024 * 1024; // telefona gidemeyen veri bu kadarı geçerse kareleri atla

// Sırayla denenecek kodlayıcılar. İlki çalışmazsa (ör. Quick Sync yoksa) bir sonrakine geçilir.
// NVENC ölçümde 144 fps'e kadar çıktı. Quick Sync 120'nin üstündeki kare hızını kabul etmediği için
// sabit 120 fps'e zorlanıyor (ekran dururken kare çoğaltabilir); yalnızca yedek olarak duruyor.
const ENCODERS = [
  {
    name: 'NVIDIA NVENC',
    filter: (idx) => `ddagrab=output_idx=${idx}:framerate=240:dup_frames=0:draw_mouse=1,hwdownload,format=bgra`,
    args: (mbps) => ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-zerolatency', '1', '-aud', '1', ...rate(mbps), '-fps_mode', 'passthrough'],
  },
  {
    name: 'Intel Quick Sync',
    filter: (idx) => `ddagrab=output_idx=${idx}:framerate=240:dup_frames=0:draw_mouse=1,hwmap=derive_device=qsv,format=qsv`,
    args: (mbps) => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-async_depth', '2', '-look_ahead', '0', '-aud', '1', ...rate(mbps), '-r', '120'],
  },
];

function rate(mbps) {
  return ['-b:v', `${mbps}M`, '-maxrate', `${mbps}M`, '-bufsize', `${Math.max(1, Math.round(mbps / 15))}M`, '-bf', '0', '-g', '100000'];
}

function findFfmpeg() {
  if (process.env.MYSCREEN_FFMPEG && fs.existsSync(process.env.MYSCREEN_FFMPEG)) return process.env.MYSCREEN_FFMPEG;
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of fs.readdirSync(base).filter((n) => /^Gyan\.FFmpeg/i.test(n))) {
      for (const sub of fs.readdirSync(path.join(base, pkg))) {
        const exe = path.join(base, pkg, sub, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch {}
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const exe = path.join(dir, 'ffmpeg.exe');
    if (dir && fs.existsSync(exe)) return exe;
  }
  return null;
}

// ffmpeg'in ekran numarası (output_idx) ile Windows ekranını eşleştir: çözünürlüğe bakarak.
function probeOutput(ffmpeg, idx) {
  return new Promise((resolve) => {
    execFile(
      ffmpeg,
      ['-hide_banner', '-f', 'lavfi', '-i', `ddagrab=output_idx=${idx}:framerate=5`, '-frames:v', '1', '-f', 'null', '-'],
      { windowsHide: true, timeout: 8000 },
      (err, stdout, stderr) => {
        const m = String(stderr).match(/Stream #0:0.*?Video:.*?(\d{3,5})x(\d{3,5})/);
        resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : null);
      }
    );
  });
}

function nalTypes(au) {
  const types = new Set();
  for (let i = 0; i + 3 < au.length; i++) {
    if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1) {
      types.add(au[i + 3] & 0x1f);
      i += 3;
    }
  }
  return types;
}

// cache: önceki oturumlardan "genişlik x yükseklik" -> output_idx eşlemesi (yoklama ekran başına ~3 sn sürüyor).
function createNativeStreamer({ log, onStatus, cache = {}, saveCache = () => {} }) {
  const ffmpeg = findFfmpeg();
  const outputCache = new Map(Object.entries(cache));
  let proc = null;
  let socket = null;
  let display = null; // { width, height }
  let mbps = 30;
  let encoderIndex = 0;
  let pending = Buffer.alloc(0);
  let waitingKey = true;
  let restartTimer = null;
  let stats = { frames: 0, bytes: 0, skipped: 0 };
  let statsTimer = null;
  let generation = 0;

  let probing = null;
  async function findOutputIndex(size = display) {
    const key = `${size.width}x${size.height}`;
    if (outputCache.has(key)) return outputCache.get(key);
    if (probing) await probing; // aynı anda iki yoklama yapma
    if (outputCache.has(key)) return outputCache.get(key);
    let resolveProbe;
    probing = new Promise((r) => (resolveProbe = r));
    try {
      for (let idx = 0; idx < 6; idx++) {
        const found = await probeOutput(ffmpeg, idx);
        if (!found) break;
        outputCache.set(`${found.width}x${found.height}`, idx);
        if (found.width === size.width && found.height === size.height) break;
      }
      saveCache(Object.fromEntries(outputCache));
    } finally {
      probing = null;
      resolveProbe();
    }
    return outputCache.has(key) ? outputCache.get(key) : null;
  }

  function sendFrame(au) {
    if (!socket || socket.readyState !== 1) return;
    const types = nalTypes(au);
    const key = types.has(5) || types.has(7);
    if (waitingKey && !key) {
      stats.skipped++;
      return;
    }
    if (socket.bufferedAmount > MAX_BUFFERED) {
      // Telefon yetişemiyor: yeni bir anahtar kareyle temiz başlangıç yap.
      stats.skipped++;
      waitingKey = true;
      scheduleRestart('telefon yetisemiyor');
      return;
    }
    waitingKey = false;
    const header = Buffer.alloc(9);
    header[0] = key ? 1 : 0;
    header.writeDoubleLE(performance.now(), 1);
    socket.send(Buffer.concat([header, au]), { binary: true });
    stats.frames++;
    stats.bytes += au.length;
  }

  function onData(chunk) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    // Her erişim birimi bir AUD ile başlar; iki AUD arasını bir kare olarak gönder.
    let start = pending.indexOf(AUD);
    if (start < 0) return;
    let next;
    while ((next = pending.indexOf(AUD, start + AUD.length)) >= 0) {
      sendFrame(pending.subarray(start, next));
      start = next;
    }
    pending = pending.subarray(start);
  }

  function stop() {
    generation++;
    clearTimeout(restartTimer);
    restartTimer = null;
    if (proc) {
      proc.removeAllListeners();
      proc.stdout.removeAllListeners();
      try {
        proc.kill();
      } catch {}
    }
    proc = null;
    pending = Buffer.alloc(0);
  }

  async function start() {
    stop();
    const myGeneration = generation;
    if (!socket) return;
    if (!ffmpeg) {
      status('error', 'ffmpeg bulunamadı');
      return;
    }
    const idx = await findOutputIndex();
    if (myGeneration !== generation || !socket) return;
    if (idx === null) {
      status('error', `ffmpeg ${display.width}×${display.height} ekranını bulamadı`);
      return;
    }
    const encoder = ENCODERS[encoderIndex];
    const args = ['-hide_banner', '-loglevel', 'error', '-filter_complex', encoder.filter(idx), ...encoder.args(mbps), '-f', 'h264', 'pipe:1'];
    waitingKey = true;
    const startedAt = Date.now();
    let gotData = false;
    let errText = '';
    proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => {
      gotData = true;
      onData(chunk);
    });
    proc.stderr.on('data', (d) => {
      errText = (errText + d).slice(-600);
    });
    proc.on('exit', (code) => {
      if (myGeneration !== generation) return;
      proc = null;
      log(`yerel ffmpeg cikti kod=${code} kodlayici=${encoder.name} ${errText.replace(/\s+/g, ' ').trim()}`);
      // Hemen çöktüyse sıradaki kodlayıcıyı dene.
      if (!gotData && Date.now() - startedAt < 4000 && encoderIndex < ENCODERS.length - 1) {
        encoderIndex++;
        start();
      } else if (socket) {
        status('error', `kodlama durdu (${encoder.name})`);
        scheduleRestart('ffmpeg durdu', 1500);
      }
    });
    status('live', `${encoder.name} · ekran ${idx} · ${display.width}×${display.height}`);
    log(`yerel basladi kodlayici=${encoder.name} output_idx=${idx} ${display.width}x${display.height} ${mbps}Mbps`);
  }

  function scheduleRestart(reason, delay = 200) {
    if (restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (socket) {
        log(`yerel yeniden baslatma: ${reason}`);
        start();
      }
    }, delay);
  }

  function status(state, text) {
    if (onStatus) onStatus({ state, text });
  }

  return {
    available: !!ffmpeg,
    ffmpegPath: ffmpeg,
    // Ekran eklenip çıkarıldığında numaralar değişebilir; eşlemeyi sıfırla.
    resetCache() {
      outputCache.clear();
      saveCache({});
    },
    // Telefon bağlanmadan önce ekran eşlemesini hazırla.
    warmup(size) {
      if (ffmpeg) findOutputIndex(size).catch(() => {});
    },
    attach(ws, displaySize, bitrateMbps) {
      socket = ws;
      display = displaySize;
      if (bitrateMbps) mbps = bitrateMbps;
      encoderIndex = 0;
      stats = { frames: 0, bytes: 0, skipped: 0 };
      clearInterval(statsTimer);
      statsTimer = setInterval(() => {
        if (!socket) return;
        const line = `yerel fps=${stats.frames} mbps=${((stats.bytes * 8) / 1e6).toFixed(1)} atlanan=${stats.skipped} tampon=${Math.round((socket.bufferedAmount || 0) / 1024)}KB kodlayici=${ENCODERS[encoderIndex].name}`;
        log(line);
        if (onStatus) onStatus({ state: 'stats', fps: stats.frames, mbps: (stats.bytes * 8) / 1e6, encoder: ENCODERS[encoderIndex].name });
        stats = { frames: 0, bytes: 0, skipped: 0 };
      }, 1000);
      start();
    },
    detach(ws) {
      if (ws && ws !== socket) return;
      socket = null;
      clearInterval(statsTimer);
      stop();
      status('idle', '');
    },
    // Ekran değişti ya da telefon temiz bir anahtar kare istedi.
    restart(displaySize) {
      if (displaySize) display = displaySize;
      if (socket) start();
    },
    requestKey() {
      waitingKey = true;
      scheduleRestart('telefon anahtar kare istedi');
    },
  };
}

module.exports = { createNativeStreamer, findFfmpeg };
