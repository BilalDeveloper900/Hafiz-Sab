const { contextBridge, ipcRenderer } = require('electron');

// The page can only call channels main.js registers; it never touches the DB or Node.
contextBridge.exposeInMainWorld('api', (channel, arg) => ipcRenderer.invoke(channel, arg));
