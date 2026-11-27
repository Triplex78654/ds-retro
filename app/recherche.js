// « Chercher mes jeux » : parcourt les dossiers choisis, reconnaît la console de chaque jeu
// (par l'extension, et en lisant le début du fichier quand l'extension ne suffit pas, comme pour un .iso),
// et range le chemin dans la bibliothèque. Rien n'est copié ni déplacé.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const PAR_EXTENSION = {
  ".nes": "nes", ".fds": "nes", ".sfc": "snes", ".smc": "snes", ".z64": "n64", ".n64": "n64", ".v64": "n64",
  ".nds": "ds", ".gba": "ds", ".gb": "ds", ".gbc": "ds",
  ".cia": "3ds", ".cci": "3ds", ".cxi": "3ds", ".3dsx": "3ds", ".zcci": "3ds", ".zcxi": "3ds", ".z3dsx": "3ds",
  ".nsp": "switch", ".xci": "switch",
  ".cso": "psp", ".zso": "ps2",
  ".gcm": "gc", ".rvz": "gc", ".wbfs": "gc", ".gcz": "gc", ".wia": "gc",
};
// À regarder de plus près : le même format sert à plusieurs consoles.
// (.cue/.bin à part : l'émulateur PlayStation de l'appli les lit dans un .zip.)
const A_LIRE = new Set([".iso", ".chd", ".pbp", ".3ds", ".zip", ".7z"]);
// Dossiers qu'on ne fouille pas (système, programmes, caches).
const IGNORES = /^(windows|program files( \(x86\))?|programdata|\$recycle\.bin|system volume information|appdata|node_modules|\.git|steamapps|retro-site|__macosx)$/i;

// Lectures asynchrones : l'appli reste fluide pendant la recherche.
async function lire(fh, position, taille) {
  const b = Buffer.alloc(taille);
  const { bytesRead } = await fh.read(b, 0, taille, position);
  return b.subarray(0, bytesRead);
}
async function avecFichier(chemin, f) {
  const fh = await fsp.open(chemin, "r");
  try { return await f(fh); } finally { await fh.close(); }
}

// ISO 9660 : liste des noms du dossier racine.
async function racineIso(fd) {
  const pvd = await lire(fd, 16 * 2048, 2048);
  if (pvd.length < 190 || pvd.toString("latin1", 1, 6) !== "CD001") return null;
  const secteur = pvd.readUInt32LE(156 + 2), taille = pvd.readUInt32LE(156 + 10);
  const dir = await lire(fd, secteur * 2048, Math.min(taille, 64 * 1024));
  const noms = [];
  for (let i = 0; i < dir.length;) {
    const l = dir[i];
    if (!l) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
    const n = dir[i + 32];
    noms.push(dir.toString("latin1", i + 33, i + 33 + n).replace(/;1$/, "").toUpperCase());
    i += l;
  }
  return noms;
}

function consoleIso(chemin) {
  return avecFichier(chemin, async fd => {
    const debut = await lire(fd, 0, 0x40);
    if (debut.length >= 0x20 && debut.readUInt32BE(0x1c) === 0xc2339f3d) return "gc"; // GameCube
    if (debut.length >= 0x20 && debut.readUInt32BE(0x18) === 0x5d1c9ea3) return "gc"; // Wii
    const noms = (await racineIso(fd)) || [];
    if (noms.includes("PS3_GAME") || noms.includes("PS3_DISC.SFB")) return "ps3";
    if (noms.includes("UMD_DATA.BIN") || noms.includes("PSP_GAME")) return "psp";
    if (noms.includes("SYSTEM.CNF")) {
      // BOOT2 = PlayStation 2, BOOT = PlayStation
      return /BOOT2\s*=/i.test((await lireFichierIso(fd, "SYSTEM.CNF")) || "") ? "ps2" : "psx";
    }
    // Image « bin » brute de CD (2352 octets par secteur) : PlayStation
    const brut = await lire(fd, 16 * 2352 + 16, 8);
    if (brut.toString("latin1", 1, 6) === "CD001") return "psx";
    return null;
  });
}
async function lireFichierIso(fd, nom) {
  const pvd = await lire(fd, 16 * 2048, 2048);
  const secteur = pvd.readUInt32LE(156 + 2), taille = pvd.readUInt32LE(156 + 10);
  const dir = await lire(fd, secteur * 2048, Math.min(taille, 64 * 1024));
  for (let i = 0; i < dir.length;) {
    const l = dir[i];
    if (!l) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
    const n = dir[i + 32];
    if (dir.toString("latin1", i + 33, i + 33 + n).replace(/;1$/, "").toUpperCase() === nom)
      return (await lire(fd, dir.readUInt32LE(i + 2) * 2048, Math.min(dir.readUInt32LE(i + 10), 4096))).toString("latin1");
    i += l;
  }
  return null;
}

