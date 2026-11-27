// Lance la vraie appli Rétro (Electron) en mode démonstration, parcourt ses pages, vérifie qu'il n'y a pas
// d'erreur dans la console et prend des captures d'écran.
//   cd app && node tests/captures.mjs [dossier-des-captures]
// Mode démo : données et dossiers de jeux dans un dossier temporaire, aucune recherche sur le PC.
// Les jeux de démonstration sont des fichiers vides aux noms de jeux libres (homebrew) ou inventés.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const appli = path.resolve(ici, "..");
const sortie = path.resolve(process.argv[2] || path.join(appli, "captures"));
const PORT_DEBUG = 9333, ORIGINE = "http://127.0.0.1:53135";
fs.mkdirSync(sortie, { recursive: true });

// ---------- Jeux de démonstration ----------
const demo = fs.mkdtempSync(path.join(os.tmpdir(), "retro-demo-"));
const JEUX = {
  NES: ["Alter Ego.nes", "Blade Buster.nes", "Super Tilt Bro.nes", "Nebs n Debs.nes", "Lan Master.nes"],
  "Super Nintendo": ["Demo Plateformes.sfc", "Demo Course.sfc"],
  "Nintendo 64": ["Demo Aventure 3D.z64"],
  PlayStation: ["Demo Course PS1.chd"],
  "3DS": ["Demo Puzzle.cci"],
  PSP: ["Demo Rythme.iso"],
};
for (const [dossier, noms] of Object.entries(JEUX)) {
  const d = path.join(demo, "documents", "Rétro", dossier);
  fs.mkdirSync(d, { recursive: true });
  noms.forEach((n, i) => fs.writeFileSync(path.join(d, n), Buffer.alloc(40960 * (i + 1))));
}
// Console DS : un vrai jeu libre du catalogue et la ROM GBA des tests, pour vérifier qu'ils se lancent.
const dossierDs = path.join(demo, "documents", "Rétro", "DS");
fs.mkdirSync(dossierDs, { recursive: true });
fs.copyFileSync(path.join(appli, "..", "catalogue", "SpaceImpaktoDS.nds"), path.join(dossierDs, "SpaceImpaktoDS.nds"));
fs.copyFileSync(path.join(appli, "..", "tests", "roms", "test-rouge.gba"), path.join(dossierDs, "Test rouge.gba"));

execFileSync(process.execPath, ["preparer.mjs"], { cwd: appli, stdio: "inherit" });
const electron = createRequire(import.meta.url)(path.join(appli, "node_modules", "electron"));
const app = spawn(electron, ["--remote-debugging-port=" + PORT_DEBUG, "."], { cwd: appli, env: { ...process.env, RETRO_DEMO: demo }, stdio: "inherit" });
const fin = code => { try { app.kill(); } catch (e) {} setTimeout(() => { try { fs.rmSync(demo, { recursive: true, force: true }); } catch (e) {} process.exit(code); }, 800); };
const pause = ms => new Promise(ok => setTimeout(ok, ms));

