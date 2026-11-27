// Pont minimal entre l'appli et ses pages : rien d'autre que ce qui est listé ici n'est exposé.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("retroApp", {
  version: () => ipcRenderer.invoke("version"),
  pleinEcran: () => ipcRenderer.invoke("plein-ecran"),
});