// CHD : un disque DVD (PS2) ou un CD (PlayStation).
function consoleChd(chemin) {
  return avecFichier(chemin, async fd => {
    const debut = (await lire(fd, 0, 1 << 16)).toString("latin1");
    if (!debut.startsWith("MComprHD")) return null;
    if (debut.includes("DVD ")) return "ps2";
    return "psx";
  });
}

// PBP : un jeu PlayStation (PSone Classics, lu par l'émulateur PlayStation) ou un jeu PSP.
function consolePbp(chemin) {
  return avecFichier(chemin, async fd => {
    const h = await lire(fd, 0, 0x28);
    if (h.length < 0x28 || h.toString("latin1", 1, 4) !== "PBP") return null;
    const m = (await lire(fd, h.readUInt32LE(0x24), 12)).toString("latin1");
    return m.startsWith("PSISOIMG") || m.startsWith("PSTITLEIMG") ? "psx" : "psp";
  });
}

// .3ds : la plupart sont chiffrés ; on les range en 3DS (Azahar dira s'il ne peut pas les lire).
function consoleTroisDs(chemin) {
  return avecFichier(chemin, async fd => ((await lire(fd, 0x100, 4)).toString("latin1") === "NCSD" ? "3ds" : null));
}

// Archive : le nom du fichier qu'elle contient.
function contenuArchive(chemin, sept) {
  return new Promise(ok => {
    execFile(sept, ["l", "-ba", "-slt", chemin], { maxBuffer: 1 << 22, timeout: 20000 }, (err, sortie) => {
      if (err) return ok(null);
      const noms = String(sortie).split(/\r?\n/).filter(l => l.startsWith("Path = ")).map(l => l.slice(7));
      for (const n of noms) {
        const c = PAR_EXTENSION[path.extname(n).toLowerCase()];
        if (c && c !== "gc") return ok(c);
      }
      if (noms.some(n => /\.cue$/i.test(n)) && noms.some(n => /\.bin$/i.test(n))) return ok("psx");
      ok(null);
    });
  });
}

async function consoleDe(chemin, sept) {
  const ext = path.extname(chemin).toLowerCase();
  try {
    if (ext === ".iso") return await consoleIso(chemin);
    if (ext === ".chd") return await consoleChd(chemin);
    if (ext === ".pbp") return await consolePbp(chemin);
    if (ext === ".3ds") return await consoleTroisDs(chemin);
    if (ext === ".zip" || ext === ".7z") return sept ? await contenuArchive(chemin, sept) : null;
  } catch (e) { return null; }
  return PAR_EXTENSION[ext] || null;
}

// Un dossier de jeu PS3 (PS3_GAME/USRDIR/EBOOT.BIN).
const existe = p => fsp.access(p).then(() => true, () => false);
async function estJeuPs3(d, noms) {
  if (noms.has("PS3_GAME") && await existe(path.join(d, "PS3_GAME", "USRDIR", "EBOOT.BIN"))) return true;
  return noms.has("USRDIR") && noms.has("PARAM.SFO") && existe(path.join(d, "USRDIR", "EBOOT.BIN"));
}

