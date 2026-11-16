const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');
const { createNativeStreamer } = require('./native');

const CLIENT_DIR = path.join(__dirname, 'client');
// PowerShell yardımcıları paketlenmiş uygulamada app.asar dışına (app.asar.unpacked) çıkarılıyor.
const unpacked = (file) => path.join(__dirname, file).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const BASE_PORT = 8787; // HTTP: yalnızca HTTPS sayfasına yönlendirir (eski kısayollar çalışsın diye)

let win = null;
let port = BASE_PORT;
let securePort = 0; // telefon sayfası (HTTPS; telefonda WebCodecs güvenli bağlam ister)
let serverError = '';
let config = {
  token: '',
  selectedDisplayId: null,
  inputEnabled: true,
  nativeMbps: 30,
  nativeOutputs: {},
  manageVirtualDisplay: true, // sanal ekranı uygulama açılınca bağla, kapanınca ayır
  device: 'galaxy-a36', // sanal ekranın hangi cihaza göre ayarlandığı (DEVICES)
  virtualSide: 'right', // sanal ekran Windows'ta laptop ekranının sağında mı solunda mı
  virtualMode: { width: 2340, height: 1080, hz: 120, x: -1, y: 0 }, // son kullanılan sanal ekran düzeni
};
let viewerSocket = null;
let streamer = null;
let targetRect = null; // seçili ekranın fiziksel piksel dikdörtgeni
let helper = null;
let entries = [];
let adapterDescriptions = {};
let lastInterfaceKey = '';

