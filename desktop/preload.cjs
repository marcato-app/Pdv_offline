const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visionDesktop', {
  saveBackup: (name, content) => ipcRenderer.invoke('backup:save', name, content),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: (name) => ipcRenderer.invoke('backup:read', name),
  openBackupFolder: () => ipcRenderer.invoke('backup:open'),
  backupFolder: () => ipcRenderer.invoke('backup:folder'),
  openPdv: (url) => ipcRenderer.invoke('pdv:open', url),
  focusMain: () => ipcRenderer.invoke('pdv:focusMain'),
  setFullScreen: (on) => ipcRenderer.invoke('win:fullscreen', on),
  isPdvWindow: process.argv.includes('--vision-pdv'),
});
contextBridge.exposeInMainWorld('visionPrint', (html, opts) => ipcRenderer.invoke('print:html', html, opts));
