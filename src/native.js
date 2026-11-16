// Ekran yayını: ekranı ffmpeg ile doğrudan Windows'tan (Desktop Duplication) yakalar,
// donanım kodlayıcıyla H.264'e çevirir ve kareleri WebSocket üzerinden telefona gönderir.
// Telefon tarafı bunları WebCodecs ile çözer (src/client/client.js).
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUD = Buffer.from([0, 0, 0, 1, 0x09]);
const MAX_BUFFERED = 8 * 1024 * 1024; // telefona gidemeyen veri bu kadarı geçerse kareleri atla

// Ekran yakalandığı ekran kartına göre kodlayıcı zinciri seçilir:
// - Sanal ekran NVIDIA'daysa kareler kopyalanmadan NVENC'e gider (2560x1600'de ~90+ fps ölçüldü).
// - Intel'deyse kareler ya belleğe indirilip NVENC'e verilir ya da Quick Sync kullanılır. Bu yol
//   2560x1600'de ~40 fps'te tıkandı; bu yüzden sanal ekran sürücüsü NVIDIA'ya ayarlı.
// Her zincir sırayla denenir; ilki hemen çökerse sıradakine geçilir.
// Seyreltme: saniye "en fazla fps" kadar dilime bölünür, her dilimden en fazla bir kare kodlanır.
// Ekranın yenileme hızından fazla kare göndermek tablette kuyruk ve takılma yapıyordu.
function limiter(fps) {
  return `select='isnan(prev_selected_t)+gt(floor(t*${fps})\\,floor(prev_selected_t*${fps}))'`;
}
function grab(output, fps) {
  return `ddagrab=output_idx=${output}:framerate=240:dup_frames=0:draw_mouse=1,${limiter(fps)}`;
}
const NVENC = (mbps) => ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-zerolatency', '1', '-aud', '1', '-profile:v', 'high', ...rate(mbps), '-fps_mode', 'passthrough'];
// Yedekler: NVIDIA sürücüsü eskiyse NVENC "Function not implemented" (-40) verip açılmıyor
// (ffmpeg 9 yeni NVENC API'si istiyor). Media Foundation her üreticinin sürücüsündeki donanım
// kodlayıcıyı kullanır; OpenH264 yazılımla kodlar (yavaş ama her yerde çalışır).
const FALLBACKS = [
  {
    name: 'Windows Media Foundation',
    filter: (o, fps) => `${grab(o, fps)},hwdownload,format=bgra,format=nv12`,
    args: (mbps) => ['-c:v', 'h264_mf', '-hw_encoding', '1', '-scenario', 'display_remoting', '-rate_control', 'cbr', '-aud', '1', ...rate(mbps), '-fps_mode', 'passthrough'],
  },
  {
    name: 'OpenH264 (yazılım)',
    filter: (o, fps) => `${grab(o, Math.min(fps, 60))},hwdownload,format=bgra,format=yuv420p`,
    args: (mbps) => ['-c:v', 'libopenh264', '-b:v', `${Math.min(mbps, 20)}M`, '-g', '100000', '-bsf:v', 'h264_metadata=aud=insert', '-fps_mode', 'passthrough'],
  },
];
const CHAINS = {
  nvidia: [{ name: 'NVIDIA NVENC (kopyasız)', filter: (o, fps) => grab(o, fps), args: (mbps) => NVENC(mbps) }, ...FALLBACKS],
  other: [
    { name: 'NVIDIA NVENC', filter: (o, fps) => `${grab(o, fps)},hwdownload,format=bgra`, args: (mbps) => NVENC(mbps) },
    {
      name: 'Intel Quick Sync',
      filter: (o, fps) => `${grab(o, fps)},hwmap=derive_device=qsv,format=qsv`,
      // Quick Sync 120'nin üstündeki kare hızını kabul etmiyor.
      args: (mbps, fps) => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-async_depth', '2', '-look_ahead', '0', '-aud', '1', '-profile:v', 'high', ...rate(mbps), '-r', String(Math.min(120, fps))],
    },
    ...FALLBACKS,
  ],
};

