// Preload SÓ da miniatura de captura (capture.cjs): quatro ações, sem argumentos (o arquivo é o da própria miniatura, conhecido pelo processo principal).
// A janela principal do FORGE usa outro preload (preload.cjs) e não recebe nada disto.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('forgeCapture', Object.freeze({
  drag: () => ipcRenderer.send('forge-capture:drag'),
  copy: () => ipcRenderer.send('forge-capture:copy'),
  show: () => ipcRenderer.send('forge-capture:show'),
  close: () => ipcRenderer.send('forge-capture:close'),
}));
