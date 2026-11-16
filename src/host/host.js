const api = window.myscreen;
const $ = (id) => document.getElementById(id);

const displaySelect = $('display');
const mbpsSelect = $('mbps');
const inputCheck = $('input');
const statusEl = $('status');
const statusText = $('statusText');
const statsEl = $('stats');
const errorEl = $('error');

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

function renderEntries(entries) {
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
      const img = document.createElement('img');
      img.src = e.qr;
      img.alt = 'QR kod';
      const text = document.createElement('div');
      const url = document.createElement('div');
      url.className = 'url';
      url.textContent = e.url;
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

// ---------- yayın durumu ----------
api.onStreamStatus((info) => {
  if (info.state === 'idle') {
    setStatus('idle', 'Telefon bekleniyor');
    statsEl.textContent = 'Yayın bilgisi telefon bağlanınca görünür.';
  } else if (info.state === 'stats') {
    setStatus('live', 'Telefon bağlı, yayın sürüyor');
    statsEl.textContent = `${info.fps} fps · ${info.mbps.toFixed(1)} Mbps · ${info.encoder}`;
  } else if (info.state === 'error') {
    setStatus('error', 'Yayın hatası');
    statsEl.textContent = info.text;
  } else if (info.state === 'live') {
    setStatus('connecting', 'Yayın başlıyor…');
    statsEl.textContent = info.text;
  }
});

// ---------- bağlı telefon ----------
const disconnectBtn = $('disconnect');
function showViewer(ip) {
  disconnectBtn.hidden = !ip;
  disconnectBtn.title = ip ? `${ip} adresindeki telefonun bağlantısını kes` : '';
}
api.onViewer(({ ip }) => showViewer(ip));
disconnectBtn.onclick = async () => {
  disconnectBtn.disabled = true;
  await api.disconnectViewer();
  disconnectBtn.disabled = false;
  setStatus('idle', 'Bağlantı kesildi');
  statsEl.textContent = 'Telefonda "Yeniden bağlan"a dokununca yayın yeniden başlar.';
};

// ---------- cihaz (sanal ekran çözünürlüğü) ----------
const deviceSelect = $('device');
const deviceStatus = $('deviceStatus');
let currentDevice = '';
function renderDevices(devices, selected) {
  deviceSelect.textContent = '';
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} — ${d.width}×${d.height} @ ${d.hz} Hz`;
    deviceSelect.appendChild(opt);
  }
  deviceSelect.value = selected;
  currentDevice = selected;
}
deviceSelect.onchange = async () => {
  const id = deviceSelect.value;
  deviceSelect.disabled = true;
  deviceStatus.hidden = false;
  deviceStatus.textContent = 'Sanal ekran ayarlanıyor… (ilk seferde sürücü yeniden yüklenir, ekran birkaç saniye kaybolabilir)';
  const result = await api.setDevice(id);
  deviceSelect.disabled = false;
  if (result.ok) {
    currentDevice = id;
    deviceStatus.textContent = `Sanal ekran ${result.mode.width}×${result.mode.height} @ ${result.mode.hz} Hz yapıldı.`;
  } else {
    deviceSelect.value = currentDevice;
    deviceStatus.textContent = `Ayarlanamadı: ${result.error}`;
  }
};

// ---------- olaylar ----------
displaySelect.onchange = () => api.selectDisplay(Number(displaySelect.value));
mbpsSelect.onchange = () => api.setMbps(Number(mbpsSelect.value));
inputCheck.onchange = () => api.setInputEnabled(inputCheck.checked);
$('manageVirtual').onchange = (e) => api.setManageVirtualDisplay(e.target.checked);

api.onNetwork(renderEntries);
api.onRequest((info) => {
  $('lastRequest').textContent = `Son istek: ${info.ip} — ${info.time}`;
});
api.onDisplays(({ displays, selectedDisplayId }) => renderDisplays(displays, selectedDisplayId));

(async () => {
  const state = await api.getState();
  inputCheck.checked = state.inputEnabled;
  $('manageVirtual').checked = state.manageVirtualDisplay;
  showViewer(state.viewerIp);
  renderDevices(state.devices, state.device);
  mbpsSelect.value = String(state.mbps || 30);
  renderDisplays(state.displays, state.selectedDisplayId);
  renderEntries(state.entries);
  if (state.serverError) showError(state.serverError);
  else if (!state.ffmpegAvailable)
    showError('ffmpeg bulunamadı. Bir komut isteminde "winget install Gyan.FFmpeg" çalıştırıp My Screen\'i yeniden başlat.');
})();
