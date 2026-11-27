// Pont minimal entre l'appli et ses pages : rien d'autre que ce qui est listé ici n'est exposé.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("retroApp", {
  version: () => ipcRenderer.invoke("version"),
  pleinEcran: () => ipcRenderer.invoke("plein-ecran"),
  ouvrirDossier: c => ipcRenderer.invoke("ouvrir-dossier", String(c)),
  cheminDossier: c => ipcRenderer.invoke("chemin-dossier", String(c)),
});
