// Tests de l'appli Windows (sans Electron) : serveur local, recherche des jeux, réglages Azahar et Eden.
// Lancés par GitHub avant chaque construction : node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const { demarrer } = require(path.join(racine, "serveur-local.js"));
const recherche = require(path.join(racine, "recherche.js"));
const azahar = require(path.join(racine, "azahar.js"));
const eden = require(path.join(racine, "eden.js"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "retro-tests-"));

// ---------- Faux fichiers de jeux ----------
// Image ISO 9660 minimale : descripteur au secteur 16, dossier racine au secteur 18, fichiers ensuite.
function iso(fichiers) {
  const S = 2048, noms = Object.keys(fichiers);
  const b = Buffer.alloc(S * (20 + noms.length));
  b.write("\x01CD001\x01", 16 * S, "latin1");
  const entree = (pos, secteur, taille, nom, dossier) => {
    const n = Buffer.from(nom, "latin1"), l = 33 + n.length + (n.length % 2 ? 0 : 1);
    b[pos] = l; b.writeUInt32LE(secteur, pos + 2); b.writeUInt32LE(taille, pos + 10);
    b[pos + 25] = dossier ? 2 : 0; b[pos + 32] = n.length; n.copy(b, pos + 33);
    return l;
  };
  entree(16 * S + 156, 18, S, "\0", true);
  let pos = 18 * S;
  pos += entree(pos, 18, S, "\0", true); pos += entree(pos, 18, S, "\x01", true);
  noms.forEach((nom, i) => {
    const data = Buffer.from(fichiers[nom]);
    data.copy(b, (20 + i) * S);
    pos += entree(pos, 20 + i, data.length, nom + ";1", false);
  });
  return b;
}
function preparerJeux() {
  const d = path.join(tmp, "jeux"); fs.mkdirSync(path.join(d, "sous", "Mon Jeu PS3", "PS3_GAME", "USRDIR"), { recursive: true });
  fs.writeFileSync(path.join(d, "Okami.iso"), iso({ "SYSTEM.CNF": "BOOT2 = cdrom0:\\SLES_123.45;1\n" }));
  fs.writeFileSync(path.join(d, "Crash.iso"), iso({ "SYSTEM.CNF": "BOOT = cdrom:\\SCUS_949.00;1\n" }));
  fs.writeFileSync(path.join(d, "Monster Hunter.iso"), iso({ "UMD_DATA.BIN": "ULES-00000|" }));
  const gc = Buffer.alloc(0x100); gc.writeUInt32BE(0xc2339f3d, 0x1c); fs.writeFileSync(path.join(d, "Zelda WW.iso"), gc);
  fs.writeFileSync(path.join(d, "Kingdom.chd"), Buffer.concat([Buffer.from("MComprHD"), Buffer.alloc(100), Buffer.from("DVD ")]));
  const pbp = Buffer.alloc(0x200); pbp.write("\0PBP", 0, "latin1"); pbp.writeUInt32LE(0x100, 0x24); pbp.write("PSISOIMG0000", 0x100, "latin1");
  fs.writeFileSync(path.join(d, "sous", "FF7.pbp"), pbp);
  fs.writeFileSync(path.join(d, "Mario.nes"), "NES\x1a");
  fs.writeFileSync(path.join(d, "Zelda.nsp"), "PFS0");
  fs.writeFileSync(path.join(d, "sous", "Mon Jeu PS3", "PS3_GAME", "USRDIR", "EBOOT.BIN"), "e");
  fs.writeFileSync(path.join(d, "notes.txt"), "pas un jeu");
  return d;
}

test("la recherche range chaque jeu dans la bonne console", async () => {
  const d = preparerJeux();
  const trouves = await recherche.chercher([d], {});
  const par = Object.fromEntries(trouves.map(t => [t.nom, t.console]));
  assert.deepEqual(par, {
    "Okami.iso": "ps2", "Crash.iso": "psx", "Monster Hunter.iso": "psp", "Zelda WW.iso": "gc", "Kingdom.chd": "ps2",
    "FF7.pbp": "psx", "Mario.nes": "nes", "Zelda.nsp": "switch", "Mon Jeu PS3": "ps3",
  });
});

test("la recherche s'arrête quand le temps est écoulé", async () => {
  const trouves = await recherche.chercher([path.join(tmp, "jeux")], { dureeMax: -1 });
  assert.equal(trouves.length, 0);
});

