// Telefon sayfası: bilgisayarın ffmpeg ile kodladığı H.264 karelerini WebSocket'ten alır,
// WebCodecs ile donanımda çözer ve tuvale çizer. Dokunuşları fare girdisi olarak geri gönderir.
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
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
const counters = { received: 0, decoded: 0, dropped: 0, bytes: 0, decodeMs: 0 };
const sentAt = new Map(); // timestamp -> çözücüye verilme zamanı

function show(text, withButton) {
  overlay.hidden = false;
  message.textContent = text;
  startBtn.hidden = !withButton;
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

function drawFrame(frame) {
  if (frame.displayWidth !== canvas.width || frame.displayHeight !== canvas.height) {
    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
    frameSize = { width: frame.displayWidth, height: frame.displayHeight };
  }
  ctx.drawImage(frame, 0, 0);
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
      // Çözücüde birikme varsa yalnızca en yeni kareyi çiz.
      if (decoder.decodeQueueSize > 0) {
        counters.dropped++;
        frame.close();
        return;
      }
      drawFrame(frame);
      frame.close();
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
    if (msg.type === 'replaced') {
      stopped = true;
      show('Başka bir cihaz bağlandı. Yeniden bağlanmak için sayfayı yenile.', false);
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
    if (stopped || e.code === 4002) return;
    show('Bilgisayara bağlanılıyor…', false);
    setTimeout(connect, 1500);
  };
}

startBtn.addEventListener('click', async () => {
  started = true;
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
  const line = `alinan=${counters.received} cozulen=${counters.decoded} atlanan=${counters.dropped} mbps=${((counters.bytes * 8) / 1e6).toFixed(1)} cozmeMs=${counters.decoded ? (counters.decodeMs / counters.decoded).toFixed(1) : '?'} kuyruk=${decoder ? decoder.decodeQueueSize : '?'} ${frameSize.width}x${frameSize.height} ${configuredCodec}`;
  wsSend({ type: 'stats', line });
  if (showHud) {
    hud.hidden = false;
    hud.textContent = `${counters.decoded} fps · ${((counters.bytes * 8) / 1e6).toFixed(0)} Mbps · çözme ${counters.decoded ? (counters.decodeMs / counters.decoded).toFixed(1) : '?'} ms`;
  }
  counters.received = counters.decoded = counters.dropped = counters.bytes = counters.decodeMs = 0;
}, 1000);

setupTouch(canvas, () => frameSize, wsSend);
document.addEventListener('contextmenu', (e) => e.preventDefault());

if (!stopped) {
  if (!token) show('Bağlantı adresi eksik. Bilgisayardaki QR kodu okut.', false);
  else connect();
}
