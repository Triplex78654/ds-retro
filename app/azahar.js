// Réglages d'Azahar (3DS) pour jouer comme dans le reste de l'appli, et jeux .cia.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const dossierAzahar = () => path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Azahar");

// ---------- Commandes ----------
// Touches Qt (ce que la touche écrit : sur un clavier AZERTY, ZQSD donne Z, Q, S, D).
const K = { A: 0x41, B: 0x42, C: 0x43, D: 0x44, E: 0x45, F: 0x46, G: 0x47, H: 0x48, I: 0x49, J: 0x4a, O: 0x4f, P: 0x50, Q: 0x51, S: 0x53, T: 0x54, V: 0x56, W: 0x57, X: 0x58, Z: 0x5a,
  espace: 0x20, entree: 0x01000004, retour: 0x01000003, maj: 0x01000020, haut: 0x01000013, bas: 0x01000015, gauche: 0x01000012, droite: 0x01000014 };
// Format des paramètres d'Azahar : « clé:valeur,clé:valeur », avec $0 $1 $2 pour : , $ dans une valeur imbriquée.
const echapper = v => String(v).replace(/\$/g, "$2").replace(/,/g, "$1").replace(/:/g, "$0");
const param = o => Object.keys(o).sort().map(k => k + ":" + echapper(o[k])).join(",");
const touche = code => param({ engine: "keyboard", code });
const croixClavier = (h, b, g, d, mod) => param({ engine: "analog_from_button", up: touche(h), down: touche(b), left: touche(g), right: touche(d), modifier: touche(mod), modifier_scale: "0.500000" });
// Manette : n'importe quelle manette (« maptype:all »), boutons SDL GameController.
const pad = o => param({ engine: "sdl", api: "controller", maptype: "all", port: 0, guid: "0", ...o });
const SDL = { A: 0, B: 1, X: 2, Y: 3, BACK: 4, GUIDE: 5, START: 6, LB: 9, RB: 10, HAUT: 11, BAS: 12, GAUCHE: 13, DROITE: 14 };

const PROFILS = {
  "Retro clavier": {
    button_a: touche(K.entree), button_b: touche(K.espace), button_x: touche(K.I), button_y: touche(K.J),
    button_up: touche(K.haut), button_down: touche(K.bas), button_left: touche(K.gauche), button_right: touche(K.droite),
    button_l: touche(K.A), button_r: touche(K.E), button_start: touche(K.P), button_select: touche(K.O),
    button_debug: touche(0x01000037 /* F8 */), button_gpio14: touche(0x01000038 /* F9 */),
    button_zl: touche(K.W), button_zr: touche(K.X), button_home: touche(K.B), button_power: touche(K.V),
    circle_pad: croixClavier(K.Z, K.S, K.Q, K.D, K.maj), c_stick: croixClavier(K.T, K.G, K.F, K.H, K.C),
  },
  // Placement à la Nintendo : A à droite, B en bas.
  "Retro manette": {
    button_a: pad({ button: SDL.B }), button_b: pad({ button: SDL.A }), button_x: pad({ button: SDL.Y }), button_y: pad({ button: SDL.X }),
    button_up: pad({ button: SDL.HAUT }), button_down: pad({ button: SDL.BAS }), button_left: pad({ button: SDL.GAUCHE }), button_right: pad({ button: SDL.DROITE }),
    button_l: pad({ button: SDL.LB }), button_r: pad({ button: SDL.RB }), button_start: pad({ button: SDL.START }), button_select: pad({ button: SDL.BACK }),
    button_debug: touche(0x01000037), button_gpio14: touche(0x01000038),
    button_zl: pad({ axis: 4, direction: "+", threshold: "0.500000" }), button_zr: pad({ axis: 5, direction: "+", threshold: "0.500000" }),
    button_home: pad({ button: SDL.GUIDE }), button_power: touche(K.V),
    circle_pad: pad({ axis_x: 0, axis_y: 1, deadzone: "0.100000" }), c_stick: pad({ axis_x: 2, axis_y: 3, deadzone: "0.100000" }),
  },
};

