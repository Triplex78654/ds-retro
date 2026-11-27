// « Chercher mes jeux » : parcourt les dossiers choisis, reconnaît la console de chaque jeu
// (par l'extension, et en lisant le début du fichier quand l'extension ne suffit pas, comme pour un .iso),
// et range le chemin dans la bibliothèque. Rien n'est copié ni déplacé.
const fs = require("node:fs");
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
const IGNORES = /^(windows|program files( \(x86\))?|programdata|\$recycle\.bin|system volume information|appdata|node_modules|\.git|steamapps|retro-site)$/i;

function lire(fd, position, taille) {
  const b = Buffer.alloc(taille);
  const n = fs.readSync(fd, b, 0, taille, position);
  return b.subarray(0, n);
}

// ISO 9660 : liste des noms du dossier racine.
function racineIso(fd) {
  const pvd = lire(fd, 16 * 2048, 2048);
  if (pvd.length < 190 || pvd.toString("latin1", 1, 6) !== "CD001") return null;
  const secteur = pvd.readUInt32LE(156 + 2), taille = pvd.readUInt32LE(156 + 10);
  const dir = lire(fd, secteur * 2048, Math.min(taille, 64 * 1024));
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
  const fd = fs.openSync(chemin, "r");
  try {
    const debut = lire(fd, 0, 0x40);
    if (debut.length >= 0x20 && debut.readUInt32BE(0x1c) === 0xc2339f3d) return "gc"; // GameCube
    if (debut.length >= 0x20 && debut.readUInt32BE(0x18) === 0x5d1c9ea3) return "gc"; // Wii
    const noms = racineIso(fd) || [];
    if (noms.includes("PS3_GAME") || noms.includes("PS3_DISC.SFB")) return "ps3";
    if (noms.includes("UMD_DATA.BIN") || noms.includes("PSP_GAME")) return "psp";
    if (noms.includes("SYSTEM.CNF")) {
      // BOOT2 = PlayStation 2, BOOT = PlayStation
      return /BOOT2\s*=/i.test(lireFichierIso(fd, "SYSTEM.CNF") || "") ? "ps2" : "psx";
    }
    // Image « bin » brute de CD (2352 octets par secteur) : PlayStation
    const brut = lire(fd, 16 * 2352 + 16, 8);
    if (brut.toString("latin1", 1, 6) === "CD001") return "psx";
    return null;
  } finally { fs.closeSync(fd); }
}
function lireFichierIso(fd, nom) {
  const pvd = lire(fd, 16 * 2048, 2048);
  const secteur = pvd.readUInt32LE(156 + 2), taille = pvd.readUInt32LE(156 + 10);
  const dir = lire(fd, secteur * 2048, Math.min(taille, 64 * 1024));
  for (let i = 0; i < dir.length;) {
    const l = dir[i];
    if (!l) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
    const n = dir[i + 32];
    if (dir.toString("latin1", i + 33, i + 33 + n).replace(/;1$/, "").toUpperCase() === nom)
      return lire(fd, dir.readUInt32LE(i + 2) * 2048, Math.min(dir.readUInt32LE(i + 10), 4096)).toString("latin1");
    i += l;
  }
  return null;
}

// CHD : un disque DVD (PS2) ou un CD (PlayStation).
function consoleChd(chemin) {
  const fd = fs.openSync(chemin, "r");
  try {
    const debut = lire(fd, 0, 1 << 16).toString("latin1");
    if (!debut.startsWith("MComprHD")) return null;
    if (debut.includes("DVD ")) return "ps2";
    return "psx";
  } finally { fs.closeSync(fd); }
}

// PBP : un jeu PlayStation (PSone Classics, lu par l'émulateur PlayStation) ou un jeu PSP.
function consolePbp(chemin) {
  const fd = fs.openSync(chemin, "r");
  try {
    const h = lire(fd, 0, 0x28);
    if (h.toString("latin1", 1, 4) !== "PBP") return null;
    const psar = h.readUInt32LE(0x24);
    const m = lire(fd, psar, 12).toString("latin1");
    return m.startsWith("PSISOIMG") || m.startsWith("PSTITLEIMG") ? "psx" : "psp";
  } finally { fs.closeSync(fd); }
}

// .3ds : la plupart sont chiffrés ; on les range en 3DS (Azahar dira s'il ne peut pas les lire).
function consoleTroisDs(chemin) {
  const fd = fs.openSync(chemin, "r");
  try { return lire(fd, 0x100, 4).toString("latin1") === "NCSD" ? "3ds" : null; } finally { fs.closeSync(fd); }
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
    if (ext === ".iso") return consoleIso(chemin);
    if (ext === ".chd") return consoleChd(chemin);
    if (ext === ".pbp") return consolePbp(chemin);
    if (ext === ".3ds") return consoleTroisDs(chemin);
    if (ext === ".zip" || ext === ".7z") return sept ? contenuArchive(chemin, sept) : null;
  } catch (e) { return null; }
  return PAR_EXTENSION[ext] || null;
}

// Un dossier de jeu PS3 (PS3_GAME/USRDIR/EBOOT.BIN).
const estJeuPs3 = d => fs.existsSync(path.join(d, "PS3_GAME", "USRDIR", "EBOOT.BIN")) || fs.existsSync(path.join(d, "USRDIR", "EBOOT.BIN"));

async function chercher(racines, { sept, progression = () => {}, exclure = [] } = {}) {
  const trouves = [];
  const exclus = exclure.map(d => path.resolve(d).toLowerCase());
  let vus = 0, dernier = 0;
  async function fouiller(dossier, profondeur) {
    if (profondeur > 8 || exclus.some(x => path.resolve(dossier).toLowerCase().startsWith(x))) return;
    let liste;
    try { liste = fs.readdirSync(dossier, { withFileTypes: true }); } catch (e) { return; }
    for (const e of liste) {
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) {
        if (IGNORES.test(e.name) || e.name.startsWith(".")) continue;
        if (estJeuPs3(p)) { trouves.push({ console: "ps3", chemin: p, nom: e.name, dossier: true }); continue; }
        await fouiller(p, profondeur + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!PAR_EXTENSION[ext] && !A_LIRE.has(ext)) continue;
      vus++;
      if (Date.now() - dernier > 250) { dernier = Date.now(); progression({ etape: "recherche", texte: "Recherche… " + trouves.length + " jeux trouvés", dossier }); }
      // Les .bin d'un .cue sont comptés avec le .cue ; un petit .zip n'est sûrement pas un jeu de salon récent : on regarde quand même.
      const c = await consoleDe(p, sept);
      if (c) trouves.push({ console: c, chemin: p, nom: e.name });
    }
  }
  for (const r of racines) await fouiller(r, 0);
  progression({ etape: "fini", texte: trouves.length + " jeux trouvés" });
  return trouves;
}

module.exports = { chercher, consoleDe };
