// Émulateurs externes : téléchargés depuis leur source officielle au premier lancement d'un jeu,
// rangés dans le dossier de l'appli en mode portable (leurs réglages, sauvegardes, clés et BIOS restent
// à côté d'eux), puis lancés avec le jeu choisi dans le catalogue.
const { app, net } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

// RETRO_GITHUB_API / RETRO_EDEN_API : seulement pour les tests (faux serveurs locaux).
const API_GITHUB = process.env.RETRO_GITHUB_API || "https://api.github.com";
const API_EDEN = process.env.RETRO_EDEN_API || "https://git.eden-emu.dev/api/v1";

// Chaque émulateur :
// - source() : { version, url, nom } du fichier Windows de la dernière version officielle ;
// - exe : le programme ; args(jeu) : comment lui donner le jeu (plein écran) ;
// - portable(dir) : ce qu'il faut à côté de l'exe pour qu'il garde tout dans son dossier ;
// - systeme : fichiers à fournir soi-même (clés, firmware, BIOS), venus de sa propre console.
const EMULATEURS = {
  "3ds": {
    nom: "Azahar", source: () => depuisGithub("azahar-emu/azahar", /^azahar-windows-msvc-[\d.]+\.zip$/i), exe: "azahar.exe",
    args: jeu => ["-f", jeu],
    // Pas de mode portable : Azahar garde ses données dans AppData, comme dans la version 0.5.
    portable: () => {},
  },
  switch: {
    nom: "Eden", source: sourceEden, exe: "eden.exe",
    args: jeu => ["-f", "-g", jeu],
    portable: dir => fs.mkdirSync(path.join(dir, "user"), { recursive: true }),
    systeme: {
      cles: { titre: "Clés (prod.keys)", obligatoire: true, aide: "prod.keys et, si tu l'as, title.keys, sortis de ta Switch.", filtres: [{ name: "Clés Switch", extensions: ["keys"] }], plusieurs: true },
      firmware: { titre: "Firmware", obligatoire: false, aide: "Le firmware de ta Switch : un .zip ou un dossier de fichiers .nca. La plupart des jeux en ont besoin.", filtres: [{ name: "Firmware (.zip)", extensions: ["zip"] }], dossierPossible: true },
    },
  },
  psp: {
    nom: "PPSSPP", source: () => depuisGithub("hrydgard/ppsspp", /^PPSSPP-v[\d.]+-Windows-x64\.zip$/i), exe: "PPSSPPWindows64.exe",
    args: jeu => ["--fullscreen", "--escape-exit", jeu],
    portable: dir => fs.mkdirSync(path.join(dir, "memstick"), { recursive: true }),
  },
  ps2: {
    nom: "PCSX2", source: () => depuisGithub("PCSX2/pcsx2", /^pcsx2-v[\d.]+-windows-x64-Qt\.7z$/i), exe: "pcsx2-qt.exe",
    args: jeu => ["-batch", "-fullscreen", "--", jeu],
    portable: dir => { if (!fs.existsSync(path.join(dir, "portable.txt"))) fs.writeFileSync(path.join(dir, "portable.txt"), ""); },
    systeme: {
      bios: { titre: "BIOS PS2", obligatoire: true, aide: "Le BIOS de ta PlayStation 2 (fichier .bin, sorti de ta console).", filtres: [{ name: "BIOS PS2", extensions: ["bin", "rom", "rom0", "zip"] }], plusieurs: true },
    },
  },
  ps3: {
    nom: "RPCS3", source: () => depuisGithub("RPCS3/rpcs3-binaries-win", /^rpcs3-v[\d.]+-\d+-[0-9a-f]+_win64_msvc\.7z$/i), exe: "rpcs3.exe",
    args: jeu => ["--no-gui", "--fullscreen", jeu],
    portable: () => {},
    systeme: {
      firmware: { titre: "Firmware PS3", obligatoire: true, aide: "Le fichier PS3UPDAT.PUP (mise à jour système PS3, sur le site officiel PlayStation).", filtres: [{ name: "Firmware PS3", extensions: ["pup", "PUP"] }] },
    },
  },
};