// ---------- ayarlar ----------
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function loadConfig() {
  try {
    Object.assign(config, JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch {}
  if (!config.token) {
    config.token = crypto.randomBytes(9).toString('base64url');
    saveConfig();
  }
}
function saveConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch {}
}
function logStats(line) {
  const time = new Date().toLocaleTimeString('tr-TR');
  fs.appendFile(path.join(app.getPath('userData'), 'stats.log'), `${time} ${String(line).slice(0, 400)}\n`, () => {});
}

// ---------- ekranlar ----------
function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Ekran ${i + 1}`,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    hz: Math.round(d.displayFrequency || 60),
    primary: d.id === primaryId,
  }));
}
// Kullanıcı bir ekran seçmediyse sanal ekranı (yoksa ana olmayan ilk ekranı, o da yoksa ana ekranı) yayınla.
function selectedDisplay() {
  const all = screen.getAllDisplays();
  const chosen = all.find((d) => d.id === config.selectedDisplayId);
  if (chosen) return chosen;
  const primary = screen.getPrimaryDisplay();
  const others = all.filter((d) => d.id !== primary.id);
  return others.find((d) => /VDD|Virtual/i.test(d.label || '')) || others[0] || primary;
}
function selectedPixelSize() {
  const d = selectedDisplay();
  return { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
}
// Yayınlanan ekranın yenileme hızı: bundan fazla kare göndermek yalnızca tekrar ve tablette takılma demek.
function selectedHz() {
  return Math.max(30, Math.round(selectedDisplay().displayFrequency || 60));
}
function refreshTargetRect() {
  targetRect = screen.dipToScreenRect(null, selectedDisplay().bounds);
}
let lastDisplayKey = '';
function onDisplaysChanged() {
  refreshTargetRect();
  // Görev çubuğu gibi küçük değişikliklerde de tetikleniyor; yalnızca ekran düzeni değiştiyse yeniden başlat.
  const key = JSON.stringify(listDisplays());
  if (key === lastDisplayKey) return;
  lastDisplayKey = key;
  streamer.resetCache();
  streamer.warmup(selectedPixelSize());
  streamer.restart(selectedPixelSize(), selectedHz());
  if (win) win.webContents.send('displays', { displays: listDisplays(), selectedDisplayId: selectedDisplay().id });
}

// ---------- cihaz profilleri ----------
// Sanal ekran bu çözünürlük ve yenileme hızına ayarlanır; görüntü cihazın ekranını tam doldurur.
const DEVICES = [
  { id: 'galaxy-a36', name: 'Galaxy A36 (telefon)', width: 2340, height: 1080, hz: 120 },
  { id: 'galaxy-tab-s6', name: 'Galaxy Tab S6 (tablet)', width: 2560, height: 1600, hz: 60 },
];
const VDD_SETTINGS = 'C:\\VirtualDisplayDriver\\vdd_settings.xml';
const VDD_PIPE = '\\\\.\\pipe\\MTTVirtualDisplayPipe';

function runDisplayHelper(action, mode) {
  return new Promise((resolve) => {
    execFile('powershell.exe', displayHelperArgs(action, mode), { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      resolve(err ? { ok: false, error: err.message } : parseHelper(stdout));
    });
  });
}

// Çözünürlük sürücünün ayar dosyasında yoksa ekle (yenileme hızları dosyadaki genel listeden gelir).
function addResolutionToDriver(width, height) {
  const text = fs.readFileSync(VDD_SETTINGS, 'utf8');
  const exists = new RegExp(`<width>${width}</width>\\s*<height>${height}</height>`).test(text);
  if (exists) return false;
  const entry = `        <resolution>\r\n            <width>${width}</width>\r\n            <height>${height}</height>\r\n            <refresh_rate>60</refresh_rate>\r\n        </resolution>\r\n    </resolutions>`;
  fs.writeFileSync(VDD_SETTINGS, text.replace(/\s*<\/resolutions>/, `\r\n${entry}`), 'utf8');
  return true;
}

// Sürücüye ayarları yeniden okut (yönetici izni gerekmez; VDD Control'ün kullandığı kanal).
function reloadDriver() {
  return new Promise((resolve) => {
    const socket = require('net').connect(VDD_PIPE, () => {
      socket.end(Buffer.from('RELOAD_DRIVER', 'utf16le'));
    });
    socket.on('error', (err) => resolve({ ok: false, error: err.message }));
    socket.on('close', () => resolve({ ok: true }));
    setTimeout(() => {
      socket.destroy();
      resolve({ ok: true });
    }, 5000);
  });
}

// Sanal ekranı verilen moda (çözünürlük + yenileme) ayarla. Çözünürlük sürücüde yoksa eklenir ve
// sürücü yeniden yüklenir (ekran ~6 sn kaybolup geri gelir).
async function applyMode(mode) {
  const want = `${mode.width}x${mode.height}@${mode.hz}`;
  let modes = await runDisplayHelper('modes');
  if (!modes.found) return { ok: false, error: 'Sanal ekran sürücüsü bulunamadı' };
  if (!(modes.modes || []).includes(want)) {
    try {
      addResolutionToDriver(mode.width, mode.height);
    } catch (err) {
      return { ok: false, error: `Sürücü ayar dosyası yazılamadı: ${err.message}` };
    }
    logStats(`surucu yeniden yukleniyor (${want} icin)`);
    await reloadDriver();
    // Sürücü yeniden yüklenince ekran birkaç saniye kaybolup geri geliyor.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      modes = await runDisplayHelper('modes');
      if ((modes.modes || []).includes(want)) break;
    }
    if (!(modes.modes || []).includes(want)) return { ok: false, error: `${want} modu sürücüde görünmedi` };
  }
  const result = await runDisplayHelper('set', { width: mode.width, height: mode.height, hz: mode.hz, x: sideX(mode.width), y: 0 });
  if (!result.ok) return { ok: false, error: `Ekran ayarı uygulanamadı (kod ${result.result})` };
  config.virtualMode = { width: result.width, height: result.height, hz: result.hz, x: result.x, y: result.y };
  saveConfig();
  return { ok: true, mode: config.virtualMode };
}

async function applyDevice(id) {
  if (id === 'auto') {
    // Otomatik: bağlı cihaz varsa onun bildirdiği ekrana hemen uy, yoksa bağlanınca uyulur.
    config.device = 'auto';
    saveConfig();
    if (lastDeviceInfo) return applyAuto(lastDeviceInfo);
    return { ok: true, mode: config.virtualMode, pending: true };
  }
  const device = DEVICES.find((d) => d.id === id);
  if (!device) return { ok: false, error: 'Bilinmeyen cihaz' };
  const result = await applyMode(device);
  logStats(`cihaz ${device.id} uygulandi: ${JSON.stringify(result)}`);
  if (result.ok) {
    config.device = device.id;
    saveConfig();
  }
  return result;
}

// ---------- otomatik mod ----------
// Bağlanan cihazın sayfası ekranının fiziksel çözünürlüğünü ve ölçtüğü yenileme hızını bildirir.
const VDD_RATES = [60, 90, 120, 144, 165]; // sürücü ayarlarındaki genel yenileme hızları
let lastDeviceInfo = null;
function autoModeFrom(info) {
  let w = Math.round(Number(info.width)) || 0;
  let h = Math.round(Number(info.height)) || 0;
  if (h > w) [w, h] = [h, w]; // yatay kullanım
  // Tarayıcı ekranı ölçekli birimle bildirir; Android'de "Ekran yakınlaştırma" değişince ölçüm
  // gerçek boyutun biraz altında çıkar (A36: 2340x1080 yerine 2250x1012). Bilinen bir profile
  // her boyutta %8'den yakınsa profilin gerçek çözünürlüğünü kullan.
  const near = DEVICES.find((d) => Math.abs(w / d.width - 1) <= 0.08 && Math.abs(h / d.height - 1) <= 0.08);
  if (near) [w, h] = [near.width, near.height];
  // Mantıklı sınırlar; sürücü çift sayılı boyutları sever.
  w = Math.min(3840, Math.max(800, w - (w % 2)));
  h = Math.min(2400, Math.max(480, h - (h % 2)));
  const measured = Number(info.hz) || 60;
  const hz = VDD_RATES.reduce((best, r) => (Math.abs(r - measured) < Math.abs(best - measured) ? r : best), 60);
  return { width: w, height: h, hz };
}
async function applyAuto(info) {
  if (applyAuto.running) return applyAuto.running;
  applyAuto.running = applyAutoNow(info).finally(() => (applyAuto.running = null));
  return applyAuto.running;
}
// Android tarayıcıları "masaüstü sürümü" açıkken kendini Linux bilgisayar gibi tanıtır ve sayfaya
// sahte bir ekran boyutu bildirir (Tab S6'da 2560x1600 yerine 2001x1200). Bu durumda ayar yapma.
function isDesktopModeAndroid(info) {
  return /X11; Linux/.test(info.ua || '') && !/Windows|Macintosh|CrOS/.test(info.ua || '');
}
async function applyAutoNow(info) {
  if (isDesktopModeAndroid(info)) {
    const result = { ok: false, error: 'Cihazın tarayıcısında "masaüstü sürümü" açık; ekran boyutunu doğru bildirmiyor. Tarayıcı menüsünden kapat.' };
    logStats('otomatik mod: masaustu surumu acik, ayar yapilmadi');
    if (win) win.webContents.send('auto-mode', { info, result });
    return result;
  }
  const mode = autoModeFrom(info);
  const cur = config.virtualMode || {};
  const st = await runDisplayHelper('status');
  if (st.attached && st.width === mode.width && st.height === mode.height && st.hz === mode.hz) return { ok: true, mode: cur };
  logStats(`otomatik mod: cihaz ${info.width}x${info.height} ${info.hz}Hz -> sanal ekran ${mode.width}x${mode.height}@${mode.hz}`);
  const result = await applyMode(mode);
  logStats(`otomatik mod sonucu: ${JSON.stringify(result)}`);
  if (win) win.webContents.send('auto-mode', { info, result });
  return result;
}
async function onDeviceInfo(info) {
  lastDeviceInfo = info;
  logStats(`cihaz bildirdi ${JSON.stringify({ width: info.width, height: info.height, hz: info.hz, raw: info.raw, ua: info.ua })}`);
  if (win) win.webContents.send('auto-mode', { info });
  if (config.device !== 'auto') return;
  await applyAuto(info);
}

// Sanal ekranın masaüstündeki yatay konumu: laptop ekranının sağı ya da solu (üst kenarlar hizalı).
function sideX(width) {
  if (config.virtualSide === 'left') return -width;
  const p = screen.getPrimaryDisplay();
  return Math.round(p.bounds.x * p.scaleFactor + p.size.width * p.scaleFactor);
}
async function applySide(side) {
  config.virtualSide = side === 'left' ? 'left' : 'right';
  saveConfig();
  const st = await runDisplayHelper('status');
  if (!st.attached) return { ok: true };
  const result = await runDisplayHelper('set', { width: st.width, height: st.height, hz: st.hz, x: sideX(st.width), y: 0 });
  logStats(`sanal ekran konumu ${config.virtualSide}: ${JSON.stringify(result)}`);
  return result.ok ? { ok: true } : { ok: false, error: `Konum değiştirilemedi (kod ${result.result})` };
}

// ---------- sanal ekranı aç/kapat ----------
const DISPLAY_HELPER = unpacked('display-helper.ps1');
function displayHelperArgs(action, mode) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DISPLAY_HELPER, action];
  // Adlandırılmış parametre: konumsal verince PowerShell '-2560' gibi negatif sayıları parametre adı sanıyor.
  if (mode) args.push('-Width', String(mode.width), '-Height', String(mode.height), '-Hz', String(mode.hz || 0), '-X', String(mode.x ?? -99999), '-Y', String(mode.y || 0));
  return args;
}
function parseHelper(out) {
  try {
    return JSON.parse(String(out).trim().split(/\r?\n/).pop());
  } catch {
    return { ok: false, error: String(out).slice(0, 200) };
  }
}
function attachVirtualDisplay() {
  return new Promise((resolve) => {
    execFile('powershell.exe', displayHelperArgs('attach', { ...config.virtualMode, x: sideX(config.virtualMode.width), y: 0 }), { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      const result = err ? { ok: false, error: err.message } : parseHelper(stdout);
      logStats(`sanal ekran baglama: ${JSON.stringify(result)}`);
      resolve(result);
    });
  });
}
// Kapanışta çağrılır; uygulama kapanmadan bitmesi için eşzamanlı.
function detachVirtualDisplay() {
  try {
    const result = parseHelper(execFileSync('powershell.exe', displayHelperArgs('detach'), { windowsHide: true, timeout: 20000 }));
    if (result.width && result.height) {
      config.virtualMode = { width: result.width, height: result.height, hz: result.hz, x: result.x, y: result.y };
      saveConfig();
    }
    logStats(`sanal ekran ayirma: ${JSON.stringify(result)}`);
  } catch (err) {
    logStats(`sanal ekran ayirma hatasi: ${err.message}`);
  }
}

// Seçili ekranın köşesinde bir anlığına 1 piksellik pencere açıp kapatır. Ekran hiç değişmiyorken
// yakalama yeni kare üretmediği için telefon "Görüntü bekleniyor"da kalıyordu; bu ilk kareyi tetikler.
function nudgeDisplay() {
  const b = selectedDisplay().bounds;
  const w = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: 1,
    height: 1,
    frame: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#000000',
  });
  w.setIgnoreMouseEvents(true);
  w.showInactive();
  setTimeout(() => w.destroy(), 150);
}

// ---------- fare girdisi (PowerShell yardımcı süreci) ----------
function startHelper() {
  helper = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', unpacked('input-helper.ps1')],
    { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }
  );
  helper.on('exit', () => {
    helper = null;
  });
  helper.stdin.on('error', () => {});
}
function sendHelper(line) {
  if (!helper) startHelper();
  helper.stdin.write(line + '\n');
}
function handleInput(msg) {
  if (!config.inputEnabled || !targetRect) return;
  switch (msg.k) {
    case 'm': {
      const nx = Math.min(1, Math.max(0, Number(msg.x)));
      const ny = Math.min(1, Math.max(0, Number(msg.y)));
      if (Number.isNaN(nx) || Number.isNaN(ny)) return;
      // Kenarlarda 1 piksel pay: dokunuş ekranın en kenarına gelince imleç yan ekrana kaçmasın.
      const x = Math.round(targetRect.x + 1 + nx * (targetRect.width - 3));
      const y = Math.round(targetRect.y + 1 + ny * (targetRect.height - 3));
      sendHelper(`m ${x} ${y}`);
      break;
    }
    case 'd':
    case 'u':
    case 'r':
      sendHelper(msg.k);
      break;
    case 'w':
    case 'h': {
      const delta = Math.max(-2400, Math.min(2400, Math.round(Number(msg.v)) || 0));
      if (delta) sendHelper(`${msg.k} ${delta}`);
      break;
    }
  }
}

// ---------- ağ arayüzleri ----------
function cleanIp(addr) {
  return (addr || '').replace(/^::ffff:/, '');
}
function isLoopback(addr) {
  const ip = cleanIp(addr);
  return ip === '127.0.0.1' || ip === '::1';
}
// Yalnızca yerel (özel) ağ adreslerinden gelen bağlantıları kabul et.
function isPrivate(addr) {
  const ip = cleanIp(addr);
  if (isLoopback(addr)) return true;
  const m = ip.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function classify(name) {
  const desc = adapterDescriptions[name] || '';
  const text = `${name} ${desc}`;
  if (/Wi-Fi Direct Virtual/i.test(desc)) return 'hotspot';
  if (/Remote NDIS|RNDIS|Android|USB/i.test(desc)) return 'usb';
  if (/Hyper-V|vEthernet|VirtualBox|VMware|TAP|TUN|VPN|WSL|Loopback|Bluetooth/i.test(text)) return null;
  return 'lan';
}
function currentInterfaces() {
  const result = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        result.push({ name, address: a.address });
      }
    }
  }
  return result;
}
function loadAdapterDescriptions() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-NetAdapter | Select-Object Name,InterfaceDescription | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (!err) {
          try {
            let list = JSON.parse(stdout);
            if (!Array.isArray(list)) list = [list];
            adapterDescriptions = {};
            for (const a of list) adapterDescriptions[a.Name] = a.InterfaceDescription || '';
          } catch {}
        }
        resolve();
      }
    );
  });
}
async function refreshNetwork(force) {
  const interfaces = currentInterfaces();
  const key = interfaces.map((i) => `${i.name}=${i.address}`).join('|');
  if (!force && key === lastInterfaceKey) return;
  lastInterfaceKey = key;
  await loadAdapterDescriptions();
  const next = [];
  if (securePort) {
    for (const i of interfaces) {
      const kind = classify(i.name);
      if (!kind || !isPrivate(i.address)) continue;
      const url = `https://${i.address}:${securePort}/?t=${config.token}`;
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
      next.push({ kind, name: i.name, address: i.address, url, qr });
    }
  }
  entries = next;
  if (win) win.webContents.send('network', entries);
}

