const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agendaAPI", {
  init: () => ipcRenderer.invoke("agenda:init"),
  initSync: () => ipcRenderer.sendSync("agenda:initSync"),
  write: (text) => ipcRenderer.invoke("agenda:write", text),
  writeSync: (text) => ipcRenderer.sendSync("agenda:writeSync", text),
  open: () => ipcRenderer.invoke("agenda:open"),
  use: (p) => ipcRenderer.invoke("agenda:use", p),
  saveAs: (text) => ipcRenderer.invoke("agenda:saveAs", text)
});
