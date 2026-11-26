  // ---------- État général ----------
  let jeuActif = false;     // une cartouche est insérée (chargement ou jeu)
  let jeuDemarre = false;   // l'émulateur tourne
  let menuOuvert = false;   // menu affiché pendant une partie (jeu en pause)
  let spectateur = false;   // on regarde l'écran d'un autre joueur du salon
  let cartoucheId = null;
  let nomJeu = "";

  // ---------- Touches du clavier ----------
  const BOUTONS = [
    { id: 4, nom: "Haut" }, { id: 5, nom: "Bas" }, { id: 6, nom: "Gauche" }, { id: 7, nom: "Droite" },
    { id: 8, nom: "A" }, { id: 0, nom: "B" }, { id: 9, nom: "X" }, { id: 1, nom: "Y" },
    { id: 10, nom: "L" }, { id: 11, nom: "R" }, { id: 3, nom: "Start" }, { id: 2, nom: "Select" }
  ];
  const PRESETS = {
    zqsd: {
      gameId: 101,
      titre: "ZQSD + JKUI",
      desc: "Clavier AZERTY",
      touches: { 4: "z", 5: "s", 6: "q", 7: "d", 8: "k", 0: "j", 9: "i", 1: "u", 10: "a", 11: "e", 3: "enter", 2: "space" },
      noms: { z: "Z", s: "S", q: "Q", d: "D", k: "K", j: "J", i: "I", u: "U", a: "A", e: "E", enter: "Entrée", space: "Espace" }
    },
    fleches: {
      gameId: 102,
      titre: "Flèches",
      desc: "Flèches + lettres",
      touches: { 4: "up arrow", 5: "down arrow", 6: "left arrow", 7: "right arrow", 8: "x", 0: "w", 9: "s", 1: "q", 10: "a", 11: "z", 3: "enter", 2: "shift" },
      noms: { "up arrow": "↑", "down arrow": "↓", "left arrow": "←", "right arrow": "→", x: "X", w: "W", s: "S", q: "Q", a: "A", z: "Z", enter: "Entrée", shift: "Maj" }
    }
  };
  // Manette standard : BUTTON_1 = bas, BUTTON_2 = droite, BUTTON_3 = gauche, BUTTON_4 = haut
  const MANETTES = {
    ds: {
      titre: "Positions DS",
      desc: "A à droite, B en bas",
      boutons: { 8: "BUTTON_2", 0: "BUTTON_1", 9: "BUTTON_4", 1: "BUTTON_3" },
      valider: 1, retour: 0,
      ligne: "Manette, positions DS : A à droite, B en bas, comme sur la console."
    },
    xbox: {
      titre: "Lettres Xbox",
      desc: "A = A, B = B",
      boutons: { 8: "BUTTON_1", 0: "BUTTON_2", 9: "BUTTON_3", 1: "BUTTON_4" },
      valider: 0, retour: 1,
      ligne: "Manette, lettres Xbox : le bouton A de ta manette fait A."
    }
  };
  const MANETTE_COMMUNS = {
    2: "SELECT", 3: "START", 4: "DPAD_UP", 5: "DPAD_DOWN", 6: "DPAD_LEFT", 7: "DPAD_RIGHT",
    10: "LEFT_TOP_SHOULDER", 11: "RIGHT_TOP_SHOULDER"
  };

  let presetChoisi = lire("ds-retro-preset", "zqsd");
  if (!PRESETS[presetChoisi]) presetChoisi = "zqsd";
  let manetteChoisie = lire("ds-retro-manette", "ds");
  if (!MANETTES[manetteChoisie]) manetteChoisie = "ds";

  function afficherTouches() {
    const p = PRESETS[presetChoisi];
    $("nom-dispo").textContent = p.titre;
    const el = $("legende");
    el.innerHTML = "";
    BOUTONS.forEach(b => {
      const ligne = document.createElement("div");
      const nom = document.createElement("span");
      nom.textContent = b.nom;
      const touche = document.createElement("kbd");
      touche.textContent = p.noms[p.touches[b.id]];
      ligne.append(nom, touche);
      el.appendChild(ligne);
    });
    $("ligne-manette").textContent = MANETTES[manetteChoisie].ligne + " Menu : bouton central, ou Select + Start.";

    const remplir = (conteneur, liste, choisi, surChoix) => {
      conteneur.innerHTML = "";
      Object.entries(liste).forEach(([cle, item]) => {
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "choix";
        btn.setAttribute("aria-pressed", String(cle === choisi));
        const t = document.createElement("strong"); t.textContent = item.titre;
        const d = document.createElement("span"); d.textContent = item.desc;
        btn.append(t, d);
        btn.addEventListener("click", () => { surChoix(cle); afficherTouches(); btnFocus(conteneur, cle, liste); });
        conteneur.appendChild(btn);
      });
    };
    remplir($("dispositions"), PRESETS, presetChoisi, cle => { presetChoisi = cle; ecrire("ds-retro-preset", cle); });
    remplir($("manettes"), MANETTES, manetteChoisie, cle => { manetteChoisie = cle; ecrire("ds-retro-manette", cle); });
  }
  function btnFocus(conteneur, cle, liste) {
    const i = Object.keys(liste).indexOf(cle);
    const b = conteneur.children[i];
    if (b) b.focus({ preventScroll: true });
  }
  afficherTouches();

  function construireControles() {
    const p = PRESETS[presetChoisi];
    const m = MANETTES[manetteChoisie];
    const joueur1 = {};
    for (let i = 0; i < 30; i++) joueur1[i] = { value: "" };
    Object.entries(MANETTE_COMMUNS).forEach(([id, bouton]) => { joueur1[id].value2 = bouton; });
    Object.entries(m.boutons).forEach(([id, bouton]) => { joueur1[id].value2 = bouton; });
    Object.entries(p.touches).forEach(([id, touche]) => { joueur1[id].value = touche; });
    return { 0: joueur1, 1: {}, 2: {}, 3: {} };
  }

  // ---------- Clavier et boutons de la console → émulateur ----------
  const NOMS_VERS_CODES = {
    "up arrow": 38, "down arrow": 40, "left arrow": 37, "right arrow": 39,
    enter: 13, space: 32, shift: 16
  };
  function codesDuPreset() {
    const codes = new Set([32, 37, 38, 39, 40]);
    Object.values(PRESETS[presetChoisi].touches).forEach(t => {
      codes.add(NOMS_VERS_CODES[t] || t.toUpperCase().charCodeAt(0));
    });
    return codes;
  }
  let codesJeu = codesDuPreset();

  function focusJeu() {
    if (menuOuvert) return;
    const g = $("game");
    if (g && document.activeElement !== g && !g.contains(document.activeElement)) {
      g.focus({ preventScroll: true });
    }
  }

  function nomDeTouche(e) {
    const speciales = { ArrowUp: "up arrow", ArrowDown: "down arrow", ArrowLeft: "left arrow", ArrowRight: "right arrow", Enter: "enter", " ": "space", Shift: "shift" };
    return speciales[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : null);
  }
  function boutonDepuisTouche(e) {
    const nom = nomDeTouche(e);
    if (!nom) return null;
    const trouve = Object.entries(PRESETS[presetChoisi].touches).find(([, v]) => v === nom);
    return trouve ? Number(trouve[0]) : null;
  }

  function gererClavier(e) {
    if (spectateur && !menuOuvert) {
      if (e.key === "Escape" || e.ctrlKey || e.metaKey || e.altKey) return;
      const b = boutonDepuisTouche(e);
      if (b === null) return;
      e.preventDefault();
      if (!e.repeat) toucheSpectateur(b, e.type === "keydown");
      return;
    }
    if (!jeuActif || menuOuvert) return;
    if (e.key === "Escape" || /^F\d+$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    const g = $("game");
    const dedans = g.contains(e.target);
    if (dedans) {
      if (codesJeu.has(e.keyCode)) e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    focusJeu();
    const copie = new KeyboardEvent(e.type, {
      key: e.key, code: e.code, repeat: e.repeat, bubbles: true, cancelable: true,
      shiftKey: e.shiftKey
    });
    Object.defineProperty(copie, "keyCode", { get: () => e.keyCode });
    Object.defineProperty(copie, "which", { get: () => e.keyCode });
    g.dispatchEvent(copie);
  }
  window.addEventListener("keydown", gererClavier, true);
  window.addEventListener("keyup", gererClavier, true);
  window.addEventListener("keydown", e => {
    if (e.key === "Escape" && (jeuDemarre || spectateur)) { e.preventDefault(); menuOuvert ? fermerPause() : ouvrirPause(); return; }
    if (!menuVisible()) return;
    const fleches = { ArrowUp: "haut", ArrowDown: "bas", ArrowLeft: "gauche", ArrowRight: "droite" };
    if (fleches[e.key]) { e.preventDefault(); naviguer(fleches[e.key]); }
  });

  $("console").addEventListener("pointerdown", e => {
    document.body.classList.remove("nav-manette");
    if (jeuActif && !menuOuvert && !e.target.closest("button")) setTimeout(focusJeu, 0);
  });
  document.addEventListener("fullscreenchange", () => {
    $("plein-ecran").textContent = document.fullscreenElement ? "Quitter le plein écran" : "Plein écran";
    setTimeout(focusJeu, 50);
  });
  window.addEventListener("focus", () => { if (jeuActif) setTimeout(focusJeu, 50); });

  function envoyerTouche(type, idBouton) {
    if (menuOuvert) return;
    const touches = PRESETS[presetChoisi].touches;
    if (!Object.prototype.hasOwnProperty.call(touches, idBouton)) return;
    const nomTouche = touches[idBouton];
    if (typeof nomTouche !== "string") return;
    const code = NOMS_VERS_CODES[nomTouche] || nomTouche.toUpperCase().charCodeAt(0);
    const g = $("game");
    const ev = new KeyboardEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "keyCode", { get: () => code });
    Object.defineProperty(ev, "which", { get: () => code });
    g.dispatchEvent(ev);
  }

  // Quand le menu est affiché, la croix et A/B de la console servent à s'y déplacer.
  const NAV_CONSOLE = { 4: "haut", 5: "bas", 6: "gauche", 7: "droite", 10: "onglet-", 11: "onglet+", 8: "valider", 0: "retour", 3: "valider" };

  document.querySelectorAll("#console [data-bouton]").forEach(btn => {
    const id = Number(btn.dataset.bouton);
    let actif = false;
    const appuyer = e => {
      e.preventDefault();
      if (actif) return;
      actif = true;
      btn.classList.add("appuye");
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }
      if (menuVisible()) { naviguer(NAV_CONSOLE[id]); return; }
      if (spectateur) { toucheSpectateur(id, true); return; }
      envoyerTouche("keydown", id);
    };
    const relacher = () => {
      if (!actif) return;
      actif = false;
      btn.classList.remove("appuye");
      if (spectateur) toucheSpectateur(id, false);
      else envoyerTouche("keyup", id);
      if (jeuActif) focusJeu();
    };
    btn.addEventListener("pointerdown", appuyer);
    btn.addEventListener("pointerup", relacher);
    btn.addEventListener("pointercancel", relacher);
    btn.addEventListener("lostpointercapture", relacher);
    btn.addEventListener("contextmenu", e => e.preventDefault());
  });