// ---------- sunucular ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function noteRequest(addr, what) {
  if (isLoopback(addr)) return;
  const info = { ip: cleanIp(addr), what, time: new Date().toLocaleTimeString('tr-TR') };
  fs.appendFile(path.join(app.getPath('userData'), 'requests.log'), `${info.time} ${info.ip} ${what}\n`, () => {});
  if (win) win.webContents.send('request', info);
}

function serveClient(req, res) {
  if (!isPrivate(req.socket.remoteAddress)) {
    req.socket.destroy();
    return;
  }
  noteRequest(req.socket.remoteAddress, 'sayfa');
  const url = new URL(req.url, 'http://x');
  // native.html: deneysel sürümden kalan kısayollar için eski ad.
  const file = url.pathname === '/' || url.pathname === '/native.html' ? 'index.html' : path.basename(url.pathname);
  const full = path.join(CLIENT_DIR, file);
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Bulunamadı');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// Eski http:// kısayollarını HTTPS sayfasına yönlendir.
function redirectToSecure(req, res) {
  if (!isPrivate(req.socket.remoteAddress) || !securePort) {
    req.socket.destroy();
    return;
  }
  const url = new URL(req.url, 'http://x');
  const host = (req.headers.host || '').replace(/:\d+$/, '') || '127.0.0.1';
  res.writeHead(302, { Location: `https://${host}:${securePort}/${url.search}`, 'Cache-Control': 'no-store' });
  res.end();
}

function send(socket, msg) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
}

