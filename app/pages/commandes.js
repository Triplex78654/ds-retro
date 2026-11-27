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

  // Boutons d'une manette au format standard du navigateur. Les noms décrivent la POSITION du bouton,
  // pour que ce soit juste avec toutes les manettes : « bas » = A Xbox = ✕ PlayStation = B Nintendo.
  const M = { bas: 0, droite: 1, gauche: 2, haut: 3, LB: 4, RB: 5, LT: 6, RT: 7, select: 8, start: 9, L3: 10, R3: 11, dHaut: 12, dBas: 13, dGauche: 14, dDroite: 15 };
  const NOMS_BOUTONS = {
    bas: "Bas (A · ✕)", droite: "Droite (B · ○)", gauche: "Gauche (X · □)", haut: "Haut (Y · △)",
    LB: "LB · L1", RB: "RB · R1", LT: "LT · L2", RT: "RT · R2", select: "Select · Share", start: "Start · Options",
    L3: "Clic stick gauche", R3: "Clic stick droit", dHaut: "Croix ↑", dBas: "Croix ↓", dGauche: "Croix ←", dDroite: "Croix →",
  };

  // Actions de chaque console : ce qu'elles font dans le jeu (cibles), touches du clavier par défaut (position physique :
  // ZQSD en AZERTY = WASD en QWERTY) et boutons de manette par défaut. Chaque joueur peut les changer (Paramètres › Commandes).
  // Une cible "stick:<g|d>:<x|y>:<+1|-1>" pousse un stick à fond. Les sticks de la manette restent analogiques (stickG / stickD).
  const act = (id, nom, cibles, clavier = [], manette = []) => ({ id, nom, cibles, clavier, manette });
  const directions = (clavier, avecStick) => [
    act("haut", "Haut", avecStick ? [HAUT, "stick:g:y:-1"] : [HAUT], clavier[0], ["dHaut"]),
    act("bas", "Bas", avecStick ? [BAS, "stick:g:y:+1"] : [BAS], clavier[1], ["dBas"]),
    act("gauche", "Gauche", avecStick ? [GAUCHE, "stick:g:x:-1"] : [GAUCHE], clavier[2], ["dGauche"]),
    act("droite", "Droite", avecStick ? [DROITE, "stick:g:x:+1"] : [DROITE], clavier[3], ["dDroite"]),
  ];
  const ZQSD_FLECHES = [["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"], ["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]];
  const PROFILS = {
    nes: { stickG: "croix", stickD: null, souris: null, actions: [
      ...directions(ZQSD_FLECHES),
      act("a", "A", [A], ["Space", "KeyK", "KeyL"], ["droite", "haut", "LT"]),
      act("b", "B", [B], ["KeyJ", "KeyI"], ["bas", "gauche", "RT"]),
      act("start", "Start", [START], ["Enter"], ["start"]),
      act("select", "Select", [SELECT], ["Backspace", "ShiftRight"], ["select"]),
    ] },
    snes: { stickG: "croix", stickD: null, souris: null, actions: [
      ...directions(ZQSD_FLECHES),
      act("b", "B", [B], ["Space", "KeyK"], ["bas"]),
      act("a", "A", [A], ["KeyL"], ["droite"]),
      act("y", "Y", [Y], ["KeyJ"], ["gauche"]),
      act("x", "X", [X], ["KeyI"], ["haut"]),
      act("l", "L", [L], ["KeyQ"], ["LB", "LT"]),
      act("r", "R", [R], ["KeyE"], ["RB", "RT"]),
      act("start", "Start", [START], ["Enter"], ["start"]),
      act("select", "Select", [SELECT], ["Backspace", "ShiftRight"], ["select"]),
    ] },
    // Mupen64Plus : A = B libretro, B = Y libretro, Z = L2, boutons C = stick droit.
    n64: { stickG: "stick", stickD: "stick", souris: { gauche: [L2], droit: [R], camera: true }, actions: [
      act("stick-haut", "Stick haut", ["stick:g:y:-1"], ["KeyW"]),
      act("stick-bas", "Stick bas", ["stick:g:y:+1"], ["KeyS"]),
      act("stick-gauche", "Stick gauche", ["stick:g:x:-1"], ["KeyA"]),
      act("stick-droite", "Stick droite", ["stick:g:x:+1"], ["KeyD"]),
      act("a", "A", [B], ["Space", "KeyK"], ["bas"]),
      act("b", "B", [Y], ["KeyJ"], ["gauche"]),
      act("z", "Z", [L2], ["ShiftLeft"], ["LT", "RT", "select"]),
      act("l", "L", [L], ["KeyQ"], ["LB"]),
      act("r", "R", [R], ["KeyE", "KeyR"], ["RB"]),
      act("start", "Start", [START], ["Enter"], ["start"]),
      act("c-haut", "C haut", ["stick:d:y:-1"], ["ArrowUp"]),
      act("c-bas", "C bas", ["stick:d:y:+1"], ["ArrowDown", "KeyL"], ["droite"]),
      act("c-gauche", "C gauche", ["stick:d:x:-1"], ["ArrowLeft", "KeyI"], ["haut"]),
      act("c-droite", "C droite", ["stick:d:x:+1"], ["ArrowRight"]),
      ...directions([[], [], [], []]).map(a => ({ ...a, id: "croix-" + a.id, nom: "Croix " + a.nom.toLowerCase() })),
    ] },
    // PCSX ReARMed avec une DualShock : la croix et le stick gauche servent tous les deux à bouger.
    psx: { stickG: "stick+croix", stickD: "stick", souris: { gauche: [R2], droit: [L2], camera: true }, actions: [
      ...directions([["KeyW"], ["KeyS"], ["KeyA"], ["KeyD"]], true),
      act("croix", "✕ Croix", [B], ["Space", "KeyK"], ["bas"]),
      act("rond", "○ Rond", [A], ["KeyL"], ["droite"]),
      act("carre", "□ Carré", [Y], ["KeyJ"], ["gauche"]),
      act("triangle", "△ Triangle", [X], ["KeyI"], ["haut"]),
      act("l1", "L1", [L], ["KeyQ"], ["LB"]),
      act("r1", "R1", [R], ["KeyE"], ["RB"]),
      act("l2", "L2", [L2], ["ShiftLeft"], ["LT"]),
      act("r2", "R2", [R2], ["KeyR"], ["RT"]),
      act("l3", "L3", [L3], ["KeyC"], ["L3"]),
      act("r3", "R3", [R3], ["KeyV"], ["R3"]),
      act("start", "Start", [START], ["Enter"], ["start"]),
      act("select", "Select", [SELECT], ["Backspace", "ShiftRight"], ["select"]),
      act("cam-haut", "Stick droit haut", ["stick:d:y:-1"], ["ArrowUp"]),
      act("cam-bas", "Stick droit bas", ["stick:d:y:+1"], ["ArrowDown"]),
      act("cam-gauche", "Stick droit gauche", ["stick:d:x:-1"], ["ArrowLeft"]),
      act("cam-droite", "Stick droit droite", ["stick:d:x:+1"], ["ArrowRight"]),
    ] },
  };

  // Réglages du joueur : { console: { action: { clavier: [codes], manette: [boutons] } } } ; absent = par défaut.
  const CLE_REGLAGES = "retro-commandes";
  const lireReglages = () => { try { const v = JSON.parse(localStorage.getItem(CLE_REGLAGES) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } };
  const ecrireReglages = v => { try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(v)); } catch (e) {} };
  function actions(consoleId) {
    const p = PROFILS[consoleId];
    if (!p) return [];
    const perso = lireReglages()[consoleId] || {};
    return p.actions.map(a => {
      const r = perso[a.id] || {};
      return { ...a, clavier: Array.isArray(r.clavier) ? r.clavier.filter(t => typeof t === "string") : a.clavier,
        manette: Array.isArray(r.manette) ? r.manette.filter(b => b in M) : a.manette, modifie: Boolean(r.clavier || r.manette) };
    });
  }
  // Une touche ou un bouton ne sert qu'à une action d'une console : on l'enlève des autres.
  function changer(consoleId, actionId, sorte, valeurs) {
    const tout = lireReglages(), perso = tout[consoleId] || (tout[consoleId] = {});
    for (const a of actions(consoleId)) {
      if (a.id === actionId) continue;
      const reste = a[sorte].filter(v => !valeurs.includes(v));
      if (reste.length !== a[sorte].length) perso[a.id] = { ...(perso[a.id] || {}), [sorte]: reste };
    }
    perso[actionId] = { ...(perso[actionId] || {}), [sorte]: valeurs };
    ecrireReglages(tout);
  }
  function parDefaut(consoleId) { const tout = lireReglages(); delete tout[consoleId]; ecrireReglages(tout); }
  // Tables touche → cibles et bouton → cibles pour la partie en cours.
  function compiler(consoleId) {
    const p = PROFILS[consoleId];
    if (!p) return null;
    const clavier = {}, manette = {};
    for (const a of actions(consoleId)) {
      for (const t of a.clavier) (clavier[t] = clavier[t] || []).push(...a.cibles);
      for (const b of a.manette) (manette[b] = manette[b] || []).push(...a.cibles);
    }
    return { ...p, clavier, manette };
  }
  // Nom lisible d'une touche, selon la disposition du clavier (Z sur un AZERTY pour KeyW).
  const NOMS_TOUCHES = { Space: "Espace", Enter: "Entrée", Backspace: "Retour", ShiftLeft: "Maj gauche", ShiftRight: "Maj droite",
    ControlLeft: "Ctrl gauche", ControlRight: "Ctrl droit", AltLeft: "Alt", Tab: "Tab", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  let disposition = null;
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then(m => { disposition = m; }).catch(() => {});
  const nomTouche = code => NOMS_TOUCHES[code] || (disposition && disposition.get(code) ? disposition.get(code).toUpperCase() : code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Pavé "));
  // Résumé des commandes d'une console (aide sous l'écran de jeu).
  function resume(consoleId) {
    const echapper = t => t.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    const parties = actions(consoleId).filter(a => a.clavier.length).map(a => a.clavier.map(t => "<kbd>" + echapper(nomTouche(t)) + "</kbd>").join("") + " " + echapper(a.nom));
    return "Clavier : " + parties.join(" · ") + ". Manette : sticks pour bouger. Tout se change dans Paramètres › Commandes.";
  }

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
      const ax = i => zoneMorte(manette.axes[i] || 0);
      direction(etat, profil.stickG, ax(0), ax(1));
      if (profil.stickD === "stick") pousser(etat, STICK_D, ax(2), ax(3));
    }
    if (n === 0) {
      for (const t of touches) { const cibles = profil.clavier[t]; if (cibles) cibles.forEach(c => appliquer(etat, c, 1)); }
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
    profils: PROFILS, NOMS_BOUTONS, BOUTONS: M, actions, changer, parDefaut, nomTouche, resume,
    // Options passées à l'émulateur avant le chargement (manette DualShock pour la PlayStation).
    retroarch(consoleId) {
      return consoleId === "psx" ? [1, 2, 3, 4].map(p => 'input_libretro_device_p' + p + ' = "517"') : [];
    },
    demarrer(consoleId, avecPistolet) {
      profil = compiler(consoleId);
      pistolet = Boolean(avecPistolet);
      actif = Boolean(profil);
      // L'émulateur web n'écoute plus le clavier ni les manettes : c'est ce fichier qui s'en charge.
      if (actif && window.EJS_emulator) EJS_emulator.controls = { 0: {}, 1: {}, 2: {}, 3: {} };
    },
    liberer() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); touches.clear(); },
    sourisCapturee,
  };
})();
