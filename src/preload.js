const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myscreen', {
  getState: () => ipcRenderer.invoke('get-state'),
  selectDisplay: (id) => ipcRenderer.invoke('select-display', id),
  setInputEnabled: (value) => ipcRenderer.invoke('set-input-enabled', value),
  openHotspotSettings: () => ipcRenderer.invoke('open-hotspot-settings'),
  onNetwork: (cb) => ipcRenderer.on('network', (e, entries) => cb(entries)),
  logStats: (line) => ipcRenderer.send('stats-log', line),
  onRequest: (cb) => ipcRenderer.on('request', (e, info) => cb(info)),
  onDisplays: (cb) => ipcRenderer.on('displays', (e, data) => cb(data)),
});