function notifyViewer(ip) {
  if (win) win.webContents.send('viewer', { connected: !!ip, ip: ip || '' });
}

// Panelden "Bağlantıyı kes": telefon kendiliğinden yeniden bağlanmaz, "Yeniden bağlan" düğmesi gösterir.
function disconnectViewer() {
  if (!viewerSocket) return;
  const socket = viewerSocket;
  viewerSocket = null;
  streamer.detach(socket);
  send(socket, { type: 'kicked' });
  socket.close(4003, 'kicked');
  logStats('telefon baglantisi panelden kesildi');
  notifyViewer('');
}

// Telefon sayfasının sürümü: dosyalar değişince telefon açık kalan eski sayfayı kendiliğinden yeniler.
let clientBuild = '';
function computeClientBuild() {
  const hash = crypto.createHash('sha1');
  for (const name of fs.readdirSync(CLIENT_DIR).sort()) hash.update(name).update(fs.readFileSync(path.join(CLIENT_DIR, name)));
  clientBuild = hash.digest('hex').slice(0, 12);
}

function onViewer(socket, ip) {
  if (viewerSocket) {
    send(viewerSocket, { type: 'replaced' });
    viewerSocket.close(4002, 'replaced');
    streamer.detach(viewerSocket);
  }
  viewerSocket = socket;
  socket.myScreenIp = ip;
  logStats(`telefon baglandi ${ip}`);
  notifyViewer(ip);
  send(socket, { type: 'hello', build: clientBuild });
  socket.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'input') handleInput(msg);
    else if (msg.type === 'stats') logStats(`telefon ${msg.line}`);
    else if (msg.type === 'key') streamer.requestKey();
    else if (msg.type === 'device-info') onDeviceInfo(msg);
    else if (msg.type === 'client-log') logStats(`cihaz: ${String(msg.text).slice(0, 300)}`);
  });
  socket.on('close', () => {
    if (viewerSocket === socket) {
      viewerSocket = null;
      streamer.detach(socket);
      logStats('telefon ayrildi');
      notifyViewer('');
    }
  });
  if (!streamer.available) {
    send(socket, { type: 'error', text: 'Bilgisayarda ffmpeg bulunamadı. My Screen penceresindeki talimatı izle.' });
    return;
  }
  streamer.attach(socket, selectedPixelSize(), config.nativeMbps, selectedHz());
}

