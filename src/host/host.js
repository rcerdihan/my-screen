const api = window.myscreen;
const $ = (id) => document.getElementById(id);

const displaySelect = $('display');
const fpsSelect = $('fps');
const bitrateSelect = $('bitrate');
const inputCheck = $('input');
const preview = $('preview');
const statusEl = $('status');
const statusText = $('statusText');
const statsEl = $('stats');
const errorEl = $('error');

let ws = null;
let pc = null;
let sender = null;
let stream = null;
let viewerPresent = false;
let hostWsUrl = '';
let lastStats = null;
let queue = Promise.resolve();

fpsSelect.value = localStorage.getItem('fps') || '60';
bitrateSelect.value = localStorage.getItem('bitrate') || '25';

function setStatus(kind, text) {
  statusEl.className = `status ${kind}`;
  statusText.textContent = text;
}
function showError(text) {
  errorEl.hidden = !text;
  errorEl.textContent = text || '';
}

// ---------- bağlantı kartları ----------
const EMPTY = {
  hotspot: () => {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<ol><li>Windows\'ta mobil etkin noktayı aç.</li><li>Telefonu bu etkin noktanın Wi-Fi ağına bağla.</li><li>Burada çıkan QR kodu okut.</li></ol>';
    const btn = document.createElement('button');
    btn.textContent = 'Etkin nokta ayarlarını aç';
    btn.onclick = () => api.openHotspotSettings();
    wrap.appendChild(btn);
    return wrap;
  },
  usb: () => {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<ol><li>Telefonu USB kabloyla bilgisayara tak.</li><li>Telefonda: Ayarlar → Bağlantılar → Mobil etkin nokta ve tethering → <b>USB tethering</b>\'i aç.</li><li>Burada çıkan QR kodu okut.</li></ol>';
    return wrap;
  },
};

// ---------- yerel mod (deneysel) ----------
const nativeCheck = $('nativeMode');
const nativeMbpsSelect = $('nativeMbps');
const nativeStatusEl = $('nativeStatus');
let lastEntries = [];
let nativeOn = false;
try {
  nativeOn = localStorage.getItem('nativeMode') === '1';
} catch {}

function applyNativeMode() {
  nativeCheck.checked = nativeOn;
  $('nativeHint').hidden = !nativeOn;
  $('nativeRateBox').hidden = !nativeOn;
  renderEntries(lastEntries);
}
nativeCheck.onchange = () => {
  nativeOn = nativeCheck.checked;
  try {
    localStorage.setItem('nativeMode', nativeOn ? '1' : '0');
  } catch {}
  applyNativeMode();
};
nativeMbpsSelect.onchange = () => api.setNativeMbps(Number(nativeMbpsSelect.value));
api.onNativeStatus((info) => {
  if (info.state === 'idle') {
    nativeStatusEl.hidden = true;
    return;
  }
  nativeStatusEl.hidden = false;
  if (info.state === 'stats') {
    nativeStatusEl.textContent = `Yerel mod yayında: ${info.fps} fps · ${info.mbps.toFixed(1)} Mbps · ${info.encoder}`;
    setStatus('live', 'Telefon yerel modda bağlı');
  } else if (info.state === 'error') {
    nativeStatusEl.textContent = `Yerel mod hatası: ${info.text}`;
  } else {
    nativeStatusEl.textContent = `Yerel mod: ${info.text}`;
  }
});

function renderEntries(entries) {
  lastEntries = entries;
  for (const kind of ['hotspot', 'usb', 'lan']) {
    const card = $(`card-${kind}`);
    const body = card.querySelector('[data-body]');
    const badge = card.querySelector('[data-badge]');
    const list = entries.filter((e) => e.kind === kind);
    body.textContent = '';
    if (kind === 'lan') card.hidden = list.length === 0;
    badge.textContent = list.length ? 'Hazır' : 'Kapalı';
    badge.classList.toggle('on', list.length > 0);
    if (!list.length) {
      if (EMPTY[kind]) body.appendChild(EMPTY[kind]());
      continue;
    }
    for (const e of list) {
      const row = document.createElement('div');
      row.className = 'entry';
      const useNative = nativeOn && e.nativeQr;
      const img = document.createElement('img');
      img.src = useNative ? e.nativeQr : e.qr;
      img.alt = 'QR kod';
      const text = document.createElement('div');
      const url = document.createElement('div');
      url.className = 'url';
      url.textContent = useNative ? e.nativeUrl : e.url;
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = e.name;
      text.append(url, name);
      row.append(img, text);
      body.appendChild(row);
    }
  }
}