async function json(url) {
  const r = await net.fetch(url, { headers: { Accept: "application/json", "User-Agent": "Retro-app" } });
  if (!r.ok) throw new Error("Le site de l'émulateur ne répond pas (" + r.status + ")");
  return r.json();
}
async function depuisGithub(depot, motif) {
  const v = await json(`${API_GITHUB}/repos/${depot}/releases/latest`);
  const a = (v.assets || []).find(x => motif.test(x.name));
  if (!a) throw new Error("Pas de version Windows dans la dernière publication");
  return { version: v.tag_name, url: a.browser_download_url, nom: a.name, taille: a.size };
}
// Eden publie sur son propre serveur (git.eden-emu.dev) ; les fichiers sont sur stable.eden-emu.dev.
// Version « PGO » amd64 : la plus rapide (processeur avec AVX2, soit à peu près tout PC depuis 2013).
async function sourceEden() {
  const v = await json(`${API_EDEN}/repos/eden-emu/eden/releases/latest`);
  const tag = String(v.tag_name || "");
  if (!/^v[\w.-]+$/.test(tag)) throw new Error("Version d'Eden illisible");
  const nom = `Eden-Windows-${tag}-amd64-clang-pgo.zip`;
  const a = (v.assets || []).find(x => x.name === nom);
  const url = a && (/^https:\/\//.test(a.browser_download_url) || process.env.RETRO_EDEN_API) ? a.browser_download_url : `https://stable.eden-emu.dev/${tag}/${nom}`;
  return { version: tag, url, nom, taille: a ? a.size : 0 };
}

const dossierDe = c => path.join(app.getPath("userData"), "emulateurs", c);
function trouver(dossier, nom, profondeur = 0) {
  if (!fs.existsSync(dossier) || profondeur > 3) return null;
  const liste = fs.readdirSync(dossier, { withFileTypes: true });
  for (const e of liste) if (e.isFile() && e.name.toLowerCase() === nom.toLowerCase()) return path.join(dossier, e.name);
  for (const e of liste) if (e.isDirectory()) { const r = trouver(path.join(dossier, e.name), nom, profondeur + 1); if (r) return r; }
  return null;
}
const exeDe = c => EMULATEURS[c] && trouver(dossierDe(c), EMULATEURS[c].exe);

function etat(c) {
  const e = EMULATEURS[c];
  if (!e) return null;
  let version = null;
  try { version = fs.readFileSync(path.join(dossierDe(c), "version.txt"), "utf8").trim(); } catch (x) {}
  const exe = exeDe(c);
  return { nom: e.nom, installe: Boolean(version && exe), version, systeme: etatSysteme(c, exe) };
}

const sept = () => require("7zip-bin").path7za.replace("app.asar", "app.asar.unpacked");
const extraire = (archive, vers) => new Promise((ok, ko) => execFile(sept(), ["x", "-y", "-o" + vers, archive], { maxBuffer: 1 << 24 }, err => (err ? ko(err) : ok())));

async function telecharger(url, vers, progression, texte) {
  const reponse = await net.fetch(url);
  if (!reponse.ok || !reponse.body) throw new Error("Téléchargement refusé (" + reponse.status + ")");
  const total = Number(reponse.headers.get("content-length")) || 0;
  const sortie = fs.createWriteStream(vers);
  let recus = 0, dernier = 0;
  const lecteur = reponse.body.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    recus += value.length;
    if (!sortie.write(Buffer.from(value))) await new Promise(ok => sortie.once("drain", ok));
    if (Date.now() - dernier > 200) { dernier = Date.now(); progression({ etape: "telechargement", recus, total, texte }); }
  }
  await new Promise((ok, ko) => sortie.end(err => (err ? ko(err) : ok())));
}