function onUpgrade(wss, req, socket, head) {
  if (!isPrivate(req.socket.remoteAddress)) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url, 'http://x');
  const ok = url.pathname === '/ws' && url.searchParams.get('t') === config.token;
  const remote = req.socket.remoteAddress;
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!ok) {
      ws.close(4001, 'unauthorized');
      return;
    }
    onViewer(ws, isLoopback(remote) ? '127.0.0.1' : cleanIp(remote));
  });
}

async function loadCertificate() {
  const file = path.join(app.getPath('userData'), 'cert.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.cert && saved.key) return saved;
  } catch {}
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'My Screen' }], { days: 3650, keySize: 2048 });
  const result = { cert: pems.cert, key: pems.private };
  fs.writeFileSync(file, JSON.stringify(result));
  return result;
}

// Sunucuyu ilk boş porta aç (first'ten başlayarak).
function listenOn(server, first) {
  return new Promise((resolve, reject) => {
    let candidate = first;
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && candidate < first + 20) {
        candidate += 1;
        server.listen(candidate, '0.0.0.0');
      } else {
        reject(err);
      }
    });
    server.on('listening', () => resolve(candidate));
    server.listen(candidate, '0.0.0.0');
  });
}

async function startServers() {
  try {
    const plain = http.createServer(redirectToSecure);
    plain.on('connection', (socket) => noteRequest(socket.remoteAddress, 'tcp'));
    port = await listenOn(plain, BASE_PORT);

    const { cert, key } = await loadCertificate();
    const server = https.createServer({ cert, key }, serveClient);
    const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    server.on('connection', (socket) => noteRequest(socket.remoteAddress, 'tcp-https'));
    server.on('upgrade', (req, socket, head) => onUpgrade(wss, req, socket, head));
    securePort = await listenOn(server, port + 1);
  } catch (err) {
    serverError = `Sunucu açılamadı: ${err.message}`;
    logStats(serverError);
  }
}

