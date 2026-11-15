const { app, BrowserWindow, ipcMain, screen, desktopCapturer, session, shell } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');
const { createNativeStreamer } = require('./native');

// Yerel ağda doğrudan bağlantı için gerçek IP adaylarını kullan (mDNS gizlemesi kapalı).
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// GPU korumalı alanı açıkken Windows'un donanım video kodlayıcıları (Intel Quick Sync / NVENC)
// görünmüyor ve 1080p60 yazılımla kodlanmak zorunda kalıyor. Uygulama yalnızca kendi yerel
// sayfalarını gösterdiği için korumalı alanı kapatmak kabul edilebilir.
app.commandLine.appendSwitch('disable-gpu-sandbox');

const CLIENT_DIR = path.join(__dirname, 'client');
const BASE_PORT = 8787;
const hostKey = crypto.randomBytes(16).toString('hex');

let win = null;
let port = BASE_PORT;
let securePort = 0; // yerel mod sayfası (HTTPS; telefonda WebCodecs güvenli bağlam ister)
let config = { token: '', selectedDisplayId: null, inputEnabled: true, nativeMbps: 30 };
let hostSocket = null;
let viewerSocket = null;
let nativeSocket = null;
let native = null;
let viewerIp = '';
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
function refreshTargetRect() {
  targetRect = screen.dipToScreenRect(null, selectedDisplay().bounds);
}
function selectedPixelSize() {
  const d = selectedDisplay();
  return { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
}
function pushDisplays() {
  refreshTargetRect();
  if (win) win.webContents.send('displays', { displays: listDisplays(), selectedDisplayId: selectedDisplay().id });
}

// ---------- fare girdisi (PowerShell yardımcı süreci) ----------
function startHelper() {
  helper = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'input-helper.ps1')],
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
      const x = Math.round(targetRect.x + nx * (targetRect.width - 1));
      const y = Math.round(targetRect.y + ny * (targetRect.height - 1));
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
  for (const i of interfaces) {
    const kind = classify(i.name);
    if (!kind || !isPrivate(i.address)) continue;
    const url = `http://${i.address}:${port}/?t=${config.token}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    let nativeUrl = '';
    let nativeQr = '';
    if (securePort) {
      nativeUrl = `https://${i.address}:${securePort}/native.html?t=${config.token}`;
      nativeQr = await QRCode.toDataURL(nativeUrl, { margin: 1, width: 240 });
    }
    next.push({ kind, name: i.name, address: i.address, url, qr, nativeUrl, nativeQr });
  }
  entries = next;
  if (win) win.webContents.send('network', entries);
}

// ---------- HTTP + WebSocket sunucusu ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

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
function noteRequest(addr, what) {
  if (isLoopback(addr)) return;
  const info = { ip: cleanIp(addr), what, time: new Date().toLocaleTimeString('tr-TR') };
  fs.appendFile(path.join(app.getPath('userData'), 'requests.log'), `${info.time} ${info.ip} ${what}\n`, () => {});
  if (win) win.webContents.send('request', info);
}

function logStats(line) {
  const time = new Date().toLocaleTimeString('tr-TR');
  fs.appendFile(path.join(app.getPath('userData'), 'stats.log'), `${time} ${String(line).slice(0, 400)}\n`, () => {});
}

function serveClient(req, res) {
  if (!isPrivate(req.socket.remoteAddress)) {
    req.socket.destroy();
    return;
  }
  noteRequest(req.socket.remoteAddress, 'sayfa');
  const url = new URL(req.url, 'http://x');
  const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
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

function send(socket, msg) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
}
function cleanIp(addr) {
  return (addr || '').replace(/^::ffff:/, '');
}
function isLoopback(addr) {
  const ip = cleanIp(addr);
  return ip === '127.0.0.1' || ip === '::1';
}

