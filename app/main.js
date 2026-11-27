// Appli Rétro (Windows) : une fenêtre, un serveur local, et la console servie comme dans l'Activité.
const { app, BrowserWindow, shell, ipcMain, session } = require("electron");
const path = require("node:path");
const { demarrer } = require("./serveur-local");

const PORT = 53134;   // fixe : c'est aussi l'adresse de retour après la connexion Discord
const API = process.env.RETRO_API || "https://ds-retro-serveur.estamveille2026.workers.dev/api";
const ORIGINE = `http://127.0.0.1:${PORT}`;

if (!app.requestSingleInstanceLock()) app.quit();

let fenetre = null;
async function lancer() {
  try {
    await demarrer({ dossier: path.join(__dirname, "site"), port: PORT, api: API });
  } catch (e) {
    const { dialog } = require("electron");
    dialog.showErrorBox("Rétro", "Rétro est peut-être déjà ouvert (le port " + PORT + " est occupé).");
    return app.quit();
  }
  // Aucune autorisation sensible pour les pages (caméra, micro, position…), sauf le plein écran.
  session.defaultSession.setPermissionRequestHandler((_c, permission, ok) => ok(["fullscreen", "clipboard-sanitized-write"].includes(permission)));

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
}

ipcMain.handle("version", () => app.getVersion());
ipcMain.handle("plein-ecran", e => { const f = BrowserWindow.fromWebContents(e.sender); f.setFullScreen(!f.isFullScreen()); return f.isFullScreen(); });
app.on("second-instance", () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
app.whenReady().then(lancer);
app.on("window-all-closed", () => app.quit());
