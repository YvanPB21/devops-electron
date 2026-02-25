const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getCredentials: () => ipcRenderer.invoke('get-credentials'),
  saveCredentials: (data) => ipcRenderer.invoke('save-credentials', data),
  deleteCredentials: () => ipcRenderer.invoke('delete-credentials')
  ,openSettings: () => ipcRenderer.invoke('open-settings')
});
