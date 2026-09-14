const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onState: cb => ipcRenderer.on('state', (_, s) => cb(s)),
  refresh: () => ipcRenderer.invoke('refresh'),
  menu: id => ipcRenderer.invoke('menu', id),
  addMenu: () => ipcRenderer.invoke('menu-add'),
  hide: () => ipcRenderer.invoke('hide'),
  resize: h => ipcRenderer.invoke('resize', h),
  setHotkey: acc => ipcRenderer.invoke('set-hotkey', acc),
  setTheme: t => ipcRenderer.invoke('set-theme', t),
  setLang: l => ipcRenderer.invoke('set-lang', l),
});