// ---------- Protocole de débogage de Chromium ----------
let cible = null;
for (let i = 0; i < 60 && !cible; i++) {
  await pause(500);
  try { cible = (await (await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/list`)).json()).find(t => t.type === "page" && t.url.startsWith(ORIGINE)); } catch (e) {}
}
if (!cible) { console.error("L'appli n'a pas démarré."); fin(1); }
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
let n = 0;
const attentes = new Map(), ecouteurs = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && attentes.has(d.id)) { const [ok, ko] = attentes.get(d.id); attentes.delete(d.id); d.error ? ko(new Error(d.error.message)) : ok(d.result); }
  else ecouteurs.forEach(f => f(d));
};
const cdp = (method, params = {}) => new Promise((ok, ko) => { const id = ++n; attentes.set(id, [ok, ko]); ws.send(JSON.stringify({ id, method, params })); });
const erreurs = [];
ecouteurs.push(d => {
  if (d.method === "Runtime.exceptionThrown") erreurs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") erreurs.push(d.params.args.map(a => a.value ?? a.description).join(" "));
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") erreurs.push(d.params.entry.text + " " + (d.params.entry.url || ""));
});
await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Log.enable");
const evaluer = async code => {
  // Le bloc { } garde les const de chaque essai à part ; la valeur rendue est celle de la dernière instruction.
  const r = await cdp("Runtime.evaluate", { expression: "{" + code + "\n}", returnByValue: true });
  if (r.exceptionDetails) throw new Error("Évaluation : " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
async function aller(page) {
  const charge = new Promise(ok => { const f = d => { if (d.method === "Page.loadEventFired") { ecouteurs.splice(ecouteurs.indexOf(f), 1); ok(); } }; ecouteurs.push(f); });
  await cdp("Page.navigate", { url: ORIGINE + "/" + page });
  await charge; await pause(900);
}
async function taille(width, height) { await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); }
async function capture(nom) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(sortie, nom + ".png"), Buffer.from(data, "base64"));
  console.log("capture", nom);
}
const verifier = (condition, message) => { if (!condition) { erreurs.push("Vérification : " + message); console.error("✗", message); } else console.log("✓", message); };

try {
  await taille(1440, 900);
  await aller("accueil.html");
  verifier(await evaluer("document.querySelectorAll('.console').length") >= 11, "l'accueil affiche les consoles");
  verifier(await evaluer("[...document.querySelectorAll('.console .badge')].some(b => b.textContent === '5 jeux')"), "l'accueil compte les jeux NES du dossier");
  // Historique de démonstration : quelques lancements et favoris.
  await evaluer(`localStorage.setItem("retro-recents", JSON.stringify([
    { cle: "nes:Super Tilt Bro.nes", console: "nes", nom: "Super Tilt Bro.nes", date: Date.now() - 3e5 },
    { cle: "snes:Demo Plateformes.sfc", console: "snes", nom: "Demo Plateformes.sfc", date: Date.now() - 7.2e6 },
    { cle: "nes:Alter Ego.nes", console: "nes", nom: "Alter Ego.nes", date: Date.now() - 9e7 }]));
    localStorage.setItem("retro-favoris", JSON.stringify(["nes:Alter Ego.nes", "n64:Demo Aventure 3D.z64"]));
    localStorage.setItem("retro-lancements", "3"); true`);
  await aller("accueil.html");
  verifier(await evaluer("!document.getElementById('bloc-recents').hidden && document.querySelectorAll('#recents .carte').length === 3"), "« Reprendre » montre les jeux récents");
  await capture("accueil");

  await aller("bibliotheque.html");
  verifier(await evaluer("document.querySelectorAll('#jeux .carte').length") === 13, "la bibliothèque liste les 13 jeux (DS compris)");
  await capture("bibliotheque");
  await evaluer("const q = document.getElementById('q'); q.value = 'demo'; q.dispatchEvent(new Event('input')); true");
  verifier(await evaluer("document.querySelectorAll('#jeux .carte').length") === 6, "la recherche filtre instantanément");
  await evaluer("const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); document.getElementById('favoris').click(); true");
  verifier(await evaluer("document.querySelectorAll('#jeux .carte').length") === 2, "le filtre Favoris garde 2 jeux");
  await evaluer("document.getElementById('favoris').click(); document.querySelector('input[name=vue][value=liste]').click(); true");
  verifier(await evaluer("document.getElementById('jeux').classList.contains('liste')"), "l'affichage en liste s'active");
  await capture("bibliotheque-liste");
  await evaluer("document.querySelector('input[name=vue][value=grille]').click(); true");

  // Console DS : catalogue comme les autres consoles, puis la fiche lance le jeu dans la console DS.
  await aller("salon.html?console=ds");
  verifier(await evaluer("[...document.querySelectorAll('#jeux .carte .titre-jeu > span')].map(n => n.textContent).sort().join(',')") === "SpaceImpaktoDS,Test rouge", "le catalogue DS liste les jeux DS / GBA du PC");
  await capture("catalogue-ds");
  await aller("salon.html?console=ds&jeu=" + encodeURIComponent("Test rouge.gba"));
  verifier(await evaluer("document.getElementById('fiche').open"), "la fiche d'un jeu DS s'ouvre");
  const versDs = new Promise(ok => { const f = d => { if (d.method === "Page.loadEventFired") { ecouteurs.splice(ecouteurs.indexOf(f), 1); ok(); } }; ecouteurs.push(f); });
  await evaluer("document.getElementById('fiche-lancer').click(); true");
  await versDs; await pause(6000);
  verifier(await evaluer("location.pathname === '/index.html' && document.body.classList.contains('mode-gba') && !document.body.classList.contains('chargement') && !document.getElementById('erreur').textContent"), "« Lancer le jeu » démarre le jeu GBA dans la console DS");
  await capture("console-ds-en-jeu");
  await aller("index.html");
  verifier(await evaluer("[...document.querySelectorAll('#grille .cart .nom')].map(n => n.textContent).sort().join(',')") === "SpaceImpaktoDS,Test rouge", "la console DS montre aussi les jeux du PC");

  await aller("salon.html?console=nes");
  verifier(await evaluer("document.querySelectorAll('#jeux .carte').length") === 5, "le catalogue NES liste ses jeux");
  await capture("console-nes");
  await aller("salon.html?console=nes&jeu=" + encodeURIComponent("Alter Ego.nes"));
  verifier(await evaluer("document.getElementById('fiche').open && document.getElementById('fiche-titre').textContent === 'Alter Ego'"), "la fiche du jeu s'ouvre depuis un lien");
  verifier(await evaluer("document.getElementById('fiche-favori').getAttribute('aria-pressed')") === "true", "la fiche montre le favori");
  await capture("fiche-jeu");
  await evaluer("document.getElementById('fiche-favori').click(); true");
  verifier(await evaluer("!JSON.parse(localStorage.getItem('retro-favoris')).includes('nes:Alter Ego.nes')"), "le bouton favori enregistre le choix");
  await evaluer("document.getElementById('fiche-favori').click(); true");

  await aller("salon.html?console=3ds");
  await pause(600);
  await capture("console-3ds");

  await aller("reglages.html");
  await capture("parametres");
  // Thèmes : changement immédiat et retenu
  for (const [palette, schema] of [["bleu", "dark"], ["vert", "dark"], ["rose", "light"]]) {
    await evaluer(`document.querySelector('input[name=palette][value=${palette}]').click(); document.querySelector('input[name=schema][value="${schema}"]').click(); true`);
    await aller("accueil.html");
    verifier(await evaluer(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === RetroTheme.PALETTES.${palette}.couleur && getComputedStyle(document.documentElement).colorScheme === "${schema}"`), `thème ${palette} / ${schema} appliqué et retenu`);
    await capture("theme-" + palette + "-" + (schema === "dark" ? "sombre" : "clair"));
    await aller("reglages.html");
  }
  await evaluer("RetroTheme.reinitialiser(); true");
  // Résolutions
  for (const [w, h] of [[1280, 720], [1920, 1080], [800, 600]]) {
    await taille(w, h);
    await aller("accueil.html");
    verifier(await evaluer("document.documentElement.scrollWidth <= innerWidth"), `pas de défilement horizontal en ${w}×${h}`);
    await capture(`accueil-${w}x${h}`);
  }
} catch (e) { erreurs.push(String(e.stack || e)); }

ws.close();
// Messages connus et sans gravité : EmulatorJS essaie d'abord ses fichiers minifiés (absents) puis prend les autres ;
// le cœur demande à garder l'écran allumé, refusé quand la fenêtre de test n'est pas au premier plan.
const CONNUES = [/emulator\.min\.(js|css)/, /localization\/fr\.json/, /WakeLock|Wake Lock/];
erreurs.splice(0, erreurs.length, ...erreurs.filter(e => !CONNUES.some(r => r.test(e))));
if (erreurs.length) { console.error("\nErreurs :\n- " + erreurs.join("\n- ")); fin(1); }
else { console.log("\nAucune erreur dans la console. Captures dans " + sortie); fin(0); }