// ---------- ekran listesi ----------
function renderDisplays(displays, selectedId) {
  displaySelect.textContent = '';
  for (const d of displays) {
    const opt = document.createElement('option');
    opt.value = String(d.id);
    opt.textContent = `${d.label} — ${d.width}×${d.height} @ ${d.hz} Hz${d.primary ? ' (ana ekran)' : ''}`;
    displaySelect.appendChild(opt);
  }
  displaySelect.value = String(selectedId);
}

// ---------- ekran yakalama ----------
async function capture() {
  // Ekranı hedef hızın iki katı sıklıkta yokla: yakalayıcı yalnızca yeni kare geldiğinde kare
  // ürettiği için, hedefle aynı hızda yoklamak karelerin bir kısmını kaçırıyor (60 yerine ~48-55).
  // Üst sınırı kodlayıcıdaki maxFramerate belirler.
  const fps = Math.min(240, Number(fpsSelect.value) * 2);
  try {
    const next = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps } },
      audio: false,
    });
    const track = next.getVideoTracks()[0];
    track.contentHint = 'motion';
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = next;
    preview.srcObject = stream;
    if (sender) await sender.replaceTrack(track);
    showError('');
  } catch (err) {
    showError(`Ekran yakalanamadı: ${err.message}`);
  }
}

// ---------- WebRTC ----------
function closePeer() {
  if (pc) {
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.close();
  }
  pc = null;
  sender = null;
  lastStats = null;
}

async function applyEncoding() {
  if (!sender) return;
  let params = sender.getParameters();
  if (!params.encodings || !params.encodings.length) return;
  params.encodings[0].maxBitrate = Number(bitrateSelect.value) * 1_000_000;
  params.encodings[0].maxFramerate = Number(fpsSelect.value);
  params.encodings[0].scaleResolutionDownBy = 1;
  params.encodings[0].priority = 'high';
  params.encodings[0].networkPriority = 'high';
  // Çözünürlük ve kare hızı sabit kalsın; ağ yetmezse yalnızca sıkıştırma artsın.
  for (const preference of ['maintain-framerate-and-resolution', 'maintain-framerate']) {
    params.degradationPreference = preference;
    try {
      await sender.setParameters(params);
      return;
    } catch {
      params = sender.getParameters();
      params.encodings[0].maxBitrate = Number(bitrateSelect.value) * 1_000_000;
      params.encodings[0].maxFramerate = Number(fpsSelect.value);
    }
  }
}

// Bant genişliği tahmini düşükten başlayıp yavaş yükselmesin: başlangıç ve taban bit hızını yükselt.
function boostBitrate(sdp) {
  const selected = Number(bitrateSelect.value) * 1000;
  const start = Math.round(selected * 0.7);
  const min = Math.min(4000, Math.round(selected * 0.3));
  // Üst sınırı setParameters belirler; burada yalnızca tavanı yüksek tut.
  const extra = `x-google-start-bitrate=${start};x-google-min-bitrate=${min};x-google-max-bitrate=60000`;
  return sdp.replace(/^(a=fmtp:\d+ .*)$/gm, (line) => (line.includes('apt=') ? line : `${line};${extra}`));
}