function rate(mbps) {
  return ['-b:v', `${mbps}M`, '-maxrate', `${mbps}M`, '-bufsize', `${Math.max(1, Math.round(mbps / 15))}M`, '-bf', '0', '-g', '100000'];
}

function findFfmpeg() {
  if (process.env.MYSCREEN_FFMPEG && fs.existsSync(process.env.MYSCREEN_FFMPEG)) return process.env.MYSCREEN_FFMPEG;
  // Kurulumla gelen ffmpeg (resources/ffmpeg), geliştirmede vendor/ffmpeg.
  for (const dir of [process.resourcesPath && path.join(process.resourcesPath, 'ffmpeg'), path.join(__dirname, '..', 'vendor', 'ffmpeg')]) {
    if (dir && fs.existsSync(path.join(dir, 'ffmpeg.exe'))) return path.join(dir, 'ffmpeg.exe');
  }
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

// Ekran kartının üreticisini öğren (10de = NVIDIA, 8086 = Intel). Kart yoksa null.
function probeAdapter(ffmpeg, adapter) {
  return new Promise((resolve) => {
    execFile(
      ffmpeg,
      ['-hide_banner', '-v', 'verbose', '-init_hw_device', `d3d11va=g:${adapter}`, '-f', 'lavfi', '-i', 'nullsrc=s=16x16', '-frames:v', '1', '-f', 'null', '-'],
      { windowsHide: true, timeout: 8000 },
      (err, stdout, stderr) => {
        const m = String(stderr).match(/Using device ([0-9a-f]{4}):([0-9a-f]{4})/i);
        resolve(m ? { vendor: m[1].toLowerCase() === '10de' ? 'nvidia' : 'other', id: `${m[1]}:${m[2]}` } : null);
      }
    );
  });
}

// Kartın verilen çıkışının çözünürlüğü (ekran Windows'taki hangi monitör, buna bakarak eşleşiyor).
function probeOutput(ffmpeg, adapter, output) {
  return new Promise((resolve) => {
    execFile(
      ffmpeg,
      ['-hide_banner', '-init_hw_device', `d3d11va=g:${adapter}`, '-filter_hw_device', 'g', '-filter_complex', `ddagrab=output_idx=${output}:framerate=5`, '-frames:v', '1', '-f', 'null', '-'],
      { windowsHide: true, timeout: 8000 },
      (err, stdout, stderr) => {
        const m = String(stderr).match(/Stream #0:0.*?Video:.*?(\d{3,5})x(\d{3,5})/);
        if (m) return resolve({ width: Number(m[1]), height: Number(m[2]) });
        const last = String(stderr).trim().split(/\r?\n/).filter((l) => /error|fail|invalid|not/i.test(l) && !/Conversion failed/.test(l)).pop();
        resolve({ error: (last || (err && err.message) || 'cikti yok').slice(0, 160) });
      }
    );
  });
}

// H.264 seviyesi (level_idc) için gerçek değer. Kodlayıcı, yakalayıcının bildirdiği 240 kare/sn'ye
// bakıp 6.0 yazıyor; ama gönderilen kare hızı ekranın yenileme hızıyla sınırlı olduğu için akış
// aslında 5.x sınırlarında. Bazı Android çözücüleri (ör. Honor 90) 6.0 görünce görüntüyü açmıyordu.
const LEVELS = [
  // [level_idc, saniyede makro blok, kare başına makro blok]
  [41, 245760, 8192],
  [42, 522240, 8704],
  [50, 589824, 22080],
  [51, 983040, 36864],
  [52, 2073600, 36864],
  [60, 4177920, 139264],
];
function levelFor(width, height, fps) {
  const fs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = fs * fps;
  const hit = LEVELS.find(([, mbps, maxFs]) => rate <= mbps && fs <= maxFs);
  return hit ? hit[0] : 62;
}
// Erişim birimindeki SPS'in level_idc baytını değiştir (NAL başlığı + profil + kısıtlar + seviye).
function patchSpsLevel(au, level) {
  for (let i = 0; i + 6 < au.length; i++) {
    if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1 && (au[i + 3] & 0x1f) === 7) {
      if (au[i + 6] > level) au[i + 6] = level;
      return;
    }
  }
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

// cache: önceki oturumlardan "genişlik x yükseklik" -> { kart, çıkış, üretici } eşlemesi (yoklama ekran başına ~1-3 sn sürüyor).
// onNeedFrame: ekran dururken Desktop Duplication yeni kare vermez; yayın başlarken ilk kare gelmezse
// çağrılır ki ekranda küçük bir değişiklik yapılıp ilk kare tetiklensin.
function createNativeStreamer({ log, onStatus, onNeedFrame = () => {}, cache = {}, saveCache = () => {} }) {
  const ffmpeg = findFfmpeg();
  const outputCache = new Map(Object.entries(cache));
  let proc = null;
  let socket = null;
  let display = null; // { width, height }
  let mbps = 30;
  let maxFps = 120; // ekranın yenileme hızından fazlası gönderilmez (fazlası yalnızca aynı karenin tekrarı)
  let encoderIndex = 0;
  let currentEncoder = '';
  let pending = Buffer.alloc(0);
  let waitingKey = true;
  let restartTimer = null;
  let stats = { frames: 0, bytes: 0, skipped: 0 };
  let statsTimer = null;
  let generation = 0;

  let probing = null;
  let probedIds = []; // son yoklamada görülen ekran kartları (ör. 1002:15bf)
  // Önbellekteki değer: { adapter, output, vendor }. Eski sürümden kalan sayı değerler geçersiz sayılır.
  const valid = (v) => v && typeof v === 'object' && Number.isInteger(v.adapter) && Number.isInteger(v.output);
  // Electron'un boyutu (DIP × ölçek) yuvarlamadan dolayı gerçek boyuttan 1-2 px sapabiliyor
  // (ör. %175 ölçekte 2664 yerine 2665). Tam eşleşme yoksa en fazla 3 px farklı olanı kabul et.
  function lookup(size) {
    const exact = outputCache.get(`${size.width}x${size.height}`);
    if (valid(exact)) return exact;
    for (const [k, v] of outputCache) {
      const [w, h] = k.split('x').map(Number);
      if (valid(v) && Math.abs(w - size.width) <= 3 && Math.abs(h - size.height) <= 3) return v;
    }
    return null;
  }
  async function findOutput(size = display) {
    if (lookup(size)) return lookup(size);
    if (probing) await probing; // aynı anda iki yoklama yapma
    if (lookup(size)) return lookup(size);
    let resolveProbe;
    probing = new Promise((r) => (resolveProbe = r));
    try {
      const seen = new Set();
      probedIds = [];
      outer: for (let adapter = 0; adapter < 4; adapter++) {
        const info = await probeAdapter(ffmpeg, adapter);
        log(`yoklama kart=${adapter} ${info ? info.id + ' ' + info.vendor : 'yok'}`);
        if (!info) break;
        probedIds.push(info.id);
        for (let output = 0; output < 6; output++) {
          const found = await probeOutput(ffmpeg, adapter, output);
          log(`yoklama kart=${adapter} cikis=${output} ${found.error ? 'HATA ' + found.error : found.width + 'x' + found.height}`);
          if (found.error) break;
          const k = `${found.width}x${found.height}`;
          if (seen.has(`${info.id}/${k}`)) continue; // aynı kart iki kez listelenebiliyor
          seen.add(`${info.id}/${k}`);
          if (!valid(outputCache.get(k))) outputCache.set(k, { adapter, output, vendor: info.vendor });
          if (lookup(size)) break outer;
        }
      }
      saveCache(Object.fromEntries([...outputCache].filter(([, v]) => valid(v))));
    } finally {
      probing = null;
      resolveProbe();
    }
    return lookup(size);
  }

  function sendFrame(au) {
    if (!socket || socket.readyState !== 1) return;
    const types = nalTypes(au);
    const key = types.has(5) || types.has(7);
    if (types.has(7) && display) patchSpsLevel(au, levelFor(display.width, display.height, maxFps));
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
    const target = await findOutput();
    if (myGeneration !== generation || !socket) return;
    if (!target) {
      // Yalnızca Microsoft Basic Render Driver (1414) görünüyorsa gerçek ekran kartı kullanılamıyor:
      // Uzak Masaüstü oturumu ya da kurulu olmayan ekran kartı sürücüsü. Ekran yakalama bu durumda çalışmaz.
      const basicOnly = probedIds.length > 0 && probedIds.every((id) => id.startsWith('1414:'));
      status('error', basicOnly
        ? 'Ekran kartı kullanılamıyor (yalnızca Microsoft Basic Render Driver görünüyor). Uzak Masaüstü ile bağlıysan My Screen uygulamasını bilgisayarın kendi oturumunda aç; değilse ekran kartı sürücüsünü (AMD/NVIDIA/Intel) kur.'
        : `ffmpeg ${display.width}×${display.height} ekranını bulamadı`);
      return;
    }
    const chain = CHAINS[target.vendor] || CHAINS.other;
    if (encoderIndex >= chain.length) encoderIndex = 0;
    const encoder = chain[encoderIndex];
    currentEncoder = encoder.name;
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-init_hw_device', `d3d11va=g:${target.adapter}`, '-filter_hw_device', 'g',
      '-filter_complex', encoder.filter(target.output, maxFps),
      ...encoder.args(mbps, maxFps),
      '-f', 'h264', 'pipe:1',
    ];
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
      if (!gotData && Date.now() - startedAt < 4000 && encoderIndex < chain.length - 1) {
        encoderIndex++;
        start();
      } else if (socket) {
        status('error', `kodlama durdu (${encoder.name})`);
        scheduleRestart('ffmpeg durdu', 1500);
      }
    });
    // İlk kare hiç gelmezse sebebi panelde ve cihazda görünsün.
    setTimeout(() => {
      if (myGeneration !== generation || !socket || !waitingKey) return;
      const why = errText.replace(/s+/g, ' ').trim().slice(-200);
      log(`yerel ilk kare gelmedi kodlayici=${encoder.name} kart=${target.adapter} cikis=${target.output} ${why}`);
      status('error', `ilk görüntü 8 saniyede gelmedi (${encoder.name}, ekran kartı ${target.adapter})${why ? ': ' + why : ''}`);
    }, 8000);
    for (const delay of [500, 1500, 3000]) {
      setTimeout(() => {
        if (myGeneration === generation && socket && waitingKey) onNeedFrame();
      }, delay);
    }
    status('live', `${encoder.name} · ${display.width}×${display.height} · en fazla ${maxFps} fps`);
    log(`yerel basladi kodlayici=${encoder.name} kart=${target.adapter} cikis=${target.output} ${display.width}x${display.height} ${mbps}Mbps en-fazla-${maxFps}fps`);
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
      if (ffmpeg) findOutput(size).catch(() => {});
    },
    attach(ws, displaySize, bitrateMbps, fps) {
      socket = ws;
      display = displaySize;
      if (bitrateMbps) mbps = bitrateMbps;
      if (fps) maxFps = fps;
      encoderIndex = 0;
      stats = { frames: 0, bytes: 0, skipped: 0 };
      clearInterval(statsTimer);
      statsTimer = setInterval(() => {
        if (!socket) return;
        const line = `yerel fps=${stats.frames} mbps=${((stats.bytes * 8) / 1e6).toFixed(1)} atlanan=${stats.skipped} tampon=${Math.round((socket.bufferedAmount || 0) / 1024)}KB kodlayici=${currentEncoder}`;
        log(line);
        if (onStatus) onStatus({ state: 'stats', fps: stats.frames, mbps: (stats.bytes * 8) / 1e6, encoder: currentEncoder });
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
    restart(displaySize, fps) {
      if (displaySize) display = displaySize;
      if (fps) maxFps = fps;
      if (socket) start();
    },
    setBitrate(value) {
      mbps = value;
      if (socket) start();
    },
    requestKey() {
      waitingKey = true;
      scheduleRestart('telefon anahtar kare istedi');
    },
  };
}

module.exports = { createNativeStreamer, findFfmpeg };
