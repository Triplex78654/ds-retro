// Commandes des consoles de salon : clavier ZQSD, souris pour la caméra, manettes avec joysticks et gâchettes.
// On remplace la gestion d'entrées de l'émulateur web : chaque image, on calcule l'état voulu des boutons
// de chaque joueur et on n'envoie au cœur que ce qui a changé.
(function () {
  "use strict";

  // Numéros des entrées libretro utilisés par l'émulateur web.
  const B = 0, Y = 1, SELECT = 2, START = 3, HAUT = 4, BAS = 5, GAUCHE = 6, DROITE = 7, A = 8, X = 9,
    L = 10, R = 11, L2 = 12, R2 = 13, L3 = 14, R3 = 15;
  // Sticks : [plus, moins] sur chaque axe (valeurs de 0 à 0x7fff).
  const STICK_G = { x: [16, 17], y: [18, 19] }, STICK_D = { x: [20, 21], y: [22, 23] };
  const ANALOGIQUES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);
  const MAX = 0x7fff;

  // Boutons d'une manette au format standard du navigateur.
  const M = { bas: 0, droite: 1, gauche: 2, haut: 3, LB: 4, RB: 5, LT: 6, RT: 7, select: 8, start: 9, L3: 10, R3: 11, dHaut: 12, dBas: 13, dGauche: 14, dDroite: 15 };

  // Pour chaque console : boutons de manette, touches du clavier (position physique : ZQSD en AZERTY = WASD en QWERTY),
  // à quoi servent les sticks, et la souris (caméra + clics).
  // Une valeur "stick:<g|d>:<x|y>:<+1|-1>" pousse un stick à fond (touche ou bouton qui sert de stick).
  const PROFILS = {
    nes: {
      manette: { bas: [B], droite: [A], gauche: [B], haut: [A], RT: [B], LT: [A], select: [SELECT], start: [START] },
      stickG: "croix", stickD: null,
      clavier: { deplacement: "croix", fleches: "croix", Space: [A], KeyK: [A], KeyL: [A], KeyJ: [B], KeyI: [B] },
      souris: null,
    },
    snes: {
      manette: { bas: [B], droite: [A], gauche: [Y], haut: [X], LB: [L], RB: [R], LT: [L], RT: [R], select: [SELECT], start: [START] },
      stickG: "croix", stickD: null,
      clavier: { deplacement: "croix", fleches: "croix", Space: [B], KeyK: [B], KeyL: [A], KeyJ: [Y], KeyI: [X], KeyQ: [L], KeyE: [R] },
      souris: null,
    },
    // Mupen64Plus : A = B libretro, B = Y libretro, Z = L2, boutons C = stick droit.
    n64: {
      manette: { bas: [B], gauche: [Y], droite: ["stick:d:y:+1"], haut: ["stick:d:x:-1"], LB: [L], RB: [R], LT: [L2], RT: [L2], select: [L2], start: [START] },
      stickG: "stick", stickD: "stick",
      clavier: { deplacement: "stick", fleches: "camera", Space: [B], KeyK: [B], KeyJ: [Y], KeyL: ["stick:d:y:+1"], KeyI: ["stick:d:x:-1"],
        KeyQ: [L], KeyE: [R], ShiftLeft: [L2], KeyR: [R] },
      souris: { gauche: [L2], droit: [R], camera: true },
    },
    // PCSX ReARMed avec une DualShock : la croix et le stick gauche servent tous les deux à bouger.
    psx: {
      manette: { bas: [B], droite: [A], gauche: [Y], haut: [X], LB: [L], RB: [R], LT: [L2], RT: [R2], select: [SELECT], start: [START], L3: [L3], R3: [R3] },
      stickG: "stick+croix", stickD: "stick",
      clavier: { deplacement: "stick+croix", fleches: "camera", Space: [B], KeyK: [B], KeyL: [A], KeyJ: [Y], KeyI: [X],
        KeyQ: [L], KeyE: [R], ShiftLeft: [L2], KeyR: [R2], KeyC: [L3], KeyV: [R3] },
      souris: { gauche: [R2], droit: [L2], camera: true },
    },
  };
  const COMMUNS = { Enter: [START], Backspace: [SELECT], ShiftRight: [SELECT] };
  const DEPLACEMENT = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
  const FLECHES = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  let profil = null, actif = false, pistolet = false;
  const touches = new Set();
  const souris = { dx: 0, dy: 0, gauche: false, droit: false };
  const envoye = [[], [], [], []];

  function zone() { return document.getElementById("game"); }
  function sourisCapturee() { return Boolean(document.pointerLockElement) && zone().contains(document.pointerLockElement); }

  function appliquer(etat, cible, force) {
    if (typeof cible === "number") { etat[cible] = Math.max(etat[cible] || 0, ANALOGIQUES.has(cible) ? MAX * force : 1); return; }
    const [, cote, axe, sens] = cible.split(":");
    pousser(etat, cote === "g" ? STICK_G : STICK_D, axe === "x" ? Number(sens) * force : 0, axe === "y" ? Number(sens) * force : 0);
  }
  // Pousse un stick (valeurs de -1 à 1) en gardant la plus forte poussée de chaque source.
  function pousser(etat, stick, x, y) {
    const mettre = (paire, v) => { const i = v > 0 ? paire[0] : paire[1]; if (v) etat[i] = Math.max(etat[i] || 0, Math.min(1, Math.abs(v)) * MAX); };
    mettre(stick.x, x); mettre(stick.y, y);
  }
  function croix(etat, x, y) {
    if (y < -0.5) etat[HAUT] = 1;
    if (y > 0.5) etat[BAS] = 1;
    if (x < -0.5) etat[GAUCHE] = 1;
    if (x > 0.5) etat[DROITE] = 1;
  }
  function direction(etat, mode, x, y) {
    if (!x && !y) return;
    if (mode === "croix" || mode === "stick+croix") croix(etat, x, y);
    if (mode === "stick" || mode === "stick+croix") pousser(etat, STICK_G, x, y);
    if (mode === "camera") pousser(etat, STICK_D, x, y);
  }
  const zoneMorte = v => (Math.abs(v) < 0.18 ? 0 : Math.sign(v) * (Math.abs(v) - 0.18) / 0.82);

  function etatJoueur(n, manette) {
    const etat = [];
    if (manette) {
      const b = i => Boolean(manette.buttons[i] && (manette.buttons[i].pressed || manette.buttons[i].value > 0.3));
      for (const [nom, cibles] of Object.entries(profil.manette)) if (b(M[nom])) cibles.forEach(c => appliquer(etat, c, 1));
      if (b(M.dHaut)) etat[HAUT] = 1;
      if (b(M.dBas)) etat[BAS] = 1;
      if (b(M.dGauche)) etat[GAUCHE] = 1;
      if (b(M.dDroite)) etat[DROITE] = 1;
      const ax = i => zoneMorte(manette.axes[i] || 0);
      direction(etat, profil.stickG, ax(0), ax(1));
      if (profil.stickD === "stick") pousser(etat, STICK_D, ax(2), ax(3));
    }
    if (n === 0) {
      let mx = 0, my = 0, fx = 0, fy = 0;
      for (const t of touches) {
        if (DEPLACEMENT[t]) { mx += DEPLACEMENT[t][0]; my += DEPLACEMENT[t][1]; }
        if (FLECHES[t]) { fx += FLECHES[t][0]; fy += FLECHES[t][1]; }
        const cibles = profil.clavier[t] || COMMUNS[t];
        if (cibles) cibles.forEach(c => appliquer(etat, c, 1));
      }
      direction(etat, profil.clavier.deplacement, mx, my);
      direction(etat, profil.clavier.fleches, fx, fy);
      if (profil.souris && !pistolet && sourisCapturee()) {
        if (souris.gauche) profil.souris.gauche.forEach(c => appliquer(etat, c, 1));
        if (souris.droit) profil.souris.droit.forEach(c => appliquer(etat, c, 1));
        if (profil.souris.camera) pousser(etat, STICK_D, souris.dx, souris.dy);
      }
    }
    return etat;
  }

  function envoyer() {
    const emu = window.EJS_emulator, gm = emu && emu.gameManager;
    if (!actif || !gm || !emu.started) return;
    const manettes = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    const enPause = document.body.classList.contains("en-pause");
    for (let n = 0; n < 4; n++) {
      const etat = enPause ? [] : etatJoueur(n, manettes[n]);
      for (let i = 0; i < 24; i++) {
        const v = Math.round(etat[i] || 0);
        if ((envoye[n][i] || 0) !== v) { gm.simulateInput(n, i, v); envoye[n][i] = v; }
      }
    }
    // La caméra à la souris revient doucement au centre quand la souris s'arrête.
    souris.dx *= 0.55; souris.dy *= 0.55;
    if (Math.abs(souris.dx) < 0.02) souris.dx = 0;
    if (Math.abs(souris.dy) < 0.02) souris.dy = 0;
  }
  (function boucle() { try { envoyer(); } catch (e) {} requestAnimationFrame(boucle); })();

  const enJeu = () => actif && !document.body.classList.contains("en-pause");
  addEventListener("keydown", e => {
    if (!enJeu() || e.code === "Escape" || (e.target.closest && e.target.closest("input, button, select"))) return;
    touches.add(e.code);
    e.preventDefault();
  }, true);
  addEventListener("keyup", e => { touches.delete(e.code); }, true);
  addEventListener("blur", () => { touches.clear(); souris.gauche = souris.droit = false; });

  // Souris : un clic dans le jeu la capture (caméra + tir), Échap la libère.
  addEventListener("mousedown", e => {
    if (!enJeu() || !profil || !profil.souris || pistolet || !zone().contains(e.target)) return;
    if (!sourisCapturee()) { const c = zone().querySelector("canvas") || zone(); if (c.requestPointerLock) c.requestPointerLock(); return; }
    if (e.button === 0) souris.gauche = true;
    if (e.button === 2) souris.droit = true;
    e.preventDefault();
  }, true);
  addEventListener("mouseup", e => { if (e.button === 0) souris.gauche = false; if (e.button === 2) souris.droit = false; }, true);
  addEventListener("mousemove", e => {
    if (!sourisCapturee()) return;
    const sensibilite = Number(localStorage.getItem("retro-sensibilite") || 5) / 100;
    souris.dx = Math.max(-1, Math.min(1, souris.dx + e.movementX * sensibilite));
    souris.dy = Math.max(-1, Math.min(1, souris.dy + e.movementY * sensibilite));
  }, true);
  document.addEventListener("pointerlockchange", () => { if (!sourisCapturee()) { souris.gauche = souris.droit = false; souris.dx = souris.dy = 0; } });

  // Appelé par la page au lancement d'un jeu.
  window.RetroCommandes = {
    profils: PROFILS,
    // Options passées à l'émulateur avant le chargement (manette DualShock pour la PlayStation).
    retroarch(consoleId) {
      return consoleId === "psx" ? [1, 2, 3, 4].map(p => 'input_libretro_device_p' + p + ' = "517"') : [];
    },
    demarrer(consoleId, avecPistolet) {
      profil = PROFILS[consoleId] || null;
      pistolet = Boolean(avecPistolet);
      actif = Boolean(profil);
      // L'émulateur web n'écoute plus le clavier ni les manettes : c'est ce fichier qui s'en charge.
      if (actif && window.EJS_emulator) EJS_emulator.controls = { 0: {}, 1: {}, 2: {}, 3: {} };
    },
    liberer() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); touches.clear(); },
    sourisCapturee,
  };
})();