async function startPeer() {
  closePeer();
  if (!stream) await capture();
  if (!stream) return;
  setStatus('connecting', 'Telefon bağlanıyor…');

  pc = new RTCPeerConnection({ iceServers: [] });
  const track = stream.getVideoTracks()[0];
  sender = pc.addTrack(track, stream);

  // Donanım kodlayıcısı olan kodekleri öne al: H.264 High, sonra VP9. Telefon bunları
  // desteklemiyorsa sıradaki ortak kodeğe düşülür.
  const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
  const caps = RTCRtpSender.getCapabilities('video');
  if (transceiver && caps && transceiver.setCodecPreferences) {
    const rank = (c) => {
      const mime = c.mimeType.toLowerCase();
      const fmtp = c.sdpFmtpLine || '';
      if (mime === 'video/h264' && /profile-level-id=64/i.test(fmtp) && /packetization-mode=1/.test(fmtp)) return 0;
      if (mime === 'video/vp9' && /profile-id=0/.test(fmtp)) return 1;
      if (mime === 'video/h264' && /packetization-mode=1/.test(fmtp)) return 2;
      if (mime === 'video/h264') return 3;
      if (mime === 'video/vp8') return 4;
      return 5;
    };
    const ordered = caps.codecs.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
    try {
      transceiver.setCodecPreferences(ordered);
    } catch {}
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: 'candidate', candidate: e.candidate });
  };
  const current = pc;
  pc.onconnectionstatechange = () => {
    if (pc !== current) return;
    const s = pc.connectionState;
    if (s === 'connected') setStatus('live', 'Telefon bağlı, yayın sürüyor');
    else if (s === 'failed') setStatus('error', 'Bağlantı kurulamadı (güvenlik duvarı izni gerekebilir)');
    else if (s === 'disconnected') setStatus('connecting', 'Bağlantı koptu, yeniden deneniyor…');
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  wsSend({ type: 'offer', sdp: pc.localDescription });
}

async function onMessage(msg) {
  if (msg.type === 'viewer-join') {
    viewerPresent = true;
    await startPeer();
  } else if (msg.type === 'viewer-leave') {
    viewerPresent = false;
    closePeer();
    setStatus('idle', 'Telefon bekleniyor');
    statsEl.textContent = 'Yayın bilgisi telefon bağlanınca görünür.';
  } else if (msg.type === 'answer' && pc) {
    await pc.setRemoteDescription({ type: 'answer', sdp: boostBitrate(msg.sdp.sdp) });
    await applyEncoding();
  } else if (msg.type === 'candidate' && pc) {
    try {
      await pc.addIceCandidate(msg.candidate);
    } catch {}
  }
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connectWs() {
  ws = new WebSocket(hostWsUrl);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    queue = queue.then(() => onMessage(msg)).catch((err) => showError(err.message));
  };
  ws.onclose = () => setTimeout(connectWs, 1000);
}

// ---------- istatistik ----------
const LIMIT_TEXT = { none: '', cpu: ' · işlemci sınırlıyor', bandwidth: ' · ağ sınırlıyor', other: '' };

setInterval(async () => {
  if (!pc || !sender || pc.connectionState !== 'connected') return;
  const report = await pc.getStats();
  let out = null;
  let source = null;
  let pair = null;
  let remote = null;
  report.forEach((s) => {
    if (s.type === 'outbound-rtp' && s.kind === 'video') out = s;
    else if (s.type === 'media-source' && s.kind === 'video') source = s;
    else if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
    else if (s.type === 'remote-inbound-rtp' && s.kind === 'video') remote = s;
  });
  if (!out) return;
  if (lastStats) {
    const dt = (out.timestamp - lastStats.timestamp) / 1000;
    const mbps = ((out.bytesSent - lastStats.bytesSent) * 8) / dt / 1_000_000;
    const frames = out.framesEncoded - lastStats.framesEncoded;
    const encodeMs = frames > 0 ? ((out.totalEncodeTime - lastStats.totalEncodeTime) / frames) * 1000 : 0;
    const codec = report.get(out.codecId);
    const name = codec ? codec.mimeType.replace('video/', '') : '';
    const fps = Math.round(out.framesPerSecond || 0);
    const limit = out.qualityLimitationReason || 'none';
    statsEl.textContent = `${out.frameWidth || '?'}×${out.frameHeight || '?'} · ${fps} fps · ${mbps.toFixed(1)} Mbps · ${name}${LIMIT_TEXT[limit] || ''}`;
    api.logStats(
      [
        `gonderen ${out.frameWidth}x${out.frameHeight}`,
        `fps=${fps}`,
        `kaynakFps=${source ? Math.round(source.framesPerSecond || 0) : '?'}`,
        `mbps=${mbps.toFixed(1)}`,
        `hedef=${((out.targetBitrate || 0) / 1e6).toFixed(1)}`,
        `agTahmini=${pair && pair.availableOutgoingBitrate ? (pair.availableOutgoingBitrate / 1e6).toFixed(1) : '?'}`,
        `sinir=${limit}`,
        `kodek=${name}`,
        `kodlayici=${out.encoderImplementation || '?'}`,
        `kodlamaMs=${encodeMs.toFixed(1)}`,
        `rtt=${remote && remote.roundTripTime != null ? Math.round(remote.roundTripTime * 1000) : '?'}`,
        `kayip=${remote && remote.fractionLost != null ? remote.fractionLost.toFixed(3) : '?'}`,
        `nack=${out.nackCount || 0}`,
        `pli=${out.pliCount || 0}`,
      ].join(' ')
    );
  }
  lastStats = {
    timestamp: out.timestamp,
    bytesSent: out.bytesSent,
    framesEncoded: out.framesEncoded,
    totalEncodeTime: out.totalEncodeTime,
  };
}, 1000);

