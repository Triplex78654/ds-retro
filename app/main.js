// Appli Rétro (Windows) : une fenêtre, un serveur local, et la console servie comme dans l'Activité.
const { app, BrowserWindow, shell, ipcMain, session } = require("electron");
const path = require("node:path");
const { demarrer } = require("./serveur-local");

const PORT = 53134;
const emulateurs = require("./emulateurs");
const maj = require("./maj");
const ORIGINE = `http://127.0.0.1:${PORT}`;

if (!app.requestSingleInstanceLock()) app.quit();

let fenetre = null;
// Un dossier de jeux par console, dans Documents\\Rétro : ce qui est posé là apparaît dans le catalogue.
const NOMS_DOSSIERS = { ds: "DS", nes: "NES", snes: "Super Nintendo", n64: "Nintendo 64", psx: "PlayStation", "3ds": "3DS" };
function dossiersDeJeux() {
  const fs = require("node:fs");
  const racine = path.join(app.getPath("documents"), "Rétro");
  const dossiers = {};
  for (const [c, nom] of Object.entries(NOMS_DOSSIERS)) {
    dossiers[c] = path.join(racine, nom);
    try { fs.mkdirSync(dossiers[c], { recursive: true }); } catch (e) {}
  }
  return dossiers;
}
let DOSSIERS = {};

async function lancer() {
  DOSSIERS = dossiersDeJeux();
  try {
    await demarrer({ dossier: path.join(__dirname, "site"), port: PORT, dossiers: DOSSIERS });
  } catch (e) {
    const { dialog } = require("electron");
    dialog.showErrorBox("Rétro", "Rétro est peut-être déjà ouvert (le port " + PORT + " est occupé).");
    return app.quit();
  }
  // Aucune autorisation sensible pour les pages (caméra, micro, position…), sauf le plein écran.
  session.defaultSession.setPermissionRequestHandler((_c, permission, ok) => ok(["fullscreen", "pointerLock", "clipboard-sanitized-write"].includes(permission)));

  fenetre = new BrowserWindow({
    width: 1280, height: 820, minWidth: 640, minHeight: 480,
    backgroundColor: "#1b1e24", title: "Rétro", autoHideMenuBar: true,
    icon: path.join(__dirname, "site", "images", "icone-180.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'appli.
  fenetre.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  fenetre.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(ORIGINE)) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  fenetre.loadURL(ORIGINE + "/");
  // Regarde s'il y a une nouvelle version peu après le démarrage (le bouton de l'accueil l'affiche).
  setTimeout(() => maj.verifier(), 4000);
}

ipcMain.handle("version", () => app.getVersion());
// Mises à jour : vérifier, télécharger, installer (redémarre l'appli).
maj.surChangement(e => { if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send("maj-etat", e); });
ipcMain.handle("maj-etat", () => maj.etat());
ipcMain.handle("maj-verifier", () => maj.verifier());
ipcMain.handle("maj-telecharger", () => maj.telecharger());
ipcMain.handle("maj-installer", () => maj.installer());
ipcMain.handle("maj-page", () => shell.openExternal(maj.PAGE_VERSIONS));
ipcMain.handle("ouvrir-dossier", (_e, c) => { if (DOSSIERS[c]) shell.openPath(DOSSIERS[c]); return DOSSIERS[c] || null; });
ipcMain.handle("chemin-dossier", (_e, c) => DOSSIERS[c] || null);

// Émulateurs externes (3DS…)
ipcMain.handle("emulateur-etat", (_e, c) => emulateurs.etat(String(c)));
ipcMain.handle("emulateur-installer", async (e, c) => {
  const envoyer = p => { if (!e.sender.isDestroyed()) e.sender.send("emulateur-progression", p); };
  try { return { ok: true, etat: await emulateurs.installer(String(c), envoyer) }; }
  catch (err) { return { ok: false, erreur: String(err.message || err) }; }
});
ipcMain.handle("lancer-externe", async (e, c, nom) => {
  c = String(c); nom = String(nom);
  const dossier = DOSSIERS[c];
  if (!dossier || !nom || /[\\/]/.test(nom) || nom.startsWith(".")) return { ok: false, erreur: "Jeu introuvable" };
  const chemin = path.join(dossier, nom);
  if (!require("node:fs").existsSync(chemin)) return { ok: false, erreur: "Ce jeu n'est plus dans ton dossier" };
  const f = BrowserWindow.fromWebContents(e.sender);
  try {
    const fin = emulateurs.lancer(c, chemin);
    if (f) f.minimize();
    await fin;
    if (f) { f.restore(); f.focus(); }
    return { ok: true };
  } catch (err) {
    if (f) f.restore();
    return { ok: false, erreur: String(err.message || err) };
  }
});
ipcMain.handle("plein-ecran", e => { const f = BrowserWindow.fromWebContents(e.sender); f.setFullScreen(!f.isFullScreen()); return f.isFullScreen(); });
app.on("second-instance", () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
app.whenReady().then(lancer);
app.on("window-all-closed", () => app.quit());
