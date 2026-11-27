// Appli Rétro (Windows) : une fenêtre, un serveur local, et la console servie comme dans l'Activité.
const { app, BrowserWindow, shell, ipcMain, session } = require("electron");
const path = require("node:path");
const { demarrer } = require("./serveur-local");

// Mode démonstration (captures d'écran, essais) : données et dossiers de jeux à part, aucune recherche sur le PC,
// et un autre port pour tourner à côté du Rétro installé.
const DEMO = process.env.RETRO_DEMO ? path.resolve(process.env.RETRO_DEMO) : null;
const PORT = DEMO ? 53135 : 53134;
const emulateurs = require("./emulateurs");
const maj = require("./maj");
const ORIGINE = `http://127.0.0.1:${PORT}`;
if (DEMO) { app.setPath("userData", path.join(DEMO, "donnees")); app.setPath("documents", path.join(DEMO, "documents")); }

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
  // Recherche automatique des jeux : au démarrage, puis quand on revient sur l'appli (au plus toutes les 10 minutes).
  setTimeout(() => rechercheAuto(), 2500);
  fenetre.on("focus", () => { if (Date.now() - derniereRecherche > 10 * 60 * 1000) rechercheAuto(); });
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
// ---------- Recherche automatique des jeux ----------
// Au démarrage puis régulièrement, l'appli fouille les endroits habituels (Téléchargements, Bureau,
// Documents, les autres disques) et les dossiers ajoutés par le joueur ; chaque jeu trouvé est rangé
// dans sa console. Les jeux qui ont disparu du PC sont retirés.
const fichierRecherche = () => path.join(app.getPath("userData"), "recherche.json");
function reglagesRecherche() {
  try { return JSON.parse(require("node:fs").readFileSync(fichierRecherche(), "utf8")); } catch (e) { return { dossiers: [] }; }
}
function sauverRecherche(r) { require("node:fs").writeFileSync(fichierRecherche(), JSON.stringify(r, null, 1)); }
// Un chemin qui ne répond pas vite (lecteur réseau, disque en veille) est laissé de côté.
const dossierPret = d => Promise.race([
  require("node:fs/promises").stat(d).then(s => s.isDirectory(), () => false),
  new Promise(ok => setTimeout(() => ok(false), 2000)),
]);
// Les disques locaux (internes et externes), sans les lecteurs réseau ni CD, et sans C: (trop gros, plein de fichiers système).
function disquesLocaux() {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise(ok => {
    const ps = "[System.IO.DriveInfo]::GetDrives() | Where-Object { ($_.DriveType -eq 'Fixed' -or $_.DriveType -eq 'Removable') -and $_.IsReady } | ForEach-Object { $_.Name }";
    require("node:child_process").execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 8000, windowsHide: true }, (err, sortie) => {
      if (err) return ok([]);
      ok(String(sortie).split(/\r?\n/).map(l => l.trim()).filter(l => /^[D-Z]:\\$/i.test(l)));
    });
  });
}
async function endroitsAFouiller() {
  const r = reglagesRecherche();
  const endroits = [];
  for (const nom of ["downloads", "desktop", "documents"]) { try { endroits.push(app.getPath(nom)); } catch (e) {} }
  // OneDrive range souvent le Bureau et les Documents ailleurs.
  if (process.env.OneDrive) for (const sous of ["Desktop", "Bureau", "Documents"]) endroits.push(path.join(process.env.OneDrive, sous));
  endroits.push(...(await disquesLocaux()));
  const uniques = [...new Set(endroits.concat(r.dossiers || []))];
  const prets = await Promise.all(uniques.map(dossierPret));
  return uniques.filter((_, i) => prets[i]);
}
let rechercheEnCours = null, derniereRecherche = 0;
const signaler = p => { if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send("recherche-progression", p); };
function rechercheAuto(choisis) {
  if (DEMO) return Promise.resolve({ ok: true, trouves: 0, ajoutes: {}, retires: 0 });
  if (rechercheEnCours) return rechercheEnCours;
  derniereRecherche = Date.now();
  rechercheEnCours = (async () => {
    const fs = require("node:fs");
    const endroits = choisis || await endroitsAFouiller();
    const sept = require("7zip-bin").path7za.replace("app.asar", "app.asar.unpacked");
    const trouves = await require("./recherche").chercher(endroits, {
      sept, progression: p => signaler({ ...p, auto: true }),
      // Pas les dossiers de jeux de l'appli (déjà au catalogue), ni ses émulateurs, ni l'appli elle-même.
      exclure: Object.values(DOSSIERS).concat([app.getPath("userData"), path.dirname(app.getPath("exe"))]),
    });
    // Ranger les nouveaux jeux, retirer ceux qui ont été supprimés.
    // Un disque débranché n'efface rien : ses jeux sont juste cachés jusqu'à son retour.
    const b = bibliotheque();
    let retires = 0;
    // Un jeu est retiré s'il a disparu, ou si la recherche a fouillé jusqu'au bout l'endroit où il est sans le garder
    // (doublon, projet de code, fichier parasite). Une recherche coupée (trop longue) ne retire rien d'autre.
    const nouveaux = new Set(trouves.map(t => t.chemin));
    const sous = (x, d) => (path.resolve(x).toLowerCase() + path.sep).startsWith(path.resolve(d).toLowerCase() + path.sep);
    const toutFouille = trouves.complet && !choisis;
    const garder = x => nouveaux.has(x.chemin)
      || ((fs.existsSync(x.chemin) || !fs.existsSync(path.parse(x.chemin).root) || !fs.existsSync(path.dirname(x.chemin)))
        && !(toutFouille && endroits.some(d => sous(x.chemin, d))));
    const connus = new Set(Object.values(b).flat().map(x => x.chemin));
    for (const c of Object.keys(b)) {
      const avant = b[c];
      b[c] = avant.filter(garder);
      retires += avant.filter(x => !nouveaux.has(x.chemin) && !b[c].includes(x)).length;
    }
    ajouterABibliotheque(trouves);
    // « Nouveaux » : seulement les jeux qui n'étaient pas déjà dans la bibliothèque.
    const ajoutes = {};
    for (const t of trouves) if (!connus.has(t.chemin)) ajoutes[t.console] = (ajoutes[t.console] || 0) + 1;
    const r = { ok: true, trouves: trouves.length, ajoutes, retires };
    signaler({ etape: "fini", auto: true, resultat: r });
    return r;
  })().catch(err => ({ ok: false, erreur: String(err.message || err) })).finally(() => { rechercheEnCours = null; });
  return rechercheEnCours;
}
ipcMain.handle("recherche-etat", () => ({ enCours: Boolean(rechercheEnCours), dossiers: reglagesRecherche().dossiers || [], derniere: derniereRecherche }));
// Ajouter un endroit à fouiller (un dossier ou un disque) : il est retenu pour les prochaines fois.
ipcMain.handle("chercher-jeux", async e => {
  const { dialog } = require("electron");
  const f = BrowserWindow.fromWebContents(e.sender);
  const choix = await dialog.showOpenDialog(f, { title: "Ajoute un dossier ou un disque où chercher tes jeux", properties: ["openDirectory", "multiSelections"] });
  if (choix.canceled || !choix.filePaths.length) return { ok: false, annule: true };
  const r = reglagesRecherche();
  r.dossiers = [...new Set((r.dossiers || []).concat(choix.filePaths))];
  sauverRecherche(r);
  if (rechercheEnCours) await rechercheEnCours;
  return rechercheAuto(choix.filePaths);
});
ipcMain.handle("recherche-relancer", () => rechercheAuto());
// Mods Switch : une archive (.zip / .7z) ou un dossier, rangé là où Eden lit les mods.
ipcMain.handle("mod-importer", async (e, c, enDossier) => {
  c = String(c);
  const { dialog } = require("electron");
  const f = BrowserWindow.fromWebContents(e.sender);
  const choix = await dialog.showOpenDialog(f, {
    title: "Choisis le mod",
    properties: enDossier ? ["openDirectory"] : ["openFile"],
    filters: enDossier ? [] : [{ name: "Mod (.zip, .7z)", extensions: ["zip", "7z", "rar"] }, { name: "Tous les fichiers", extensions: ["*"] }],
  });
  if (choix.canceled || !choix.filePaths.length) return { ok: false, annule: true };
  const envoyer = p => { if (!e.sender.isDestroyed()) e.sender.send("emulateur-progression", p); };
  try { const mods = await emulateurs.importerMod(c, choix.filePaths[0], envoyer); return { ok: true, mods, etat: emulateurs.etat(c) }; }
  catch (err) { return { ok: false, erreur: String(err.message || err) }; }
});
ipcMain.handle("mod-retirer", (_e, c, id, nom) => {
  try { emulateurs.retirerMod(String(c), String(id), String(nom)); return { ok: true, etat: emulateurs.etat(String(c)) }; }
  catch (err) { return { ok: false, erreur: String(err.message || err) }; }
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
  let reduite = false, info = null;
  try {
    await emulateurs.lancer(c, chemin, {
      manette: Boolean(options && options.manette),
      info: t => { info = t; },
      // Juste avant de lancer le jeu : l'appli se met de côté, elle revient quand l'émulateur se ferme.
      etape: texte => { if (texte) envoyer(texte); else if (f && !reduite) { reduite = true; f.minimize(); } },
    });
    if (f) { f.restore(); f.focus(); }
    return { ok: true, info };
  } catch (err) {
    if (f) f.restore();
    return { ok: false, erreur: String(err.message || err) };
  }
});
ipcMain.handle("plein-ecran", e => { const f = BrowserWindow.fromWebContents(e.sender); f.setFullScreen(!f.isFullScreen()); return f.isFullScreen(); });
app.on("second-instance", () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
app.whenReady().then(lancer);
app.on("window-all-closed", () => app.quit());