// ---------- olaylar ----------
displaySelect.onchange = async () => {
  await api.selectDisplay(Number(displaySelect.value));
  await capture();
};
fpsSelect.onchange = async () => {
  localStorage.setItem('fps', fpsSelect.value);
  await capture();
  await applyEncoding();
};
bitrateSelect.onchange = async () => {
  localStorage.setItem('bitrate', bitrateSelect.value);
  await applyEncoding();
};
inputCheck.onchange = () => api.setInputEnabled(inputCheck.checked);

api.onNetwork(renderEntries);
api.onRequest((info) => {
  $('lastRequest').textContent = `Son istek: ${info.ip} — ${info.time}`;
});
api.onDisplays(async ({ displays, selectedDisplayId }) => {
  const before = displaySelect.value;
  renderDisplays(displays, selectedDisplayId);
  if (String(selectedDisplayId) !== before) await capture();
});

// Hangi kodeklerde donanım kodlayıcı var? (tanı kaydı)
async function probeEncoders() {
  const tests = {
    'H264-baseline': 'video/H264;profile-level-id=42e02a;packetization-mode=1',
    'H264-high': 'video/H264;profile-level-id=64002a;packetization-mode=1',
    VP8: 'video/VP8',
    VP9: 'video/VP9',
    AV1: 'video/AV1',
    H265: 'video/H265',
  };
  const parts = [];
  for (const [name, contentType] of Object.entries(tests)) {
    for (const [w, h, framerate] of [
      [1920, 1080, 60],
      [1920, 1080, 30],
      [1280, 720, 30],
    ]) {
      try {
        const info = await navigator.mediaCapabilities.encodingInfo({
          type: 'webrtc',
          video: { contentType, width: w, height: h, framerate, bitrate: 8_000_000 },
        });
        parts.push(`${name}@${h}p${framerate}:${info.supported ? (info.powerEfficient ? 'donanim' : 'yazilim') : 'yok'}`);
      } catch {
        parts.push(`${name}@${h}p${framerate}:hata`);
      }
    }
  }
  api.logStats(`kodlayicilar ${parts.filter((p) => p.includes('1080p60')).join(' ')}`);
  const wc = [];
  for (const [name, codec] of Object.entries({ H264: 'avc1.64002A', HEVC: 'hvc1.1.6.L123.00', VP9: 'vp09.00.41.08', AV1: 'av01.0.09M.08' })) {
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec,
        width: 1920,
        height: 1080,
        framerate: 60,
        bitrate: 20_000_000,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'realtime',
      });
      wc.push(`${name}:${r.supported ? 'var' : 'yok'}`);
    } catch (err) {
      wc.push(`${name}:hata`);
    }
  }
  api.logStats(`webcodecsDonanim ${wc.join(' ')}`);
}

(async () => {
  setTimeout(probeEncoders, 6000);
  const state = await api.getState();
  hostWsUrl = state.hostWsUrl;
  inputCheck.checked = state.inputEnabled;
  renderDisplays(state.displays, state.selectedDisplayId);
  $('modeBox').hidden = !state.nativeAvailable;
  if (!state.nativeAvailable) nativeOn = false;
  nativeMbpsSelect.value = String(state.nativeMbps || 30);
  lastEntries = state.entries;
  applyNativeMode();
  // Kare hızı hiç seçilmediyse yayınlanan ekranın yenileme hızına uyan en yüksek seçeneği kullan.
  if (!localStorage.getItem('fps')) {
    const current = state.displays.find((d) => d.id === state.selectedDisplayId);
    const hz = current ? current.hz : 60;
    const options = [...fpsSelect.options].map((o) => Number(o.value)).filter((v) => v <= hz);
    if (options.length) fpsSelect.value = String(Math.max(...options));
  }
  await capture();
  connectWs();
})();