// Installe ou met à jour : le programme est remplacé, mais ce qui est à côté (clés, firmware, BIOS,
// sauvegardes, réglages) est gardé.
async function installer(c, progression) {
  const e = EMULATEURS[c];
  if (!e) throw new Error("Console inconnue");
  progression({ etape: "recherche", texte: "Recherche de la dernière version de " + e.nom + "…" });
  const s = await e.source();
  const tmp = path.join(app.getPath("temp"), "retro-" + c + "-" + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const archive = path.join(tmp, path.basename(s.nom).replace(/[^\w.-]/g, "_"));
    await telecharger(s.url, archive, progression, "Téléchargement de " + e.nom + " " + s.version);
    progression({ etape: "extraction", texte: "Installation de " + e.nom + "…" });
    const extrait = path.join(tmp, "extrait");
    await extraire(archive, extrait);
    const exe = trouver(extrait, e.exe);
    if (!exe) throw new Error(e.exe + " introuvable dans le fichier téléchargé");
    const dossier = dossierDe(c);
    // Ancienne installation rangée dans un sous-dossier : on garde le dossier du programme tel quel.
    const ancien = exeDe(c);
    const cible = ancien ? path.dirname(ancien) : dossier;
    fs.mkdirSync(cible, { recursive: true });
    fs.cpSync(path.dirname(exe), cible, { recursive: true, force: true });
    e.portable(cible);
    fs.writeFileSync(path.join(dossier, "version.txt"), s.version || "inconnue");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  progression({ etape: "fini", texte: e.nom + " " + s.version + " est installé." });
  return etat(c);
}

// Dernière version disponible (pour proposer une mise à jour de l'émulateur).
async function derniereVersion(c) {
  const e = EMULATEURS[c];
  if (!e) return null;
  try { return (await e.source()).version; } catch (x) { return null; }
}

// ---------- Fichiers système (clés, firmware, BIOS) ----------
function etatSysteme(c, exe) {
  const e = EMULATEURS[c];
  if (!e || !e.systeme) return null;
  const dir = exe ? path.dirname(exe) : null;
  const a = p => Boolean(dir) && fs.existsSync(path.join(dir, ...p));
  const compter = (p, filtre) => { try { return fs.readdirSync(path.join(dir, ...p)).filter(filtre).length; } catch (x) { return 0; } };
  const r = {};
  for (const [cle, def] of Object.entries(e.systeme)) {
    let present = false, detail = "";
    if (c === "switch" && cle === "cles") { present = a(["user", "keys", "prod.keys"]); detail = present ? (a(["user", "keys", "title.keys"]) ? "prod.keys + title.keys" : "prod.keys") : ""; }
    if (c === "switch" && cle === "firmware") { const n = compter(["user", "nand", "system", "Contents", "registered"], f => /\.nca$/i.test(f)); present = n > 0; detail = n ? n + " fichiers" : ""; }
    if (c === "ps2" && cle === "bios") { const n = compter(["bios"], f => !f.startsWith(".")); present = n > 0; detail = n ? n + (n > 1 ? " fichiers" : " fichier") : ""; }
    if (c === "ps3" && cle === "firmware") { present = a(["dev_flash", "vsh", "module", "vsh.self"]); detail = present ? "installé" : ""; }
    r[cle] = { titre: def.titre, aide: def.aide, obligatoire: def.obligatoire, present, detail, filtres: def.filtres, plusieurs: Boolean(def.plusieurs), dossierPossible: Boolean(def.dossierPossible) };
  }
  return r;
}

function ncaDans(dossier, liste = [], profondeur = 0) {
  if (profondeur > 6) return liste;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) ncaDans(p, liste, profondeur + 1);
    else if (e.isFile() && /\.nca$/i.test(e.name)) liste.push(p);
  }
  return liste;
}

