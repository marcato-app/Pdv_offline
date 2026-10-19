const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visionDesktop', {
  saveBackup: (name, content) => ipcRenderer.invoke('backup:save', name, content),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  readBackup: (name) => ipcRenderer.invoke('backup:read', name),
  openBackupFolder: () => ipcRenderer.invoke('backup:open'),
  backupFolder: () => ipcRenderer.invoke('backup:folder'),
});
contextBridge.exposeInMainWorld('visionPrint', (html, opts) => ipcRenderer.invoke('print:html', html, opts));
