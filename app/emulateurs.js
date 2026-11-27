// Émulateurs externes : téléchargés depuis leur page officielle au premier lancement d'un jeu,
// rangés dans le dossier de l'appli, puis lancés avec le jeu choisi dans le catalogue.
const { app, net } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

// depot : dépôt GitHub officiel ; fichier : le .zip / .7z Windows dans la dernière version ;
// exe : le programme à lancer ; args : comment lui passer le jeu (en plein écran).
const EMULATEURS = {
  "3ds": {
    nom: "Azahar", depot: "azahar-emu/azahar", fichier: /^azahar-windows-msvc-[\d.]+\.zip$/i, exe: "azahar.exe",
    args: jeu => ["-f", jeu],
  },
};

// RETRO_GITHUB_API : seulement pour les tests (un faux GitHub local).
const API_GITHUB = process.env.RETRO_GITHUB_API || "https://api.github.com";
const dossierDe = c => path.join(app.getPath("userData"), "emulateurs", c);
function trouver(dossier, nom) {
  if (!fs.existsSync(dossier)) return null;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isFile() && e.name.toLowerCase() === nom.toLowerCase()) return p;
    if (e.isDirectory()) { const r = trouver(p, nom); if (r) return r; }
  }
  return null;
}
function etat(c) {
  const e = EMULATEURS[c];
  if (!e) return null;
  let version = null;
  try { version = fs.readFileSync(path.join(dossierDe(c), "version.txt"), "utf8").trim(); } catch (x) {}
  return { nom: e.nom, installe: Boolean(version && trouver(dossierDe(c), e.exe)), version };
}

async function installer(c, progression) {
  const e = EMULATEURS[c];
  if (!e) throw new Error("Console inconnue");
  progression({ etape: "recherche", texte: "Recherche de la dernière version de " + e.nom + "…" });
  const r = await net.fetch(`${API_GITHUB}/repos/${e.depot}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Retro-app" } });
  if (!r.ok) throw new Error("GitHub ne répond pas (" + r.status + ")");
  const version = await r.json();
  const fichier = (version.assets || []).find(a => e.fichier.test(a.name));
  if (!fichier) throw new Error("Pas de version Windows de " + e.nom + " dans la dernière publication");
  const tmp = path.join(app.getPath("temp"), "retro-" + c + "-" + fichier.name);
  const reponse = await net.fetch(fichier.browser_download_url);
  if (!reponse.ok || !reponse.body) throw new Error("Téléchargement refusé (" + reponse.status + ")");
  const total = Number(reponse.headers.get("content-length")) || fichier.size || 0;
  const sortie = fs.createWriteStream(tmp);
  let recus = 0, dernier = 0;
  const lecteur = reponse.body.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    recus += value.length;
    if (!sortie.write(Buffer.from(value))) await new Promise(ok => sortie.once("drain", ok));
    if (Date.now() - dernier > 200) { dernier = Date.now(); progression({ etape: "telechargement", recus, total, texte: "Téléchargement de " + e.nom }); }
  }
  await new Promise((ok, ko) => sortie.end(err => (err ? ko(err) : ok())));
  progression({ etape: "extraction", texte: "Installation de " + e.nom + "…" });
  const dossier = dossierDe(c);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  const { path7za } = require("7zip-bin");
  const sept = path7za.replace("app.asar", "app.asar.unpacked");
  await new Promise((ok, ko) => execFile(sept, ["x", "-y", "-o" + dossier, tmp], err => (err ? ko(err) : ok())));
  fs.rmSync(tmp, { force: true });
  if (!trouver(dossier, e.exe)) throw new Error(e.exe + " introuvable après installation");
  fs.writeFileSync(path.join(dossier, "version.txt"), version.tag_name || "inconnue");
  progression({ etape: "fini", texte: e.nom + " " + (version.tag_name || "") + " est installé." });
  return etat(c);
}

// Lance le jeu ; renvoie une promesse résolue quand l'émulateur se ferme.
function lancer(c, cheminJeu) {
  const e = EMULATEURS[c];
  const exe = e && trouver(dossierDe(c), e.exe);
  if (!exe) return Promise.reject(new Error(e ? e.nom + " n'est pas installé" : "Console inconnue"));
  return new Promise((ok, ko) => {
    const p = spawn(exe, e.args(cheminJeu), { cwd: path.dirname(exe), windowsHide: false });
    p.once("error", ko);
    p.once("exit", code => ok(code));
  });
}

module.exports = { EMULATEURS, etat, installer, lancer };