// Copie les fichiers choisis par le joueur (venus de sa propre console) là où l'émulateur les attend.
async function importerSysteme(c, quoi, chemins, progression) {
  const e = EMULATEURS[c];
  if (!e || !e.systeme || !e.systeme[quoi]) throw new Error("Rien à importer ici");
  if (!chemins || !chemins.length) throw new Error("Aucun fichier choisi");
  if (!exeDe(c)) await installer(c, progression);
  const dir = path.dirname(exeDe(c));

  if (c === "switch" && quoi === "cles") {
    const cles = path.join(dir, "user", "keys");
    fs.mkdirSync(cles, { recursive: true });
    let prod = false;
    for (const p of chemins) {
      const nom = path.basename(p).toLowerCase();
      if (nom !== "prod.keys" && nom !== "title.keys") throw new Error("Choisis prod.keys (et title.keys) : « " + path.basename(p) + " » n'est pas un fichier de clés");
      if (fs.statSync(p).size > 1 << 20) throw new Error(nom + " est trop gros pour un fichier de clés");
      fs.copyFileSync(p, path.join(cles, nom));
      if (nom === "prod.keys") prod = true;
    }
    if (!prod && !fs.existsSync(path.join(cles, "prod.keys"))) throw new Error("Il manque prod.keys");
  }

  if (c === "switch" && quoi === "firmware") {
    progression({ etape: "extraction", texte: "Lecture du firmware…" });
    const tmp = path.join(app.getPath("temp"), "retro-firmware-" + Date.now());
    try {
      let source = chemins[0];
      if (fs.statSync(source).isFile()) { await extraire(source, tmp); source = tmp; }
      const ncas = ncaDans(source);
      if (ncas.length < 10) throw new Error("Pas de firmware ici : il faut un .zip ou un dossier rempli de fichiers .nca");
      // Comme Eden (« Installer le firmware ») : on vide nand/system/Contents/registered puis on copie les .nca.
      const registered = path.join(dir, "user", "nand", "system", "Contents", "registered");
      fs.rmSync(registered, { recursive: true, force: true });
      fs.mkdirSync(registered, { recursive: true });
      ncas.forEach((p, i) => {
        fs.copyFileSync(p, path.join(registered, path.basename(p)));
        if (i % 20 === 0) progression({ etape: "extraction", texte: "Installation du firmware : " + Math.round(i / ncas.length * 100) + " %" });
      });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  if (c === "ps2" && quoi === "bios") {
    const bios = path.join(dir, "bios");
    fs.mkdirSync(bios, { recursive: true });
    for (const p of chemins) {
      if (/\.zip$/i.test(p)) await extraire(p, bios);
      else fs.copyFileSync(p, path.join(bios, path.basename(p)));
    }
  }

  if (c === "ps3" && quoi === "firmware") {
    if (!/\.pup$/i.test(chemins[0])) throw new Error("Choisis le fichier PS3UPDAT.PUP");
    progression({ etape: "extraction", texte: "RPCS3 installe le firmware : suis sa fenêtre, puis ferme-la." });
    await new Promise((ok, ko) => {
      const p = spawn(exeDe(c), ["--installfw", chemins[0]], { cwd: dir });
      p.once("error", ko); p.once("exit", ok);
    });
  }

  progression({ etape: "fini", texte: "C'est fait." });
  return etat(c);
}

// Lance le jeu ; renvoie une promesse résolue quand l'émulateur se ferme.
// options.manette : une manette est branchée (les commandes de l'émulateur suivent).
const executer = (exe, args) => new Promise((ok, ko) => {
  const p = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: false });
  p.once("error", ko);
  p.once("exit", code => ok(code));
});
async function lancer(c, cheminJeu, options = {}) {
  const e = EMULATEURS[c];
  const exe = exeDe(c);
  if (!exe) throw new Error(e ? e.nom + " n'est pas installé" : "Console inconnue");
  let jeu = cheminJeu;
  if (c === "3ds") {
    const azahar = require("./azahar");
    try { azahar.reglerCommandes(Boolean(options.manette)); } catch (x) { /* réglages impossibles : Azahar garde les siens */ }
    if (/\.cia$/i.test(cheminJeu)) {
      const info = azahar.lireCia(cheminJeu);
      jeu = azahar.trouverInstalle(info);
      if (!jeu) {
        if (options.etape) options.etape("Installation du jeu dans Azahar (une seule fois)…");
        const code = await executer(exe, ["-i", cheminJeu]);
        if (code) throw new Error(azahar.ERREURS_CIA[code] || "Installation du .cia impossible (code " + code + ")");
        jeu = azahar.trouverInstalle(info);
        if (!jeu) throw new Error("Le jeu est installé mais introuvable dans Azahar");
      }
    }
  }
  if (options.etape) options.etape(null);
  return executer(exe, e.args(jeu));
}

module.exports = { EMULATEURS, etat, installer, derniereVersion, importerSysteme, lancer };
