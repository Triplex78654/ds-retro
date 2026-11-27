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
const NOMS_DOSSIERS = { ds: "DS", nes: "NES", snes: "Super Nintendo", n64: "Nintendo 64", psx: "PlayStation", "3ds": "3DS",
  switch: "Switch", psp: "PSP", ps2: "PlayStation 2", ps3: "PlayStation 3" };
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

// Bibliothèque : jeux trouvés sur le PC par « Chercher mes jeux » (chemins seulement, rien n'est copié).
const fichierBibliotheque = () => path.join(app.getPath("userData"), "bibliotheque.json");
let BIBLIOTHEQUE = null;
function bibliotheque() {
  if (!BIBLIOTHEQUE) { try { BIBLIOTHEQUE = JSON.parse(require("node:fs").readFileSync(fichierBibliotheque(), "utf8")); } catch (e) { BIBLIOTHEQUE = {}; } }
  return BIBLIOTHEQUE;
}
function ajouterABibliotheque(trouves) {
  const b = bibliotheque(), ajoutes = {};
  for (const t of trouves) {
    const liste = b[t.console] || (b[t.console] = []);
    if (liste.some(x => x.chemin === t.chemin)) continue;
    // Deux jeux du même nom à deux endroits : le 2e prend « (2) ».
    let nom = t.nom, i = 2;
    const ext = t.dossier ? "" : path.extname(t.nom);
    while (liste.some(x => x.nom === nom)) nom = path.basename(t.nom, ext) + " (" + i++ + ")" + ext;
    liste.push({ nom, chemin: t.chemin, dossier: Boolean(t.dossier) });
    ajoutes[t.console] = (ajoutes[t.console] || 0) + 1;
  }
  require("node:fs").writeFileSync(fichierBibliotheque(), JSON.stringify(b, null, 1));
  return ajoutes;
}

async function lancer() {
  DOSSIERS = dossiersDeJeux();
  try {
    await demarrer({ dossier: path.join(__dirname, "site"), port: PORT, dossiers: DOSSIERS, bibliotheque: c => bibliotheque()[c] || [] });
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
ipcMain.handle("emulateur-derniere-version", (_e, c) => emulateurs.derniereVersion(String(c)));
// Clés, firmware, BIOS : le joueur choisit ses fichiers dans une fenêtre Windows, l'appli les range.
ipcMain.handle("systeme-importer", async (e, c, quoi, enDossier) => {
  c = String(c); quoi = String(quoi);
  const et = emulateurs.etat(c);
  const def = et && et.systeme && et.systeme[quoi];
  if (!def) return { ok: false, erreur: "Rien à importer ici" };
  const { dialog } = require("electron");
  const f = BrowserWindow.fromWebContents(e.sender);
  const choix = await dialog.showOpenDialog(f, {
    title: def.titre,
    properties: enDossier && def.dossierPossible ? ["openDirectory"] : ["openFile"].concat(def.plusieurs ? ["multiSelections"] : []),
    filters: enDossier ? [] : def.filtres.concat([{ name: "Tous les fichiers", extensions: ["*"] }]),
  });
  if (choix.canceled || !choix.filePaths.length) return { ok: false, annule: true };
  const envoyer = p => { if (!e.sender.isDestroyed()) e.sender.send("emulateur-progression", p); };
  try { return { ok: true, etat: await emulateurs.importerSysteme(c, quoi, choix.filePaths, envoyer) }; }
  catch (err) { return { ok: false, erreur: String(err.message || err) }; }
});
// « Chercher mes jeux » : le joueur choisit des dossiers (ou un disque), l'appli range chaque jeu dans sa console.
ipcMain.handle("chercher-jeux", async e => {
  const { dialog } = require("electron");
  const f = BrowserWindow.fromWebContents(e.sender);
  const choix = await dialog.showOpenDialog(f, { title: "Où sont tes jeux ? (un dossier ou un disque entier)", properties: ["openDirectory", "multiSelections"] });
  if (choix.canceled || !choix.filePaths.length) return { ok: false, annule: true };
  const envoyer = p => { if (!e.sender.isDestroyed()) e.sender.send("recherche-progression", p); };
  try {
    const sept = require("7zip-bin").path7za.replace("app.asar", "app.asar.unpacked");
    const trouves = await require("./recherche").chercher(choix.filePaths, {
      sept, progression: envoyer,
      // Pas la peine de fouiller les dossiers de jeux de l'appli ni ses émulateurs.
      exclure: Object.values(DOSSIERS).concat([app.getPath("userData")]),
    });
    return { ok: true, trouves: trouves.length, ajoutes: ajouterABibliotheque(trouves) };
  } catch (err) { return { ok: false, erreur: String(err.message || err) }; }
});
ipcMain.handle("lancer-externe", async (e, c, nom, options) => {
  c = String(c); nom = String(nom);
  const dossier = DOSSIERS[c];
  if (!dossier || !nom || /[\\/]/.test(nom) || nom.startsWith(".")) return { ok: false, erreur: "Jeu introuvable" };
  let chemin = path.join(dossier, nom);
  if (!require("node:fs").existsSync(chemin)) {
    const b = (bibliotheque()[c] || []).find(x => x.nom === nom);
    if (b) chemin = b.chemin;
  }
  if (!require("node:fs").existsSync(chemin)) return { ok: false, erreur: "Ce jeu n'est plus à sa place sur ton PC" };
  const f = BrowserWindow.fromWebContents(e.sender);
  const envoyer = texte => { if (texte && !e.sender.isDestroyed()) e.sender.send("emulateur-progression", { etape: "lancement", texte }); };
  let reduite = false;
  try {
    await emulateurs.lancer(c, chemin, {
      manette: Boolean(options && options.manette),
      // Juste avant de lancer le jeu : l'appli se met de côté, elle revient quand l'émulateur se ferme.
      etape: texte => { if (texte) envoyer(texte); else if (f && !reduite) { reduite = true; f.minimize(); } },
    });
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
