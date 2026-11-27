// Mise à jour de l'appli sans réinstaller : l'appli regarde la dernière version publiée sur GitHub,
// la télécharge en arrière-plan, puis l'installe en redémarrant (version « installation » seulement).
const { app } = require("electron");

const PAGE_VERSIONS = "https://github.com/Triplex78654/ds-retro/releases/latest";
// La version portable ne peut pas se remplacer elle-même : elle propose juste la page de téléchargement.
const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);

let etat = { phase: "inconnue", version: app.getVersion(), portable };
let ecouteur = () => {};
let updater = null;

function changer(maj) { etat = { ...etat, ...maj }; ecouteur(etat); }

function preparer() {
  if (updater || portable || !app.isPackaged) return updater;
  ({ autoUpdater: updater } = require("electron-updater"));
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  // Fichiers publiés avec chaque version (latest.yml + installateur), sur la dernière version GitHub.
  updater.setFeedURL({ provider: "generic", url: "https://github.com/Triplex78654/ds-retro/releases/latest/download" });
  updater.on("checking-for-update", () => changer({ phase: "recherche", erreur: null }));
  updater.on("update-not-available", () => changer({ phase: "a-jour" }));
  updater.on("update-available", i => changer({ phase: "disponible", nouvelle: i.version }));
  updater.on("download-progress", p => changer({ phase: "telechargement", pourcent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", i => changer({ phase: "prete", nouvelle: i.version }));
  updater.on("error", e => changer({ phase: "erreur", erreur: String((e && e.message) || e).split("\n")[0].slice(0, 160) }));
  return updater;
}

module.exports = {
  PAGE_VERSIONS,
  surChangement(f) { ecouteur = f; },
  etat: () => etat,
  async verifier() {
    if (portable) return changer({ phase: "portable" }), etat;
    if (!app.isPackaged) return changer({ phase: "developpement" }), etat;
    try { await preparer().checkForUpdates(); } catch (e) { changer({ phase: "erreur", erreur: String(e.message || e).slice(0, 160) }); }
    return etat;
  },
  async telecharger() {
    if (!preparer() || etat.phase !== "disponible") return etat;
    try { await updater.downloadUpdate(); } catch (e) { changer({ phase: "erreur", erreur: String(e.message || e).slice(0, 160) }); }
    return etat;
  },
  installer() { if (updater && etat.phase === "prete") setImmediate(() => updater.quitAndInstall(false, true)); },
};
