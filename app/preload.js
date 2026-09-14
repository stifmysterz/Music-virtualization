const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('subRemixDesktop', {
  selectBackgroundFolder: () => ipcRenderer.invoke('background-folder:select'),
  scanBackgroundFolder: folder => ipcRenderer.invoke('background-folder:scan', folder),
  watchBackgroundFolder: folder => ipcRenderer.invoke('background-folder:watch', folder),
  mediaFileUrl: filePath => pathToFileURL(String(filePath)).href,
  onBackgroundFolderChanged: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('background-folder:changed', listener);
    return () => ipcRenderer.removeListener('background-folder:changed', listener);
  }
});
