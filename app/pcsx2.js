// Commandes de PCSX2 (PS2) : la manette du joueur 1 suit le clavier (touches à la même place que la PlayStation de
// l'appli) ET n'importe quelle manette (SDL, boutons par position). Seule la section [Pad1] est réécrite ;
// le reste de inis/PCSX2.ini est gardé tel quel.
const fs = require("node:fs");
const path = require("node:path");

// Touches par position physique (codes du navigateur) → action PS2. La lettre réelle dépend du clavier (AZERTY…).
const CLAVIER = {
  LUp: ["KeyW"], LDown: ["KeyS"], LLeft: ["KeyA"], LRight: ["KeyD"],
  Up: ["KeyW"], Down: ["KeyS"], Left: ["KeyA"], Right: ["KeyD"],
  RUp: ["ArrowUp"], RDown: ["ArrowDown"], RLeft: ["ArrowLeft"], RRight: ["ArrowRight"],
  Cross: ["Space", "KeyK"], Circle: ["KeyL"], Square: ["KeyJ"], Triangle: ["KeyI"],
  L1: ["KeyQ"], R1: ["KeyE"], L2: ["ShiftLeft"], R2: ["KeyR"], L3: ["KeyC"], R3: ["KeyV"],
  Start: ["Enter"], Select: ["Backspace"],
};
// Manette (SDL : n'importe quelle marque), noms de PCSX2 ; boutons par position (FaceSouth = A Xbox = ✕).
const MANETTE = {
  Up: "DPadUp", Down: "DPadDown", Left: "DPadLeft", Right: "DPadRight",
  Cross: "FaceSouth", Circle: "FaceEast", Square: "FaceWest", Triangle: "FaceNorth",
  L1: "LeftShoulder", R1: "RightShoulder", L2: "+LeftTrigger", R2: "+RightTrigger", L3: "LeftStick", R3: "RightStick",
  Start: "Start", Select: "Back",
  LUp: "-LeftY", LDown: "+LeftY", LLeft: "-LeftX", LRight: "+LeftX",
  RUp: "-RightY", RDown: "+RightY", RLeft: "-RightX", RRight: "+RightX",
  LargeMotor: "LargeMotor", SmallMotor: "SmallMotor",
};
const SPECIALES = { Space: "Space", Enter: "Return", Backspace: "Backspace", ShiftLeft: "Shift", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };

// Nom PCSX2 d'une touche : lettre réelle du clavier du joueur (disposition = { KeyW: "z", … }), sinon lettre QWERTY.
function touche(code, disposition) {
  if (SPECIALES[code]) return "Keyboard/" + SPECIALES[code];
  const m = /^Key([A-Z])$/.exec(code);
  if (!m) return null;
  const lettre = disposition && /^[a-z]$/i.test(disposition[code] || "") ? disposition[code] : m[1];
  return "Keyboard/" + lettre.toUpperCase();
}

// Lignes de [Pad1] : plusieurs lignes pour une même action = plusieurs façons de l'appuyer.
function lignesPad1(disposition) {
  const l = ["Type = DualShock2"];
  for (const [action, codes] of Object.entries(CLAVIER)) for (const c of codes) { const t = touche(c, disposition); if (t) l.push(action + " = " + t); }
  for (const [action, nom] of Object.entries(MANETTE)) l.push(action + " = SDL-0/" + nom);
  return l;
}

// Remplace une section d'un .ini (créée si absente) ; garde le reste du fichier.
function remplacerSection(texte, section, lignes, garder = () => false) {
  const morceaux = texte.split(/\r?\n/);
  const debut = morceaux.findIndex(l => l.trim() === "[" + section + "]");
  if (debut < 0) return texte.replace(/\s*$/, "") + "\n\n[" + section + "]\n" + lignes.join("\n") + "\n";
  let fin = morceaux.findIndex((l, i) => i > debut && /^\s*\[/.test(l));
  if (fin < 0) fin = morceaux.length;
  const conserves = morceaux.slice(debut + 1, fin).filter(l => garder(l.split("=")[0].trim()));
  return morceaux.slice(0, debut + 1).concat(conserves, lignes, [""], morceaux.slice(fin)).join("\n");
}
function valeur(texte, section, cle, val) {
  const re = new RegExp("(\\[" + section.replace(/[[\]/]/g, "\\$&") + "\\][^\\[]*?)^" + cle + "\\s*=.*$", "m");
  if (re.test(texte)) return texte.replace(re, "$1" + cle + " = " + val);
  return remplacerSection(texte, section, [cle + " = " + val], () => true);
}

// Réglages de la manette avant chaque partie. Sans fichier (PCSX2 jamais lancé), on en crée un minimal :
// SettingsVersion évite que PCSX2 le prenne pour un vieux fichier et remette tout à zéro.
function reglerCommandes(dir, disposition) {
  const fichier = path.join(dir, "inis", "PCSX2.ini");
  let texte = fs.existsSync(fichier) ? fs.readFileSync(fichier, "utf8") : "[UI]\nSettingsVersion = 1\n";
  // Réglages de [Pad1] autres que les touches (zone morte, sensibilité…) : gardés.
  const reglages = new Set(["InvertL", "InvertR", "Deadzone", "AxisScale", "LargeMotorScale", "SmallMotorScale", "ButtonDeadzone", "PressureModifier"]);
  texte = remplacerSection(texte, "Pad1", lignesPad1(disposition), cle => reglages.has(cle));
  texte = valeur(texte, "InputSources", "Keyboard", "true");
  texte = valeur(texte, "InputSources", "SDL", "true");
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, texte);
}

module.exports = { reglerCommandes, lignesPad1, touche };