function onHost(socket) {
  if (hostSocket) hostSocket.close();
  hostSocket = socket;
  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'offer' || msg.type === 'candidate') send(viewerSocket, msg);
  });
  socket.on('close', () => {
    if (hostSocket === socket) hostSocket = null;
  });
  if (viewerSocket) send(hostSocket, { type: 'viewer-join', ip: viewerIp });
}

function onViewer(socket, ip) {
  if (viewerSocket) {
    send(viewerSocket, { type: 'replaced' });
    viewerSocket.close(4002, 'replaced');
  }
  viewerSocket = socket;
  viewerIp = ip;
  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'input') {
      handleInput(msg);
    } else if (msg.type === 'stats') {
      logStats(`telefon ${msg.line}`);
    } else if (msg.type === 'answer') {
      send(hostSocket, msg);
    } else if (msg.type === 'candidate') {
      // Telefonun tarayıcısı yerel IP'yi mDNS adıyla gizler; gerçek adresi biliyoruz.
      if (msg.candidate && typeof msg.candidate.candidate === 'string' && ip) {
        msg.candidate.candidate = msg.candidate.candidate.replace(/\S+\.local/g, ip);
      }
      send(hostSocket, msg);
    }
  });
  socket.on('close', () => {
    if (viewerSocket === socket) {
      viewerSocket = null;
      viewerIp = '';
      send(hostSocket, { type: 'viewer-leave' });
    }
  });
  send(hostSocket, { type: 'viewer-join', ip });
}

// ---------- yerel mod (deneysel) ----------
function sendNativeStatus(info) {
  if (win) win.webContents.send('native-status', info);
}
function onNative(socket, ip) {
  if (nativeSocket) {
    send(nativeSocket, { type: 'replaced' });
    nativeSocket.close(4002, 'replaced');
    native.detach(nativeSocket);
  }
  nativeSocket = socket;
  logStats(`yerel telefon baglandi ${ip}`);
  socket.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'input') handleInput(msg);
    else if (msg.type === 'stats') logStats(`telefon-yerel ${msg.line}`);
    else if (msg.type === 'key') native.requestKey();
  });
  socket.on('close', () => {
    if (nativeSocket === socket) {
      nativeSocket = null;
      native.detach(socket);
      logStats('yerel telefon ayrildi');
    }
  });
  if (!native.available) {
    send(socket, { type: 'error', text: 'Bilgisayarda ffmpeg bulunamadı. Normal modu kullan.' });
    return;
  }
  native.attach(socket, selectedPixelSize(), config.nativeMbps);
}

function onUpgrade(wss, req, socket, head) {
  if (!isPrivate(req.socket.remoteAddress)) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role');
  const remote = req.socket.remoteAddress;
  let ok = false;
  if (url.pathname === '/ws') {
    if (role === 'host') ok = url.searchParams.get('key') === hostKey && isLoopback(remote);
    else if (role === 'viewer' || role === 'native') ok = url.searchParams.get('t') === config.token;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!ok) {
      ws.close(4001, 'unauthorized');
      return;
    }
    const ip = isLoopback(remote) ? '127.0.0.1' : cleanIp(remote);
    if (role === 'host') onHost(ws);
    else if (role === 'native') onNative(ws, ip);
    else onViewer(ws, ip);
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

// Yerel mod için ikinci (HTTPS) sunucu. Açılamazsa normal mod etkilenmez.
async function startSecureServer() {
  try {
    const { cert, key } = await loadCertificate();
    const server = https.createServer({ cert, key }, serveClient);
    const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    server.on('connection', (socket) => noteRequest(socket.remoteAddress, 'tcp-https'));
    server.on('upgrade', (req, socket, head) => onUpgrade(wss, req, socket, head));
    let candidate = port + 1;
    await new Promise((resolve, reject) => {
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && candidate < port + 20) {
          candidate += 1;
          server.listen(candidate, '0.0.0.0');
        } else {
          reject(err);
        }
      });
      server.on('listening', resolve);
      server.listen(candidate, '0.0.0.0');
    });
    securePort = candidate;
  } catch (err) {
    logStats(`yerel HTTPS sunucusu acilamadi: ${err.message}`);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serveClient);
    const wss = new WebSocketServer({ noServer: true });
    server.on('connection', (socket) => noteRequest(socket.remoteAddress, 'tcp'));
    server.on('upgrade', (req, socket, head) => onUpgrade(wss, req, socket, head));
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < BASE_PORT + 20) {
        port += 1;
        server.listen(port, '0.0.0.0');
      } else {
        reject(err);
      }
    });
    server.on('listening', resolve);
    server.listen(port, '0.0.0.0');
  });
}

