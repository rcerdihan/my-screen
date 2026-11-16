// Telefon sayfası: bilgisayarın ffmpeg ile kodladığı H.264 karelerini WebSocket'ten alır,
// WebCodecs ile donanımda çözer ve tuvale çizer. Dokunuşları fare girdisi olarak geri gönderir.
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const overlay = document.getElementById('overlay');
const message = document.getElementById('message');
const startBtn = document.getElementById('start');
const hud = document.getElementById('hud');

const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
const showHud = params.has('hud');
let ws = null;
let decoder = null;
let configuredCodec = '';
let stopped = false;
let started = false;
let needKey = true;
let frameSize = { width: 0, height: 0 };
const counters = { received: 0, decoded: 0, dropped: 0, bytes: 0, decodeMs: 0, painted: 0, late: 0, drawMs: 0 };
const sentAt = new Map(); // timestamp -> çözücüye verilme zamanı

function show(text, withButton) {
  overlay.hidden = false;
  message.textContent = text;
  startBtn.hidden = !withButton;
  const reconnect = document.getElementById('reconnect');
  if (reconnect) reconnect.hidden = true;
}
function hide() {
  overlay.hidden = true;
}
function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

if (!('VideoDecoder' in window)) {
  stopped = true;
  show(
    window.isSecureContext
      ? 'Bu tarayıcı görüntüyü çözemiyor (WebCodecs yok). Samsung Internet veya güncel bir Chrome kullan.'
      : 'Sayfa güvenli bağlantıyla (https) açılmadı. Bilgisayardaki QR kodu yeniden okut.',
    false
  );
}

// SPS'ten codec dizesini çıkar: avc1.PPCCLL
function codecFromAnnexB(data) {
  for (let i = 0; i + 7 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
      const hex = (b) => b.toString(16).padStart(2, '0');
      return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
    }
  }
  return '';
}

// Gösterim iki yoldan biriyle yapılır:
// 1) Video yolu (tercih edilen): çözülen kareler MediaStreamTrackGenerator ile bir <video> öğesine
//    verilir. Tarayıcının video oynatıcısı kareleri donanım katmanıyla, ekran yenilemesine hizalı
//    gösterir. Tablette 2560x1600 tuvale çizmek saniyede 8-14 yenilemenin kaçmasına yol açıyordu.
// 2) Tuval yolu (yedek): tarayıcı bunu desteklemiyorsa her yenilemede en son kare tuvale çizilir.
const video = document.getElementById('video');
const useVideo = 'MediaStreamTrackGenerator' in window && !params.has('canvas');
let trackWriter = null;
if (useVideo) {
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  trackWriter = generator.writable.getWriter();
  video.srcObject = new MediaStream([generator]);
  video.hidden = false;
  canvas.hidden = true;
  // Gerçekten ekranda gösterilen kareleri say.
  if ('requestVideoFrameCallback' in video) {
    let lastPresented = -1;
    let lastTime = 0;
    const onPresented = (now, meta) => {
      if (lastPresented >= 0) counters.painted += Math.max(0, meta.presentedFrames - lastPresented);
      if (lastTime && now - lastTime > 25) counters.late++;
      lastPresented = meta.presentedFrames;
      lastTime = now;
      video.requestVideoFrameCallback(onPresented);
    };
    video.requestVideoFrameCallback(onPresented);
  }
}

let latestFrame = null;
let rafPending = false;
let lastRaf = 0;
function paint(now) {
  rafPending = false;
  if (lastRaf && now - lastRaf > 25) counters.late++; // bir yenileme kaçırıldı (60 Hz'te ~16,7 ms)
  lastRaf = now;
  const frame = latestFrame;
  latestFrame = null;
  if (!frame) return;
  if (frame.displayWidth !== canvas.width || frame.displayHeight !== canvas.height) {
    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
  }
  const t0 = performance.now();
  ctx.drawImage(frame, 0, 0);
  counters.drawMs += performance.now() - t0;
  counters.painted++;
  frame.close();
}
function drawFrame(frame) {
  frameSize = { width: frame.displayWidth, height: frame.displayHeight };
  if (useVideo) {
    // Oynatıcı yetişemiyorsa kuyruğu büyütme, bu kareyi atla.
    if (trackWriter.desiredSize !== null && trackWriter.desiredSize <= 0) {
      counters.dropped++;
      frame.close();
      return;
    }
    trackWriter.write(frame).catch(() => {});
    if (video.paused) video.play().catch(() => {});
    return;
  }
  if (latestFrame) {
    latestFrame.close();
    counters.dropped++;
  }
  latestFrame = frame;
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(paint);
  }
}

function createDecoder(codec) {
  if (decoder && decoder.state !== 'closed') decoder.close();
  decoder = new VideoDecoder({
    output: (frame) => {
      const t0 = sentAt.get(frame.timestamp);
      if (t0 !== undefined) {
        counters.decodeMs += performance.now() - t0;
        sentAt.delete(frame.timestamp);
      }
      counters.decoded++;
      drawFrame(frame);
    },
    error: (err) => {
      console.error(err);
      needKey = true;
      configuredCodec = '';
      wsSend({ type: 'key' });
    },
  });
  decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' });
  configuredCodec = codec;
}