// ---------- uygulama ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    autoHideMenuBar: true,
    title: 'My Screen',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#11131a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, 'host', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

// Kısayola ikinci kez tıklanırsa yeni kopya açma, mevcut pencereyi öne getir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

// Kurulu sürümde de ayarlar ve sertifika aynı klasörde kalsın (ürün adı "My Screen" olsa da).
app.setPath('userData', path.join(app.getPath('appData'), 'my-screen'));

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  loadConfig();
  computeClientBuild();
  if (config.manageVirtualDisplay) await attachVirtualDisplay();
  refreshTargetRect();
  lastDisplayKey = JSON.stringify(listDisplays());
  streamer = createNativeStreamer({
    log: logStats,
    onStatus: (info) => {
      if (win) win.webContents.send('stream-status', info);
      // Yayın hatasını cihaza da bildir; yoksa cihaz sebepsiz "Görüntü bekleniyor"da kalıyordu.
      if (info.state === 'error') send(viewerSocket, { type: 'stream-error', text: info.text });
    },
    onNeedFrame: nudgeDisplay,
    cache: config.nativeOutputs || {},
    saveCache: (map) => {
      config.nativeOutputs = map;
      saveConfig();
    },
  });
  streamer.warmup(selectedPixelSize());
  await startServers();
  startHelper();

  ipcMain.handle('get-state', async () => {
    await refreshNetwork(true);
    return {
      displays: listDisplays(),
      selectedDisplayId: selectedDisplay().id,
      inputEnabled: config.inputEnabled,
      mbps: config.nativeMbps,
      manageVirtualDisplay: config.manageVirtualDisplay,
      devices: DEVICES,
      virtualSide: config.virtualSide,
      device: config.device,
      viewerIp: viewerSocket ? viewerSocket.myScreenIp : '',
      ffmpegAvailable: streamer.available,
      serverError,
      entries,
    };
  });
  ipcMain.handle('select-display', (e, id) => {
    config.selectedDisplayId = id;
    saveConfig();
    refreshTargetRect();
    streamer.warmup(selectedPixelSize());
    streamer.restart(selectedPixelSize(), selectedHz());
  });
  ipcMain.handle('set-input-enabled', (e, value) => {
    config.inputEnabled = !!value;
    saveConfig();
  });
  ipcMain.handle('set-mbps', (e, value) => {
    config.nativeMbps = Math.max(5, Math.min(80, Number(value) || 30));
    saveConfig();
    streamer.setBitrate(config.nativeMbps);
  });
  ipcMain.handle('disconnect-viewer', () => disconnectViewer());
  ipcMain.handle('set-device', (e, id) => applyDevice(id));
  ipcMain.handle('set-side', (e, side) => applySide(side));
  ipcMain.handle('set-manage-virtual-display', async (e, value) => {
    config.manageVirtualDisplay = !!value;
    saveConfig();
    if (config.manageVirtualDisplay) await attachVirtualDisplay();
  });
  ipcMain.handle('open-hotspot-settings', () => shell.openExternal('ms-settings:network-mobilehotspot'));

  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  createWindow();
  if (process.env.MYSCREEN_TICK) {
    // Tanı (MYSCREEN_TICK=1): seçili ekranın köşesinde her karede renk değiştiren küçük pencere açar;
    // ekran sürekli güncellendiği için ulaşılabilen en yüksek kare hızı stats.log'dan okunabilir.
    const b = selectedDisplay().bounds;
    const tick = new BrowserWindow({ x: b.x, y: b.y, width: 8, height: 8, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, webPreferences: { backgroundThrottling: false } });
    tick.setIgnoreMouseEvents(true);
    tick.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0"><script>let i=0;(function f(){document.body.style.background=(i++%2)?"#000":"#fff";requestAnimationFrame(f)})()</script>'));
  }
  setInterval(() => refreshNetwork(false), 2500);
});

app.on('window-all-closed', () => {
  if (helper) helper.kill();
  if (streamer) streamer.detach();
  app.quit();
});

app.on('will-quit', () => {
  // İkinci kopya kapanırken asıl uygulamanın sanal ekranına dokunma.
  if (app.hasSingleInstanceLock() && config.manageVirtualDisplay) detachVirtualDisplay();
});