// Lecture / écriture du fichier de réglages Qt (format INI de QSettings), en gardant tout le reste.
function lireIni(texte) {
  const sections = [];
  let s = { nom: null, lignes: [] };
  sections.push(s);
  for (const l of texte.split(/\r?\n/)) {
    const m = l.match(/^\[(.+)\]\s*$/);
    if (m) { s = { nom: m[1], lignes: [] }; sections.push(s); }
    else if (l.trim()) s.lignes.push(l);
  }
  return sections;
}
const valeurIni = v => (/[,;"=\s]|^$/.test(v) ? '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' : v);
function section(sections, nom) {
  let s = sections.find(x => x.nom === nom);
  if (!s) { s = { nom, lignes: [] }; sections.push(s); }
  const cles = () => new Map(s.lignes.map((l, i) => [l.slice(0, l.indexOf("=")), i]));
  return {
    lire: k => { const i = cles().get(k); return i === undefined ? undefined : s.lignes[i].slice(s.lignes[i].indexOf("=") + 1).replace(/^"(.*)"$/, "$1"); },
    ecrire: (k, v) => { const i = cles().get(k); const l = k + "=" + valeurIni(String(v)); if (i === undefined) s.lignes.push(l); else s.lignes[i] = l; },
  };
}

// Choisit le profil « Retro manette » ou « Retro clavier » (créés au besoin), et la disposition des écrans
// la première fois. Les autres réglages d'Azahar ne sont pas touchés.
function reglerCommandes(avecManette) {
  const fichier = path.join(dossierAzahar(), "config", "qt-config.ini");
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const sections = lireIni(fs.existsSync(fichier) ? fs.readFileSync(fichier, "utf8") : "");
  const c = section(sections, "Controls");
  let taille = Number(c.lire("profiles\\size") || 0);
  if (!taille) {
    // Pas encore de profil : Azahar créerait « Default » ; on le garde en premier.
    taille = 1;
    c.ecrire("profiles\\1\\name", "Default");
    c.ecrire("profiles\\1\\name\\default", "true");
  }
  let choisi = 0;
  for (const [nom, boutons] of Object.entries(PROFILS)) {
    let n = 0;
    for (let i = 1; i <= taille; i++) if (c.lire(`profiles\\${i}\\name`) === nom) n = i;
    if (!n) n = ++taille;
    c.ecrire(`profiles\\${n}\\name`, nom);
    c.ecrire(`profiles\\${n}\\name\\default`, "false");
    for (const [k, v] of Object.entries(boutons)) {
      c.ecrire(`profiles\\${n}\\${k}`, v);
      c.ecrire(`profiles\\${n}\\${k}\\default`, "false");
    }
    if ((nom === "Retro manette") === Boolean(avecManette)) choisi = n - 1;
  }
  c.ecrire("profiles\\size", taille);
  c.ecrire("profile", choisi);
  c.ecrire("profile\\default", "false");
  // Écran du haut en grand, écran du bas à côté (1re fois seulement : ensuite c'est ton choix dans Azahar).
  const l = section(sections, "Layout");
  if (l.lire("layout_option") === undefined || l.lire("layout_option\\default") === "true") {
    l.ecrire("layout_option", 2);
    l.ecrire("layout_option\\default", "false");
  }
  const texte = sections.filter(s => s.nom !== null || s.lignes.length)
    .map(s => (s.nom ? "[" + s.nom + "]\n" : "") + s.lignes.join("\n")).join("\n\n") + "\n";
  fs.writeFileSync(fichier, texte);
}

// ---------- Jeux .cia ----------
// Un .cia s'installe (comme sur une vraie 3DS), puis on lance le jeu installé.
function lireCia(chemin) {
  const fd = fs.openSync(chemin, "r");
  try {
    const lire = (pos, n) => { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, pos); return b; };
    const h = lire(0, 0x20);
    const aligner = x => Math.ceil(x / 64) * 64;
    const tailleEntete = h.readUInt32LE(0), cert = h.readUInt32LE(8), ticket = h.readUInt32LE(0xc), tmd = h.readUInt32LE(0x10);
    if (tailleEntete !== 0x2020 || !tmd) throw new Error("Ce .cia est illisible");
    const debutTmd = aligner(tailleEntete) + aligner(cert) + aligner(ticket);
    const t = lire(debutTmd, Math.min(tmd, 0x10000));
    const sig = t.readUInt32BE(0);
    const tailleSig = { 0x10000: 0x200 + 0x3c, 0x10001: 0x100 + 0x3c, 0x10002: 0x3c + 0x40, 0x10003: 0x200 + 0x3c, 0x10004: 0x100 + 0x3c, 0x10005: 0x3c + 0x40 }[sig];
    if (!tailleSig) throw new Error("Ce .cia est illisible");
    const e = 4 + tailleSig;
    const titre = t.readBigUInt64BE(e + 0x4c);
    const nombre = t.readUInt16BE(e + 0x9e);
    let contenu = null;
    for (let i = 0; i < nombre; i++) {
      const r = e + 0x9c4 + i * 0x30;
      if (t.readUInt16BE(r + 4) === 0) contenu = t.readUInt32BE(r);
    }
    if (contenu === null) throw new Error("Ce .cia ne contient pas de jeu");
    const hex = (n, l) => n.toString(16).padStart(l, "0");
    return { haut: hex(Number(titre >> 32n), 8), bas: hex(Number(titre & 0xffffffffn), 8), contenu: hex(contenu, 8) + ".app" };
  } finally { fs.closeSync(fd); }
}
function trouverInstalle(info) {
  const racine = path.join(dossierAzahar(), "sdmc", "Nintendo 3DS");
  if (!fs.existsSync(racine)) return null;
  for (const id0 of fs.readdirSync(racine)) for (const id1 of (() => { try { return fs.readdirSync(path.join(racine, id0)); } catch (e) { return []; } })()) {
    const dossier = path.join(racine, id0, id1, "title", info.haut, info.bas, "content");
    for (const p of [path.join(dossier, info.contenu), path.join(dossier, "00000000", info.contenu)]) if (fs.existsSync(p)) return p;
  }
  return null;
}
const ERREURS_CIA = { 3: "Azahar n'arrive pas à ouvrir ce .cia", 4: "Fichier introuvable", 5: "Installation annulée", 6: "Ce .cia est abîmé", 7: "Ce .cia est chiffré : Azahar ne lit que les jeux déchiffrés" };

module.exports = { reglerCommandes, lireCia, trouverInstalle, ERREURS_CIA };
