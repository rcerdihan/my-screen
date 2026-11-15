const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const message = document.getElementById('message');
const startBtn = document.getElementById('start');

const token = new URLSearchParams(location.search).get('t') || '';
let ws = null;
let pc = null;
let stopped = false;
let started = false;
let queue = Promise.resolve();

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

// ---------- bağlantı ----------
function closePeer() {
  if (pc) pc.close();
  pc = null;
}

async function onMessage(msg) {
  if (msg.type === 'offer') {
    closePeer();
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.ontrack = (e) => {
      // En düşük gecikme: tampon bekletme.
      try {
        e.receiver.jitterBufferTarget = 0;
        e.receiver.playoutDelayHint = 0;
      } catch {}
      video.srcObject = e.streams[0] || new MediaStream([e.track]);
      video.play().catch(() => {});
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) wsSend({ type: 'candidate', candidate: e.candidate });
    };
    const current = pc;
    pc.onconnectionstatechange = () => {
      if (pc !== current) return;
      if (pc.connectionState === 'connected') {
        if (started) hide();
        else show('Bağlandı. Tam ekran için dokun.', true);
      } else if (pc.connectionState === 'failed') {
        show('Görüntü bağlantısı kurulamadı. Bilgisayarda güvenlik duvarı iznini kontrol et.', false);
      }
    };
    await pc.setRemoteDescription(msg.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSend({ type: 'answer', sdp: pc.localDescription });
  } else if (msg.type === 'candidate' && pc) {
    try {
      await pc.addIceCandidate(msg.candidate);
    } catch {}
  } else if (msg.type === 'replaced') {
    stopped = true;
    closePeer();
    show('Başka bir cihaz bağlandı. Yeniden bağlanmak için sayfayı yenile.', false);
  }
}

function connect() {
  if (stopped) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=viewer&t=${encodeURIComponent(token)}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    queue = queue.then(() => onMessage(msg)).catch(() => {});
  };
  ws.onclose = (e) => {
    closePeer();
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

// Alıcı tarafın ölçümlerini bilgisayara gönder (tanı için).
let lastIn = null;
setInterval(async () => {
  if (!pc || pc.connectionState !== 'connected') return;
  const report = await pc.getStats();
  report.forEach((s) => {
    if (s.type !== 'inbound-rtp' || s.kind !== 'video') return;
    if (lastIn) {
      const dt = (s.timestamp - lastIn.timestamp) / 1000;
      const decoded = (s.framesDecoded - lastIn.framesDecoded) / dt;
      const received = (s.framesReceived - lastIn.framesReceived) / dt;
      const emitted = s.jitterBufferEmittedCount - lastIn.jitterBufferEmittedCount;
      const bufferMs = emitted > 0 ? ((s.jitterBufferDelay - lastIn.jitterBufferDelay) / emitted) * 1000 : 0;
      const decodeMs = decoded > 0 ? ((s.totalDecodeTime - lastIn.totalDecodeTime) / (s.framesDecoded - lastIn.framesDecoded)) * 1000 : 0;
      wsSend({
        type: 'stats',
        line: [
          `${s.frameWidth}x${s.frameHeight}`,
          `alinan=${received.toFixed(0)}`,
          `cozulen=${decoded.toFixed(0)}`,
          `dusen=${s.framesDropped - lastIn.framesDropped}`,
          `tamponMs=${bufferMs.toFixed(0)}`,
          `cozmeMs=${decodeMs.toFixed(1)}`,
          `cozucu=${s.decoderImplementation || '?'}`,
          `donma=${s.freezeCount || 0}`,
          `kayip=${s.packetsLost - lastIn.packetsLost}`,
        ].join(' '),
      });
    }
    lastIn = {
      timestamp: s.timestamp,
      framesDecoded: s.framesDecoded,
      framesReceived: s.framesReceived,
      framesDropped: s.framesDropped,
      jitterBufferEmittedCount: s.jitterBufferEmittedCount,
      jitterBufferDelay: s.jitterBufferDelay,
      totalDecodeTime: s.totalDecodeTime,
      packetsLost: s.packetsLost,
    };
  });
}, 2000);

startBtn.addEventListener('click', async () => {
  started = true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {}
  try {
    await screen.orientation.lock('landscape');
  } catch {}
  video.play().catch(() => {});
  hide();
});

// ---------- dokunmatik -> fare ----------
// Tek parmak: dokun = tık, sürükle = sürükle, basılı tut = sağ tık.
// İki parmak: kaydırma.
const MOVE_THRESHOLD = 10;
const LONG_PRESS_MS = 550;
let primaryId = null;
let startX = 0;
let startY = 0;
let dragging = false;
let consumed = false;
let longPressTimer = null;
let scrollLast = null;
let pendingMove = null;

function normalized(touch) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth || rect.width;
  const vh = video.videoHeight || rect.height;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const w = vw * scale;
  const h = vh * scale;
  const left = rect.left + (rect.width - w) / 2;
  const top = rect.top + (rect.height - h) / 2;
  return {
    x: Math.min(1, Math.max(0, (touch.clientX - left) / w)),
    y: Math.min(1, Math.max(0, (touch.clientY - top) / h)),
  };
}
function sendMove(touch) {
  const p = normalized(touch);
  wsSend({ type: 'input', k: 'm', x: p.x, y: p.y });
}
function queueMove(touch) {
  const first = !pendingMove;
  pendingMove = { clientX: touch.clientX, clientY: touch.clientY };
  if (first) {
    requestAnimationFrame(() => {
      if (pendingMove) sendMove(pendingMove);
      pendingMove = null;
    });
  }
}
function flushMove() {
  if (pendingMove) sendMove(pendingMove);
  pendingMove = null;
}
function clearLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}
function releaseDrag() {
  if (dragging) wsSend({ type: 'input', k: 'u' });
  dragging = false;
}
function centroid(touches) {
  let x = 0;
  let y = 0;
  for (const t of touches) {
    x += t.clientX;
    y += t.clientY;
  }
  return { x: x / touches.length, y: y / touches.length };
}