// ---------- Serveur local ----------
function requete(port, chemin, entetes = {}) {
  return new Promise((ok, ko) => {
    const r = http.request({ host: "127.0.0.1", port, path: chemin, headers: { Host: "127.0.0.1:" + port, ...entetes } }, res => { res.resume(); ok(res.statusCode); });
    r.on("error", ko); r.end();
  });
}
test("le serveur local refuse les autres sites et survit aux adresses invalides", async () => {
  const site = path.join(tmp, "site"); fs.mkdirSync(site, { recursive: true }); fs.writeFileSync(path.join(site, "accueil.html"), "ok");
  fs.mkdirSync(path.join(tmp, "site-voisin"), { recursive: true }); fs.writeFileSync(path.join(tmp, "site-voisin", "secret.txt"), "non");
  const nes = path.join(tmp, "nes"); fs.mkdirSync(nes, { recursive: true }); fs.writeFileSync(path.join(nes, "Jeu.nes"), "NES");
  const port = 53000 + Math.floor(Math.random() * 900);
  const serveur = await demarrer({ dossier: site, port, dossiers: { nes } });
  try {
    assert.equal(await requete(port, "/accueil.html"), 200);
    assert.equal(await requete(port, "/%E0"), 400);
    assert.equal(await requete(port, "/jeux-pc/nes/%E0"), 400);
    assert.equal(await requete(port, "/accueil.html"), 200, "le serveur répond encore");
    assert.equal(await requete(port, "/jeux-pc/nes/", { "Sec-Fetch-Site": "cross-site" }), 403);
    assert.equal(await requete(port, "/jeux-pc/nes/", { Origin: "https://exemple.com" }), 403);
    assert.equal(await requete(port, "/jeux-pc/nes/", { Host: "exemple.com:" + port }), 403);
    assert.equal(await requete(port, "/jeux-pc/nes/", { Origin: "http://127.0.0.1:" + port, "Sec-Fetch-Site": "same-origin" }), 200);
    assert.equal(await requete(port, "/../site-voisin/secret.txt"), 403);
    assert.equal(await requete(port, "/jeux-pc/nes/..%2F..%2Fsite%2Faccueil.html"), 403);
    assert.equal(await requete(port, "/jeux-pc/nes/Jeu.nes"), 200);
  } finally { serveur.close(); }
});

// ---------- Azahar (3DS) ----------
test("Azahar : profils clavier / manette, sans toucher au reste", () => {
  process.env.APPDATA = path.join(tmp, "appdata");
  const f = path.join(tmp, "appdata", "Azahar", "config", "qt-config.ini");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "[UI]\nfullscreen=false\n\n[Controls]\nprofile=0\nprofiles\\1\\name=Default\nprofiles\\size=1\n");
  azahar.reglerCommandes(false);
  let t = fs.readFileSync(f, "utf8");
  assert.match(t, /profiles\\size=3/);
  assert.match(t, /profile=1\n/);
  assert.match(t, /fullscreen=false/);
  azahar.reglerCommandes(true);
  t = fs.readFileSync(f, "utf8");
  assert.match(t, /profile=2\n/);
  assert.match(t, /profiles\\size=3/, "pas de profil en double");
});

test("Azahar : lecture d'un .cia et message clair s'il est abîmé", () => {
  const al = x => Math.ceil(x / 64) * 64, o = al(0x2020) + al(0xa00) + al(0x350);
  const b = Buffer.alloc(o + 0x2000);
  b.writeUInt32LE(0x2020, 0); b.writeUInt32LE(0xa00, 8); b.writeUInt32LE(0x350, 0xc); b.writeUInt32LE(0xb64, 0x10);
  b.writeUInt32BE(0x10004, o); const e = o + 4 + 0x13c;
  b.writeBigUInt64BE(0x0004000000055d00n, e + 0x4c); b.writeUInt16BE(1, e + 0x9e); b.writeUInt32BE(0x2a, e + 0x9c4);
  const cia = path.join(tmp, "jeu.cia"); fs.writeFileSync(cia, b);
  assert.deepEqual(azahar.lireCia(cia), { haut: "00040000", bas: "00055d00", contenu: "0000002a.app" });
  b.writeUInt16BE(60000, e + 0x9e); fs.writeFileSync(cia, b);
  assert.throws(() => azahar.lireCia(cia), /abîmé|illisible/);
});

// ---------- Eden (Switch) ----------
test("Eden : clavier/souris, puis la manette réglée dans Eden est retenue", () => {
  const dir = path.join(tmp, "eden"), f = path.join(dir, "user", "config", "qt-config.ini");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "[Renderer]\nbackend=1\n");
  assert.equal(eden.reglerCommandes(dir, true).manetteAReglee, true);
  let t = fs.readFileSync(f, "utf8");
  assert.match(t, /player_0_lstick=.*code\$090/, "ZQSD");
  assert.match(t, /mouse_panning=true/);
  assert.match(t, /backend=1/);
  fs.writeFileSync(f, t.replace(/player_0_button_a=.*/, 'player_0_button_a="engine:sdl,port:0,guid:0300,button:1"'));
  assert.equal(eden.reglerCommandes(dir, true).manette, true);
  eden.reglerCommandes(dir, false);
  assert.match(fs.readFileSync(f, "utf8"), /player_0_button_a="code:16777220/);
  eden.reglerCommandes(dir, true);
  assert.match(fs.readFileSync(f, "utf8"), /player_0_button_a="engine:sdl/);
});
