// Commandes d'Eden (Switch) : clavier ZQSD + souris pour la caméra, ou la manette réglée une fois dans Eden.
// Eden range ses réglages dans user/config/qt-config.ini (mode portable). Un bouton n'a qu'un réglage :
// l'appli écrit à chaque lancement le profil clavier/souris, ou remet la manette si elle est branchée.
const fs = require("node:fs");
const path = require("node:path");
const { lireIni, section, ecrireIni, param } = require("./azahar");

// Touches Qt (ce que la touche écrit : en AZERTY, ZQSD donne Z, Q, S, D).
const K = { A: 0x41, C: 0x43, D: 0x44, E: 0x45, H: 0x48, I: 0x49, J: 0x4a, O: 0x4f, P: 0x50, Q: 0x51, S: 0x53, V: 0x56, Z: 0x5a,
  espace: 0x20, entree: 0x01000004, maj: 0x01000020, haut: 0x01000013, bas: 0x01000015, gauche: 0x01000012, droite: 0x01000014,
  F5: 0x01000034, F6: 0x01000035, F7: 0x01000036, F8: 0x01000037, F12: 0x0100003b };
const touche = code => param({ engine: "keyboard", code, toggle: 0 });
const souris = bouton => param({ engine: "mouse", button: bouton, port: 0 });
const croix = (h, b, g, d, mod) => param({ engine: "analog_from_button", up: touche(h), down: touche(b), left: touche(g), right: touche(d), modifier: touche(mod), modifier_scale: "0.500000" });

const CLAVIER = {
  button_a: touche(K.entree), button_b: touche(K.espace), button_x: touche(K.I), button_y: touche(K.J),
  button_lstick: touche(K.C), button_rstick: touche(K.V), button_l: touche(K.A), button_r: touche(K.E),
  button_zl: souris(1), button_zr: souris(0), button_plus: touche(K.P), button_minus: touche(K.O),
  button_dleft: touche(K.gauche), button_dup: touche(K.haut), button_dright: touche(K.droite), button_ddown: touche(K.bas),
  button_slleft: touche(K.F5), button_srleft: touche(K.F6), button_home: touche(K.H), button_screenshot: touche(K.F12),
  button_slright: touche(K.F7), button_srright: touche(K.F8),
  lstick: croix(K.Z, K.S, K.Q, K.D, K.maj),
  // Caméra à la souris (« mouse panning » d'Eden)
  rstick: param({ engine: "mouse", axis_x: 0, axis_y: 1, threshold: "0.500000", range: "1.000000", deadzone: "0.000000" }),
};
const CLES_JOUEUR = Object.keys(CLAVIER);

const fichierConfig = dir => path.join(dir, "user", "config", "qt-config.ini");
const fichierManette = dir => path.join(dir, "user", "config", "retro-manette.json");

// La manette réglée dans Eden (engine:sdl) est gardée de côté pour les prochaines parties.
function retenirManette(dir) {
  const f = fichierConfig(dir);
  if (!fs.existsSync(f)) return false;
  const c = section(lireIni(fs.readFileSync(f, "utf8")), "Controls");
  const garde = {};
  for (const j of [0, 1, 2, 3]) {
    const cles = CLES_JOUEUR.filter(k => /engine:sdl/.test(c.lire(`player_${j}_${k}`) || ""));
    if (!cles.length) continue;
    for (const k of cles) garde[`player_${j}_${k}`] = c.lire(`player_${j}_${k}`);
    for (const extra of ["connected", "type"]) { const x = c.lire(`player_${j}_${extra}`); if (x !== undefined) garde[`player_${j}_${extra}`] = x; }
  }
  if (!Object.keys(garde).length) return false;
  fs.writeFileSync(fichierManette(dir), JSON.stringify(garde, null, 1));
  return true;
}
const manetteConnue = dir => fs.existsSync(fichierManette(dir));

function reglerCommandes(dir, avecManette) {
  retenirManette(dir);
  const f = fichierConfig(dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const sections = lireIni(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
  const c = section(sections, "Controls");
  const ecrire = (k, v) => { c.ecrire(k, v); c.ecrire(k + "\\default", "false"); };
  let manette = null;
  if (avecManette && manetteConnue(dir)) { try { manette = JSON.parse(fs.readFileSync(fichierManette(dir), "utf8")); } catch (e) {} }
  if (manette) {
    for (const [k, v] of Object.entries(manette)) ecrire(k, v);
    ecrire("mouse_panning", "false");
  } else {
    for (const [k, v] of Object.entries(CLAVIER)) ecrire("player_0_" + k, v);
    ecrire("player_0_connected", "true");
    ecrire("mouse_panning", "true");
  }
  fs.writeFileSync(f, ecrireIni(sections));
  return { manette: Boolean(manette), manetteAReglee: Boolean(avecManette && !manette) };
}

module.exports = { reglerCommandes, retenirManette, manetteConnue, CLAVIER };