// limites : au plus `dureeMax` ms et `dossiersMax` dossiers par recherche (gros disques, lecteurs lents).
async function chercher(racines, { sept, progression = () => {}, exclure = [], dureeMax = 4 * 60 * 1000, dossiersMax = 200000 } = {}) {
  const trouves = [];
  const exclus = exclure.map(d => path.resolve(d).toLowerCase());
  let dernier = 0, dossiersVus = 0;
  const debut = Date.now();
  const stop = () => Date.now() - debut > dureeMax || dossiersVus > dossiersMax;
  async function fouiller(dossier, profondeur) {
    if (profondeur > 8 || stop() || exclus.some(x => (path.resolve(dossier).toLowerCase() + path.sep).startsWith(x + path.sep))) return;
    dossiersVus++;
    let liste;
    try { liste = await fsp.readdir(dossier, { withFileTypes: true }); } catch (e) { return; }
    // Projet de code (dépôt git) : ses fichiers de test ou copies de jeux ne sont pas ta ludothèque.
    if (profondeur > 0 && liste.some(e => e.name === ".git")) return;
    // Ce dossier est lui-même un jeu PS3 : on le range tel quel, sans fouiller dedans.
    if (profondeur > 0 && await estJeuPs3(dossier, new Set(liste.map(e => e.name)))) {
      trouves.push({ console: "ps3", chemin: dossier, nom: path.basename(dossier), dossier: true });
      return;
    }
    for (const e of liste) {
      if (stop()) return;
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) {
        if (IGNORES.test(e.name) || e.name.startsWith(".")) continue;
        await fouiller(p, profondeur + 1);
        continue;
      }
      if (!e.isFile() || e.name.startsWith("._")) continue; // ._fichier : reste d'une archive faite sur Mac
      const ext = path.extname(e.name).toLowerCase();
      if (!PAR_EXTENSION[ext] && !A_LIRE.has(ext)) continue;
      if (Date.now() - dernier > 250) { dernier = Date.now(); progression({ etape: "recherche", texte: "Recherche… " + trouves.length + " jeux trouvés", dossier }); }
      // Les .bin d'un .cue sont comptés avec le .cue ; un petit .zip n'est sûrement pas un jeu de salon récent : on regarde quand même.
      const c = await consoleDe(p, sept);
      if (c) trouves.push({ console: c, chemin: p, nom: e.name });
    }
  }
  for (const r of racines) await fouiller(r, 0);
  const uniques = sansDoublons(trouves);
  uniques.complet = !stop(); // false : recherche coupée (durée ou nombre de dossiers), tout n'a pas été vu
  progression({ etape: "fini", texte: uniques.length + " jeux trouvés" });
  return uniques;
}

// Un même jeu trouvé plusieurs fois (copies dans plusieurs dossiers, ou archive + jeu extrait) n'est gardé qu'une fois :
// même console et même nom (sans extension, accents, ponctuation ni « (2) »), en préférant le jeu extrait à l'archive.
// Une archive X.zip dont le dossier X\ (créé par « Extraire tout ») contient un jeu de la même console est aussi écartée,
// même si le nom extrait est abîmé (accents mal convertis par une archive faite sur Mac).
const ARCHIVE = /\.(zip|7z)$/i;
const tige = t => (t.dossier ? t.nom : path.basename(t.nom, path.extname(t.nom)));
const cleJeu = t => t.console + "|" + tige(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s*\(\d+\)$/, "").replace(/[^a-z0-9]+/g, "");
function sansDoublons(trouves) {
  const dedans = (fichier, dossier) => (path.dirname(fichier).toLowerCase() + path.sep).startsWith(dossier.toLowerCase() + path.sep);
  const extraits = trouves.filter(t => !ARCHIVE.test(t.nom));
  const garde = new Map();
  for (const t of trouves) {
    if (ARCHIVE.test(t.nom)) {
      const dossierExtrait = path.join(path.dirname(t.chemin), tige(t));
      if (extraits.some(u => u.console === t.console && dedans(u.chemin, dossierExtrait))) continue;
    }
    const k = cleJeu(t), deja = garde.get(k);
    if (!deja || (ARCHIVE.test(deja.nom) && !ARCHIVE.test(t.nom))) garde.set(k, t);
  }
  return [...garde.values()];
}

module.exports = { chercher, consoleDe, sansDoublons };