video.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      primaryId = t.identifier;
      startX = t.clientX;
      startY = t.clientY;
      dragging = false;
      consumed = false;
      sendMove(t);
      clearLongPress();
      longPressTimer = setTimeout(() => {
        if (!dragging && !consumed) {
          consumed = true;
          wsSend({ type: 'input', k: 'r' });
          if (navigator.vibrate) navigator.vibrate(15);
        }
      }, LONG_PRESS_MS);
    } else if (e.touches.length === 2) {
      clearLongPress();
      releaseDrag();
      consumed = true;
      scrollLast = centroid(e.touches);
    }
  },
  { passive: false }
);

video.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    if (e.touches.length >= 2 && scrollLast) {
      const c = centroid(e.touches);
      const dy = c.y - scrollLast.y;
      const dx = c.x - scrollLast.x;
      if (Math.abs(dy) >= 2) wsSend({ type: 'input', k: 'w', v: dy * 4 });
      if (Math.abs(dx) >= 2) wsSend({ type: 'input', k: 'h', v: -dx * 4 });
      scrollLast = c;
      return;
    }
    if (consumed) return;
    const t = [...e.touches].find((x) => x.identifier === primaryId);
    if (!t) return;
    if (!dragging) {
      if (Math.hypot(t.clientX - startX, t.clientY - startY) < MOVE_THRESHOLD) return;
      clearLongPress();
      dragging = true;
      wsSend({ type: 'input', k: 'd' });
    }
    queueMove(t);
  },
  { passive: false }
);

function onTouchEnd(e) {
  e.preventDefault();
  if (e.touches.length > 0) {
    if (e.touches.length < 2) scrollLast = null;
    return;
  }
  clearLongPress();
  scrollLast = null;
  flushMove();
  if (dragging) {
    releaseDrag();
  } else if (!consumed && e.type === 'touchend') {
    wsSend({ type: 'input', k: 'd' });
    wsSend({ type: 'input', k: 'u' });
  }
  primaryId = null;
}
video.addEventListener('touchend', onTouchEnd, { passive: false });
video.addEventListener('touchcancel', onTouchEnd, { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());

if (!token) show('Bağlantı adresi eksik. Bilgisayardaki QR kodu okut.', false);
else connect();