// ---------- uygulama ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'My Screen',
    backgroundColor: '#11131a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'host', 'index.html'));
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  loadConfig();
  refreshTargetRect();
  await startServer();
  native = createNativeStreamer({
    log: logStats,
    onStatus: sendNativeStatus,
    cache: config.nativeOutputs || {},
    saveCache: (map) => {
      config.nativeOutputs = map;
      saveConfig();
    },
  });
  native.warmup(selectedPixelSize());
  await startSecureServer();
  startHelper();

  // Yakalanacak ekranı pencere sormadan biz seçiyoruz.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const wanted = String(selectedDisplay().id);
      let source = sources.find((s) => s.display_id === wanted);
      if (!source) {
        const index = screen.getAllDisplays().findIndex((d) => String(d.id) === wanted);
        source = sources[index] || sources[0];
      }
      callback({ video: source });
    } catch {
      callback({});
    }
  });

  ipcMain.handle('get-state', async () => {
    await refreshNetwork(true);
    return {
      displays: listDisplays(),
      selectedDisplayId: selectedDisplay().id,
      inputEnabled: config.inputEnabled,
      entries,
      port,
      nativeAvailable: native.available && !!securePort,
      nativeMbps: config.nativeMbps,
      hostWsUrl: `ws://127.0.0.1:${port}/ws?role=host&key=${hostKey}`,
    };
  });
  ipcMain.handle('select-display', (e, id) => {
    config.selectedDisplayId = id;
    refreshTargetRect();
    saveConfig();
    native.warmup(selectedPixelSize());
    native.restart(selectedPixelSize());
  });
  ipcMain.handle('set-native-mbps', (e, value) => {
    config.nativeMbps = Math.max(5, Math.min(80, Number(value) || 30));
    saveConfig();
    native.restart();
  });
  ipcMain.handle('set-input-enabled', (e, value) => {
    config.inputEnabled = !!value;
    saveConfig();
  });
  ipcMain.on('stats-log', (e, line) => logStats(line));
  ipcMain.handle('open-hotspot-settings', () => shell.openExternal('ms-settings:network-mobilehotspot'));

  const onDisplaysChanged = () => {
    native.resetCache();
    native.warmup(selectedPixelSize());
    pushDisplays();
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', pushDisplays);

  createWindow();
  if (process.env.MYSCREEN_TICK) {
    // Tanı (MYSCREEN_TICK=1): köşede her karede renk değiştiren küçük pencere açar; böylece ekran
    // sürekli güncellenir ve yakalamanın tavan kare hızı stats.log'dan okunabilir.
    const b = selectedDisplay().bounds;
    const tick = new BrowserWindow({ x: b.x, y: b.y, width: 8, height: 8, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, webPreferences: { backgroundThrottling: false } });
    tick.setIgnoreMouseEvents(true);
    tick.loadURL('data:text/html,<body style="margin:0"><script>let i=0;(function f(){document.body.style.background=(i++%2)?"%23000":"%23fff";requestAnimationFrame(f)})()</script>');
  }
  setInterval(() => refreshNetwork(false), 2500);
});

app.on('window-all-closed', () => {
  if (helper) helper.kill();
  if (native) native.detach();
  app.quit();
});
