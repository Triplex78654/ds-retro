// Pont minimal entre l'appli et ses pages : rien d'autre que ce qui est listé ici n'est exposé.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("retroApp", {
  version: () => ipcRenderer.invoke("version"),
  pleinEcran: () => ipcRenderer.invoke("plein-ecran"),
  ouvrirDossier: c => ipcRenderer.invoke("ouvrir-dossier", String(c)),
  cheminDossier: c => ipcRenderer.invoke("chemin-dossier", String(c)),
  emulateurEtat: c => ipcRenderer.invoke("emulateur-etat", String(c)),
  installerEmulateur: c => ipcRenderer.invoke("emulateur-installer", String(c)),
  lancerExterne: (c, nom) => ipcRenderer.invoke("lancer-externe", String(c), String(nom)),
  majEtat: () => ipcRenderer.invoke("maj-etat"),
  majVerifier: () => ipcRenderer.invoke("maj-verifier"),
  majTelecharger: () => ipcRenderer.invoke("maj-telecharger"),
  majInstaller: () => ipcRenderer.invoke("maj-installer"),
  majPage: () => ipcRenderer.invoke("maj-page"),
  surMaj: f => { const r = (_e, p) => f(p); ipcRenderer.on("maj-etat", r); return () => ipcRenderer.removeListener("maj-etat", r); },
  surProgression: f => { const r = (_e, p) => f(p); ipcRenderer.on("emulateur-progression", r); return () => ipcRenderer.removeListener("emulateur-progression", r); },
});