let timestamp = 0;
function onVideo(buf) {
  const view = new Uint8Array(buf);
  const key = view[0] === 1;
  const data = view.subarray(9);
  counters.received++;
  counters.bytes += data.length;
  if (needKey && !key) return;
  if (key) {
    const codec = codecFromAnnexB(data);
    if (codec && (codec !== configuredCodec || !decoder || decoder.state === 'closed')) {
      try {
        createDecoder(codec);
      } catch (err) {
        show(`Çözücü açılamadı (${codec}): ${err.message}`, false);
        return;
      }
    }
  }
  if (!decoder || decoder.state !== 'configured') return;
  needKey = false;
  // Çözücü yetişemiyorsa (aşırı birikme) sonraki anahtar kareye kadar atla.
  if (decoder.decodeQueueSize > 30) {
    needKey = true;
    counters.dropped++;
    wsSend({ type: 'key' });
    return;
  }
  timestamp += 1000;
  sentAt.set(timestamp, performance.now());
  if (sentAt.size > 300) sentAt.clear();
  decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, data }));
}

function connect() {
  if (stopped) return;
  ws = new WebSocket(`wss://${location.host}/ws?t=${encodeURIComponent(token)}`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    needKey = true;
    show(started ? 'Görüntü bekleniyor…' : 'Bağlandı. Tam ekran için dokun.', !started);
  };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') {
      onVideo(e.data);
      if (started && !overlay.hidden && counters.decoded > 0) hide();
      return;
    }
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      // Uygulama güncellendiyse (bilgisayar yeniden başladı, sayfa açık kaldı) yeni sayfayı yükle.
      const known = sessionStorage.getItem('myscreen-build');
      if (known && known !== msg.build) {
        sessionStorage.setItem('myscreen-build', msg.build);
        location.reload();
        return;
      }
      sessionStorage.setItem('myscreen-build', msg.build);
    } else if (msg.type === 'replaced') {
      stopAndOfferReconnect('Başka bir cihaz bağlandı.');
    } else if (msg.type === 'kicked') {
      stopAndOfferReconnect('Bağlantı bilgisayardan kesildi.');
    } else if (msg.type === 'error') {
      show(msg.text, false);
    }
  };
  ws.onclose = (e) => {
    if (e.code === 4001) {
      stopped = true;
      show('Bağlantı adresi geçersiz. Bilgisayardaki QR kodu yeniden okut.', false);
      return;
    }
    if (e.code === 4002) return stopAndOfferReconnect('Başka bir cihaz bağlandı.');
    if (e.code === 4003) return stopAndOfferReconnect('Bağlantı bilgisayardan kesildi.');
    if (stopped) return;
    show('Bilgisayara bağlanılıyor…', false);
    setTimeout(connect, 1500);
  };
}

// Bilgisayar bağlantıyı kestiğinde (ya da başka cihaz bağlandığında) kendiliğinden yeniden bağlanma;
// ekranın kararmasına izin ver ve kullanıcıya düğme göster.
const reconnectBtn = document.getElementById('reconnect');
function stopAndOfferReconnect(text) {
  stopped = true;
  if (wakeLock && !wakeLock.released) wakeLock.release().catch(() => {});
  wakeLock = null;
  show(text, false);
  reconnectBtn.hidden = false;
}
reconnectBtn.addEventListener('click', () => {
  reconnectBtn.hidden = true;
  stopped = false;
  needKey = true;
  counters.decoded = 0;
  keepScreenOn();
  show('Bilgisayara bağlanılıyor…', false);
  connect();
});

// Ekran kilidi: tuvale çizilen görüntü, video oynatımı gibi sayılmadığı için telefon kendi zaman
// aşımında ekranı karartıyordu. Wake Lock ile sayfa açıkken ekran açık kalır. Sekme arka plana
// geçince kilit düşer; öne gelince yeniden alınır.
let wakeLock = null;
async function keepScreenOn() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepScreenOn();
});

startBtn.addEventListener('click', async () => {
  started = true;
  keepScreenOn();
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {}
  try {
    await screen.orientation.lock('landscape');
  } catch {}
  if (counters.decoded > 0) hide();
  else show('Görüntü bekleniyor…', false);
});

// Ölçümleri bilgisayara gönder.
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const line = `yol=${useVideo ? 'video' : 'tuval'} alinan=${counters.received} cozulen=${counters.decoded} cizilen=${counters.painted} gecYenileme=${counters.late} cizimMs=${counters.painted ? (counters.drawMs / counters.painted).toFixed(1) : '?'} atlanan=${counters.dropped} mbps=${((counters.bytes * 8) / 1e6).toFixed(1)} cozmeMs=${counters.decoded ? (counters.decodeMs / counters.decoded).toFixed(1) : '?'} kuyruk=${decoder ? decoder.decodeQueueSize : '?'} ${frameSize.width}x${frameSize.height} ${configuredCodec}`;
  wsSend({ type: 'stats', line });
  if (showHud) {
    hud.hidden = false;
    hud.textContent = `${counters.painted} fps çizilen (${counters.decoded} çözülen) · ${((counters.bytes * 8) / 1e6).toFixed(0)} Mbps · çözme ${counters.decoded ? (counters.decodeMs / counters.decoded).toFixed(1) : '?'} ms`;
  }
  counters.received = counters.decoded = counters.dropped = counters.bytes = counters.decodeMs = counters.painted = counters.late = counters.drawMs = 0;
}, 1000);

setupTouch(document.getElementById('stage'), () => frameSize, wsSend);
// Bazı tarayıcılar kilidi yalnızca bir dokunuştan sonra verir; her dokunuşta kontrol et (zaten varsa bir şey yapmaz).
document.getElementById('stage').addEventListener('touchend', keepScreenOn);
keepScreenOn();
document.addEventListener('contextmenu', (e) => e.preventDefault());

if (!stopped) {
  if (!token) show('Bağlantı adresi eksik. Bilgisayardaki QR kodu okut.', false);
  else connect();
}
