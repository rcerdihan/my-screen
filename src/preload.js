const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myscreen', {
  getState: () => ipcRenderer.invoke('get-state'),
  selectDisplay: (id) => ipcRenderer.invoke('select-display', id),
  setInputEnabled: (value) => ipcRenderer.invoke('set-input-enabled', value),
  setMbps: (value) => ipcRenderer.invoke('set-mbps', value),
  setManageVirtualDisplay: (value) => ipcRenderer.invoke('set-manage-virtual-display', value),
  openHotspotSettings: () => ipcRenderer.invoke('open-hotspot-settings'),
  onNetwork: (cb) => ipcRenderer.on('network', (e, entries) => cb(entries)),
  onRequest: (cb) => ipcRenderer.on('request', (e, info) => cb(info)),
  onDisplays: (cb) => ipcRenderer.on('displays', (e, data) => cb(data)),
  disconnectViewer: () => ipcRenderer.invoke('disconnect-viewer'),
  setDevice: (id) => ipcRenderer.invoke('set-device', id),
  onViewer: (cb) => ipcRenderer.on('viewer', (e, info) => cb(info)),
  onStreamStatus: (cb) => ipcRenderer.on('stream-status', (e, info) => cb(info)),
});
