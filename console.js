// Fichier assemblé à partir de console/js/ par outils-depot/assembler.mjs : ne pas le modifier à la main.
  // L'émulateur dessine en WebGL : on garde chaque image lisible pour pouvoir la diffuser au salon.
  (() => {
    const origine = HTMLCanvasElement.prototype.getContext;
    const connecter = AudioNode.prototype.connect;
    window.__sortiesAudio = [];
    AudioNode.prototype.connect = function (cible, ...reste) {
      const r = connecter.call(this, cible, ...reste);
      try {
        if (typeof AudioDestinationNode === "function" && cible instanceof AudioDestinationNode) {
          const ctx = this.context;
          if (!ctx.__sortieDirecte) { ctx.__sortieDirecte = ctx.createMediaStreamDestination(); window.__sortiesAudio.push(ctx.__sortieDirecte); }
          connecter.call(this, ctx.__sortieDirecte);
        }
      } catch (e) {}
      return r;
    };
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") options = Object.assign({}, options, { preserveDrawingBuffer: true });
      return origine.call(this, type, options);
    };
  })();
  const CONFIG = window.DS_RETRO_CONFIG || {};
  const DANS_DISCORD = new URLSearchParams(location.search).has("frame_id");
  // EmulatorJS 4.2.3 est hébergé avec la console (dossier emulateur/) : version figée, rien chargé d'ailleurs.
  const CDN = "emulateur/";
  let discordPret = Promise.resolve();

  // Dans l'appli Rétro pour PC : un bouton pour revenir au menu d'accueil.
  if (window.retroApp) {
    document.body.classList.add("dans-app");
    const retour = document.createElement("a");
    retour.href = "accueil.html"; retour.textContent = "← Accueil";
    retour.setAttribute("style", "position:fixed;left:14px;top:12px;z-index:50;font:600 14px/1 system-ui,sans-serif;color:#eef0f4;background:#2b303bcc;border:1px solid #ffffff22;border-radius:9px;padding:9px 12px;text-decoration:none");
    retour.addEventListener("click", e => { if (typeof jeuActif !== "undefined" && jeuActif) { e.preventDefault(); Promise.resolve(typeof sauverSram === "function" && sauverSram(true)).finally(() => { location.href = "accueil.html"; }); } });
    document.body.appendChild(retour);
  }

  if (DANS_DISCORD) {
    document.getElementById("lieu").textContent = "Discord";
    if (window.DiscordEmbedded && CONFIG.discordApplicationId) {
      const sdk = new DiscordEmbedded.DiscordSDK(CONFIG.discordApplicationId);
      window.discordSdk = sdk;
      discordPret = sdk.ready().catch(() => {});
    }
  }
  const EXTENSIONS = [".nds", ".gba", ".gb", ".gbc", ".zip", ".7z"];
  // Consoles prises en charge. Comme sur une DS Lite, une cartouche GBA se met dans la fente du bas
  // et le jeu s'affiche sur un seul écran. Le cœur mGBA lit aussi les jeux Game Boy et Game Boy Color.
  const SYSTEMES = {
    nds: { nom: "DS", coeur: "desmume", mode: "ds" },
    gba: { nom: "GBA", coeur: "mgba", mode: "gba" },
    gbc: { nom: "GBC", coeur: "mgba", mode: "gb" },
    gb: { nom: "GB", coeur: "mgba", mode: "gb" },
  };
  let systemeJeu = "nds";
  function systemeDuNom(nom) {
    const n = String(nom || "").toLowerCase();
    if (n.endsWith(".gba")) return "gba";
    if (n.endsWith(".gbc")) return "gbc";
    if (n.endsWith(".gb")) return "gb";
    if (n.endsWith(".nds")) return "nds";
    return null;
  }
  // Pour un .zip, on lit la liste des fichiers qu'il contient ; pour un .7z, on se fie au nom.
  async function systemeDuFichier(blob, nom) {
    const direct = systemeDuNom(nom);
    if (direct) return direct;
    if (/\.zip$/i.test(nom) && blob) {
      try {
        const fin = new Uint8Array(await blob.slice(Math.max(0, blob.size - 65_557)).arrayBuffer());
        for (let i = 0; i + 46 <= fin.length; i++) {
          if (fin[i] !== 0x50 || fin[i + 1] !== 0x4b || fin[i + 2] !== 0x01 || fin[i + 3] !== 0x02) continue;
          const longueur = fin[i + 28] | (fin[i + 29] << 8);
          const s = systemeDuNom(new TextDecoder().decode(fin.subarray(i + 46, i + 46 + longueur)));
          if (s) return s;
        }
      } catch (e) {}
    }
    if (/\bgba\b/i.test(nom)) return "gba";
    if (/\bgbc\b/i.test(nom)) return "gbc";
    return "nds";
  }
  const $ = id => document.getElementById(id);
  const lire = (cle, defaut) => { try { return localStorage.getItem(cle) || defaut; } catch (e) { return defaut; } };
  const ecrire = (cle, val) => { try { localStorage.setItem(cle, val); } catch (e) {} };

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

  // ---------- Menu système (onglets) ----------
  let ongletActif = "jeux";
  const menuVisible = () => (jeuDemarre || spectateur) ? menuOuvert : !jeuActif;
  function majOnglets() {
    document.querySelector('.onglet[data-onglet="jeux"]').hidden = jeuActif || spectateur;
    document.querySelector('.onglet[data-onglet="partie"]').hidden = !jeuActif;
    const actuel = document.querySelector(`.onglet[data-onglet="${ongletActif}"]`);
    if (actuel && actuel.hidden) afficherOnglet(ongletsDisponibles()[0]);
  }
  function ongletsDisponibles() {
    return [...document.querySelectorAll(".onglet")].filter(o => !o.hidden).map(o => o.dataset.onglet);
  }
  function afficherOnglet(nom) {
    ongletActif = nom;
    $("menu").dataset.onglet = nom;
    document.querySelectorAll("#menu .panneau").forEach(p => { p.hidden = p.dataset.p !== nom; });
    document.querySelectorAll(".onglet").forEach(o => o.setAttribute("aria-selected", String(o.dataset.onglet === nom)));
    if (nom === "partie") majInfosPartie();
    if (nom === "salon") { $("point-salon").hidden = true; majSalon(); }
  }
  document.querySelectorAll(".onglet").forEach(o => o.addEventListener("click", () => afficherOnglet(o.dataset.onglet)));
  afficherOnglet("jeux");

  $("bouton-menu").addEventListener("pointerdown", e => {
    e.preventDefault();
    const b = e.currentTarget;
    b.classList.add("appuye");
    setTimeout(() => b.classList.remove("appuye"), 120);
    if (jeuDemarre || spectateur) menuOuvert ? fermerPause() : ouvrirPause();
    else if (!jeuActif) afficherOnglet("jeux");
  });

  function ouvrirPause() {
    fermerVersions();
    if (menuOuvert || (!jeuDemarre && !spectateur)) return;
    menuOuvert = true;
    document.body.classList.add("menu-ouvert");
    relacherToutSpectateur();
    if (jeuDemarre) {
      try { window.EJS_emulator.pause(); } catch (e) {}
      sauverSram(true);
      if (estHote()) envoyerSalon({ t: "pause", pause: true });
    }
    const m = $("menu");
    m.style.display = "";
    m.classList.remove("parti", "flash");
    majOnglets();
    afficherOnglet(jeuDemarre ? "partie" : "salon");
    $("quitter").classList.remove("arme");
    $("quitter").textContent = "Quitter le jeu";
    setTimeout(() => {
      const cible = jeuDemarre ? $("reprendre") : elementsNavigables().find(b => !b.classList.contains("onglet"));
      if (cible) cible.focus({ preventScroll: true });
    }, 30);
  }
  function fermerPause() {
    if (!menuOuvert) return;
    menuOuvert = false;
    document.body.classList.remove("menu-ouvert");
    $("menu").classList.add("parti");
    setTimeout(() => { if (!menuOuvert) $("menu").style.display = "none"; }, 300);
    if (jeuDemarre) {
      try { window.EJS_emulator.play(); } catch (e) {}
      if (estHote()) envoyerSalon({ t: "pause", pause: false });
    }
    codesJeu = codesDuPreset();
    setTimeout(focusJeu, 30);
  }
  $("reprendre").addEventListener("click", fermerPause);

  $("plein-ecran").addEventListener("click", () => {
    const el = document.documentElement;
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
    if (p && p.catch) p.catch(() => {});
  });

  let minuteurQuitter = null;
  $("quitter").addEventListener("click", async () => {
    const b = $("quitter");
    if (!b.classList.contains("arme")) {
      b.classList.add("arme");
      b.textContent = "Touche encore pour quitter";
      clearTimeout(minuteurQuitter);
      minuteurQuitter = setTimeout(() => { b.classList.remove("arme"); b.textContent = "Quitter le jeu"; }, 3500);
      return;
    }
    b.textContent = "Sauvegarde…";
    await sauverSram(true);
    await viderCloud();
    envoyerSalon({ t: "fin" });
    location.reload();
  });

  // ---------- Coques et décor ----------
  const THEMES = [
    { id: "perle",   nom: "Perle",   haut: "#eef0f4", bas: "#dfe2e8" },
    { id: "onyx",    nom: "Onyx",    haut: "linear-gradient(135deg,#2c2d33,#141519)", bas: "#1a1b20" },
    { id: "cerise",  nom: "Cerise",  haut: "linear-gradient(135deg,#e2475b,#a5162b)", bas: "#b81f35" },
    { id: "glacier", nom: "Glacier", haut: "linear-gradient(135deg,#bfe6ff,#78b4e6)", bas: "#93c4ea" },
    { id: "galaxie", nom: "Galaxie", haut: "radial-gradient(circle at 70% 30%,#7a45d0,#120c26 75%)", bas: "#1a1236" },
    { id: "sakura",  nom: "Sakura",  haut: "linear-gradient(135deg,#fff1f4,#f6c6d2)", bas: "#f6ccd7" },
    { id: "or",      nom: "Or",      haut: "#121110", bas: "linear-gradient(#f0d58c,#b8913f)" },
    { id: "neon",    nom: "Néon",    haut: "#0b0c10", bas: "conic-gradient(#00e5ff,#ff3df2,#00e5ff)" },
  ];
  function appliquerTheme(id) {
    const theme = THEMES.find(t => t.id === id) || THEMES[0];
    document.documentElement.dataset.theme = theme.id;
    ecrire("ds-retro-theme", theme.id);
    $("nom-coque").textContent = theme.nom;
    document.querySelectorAll(".coque-choix").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.theme === theme.id)));
    window.EJS_color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  }
  THEMES.forEach(t => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "coque-choix"; b.dataset.theme = t.id;
    const mini = document.createElement("span");
    mini.className = "mini"; mini.setAttribute("aria-hidden", "true");
    const i1 = document.createElement("i"); i1.style.background = t.haut;
    const i2 = document.createElement("i"); i2.style.background = t.bas;
    mini.append(i1, i2);
    const nom = document.createElement("span"); nom.textContent = t.nom;
    b.append(mini, nom);
    b.addEventListener("click", () => appliquerTheme(t.id));
    $("coques").appendChild(b);
  });
  appliquerTheme(lire("ds-retro-theme", "perle"));

  function appliquerDecor(avec) {
    document.documentElement.classList.toggle("sans-decor", !avec);
    $("bascule-decor").setAttribute("aria-pressed", String(avec));
    $("etat-decor").textContent = avec ? "Assorti" : "Sobre";
    ecrire("ds-retro-decor", avec ? "assorti" : "sobre");
  }
  $("bascule-decor").addEventListener("click", () => appliquerDecor(document.documentElement.classList.contains("sans-decor")));
  appliquerDecor(lire("ds-retro-decor", "assorti") === "assorti");

  // ---------- Horloge ----------
  const formatDate = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  function majHorloge() {
    const d = new Date();
    $("hh").textContent = String(d.getHours()).padStart(2, "0");
    $("mm").textContent = String(d.getMinutes()).padStart(2, "0");
    $("date").textContent = formatDate.format(d);
  }
  majHorloge();
  setInterval(majHorloge, 5000);


  // ---------- Volume : curseur sur la coque (jeu et partie regardée), gardé sur l'appareil ----------
  let volume = Math.min(100, Math.max(0, Number(lire("ds-retro-volume", "70"))));
  if (!Number.isFinite(volume)) volume = 70;
  function appliquerVolume() {
    $("volume").value = volume;
    $("volume").style.setProperty("--niveau", volume + "%");
    try {
      if (window.EJS_emulator && typeof EJS_emulator.setVolume === "function") {
        EJS_emulator.volume = volume / 100;   // gardé par l'émulateur pour les sons à venir
        EJS_emulator.setVolume(volume / 100);
      }
    } catch (e) {}
    $("video-distante").volume = volume / 100;
  }
  $("volume").addEventListener("input", e => {
    volume = Number(e.target.value);
    ecrire("ds-retro-volume", String(volume));
    appliquerVolume();
  });
  $("volume").addEventListener("change", e => {
    bulle(volume ? "Son : " + volume + " %" : "Son coupé");
    if (jeuActif && !menuOuvert) { e.target.blur(); focusJeu(); }
  });
  appliquerVolume();
  // ---------- Stockage local (IndexedDB) : cartouches, sauvegardes, états ----------
  let bdPromesse = null;
  function bd() {
    if (!bdPromesse) bdPromesse = new Promise((ok, ko) => {
      const r = indexedDB.open("ds-retro", 2);
      r.onupgradeneeded = () => {
        const base = r.result;
        ["cartouches", "sauvegardes", "etats"].forEach(nom => {
          if (!base.objectStoreNames.contains(nom)) base.createObjectStore(nom, { keyPath: "id" });
        });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    return bdPromesse;
  }
  async function magasin(nom, mode, action) {
    const base = await bd();
    return new Promise((ok, ko) => {
      const t = base.transaction(nom, mode);
      const req = action(t.objectStore(nom));
      t.oncomplete = () => ok(req ? req.result : undefined);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
    });
  }
  const listerCartouches = () => magasin("cartouches", "readonly", s => s.getAll()).catch(() => []);
  const lireDans = (nom, id) => magasin(nom, "readonly", s => s.get(id));
  const ecrireDans = (nom, objet) => magasin(nom, "readwrite", s => s.put(objet));
  const retirerCartouche = id => magasin("cartouches", "readwrite", s => s.delete(id));

  function nomLisible(nomFichier) {
    return nomFichier.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || nomFichier;
  }
  function initiales(nom) {
    const mots = nom.split(/[\s\-.]+/).filter(Boolean);
    if (mots.length >= 2) return (mots[0][0] + mots[1][0]).toUpperCase();
    return nom.slice(0, 2).toUpperCase();
  }
  function teinte(texte) {
    let h = 0;
    for (const c of texte) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }

  async function afficherCartouches() {
    const liste = (await listerCartouches()).sort((a, b) => (b.joue || 0) - (a.joue || 0));
    const grille = $("grille");
    grille.innerHTML = "";

    const ajouter = document.createElement("button");
    ajouter.type = "button"; ajouter.className = "ajouter";
    ajouter.innerHTML = '<span class="plus" aria-hidden="true">+</span><span>Ajouter des jeux</span>';
    ajouter.addEventListener("click", () => $("fichier").click());
    grille.appendChild(ajouter);

    liste.forEach(c => {
      const nom = nomLisible(c.nom);
      const emplacement = document.createElement("div");
      emplacement.className = "emplacement";
      const cart = document.createElement("button");
      cart.type = "button"; cart.className = "cart";
      cart.dataset.id = c.id;
      cart.style.setProperty("--teinte", teinte(nom));
      cart.setAttribute("aria-label", "Jouer à " + nom);
      const etiquette = document.createElement("span");
      etiquette.className = "etiquette"; etiquette.textContent = initiales(nom);
      const titre = document.createElement("span");
      titre.className = "nom"; titre.textContent = nom;
      cart.append(etiquette, titre);
      marquerSysteme(cart, c.systeme || systemeDuNom(c.nom));
      cart.addEventListener("click", () => jouerCartouche(cart, c.id));
      if (ludoContient(c.id)) {
        const nuage = document.createElement("span");
        nuage.className = "nuage-ok"; nuage.textContent = "☁"; nuage.title = "Aussi dans ton cloud";
        cart.appendChild(nuage);
      }
      emplacement.append(cart, boutonRetirer(nom, async () => {
        await retirerCartouche(c.id).catch(() => {});
        await retirerDuCloud(c.id);
      }), boutonCatalogue(nom, Boolean(c.catalogue), oui => basculerCatalogue({ id: c.id }, oui)));
      grille.appendChild(emplacement);
    });

    // Jeux de ton cloud qui ne sont pas encore sur cet appareil
    for (const d of await jeuxSeulementDansLeCloud(liste)) {
      const nom = nomLisible(d.nom);
      const emplacement = document.createElement("div");
      emplacement.className = "emplacement";
      const cart = document.createElement("button");
      cart.type = "button"; cart.className = "cart nuage";
      cart.style.setProperty("--teinte", teinte(nom));
      cart.setAttribute("aria-label", "Récupérer " + nom + " depuis ton cloud et jouer");
      const etiquette = document.createElement("span");
      etiquette.className = "etiquette"; etiquette.textContent = initiales(nom);
      const titre = document.createElement("span");
      titre.className = "nom"; titre.textContent = nom;
      const nuage = document.createElement("span");
      nuage.className = "nuage-ok"; nuage.textContent = "☁";
      cart.append(etiquette, titre, nuage);
      marquerSysteme(cart, systemeDuNom(d.nom));
      cart.addEventListener("click", () => recupererDuCloud(cart, d));
      emplacement.append(cart, boutonRetirer(nom, () => supprimerDuCloud(d.id)), boutonCatalogue(nom, Boolean(d.catalogue), oui => basculerCatalogue({ cle: d.id }, oui)));
      grille.appendChild(emplacement);
    }

    const nbCartes = grille.querySelectorAll(".cart").length;
    if (!nbCartes) {
      const vide = document.createElement("div");
      vide.className = "vide";
      let connecte = false;
      try { connecte = Boolean(salon.jeton); } catch (e) {}
      vide.innerHTML = connecte
        ? "<p>Choisis un ou plusieurs jeux sur ton appareil. Une copie va dans ton cloud, visible par toi seul.</p><p>Pas de jeu ? Va voir le Catalogue.</p>"
        : "<p>Choisis un ou plusieurs jeux <b>DS</b>, <b>GBA</b> ou <b>Game Boy</b> sur ton appareil. Ils restent chez toi.</p><p>Pas de jeu ? Va voir le Catalogue.</p>";
      grille.appendChild(vide);
    }
    $("compte").textContent = nbCartes ? String(nbCartes) : "";
    try { envoyerMaListe(false); } catch (e) {}
    afficherCatalogue();
  }

  // Cartouches GBA et Game Boy : leur forme et une petite étiquette (la DS reste sans étiquette).
  function marquerSysteme(cart, systeme) {
    if (!systeme || systeme === "nds" || !SYSTEMES[systeme]) return;
    cart.classList.add(SYSTEMES[systeme].mode === "gba" ? "gba" : "gb");
    const e = document.createElement("span");
    e.className = "systeme"; e.textContent = SYSTEMES[systeme].nom;
    cart.appendChild(e);
  }

  async function jouerCartouche(cart, id) {
    try {
      const complet = await lireDans("cartouches", id);
      if (!complet || !complet.blob) throw new Error("absent");
      complet.joue = Date.now();
      ecrireDans("cartouches", complet).catch(() => {});
      inserer(cart, complet.blob, complet.nom, id);
    } catch (e) {
      $("erreur").textContent = "Cette cartouche n'est plus sur l'appareil. Ajoute à nouveau le fichier.";
    }
  }

  // « + Catalogue » : met le jeu au catalogue de tout le salon. Tout le monde voit son nom et peut
  // te demander d'y jouer ; le jeu tourne sur ta console et ils jouent à distance. Le fichier reste chez toi.
  function boutonCatalogue(nom, oui, action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "au-catalogue";
    const maj = () => {
      b.textContent = oui ? "✓ Catalogue" : "+ Catalogue";
      b.setAttribute("aria-pressed", String(oui));
      b.setAttribute("aria-label", (oui ? "Retirer du catalogue de tout le monde : " : "Ajouter au catalogue pour tout le monde : ") + nom);
      b.title = oui ? "Dans le catalogue de tout le monde" : "Ajouter au catalogue pour tout le monde";
    };
    const expliquer = () => {
      if (jeuActif || spectateur) return;
      $("message-haut").textContent = oui
        ? nom + " est dans le catalogue de tout le monde : chacun peut te demander d'y jouer."
        : "+ Catalogue : ajoute " + nom + " au catalogue pour tout le monde. Le fichier reste chez toi.";
    };
    maj();
    b.addEventListener("mouseenter", expliquer);
    b.addEventListener("focus", expliquer);
    b.addEventListener("click", async e => {
      e.stopPropagation();
      oui = !oui; maj(); expliquer();
      await action(oui);
    });
    return b;
  }

  async function basculerCatalogue(cible, oui) {
    const maj = Date.now();
    let cle = cible.cle || null;
    if (cible.id) {
      const c = await lireDans("cartouches", cible.id).catch(() => null);
      if (c) { c.catalogue = oui; c.catalogueMaj = maj; await ecrireDans("cartouches", c).catch(() => {}); }
      if (salon.jeton) cle = await cleLudo(cible.id);
    }
    const d = cle && ludo.distants.get(cle);
    if (d && salon.jeton) {
      d.catalogue = oui ? 1 : 0; d.catalogue_maj = maj;
      appelLudo("/" + cle, { method: "POST", headers: { "X-Catalogue": oui ? "1" : "0", "X-Maj": String(maj) } }).catch(() => {});
    }
    envoyerMaListe(false);
    afficherCatalogue();
  }

  // Bandeau sous les onglets après un ajout : mettre au catalogue, jouer.
  function masquerApresAjout() {
    const zone = $("apres-ajout");
    zone.hidden = true; zone.innerHTML = "";
  }
  async function afficherApresAjout(ids) {
    const zone = $("apres-ajout");
    const cartouches = (await Promise.all(ids.map(id => lireDans("cartouches", id).catch(() => null)))).filter(Boolean);
    zone.innerHTML = "";
    zone.hidden = !cartouches.length;
    if (!cartouches.length) return;
    const seul = cartouches.length === 1;
    const nom = seul ? nomLisible(cartouches[0].nom) : "";
    const texte = document.createElement("p");
    texte.textContent = seul ? "Ajouté : " + nom : cartouches.length + " jeux ajoutés à tes cartouches";
    texte.title = texte.textContent;
    const bouton = (libelle, classe, action) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "choix " + classe; b.textContent = libelle;
      b.addEventListener("click", action);
      return b;
    };
    let tous = cartouches.every(c => c.catalogue);
    const bCatalogue = bouton("", "", async () => {
      tous = !tous; majCatalogue();
      for (const c of cartouches) await basculerCatalogue({ id: c.id }, tous);
      await afficherCartouches();
      $("message-haut").textContent = !tous ? "Retiré du catalogue."
        : seul ? nom + " est dans le catalogue de tout le monde : chacun peut te demander d'y jouer."
        : "Ces jeux sont dans le catalogue de tout le monde : chacun peut te demander d'y jouer.";
    });
    const majCatalogue = () => {
      bCatalogue.textContent = tous ? "✓ Dans le catalogue de tous" : seul ? "+ Catalogue pour tout le monde" : "+ Tout au catalogue pour tous";
      bCatalogue.setAttribute("aria-pressed", String(tous));
    };
    majCatalogue();
    zone.append(texte, bCatalogue);
    if (seul) {
      const id = cartouches[0].id;
      zone.append(bouton("Jouer", "principal", () => {
        masquerApresAjout();
        jouerCartouche(document.querySelector(`.cart[data-id="${CSS.escape(id)}"]`), id);
      }));
    } else {
      zone.append(bouton("OK", "", () => { masquerApresAjout(); $("message-haut").textContent = MESSAGE_ACCUEIL; }));
    }
  }
  // Bouton × : un premier appui arme le retrait, le second retire (de l'appareil et du cloud).
  function boutonRetirer(nom, action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "retirer";
    b.textContent = "×";
    b.setAttribute("aria-label", "Retirer " + nom);
    let minuteur = null;
    b.addEventListener("click", async e => {
      e.stopPropagation();
      if (!b.classList.contains("arme")) {
        b.classList.add("arme"); b.textContent = "Retirer ?";
        b.setAttribute("aria-label", "Confirmer le retrait de " + nom);
        clearTimeout(minuteur);
        minuteur = setTimeout(() => { b.classList.remove("arme"); b.textContent = "×"; b.setAttribute("aria-label", "Retirer " + nom); }, 3000);
        return;
      }
      clearTimeout(minuteur);
      await action();
      afficherCartouches();
    });
    return b;
  }

  afficherCartouches();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  async function ajouterFichier(fichier) {
    $("erreur").textContent = "";
    const nom = fichier.name.toLowerCase();
    if (!EXTENSIONS.some(ext => nom.endsWith(ext))) {
      $("erreur").textContent = "Ce fichier n'est pas un jeu DS, GBA ou Game Boy. Choisis un .nds, .gba, .gb, .gbc, ou un .zip / .7z qui en contient un.";
      return;
    }
    const id = fichier.name + "|" + fichier.size;
    afficherVueJeux("perso");
    try {
      const ancien = await lireDans("cartouches", id).catch(() => null);
      await ecrireDans("cartouches", { ...(ancien || {}), id, nom: fichier.name, taille: fichier.size, ajoute: ancien ? ancien.ajoute : Date.now(), joue: Date.now(), systeme: await systemeDuFichier(fichier, fichier.name), blob: fichier });
    } catch (e) {
      // Plus de place sur l'appareil : on lance quand même, sans garder la cartouche.
      const cart = document.querySelector(`.cart[data-id="${CSS.escape(id)}"]`);
      return inserer(cart, fichier, fichier.name, id);
    }
    await afficherCartouches();
    synchroniserLudotheque();
    await afficherApresAjout([id]);
    $("message-haut").textContent = nomLisible(fichier.name) + " est prêt. Touche Jouer, ou ajoute-le au catalogue pour tout le monde.";
  }

  // Plusieurs jeux d'un coup : ils rejoignent tous « Tes cartouches », sans lancer de partie.
  async function ajouterPlusieurs(fichiers) {
    const jeux = [...fichiers].filter(f => EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext)));
    const ignores = fichiers.length - jeux.length;
    $("erreur").textContent = "";
    afficherVueJeux("perso");
    let ajoutes = 0, sansPlace = 0;
    const nouveaux = [];
    for (let i = 0; i < jeux.length; i++) {
      const f = jeux[i];
      $("message-haut").textContent = "Ajout des jeux… " + (i + 1) + " / " + jeux.length;
      const id = f.name + "|" + f.size;
      try {
        const ancien = await lireDans("cartouches", id).catch(() => null);
        await ecrireDans("cartouches", { ...(ancien || {}), id, nom: f.name, taille: f.size, ajoute: ancien ? ancien.ajoute : Date.now(), joue: ancien ? ancien.joue : 0, systeme: await systemeDuFichier(f, f.name), blob: f });
        ajoutes++;
        nouveaux.push(id);
      } catch (e) { sansPlace++; }
    }
    await afficherCartouches();
    synchroniserLudotheque();
    await afficherApresAjout(nouveaux);
    $("message-haut").textContent = ajoutes === 1 ? "1 jeu ajouté à tes cartouches." : ajoutes + " jeux ajoutés à tes cartouches.";
    const remarques = [];
    if (ignores) remarques.push(ignores === 1 ? "1 fichier ignoré (ce n'est pas un jeu DS, GBA ou Game Boy)." : ignores + " fichiers ignorés (ce ne sont pas des jeux DS, GBA ou Game Boy).");
    if (sansPlace) remarques.push(sansPlace === 1 ? "1 jeu n'a pas pu être gardé : plus de place sur l'appareil." : sansPlace + " jeux n'ont pas pu être gardés : plus de place sur l'appareil.");
    $("erreur").textContent = remarques.join(" ");
  }
  function recevoirFichiers(liste) {
    if (!liste || !liste.length) return;
    if (liste.length === 1) ajouterFichier(liste[0]);
    else ajouterPlusieurs(liste);
  }

  $("fichier").addEventListener("change", () => {
    recevoirFichiers($("fichier").files);
    $("fichier").value = "";
  });

  let profondeur = 0;
  window.addEventListener("dragenter", e => { if (jeuActif) return; e.preventDefault(); profondeur++; afficherOnglet("jeux"); document.body.classList.add("depot"); });
  window.addEventListener("dragover", e => { if (!jeuActif) e.preventDefault(); });
  window.addEventListener("dragleave", () => { if (--profondeur <= 0) { profondeur = 0; document.body.classList.remove("depot"); } });
  window.addEventListener("drop", e => {
    e.preventDefault(); profondeur = 0; document.body.classList.remove("depot");
    if (!jeuActif && !spectateur) recevoirFichiers(e.dataTransfer.files);
  });

  // ---------- Catalogue : jeux partagés, dans le dossier catalogue/ du dépôt ----------
  let vueJeux = lire("ds-retro-vue-jeux", "perso");
  let catalogue = null;
  let telechargement = false;
  const MESSAGE_ACCUEIL = "Choisis une cartouche sur l'écran du bas.";

  function ficheJeu(jeu) {
    const details = [jeu.genre, jeu.joueurs].filter(Boolean).join(", ");
    const credit = jeu.auteur ? "Par " + jeu.auteur + (jeu.licence ? ", licence " + jeu.licence : "") + "." : "";
    return jeu.nom + (details ? " : " + details + "." : ".") + (credit ? " " + credit : "");
  }

  function afficherVueJeux(vue) {
    vueJeux = vue === "catalogue" ? "catalogue" : "perso";
    ecrire("ds-retro-vue-jeux", vueJeux);
    document.querySelectorAll(".vue-jeux").forEach(b => b.setAttribute("aria-selected", String(b.dataset.vue === vueJeux)));
    $("grille").hidden = vueJeux !== "perso";
    $("grille-catalogue").hidden = vueJeux !== "catalogue";
    $("etat-ludo").hidden = vueJeux !== "perso" || !$("etat-ludo").textContent;
    $("erreur").textContent = "";
    if (vueJeux !== "perso") masquerApresAjout();
    if (!jeuActif && !salon.infos.hote) {
      $("message-haut").textContent = vueJeux === "catalogue" ? "Le catalogue de tout le salon : tes jeux, ceux de tes potes et des jeux libres." : MESSAGE_ACCUEIL;
    }
    if (vueJeux === "catalogue") { if (!catalogue && !chargementCatalogue) chargerCatalogue(); else afficherCatalogue(true); }
  }
  document.querySelectorAll(".vue-jeux").forEach(b => b.addEventListener("click", () => afficherVueJeux(b.dataset.vue)));

  let chargementCatalogue = false, catalogueEnPanne = false, signatureCatalogue = "";
  async function chargerCatalogue() {
    chargementCatalogue = true;
    try {
      const r = await fetch("catalogue/jeux.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      catalogue = (await r.json()).jeux || [];
      catalogueEnPanne = false;
    } catch (e) {
      catalogue = null;
      catalogueEnPanne = true;
    }
    chargementCatalogue = false;
    afficherCatalogue(true);
  }

  function nouvelleCart(nom, label, valeurTeinte) {
    const cart = document.createElement("button");
    cart.type = "button"; cart.className = "cart";
    cart.style.setProperty("--teinte", valeurTeinte);
    cart.setAttribute("aria-label", label);
    const etiquette = document.createElement("span");
    etiquette.className = "etiquette"; etiquette.textContent = initiales(nom);
    const titre = document.createElement("span");
    titre.className = "nom"; titre.textContent = nom;
    cart.append(etiquette, titre);
    return cart;
  }

  // Trois rubriques : tes jeux au catalogue, ceux de tes potes présents dans le salon, les jeux libres.
  function afficherCatalogue(forcer) {
    return dessinerCatalogue(forcer).catch(e => console.warn("catalogue", e));
  }
  async function dessinerCatalogue(forcer) {
    const grille = $("grille-catalogue");
    const locaux = await listerCartouches();
    const miens = locaux.filter(c => c.catalogue).map(c => ({ id: c.id, nom: nomLisible(c.nom) }));
    for (const d of await jeuxSeulementDansLeCloud(locaux)) if (d.catalogue) miens.push({ id: "nuage:" + d.id, nom: nomLisible(d.nom), d });
    miens.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    const potes = [];
    if (salon.etat === "connecte") {
      for (const [id, jeux] of salon.listes) {
        if (id !== moiId() && jeux.length && salon.infos.joueurs.some(j => j.id === id)) potes.push({ id, nom: nomDe(id), jeux });
      }
    }
    const libres = catalogue || [];
    const signature = JSON.stringify([chargementCatalogue, catalogueEnPanne, libres.map(j => j.fichier), miens.map(j => j.id), potes.map(p => [p.id, p.nom, p.jeux])]);
    if (!forcer && signature === signatureCatalogue) return;
    signatureCatalogue = signature;

    const total = miens.length + libres.length + potes.reduce((n, p) => n + p.jeux.length, 0);
    $("compte-catalogue").textContent = total ? String(total) : "";
    grille.innerHTML = "";
    const rubrique = (titre, detail) => {
      const t = document.createElement("div");
      t.className = "titre-grille";
      const b = document.createElement("span"); b.textContent = titre;
      const p = document.createElement("small"); p.textContent = detail;
      t.append(b, p);
      grille.appendChild(t);
    };
    const fiche = (cart, texte) => {
      const montrer = () => { if (!jeuActif && !spectateur && !telechargement) $("message-haut").textContent = texte; };
      cart.addEventListener("mouseenter", montrer);
      cart.addEventListener("focus", montrer);
    };

    if (miens.length) {
      rubrique("Tes jeux", "pour tout le monde");
      miens.forEach(j => {
        const emplacement = document.createElement("div");
        emplacement.className = "emplacement";
        const cart = nouvelleCart(j.nom, "Jouer à " + j.nom, teinte(j.nom));
        marquerSysteme(cart, j.d ? systemeDuNom(j.d.nom) : systemeDuNom(j.id.split("|")[0]));
        fiche(cart, j.nom + ", ton jeu dans le catalogue de tout le monde. Touche pour jouer : tes potes pourront regarder et prendre la manette.");
        cart.addEventListener("click", () => j.d ? recupererDuCloud(cart, j.d) : jouerCartouche(cart, j.id));
        emplacement.append(cart, boutonCatalogue(j.nom, true, oui => basculerCatalogue(j.d ? { cle: j.d.id } : { id: j.id }, oui)));
        grille.appendChild(emplacement);
      });
    }

    potes.forEach(p => {
      rubrique("Chez " + p.nom, "il lance, tu joues");
      p.jeux.forEach(jeu => {
        const emplacement = document.createElement("div");
        emplacement.className = "emplacement";
        const cart = nouvelleCart(jeu.nom, "Demander à " + p.nom + " de lancer " + jeu.nom, teinte(jeu.nom));
        marquerSysteme(cart, systemeDuNom(String(jeu.id).split("|")[0]));
        const badge = document.createElement("i");
        badge.className = "chez"; badge.textContent = (p.nom[0] || "?").toUpperCase();
        badge.style.setProperty("--teinte-pote", teinte(p.nom));
        cart.appendChild(badge);
        fiche(cart, jeu.nom + ", chez " + p.nom + ". Touche pour lui demander de le lancer : tu verras son écran et tu auras la manette.");
        cart.addEventListener("click", () => proposerA(p.id, jeu));
        emplacement.appendChild(cart);
        grille.appendChild(emplacement);
      });
    });

    if (libres.length) {
      rubrique("Jeux libres", "jouables par chacun");
      libres.forEach(jeu => {
        const emplacement = document.createElement("div");
        emplacement.className = "emplacement";
        const cart = nouvelleCart(jeu.nom, "Jouer à " + jeu.nom, Number.isFinite(jeu.teinte) ? jeu.teinte : teinte(jeu.nom));
        marquerSysteme(cart, systemeDuNom(jeu.fichier));
        const pastille = document.createElement("i");
        pastille.className = "partage"; pastille.title = "Jeu libre";
        cart.appendChild(pastille);
        fiche(cart, ficheJeu(jeu));
        cart.addEventListener("click", () => lancerDuCatalogue(cart, jeu));
        emplacement.appendChild(cart);
        grille.appendChild(emplacement);
      });
    }

    if (!grille.children.length) {
      const vide = document.createElement("div");
      vide.className = "vide";
      vide.innerHTML = chargementCatalogue ? "<p>Chargement du catalogue…</p>"
        : "<p>Le catalogue est vide. Touche <b>+ Catalogue</b> sur une de tes cartouches pour l'ajouter pour tout le monde.</p>";
      grille.appendChild(vide);
    } else if (catalogueEnPanne) {
      const vide = document.createElement("div");
      vide.className = "vide";
      vide.innerHTML = "<p>Les jeux libres ne répondent pas pour l'instant.</p>";
      grille.appendChild(vide);
    }
  }

  function proposerA(id, jeu) {
    if (jeuActif) { $("erreur").textContent = "Quitte ton jeu pour jouer chez un pote."; return; }
    envoyerSalon({ t: "propose", a: id, jeu });
    salon.proposeA = { a: id, nom: jeu.nom };
    bulle("Demande envoyée à " + nomDe(id) + ".");
    $("message-haut").textContent = "Demande envoyée à " + nomDe(id) + ". Quand il lance " + jeu.nom + ", tu verras son écran et tu auras la manette.";
  }

  async function lancerDuCatalogue(cart, jeu) {
    if (jeuActif || spectateur || telechargement) return;
    telechargement = true;
    $("erreur").textContent = "";
    document.body.classList.add("chargement");
    $("message-haut").textContent = "Téléchargement de " + jeu.nom + "…";
    try {
      // Un gros jeu peut être découpé en morceaux (Jeu.7z.001, .002…) : on les recolle dans l'ordre.
      const fichiers = Array.isArray(jeu.parties) && jeu.parties.length ? jeu.parties : [jeu.fichier];
      const morceaux = [];
      for (let i = 0; i < fichiers.length; i++) {
        const etape = fichiers.length > 1 ? " (partie " + (i + 1) + "/" + fichiers.length + ")" : "";
        const r = await fetch("catalogue/" + encodeURIComponent(fichiers[i]));
        if (!r.ok) throw new Error(r.status);
        const total = Number(r.headers.get("Content-Length")) || 0;
        if (r.body && total) {
          const lecteur = r.body.getReader();
          let recu = 0;
          for (;;) {
            const { done, value } = await lecteur.read();
            if (done) break;
            morceaux.push(value);
            recu += value.length;
            $("message-haut").textContent = "Téléchargement de " + jeu.nom + etape + "… " + Math.round(recu / total * 100) + " %";
          }
        } else {
          $("message-haut").textContent = "Téléchargement de " + jeu.nom + etape + "…";
          morceaux.push(new Uint8Array(await r.arrayBuffer()));
        }
      }
      const blob = new Blob(morceaux);
      telechargement = false;
      const extension = (jeu.fichier.match(/\.[^.]+$/) || [".nds"])[0];
      inserer(cart, blob, jeu.nom + extension, "catalogue:" + jeu.fichier);
    } catch (e) {
      telechargement = false;
      document.body.classList.remove("chargement");
      $("message-haut").textContent = MESSAGE_ACCUEIL;
      $("erreur").textContent = "Le jeu n'a pas pu être téléchargé. Vérifie ta connexion, puis réessaie.";
    }
  }
  // ---------- Sauvegardes ----------
  // 1) La sauvegarde faite dans le jeu (comme sur une vraie DS) : copiée ici toutes les 20 s,
  //    à chaque pause et en quittant, puis remise en place au prochain lancement.
  // 2) Les états : une photo instantanée de la partie, à sauver et recharger depuis le menu.
  let derniereEmpreinte = "";
  let derniereCopie = 0;
  function empreinte(octets) {
    let h = 2166136261;
    for (let i = 0; i < octets.length; i++) h = Math.imul(h ^ octets[i], 16777619);
    return octets.length + ":" + (h >>> 0);
  }
  async function sauverSram(urgent) {
    if (!jeuDemarre || !cartoucheId) return;
    try {
      const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
      const donnees = gm && gm.getSaveFile();
      if (!donnees || !donnees.length) return;
      const e = empreinte(donnees);
      if (e !== derniereEmpreinte) {
        const copie = new Uint8Array(donnees);
        const maj = Date.now();
        await ecrireDans("sauvegardes", { id: cartoucheId, donnees: copie, maj });
        derniereEmpreinte = e;
        programmerCloud(cartoucheId, copie, maj, urgent);
      } else if (urgent) {
        await viderCloud();
      }
      derniereCopie = Date.now();
    } catch (err) {}
  }
  // Au lancement : on prend la sauvegarde la plus récente entre cet appareil et le cloud.
  // Dans Discord, on attend la connexion au cloud (8 s au plus) pour ne pas démarrer sur une vieille sauvegarde.
  let sauvegardeDeDepart = "";
  async function attendreCloud() {
    const fin = Date.now() + 8000;
    while (DANS_DISCORD && !salon.jeton && salon.etat === "connexion" && Date.now() < fin) {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  async function restaurerSram() {
    if (!cartoucheId) return;
    try {
      const id = cartoucheId;
      await attendreCloud();
      if (id !== cartoucheId) return;
      const locale = await lireDans("sauvegardes", id).catch(() => null);
      const distante = await lireCloud(id);
      if (distante !== undefined) cloudVerifiePour = id;
      let choisie = locale;
      if (distante && (!locale || distante.maj > (locale.maj || 0))) {
        choisie = distante;
        ecrireDans("sauvegardes", { id, donnees: distante.donnees, maj: distante.maj }).catch(() => {});
        bulle("Sauvegarde récupérée depuis le cloud.");
      } else if (locale && (!distante || (locale.maj || 0) > distante.maj)) {
        programmerCloud(id, locale.donnees, locale.maj || Date.now(), true);
      }
      if (!choisie || !choisie.donnees) { sauvegardeDeDepart = "vide"; derniereEmpreinte = ""; return; }
      const gm = window.EJS_emulator.gameManager;
      gm.FS.writeFile(gm.getSaveFilePath(), choisie.donnees);
      gm.loadSaveFiles();
      derniereEmpreinte = empreinte(choisie.donnees);
      sauvegardeDeDepart = derniereEmpreinte;
    } catch (err) {}
  }

  // La connexion au cloud arrive alors que le jeu tourne déjà. Si le cloud a plus récent et que tu
  // n'as pas encore sauvegardé depuis le lancement, le jeu redémarre sur la sauvegarde du cloud.
  // Sinon on garde ta partie : l'ancienne version du cloud reste dans « Anciennes sauvegardes ».
  async function verifierCloudEnCours() {
    if (!cartoucheId || !jeuDemarre) return;
    try {
      const id = cartoucheId;
      const locale = await lireDans("sauvegardes", id).catch(() => null);
      const distante = await lireCloud(id);
      if (distante === undefined || id !== cartoucheId) return;
      cloudVerifiePour = id;
      if (!distante) { if (locale) programmerCloud(id, locale.donnees, locale.maj || Date.now(), true); return; }
      // Lancé sans sauvegarde sur cet appareil, ou rien sauvegardé depuis : le cloud gagne.
      const rienDepuis = sauvegardeDeDepart === "vide" || derniereEmpreinte === sauvegardeDeDepart;
      if (distante.maj > ((locale && locale.maj) || 0) && rienDepuis) {
        await ecrireDans("sauvegardes", { id, donnees: distante.donnees, maj: distante.maj }).catch(() => {});
        const gm = window.EJS_emulator.gameManager;
        gm.FS.writeFile(gm.getSaveFilePath(), distante.donnees);
        gm.loadSaveFiles();
        derniereEmpreinte = sauvegardeDeDepart = empreinte(distante.donnees);
        gm.restart();
        bulle("Sauvegarde plus récente trouvée dans ton cloud : le jeu redémarre dessus.");
      } else if (locale && locale.maj > distante.maj) {
        programmerCloud(id, locale.donnees, locale.maj, true);
      }
    } catch (err) {}
  }
  setInterval(sauverSram, 20000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) sauverSram(); });
  window.addEventListener("pagehide", () => { sauverSram(true); });

  function ilYA(t) {
    if (!t) return "aucun";
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "à l'instant";
    const m = Math.round(s / 60);
    if (m < 60) return "il y a " + m + " min";
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(t);
  }
  // États de partie : aussi dans le cloud (compressés), pour les retrouver sur un autre appareil.
  async function compresser(octets) {
    if (typeof CompressionStream !== "function") return octets;
    const gz = new Uint8Array(await new Response(new Blob([octets]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    const sortie = new Uint8Array(4 + gz.length);
    sortie.set([68, 83, 90, 49]); sortie.set(gz, 4);   // « DSZ1 » : état compressé
    return sortie;
  }
  async function decompresser(octets) {
    if (!(octets[0] === 68 && octets[1] === 83 && octets[2] === 90 && octets[3] === 49)) return octets;
    return new Uint8Array(await new Response(new Blob([octets.subarray(4)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  const routeEtat = async id => API + "/etats/" + await cleJeu("etat:" + id);
  async function envoyerEtatCloud(id, etat, maj) {
    if (!salon.jeton) return false;
    try {
      const r = await fetch(await routeEtat(id), { method: "PUT", headers: { Authorization: "Bearer " + salon.jeton, "X-Maj": String(maj) }, body: await compresser(etat) });
      return r.ok;
    } catch (e) { return false; }
  }
  async function infoEtatCloud(id) {
    if (!salon.jeton || !id) return null;
    try {
      const r = await fetch(await routeEtat(id) + "/info", { headers: { Authorization: "Bearer " + salon.jeton } });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  async function lireEtatCloud(id) {
    const r = await fetch(await routeEtat(id), { headers: { Authorization: "Bearer " + salon.jeton } });
    if (!r.ok) throw new Error(r.status);
    return { etat: await decompresser(new Uint8Array(await r.arrayBuffer())), maj: Number(r.headers.get("X-Maj")) || Date.now() };
  }

  async function majInfosPartie() {
    $("titre-partie").textContent = nomJeu;
    $("info-sram").textContent = derniereCopie ? "copiée " + ilYA(derniereCopie) : "pas encore faite";
    const etat = cartoucheId ? await lireDans("etats", cartoucheId).catch(() => null) : null;
    const distant = await infoEtatCloud(cartoucheId);
    const plusRecent = Math.max((etat && etat.maj) || 0, (distant && distant.maj) || 0);
    $("info-etat").textContent = plusRecent ? ilYA(plusRecent) + (distant && distant.maj >= plusRecent ? ", dans ton cloud" : "") : "aucun";
    $("charger-etat").disabled = !plusRecent;
    $("info-cloud").textContent = !DANS_DISCORD ? "dans Discord seulement"
      : !salon.jeton ? "hors ligne"
      : cloud.erreur ? "échec, nouvel essai bientôt"
      : cloud.derniereSync ? "à jour " + ilYA(cloud.derniereSync)
      : "en attente";
  }
  // ---------- Anciennes sauvegardes : l'historique gardé dans le cloud ----------
  function fermerVersions() {
    $("versions").hidden = true;
    $("versions").innerHTML = "";
    document.querySelector('.panneau[data-p="partie"] .choix-grille').hidden = false;
  }
  const dateVersion = t => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(t);
  async function afficherVersions() {
    const liste = $("versions");
    document.querySelector('.panneau[data-p="partie"] .choix-grille').hidden = true;
    liste.hidden = false;
    liste.innerHTML = "";
    const bouton = (titre, detail, action, classe) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "choix " + (classe || "");
      const fort = document.createElement("strong"); fort.textContent = titre;
      b.appendChild(fort);
      if (detail) { const petit = document.createElement("span"); petit.textContent = detail; b.appendChild(petit); }
      if (action) b.addEventListener("click", () => action(b, fort));
      liste.appendChild(b);
      return b;
    };
    const note = texte => { const p = document.createElement("p"); p.className = "note-lcd"; p.textContent = texte; liste.appendChild(p); };
    const retour = bouton("Retour", "", () => fermerVersions(), "centre");
    retour.focus();
    if (!salon.jeton || !cartoucheId) { note("Les anciennes sauvegardes sont gardées dans ton cloud : ouvre la console dans Discord."); return; }
    note("Chargement…");
    let versions = [];
    try {
      const r = await fetch(API + "/sauvegardes/" + await cleJeu(cartoucheId) + "/versions", { headers: { Authorization: "Bearer " + salon.jeton } });
      if (!r.ok) throw new Error(r.status);
      versions = await r.json();
    } catch (e) {
      liste.lastChild.textContent = "Ton cloud ne répond pas. Réessaie dans un instant.";
      return;
    }
    liste.lastChild.remove();
    if (versions.length <= 1) { note("Pas encore d'ancienne version. Le cloud en garde jusqu'à 12, espacées d'au moins 10 minutes."); }
    versions.forEach(v => {
      if (v.actuelle) return bouton(dateVersion(v.maj), "Sauvegarde actuelle", null);
      let arme = false;
      bouton(dateVersion(v.maj), "Touche pour revenir à cette version", (b, fort) => {
        if (!arme) {
          arme = true; b.classList.add("danger", "arme"); fort.textContent = "Revenir à celle-ci ? Touche encore";
          setTimeout(() => { arme = false; b.classList.remove("danger", "arme"); fort.textContent = dateVersion(v.maj); }, 3000);
          return;
        }
        restaurerVersion(v.maj);
      });
    });
    note("Revenir en arrière ne supprime rien : ta sauvegarde actuelle rejoint cette liste.");
  }
  async function restaurerVersion(maj) {
    try {
      const id = cartoucheId;
      const r = await fetch(API + "/sauvegardes/" + await cleJeu(id) + "/versions/" + maj, { headers: { Authorization: "Bearer " + salon.jeton } });
      if (!r.ok) throw new Error(r.status);
      const donnees = new Uint8Array(await r.arrayBuffer());
      const maintenant = Date.now();
      await ecrireDans("sauvegardes", { id, donnees, maj: maintenant });
      const gm = window.EJS_emulator.gameManager;
      gm.FS.writeFile(gm.getSaveFilePath(), donnees);
      gm.loadSaveFiles();
      derniereEmpreinte = sauvegardeDeDepart = empreinte(donnees);
      cloudVerifiePour = id;
      programmerCloud(id, donnees, maintenant, true);
      fermerVersions();
      fermerPause();
      gm.restart();
      bulle("Sauvegarde du " + dateVersion(maj) + " remise en place : le jeu redémarre.");
    } catch (e) {
      bulle("Cette version n'a pas pu être récupérée. Réessaie dans un instant.");
    }
  }
  $("anciennes").addEventListener("click", afficherVersions);

  $("sauver-etat").addEventListener("click", async () => {
    const b = $("sauver-etat");
    try {
      const etat = new Uint8Array(window.EJS_emulator.gameManager.getState());
      const maj = Date.now();
      await ecrireDans("etats", { id: cartoucheId, etat, maj });
      b.textContent = "État sauvé";
      if (salon.jeton) envoyerEtatCloud(cartoucheId, etat, maj).then(ok => { if (!ok) bulle("État sauvé sur cet appareil. Le cloud ne répond pas pour l'instant."); majInfosPartie(); });
    } catch (e) {
      b.textContent = "Échec, réessaie";
    }
    setTimeout(() => { b.textContent = "Sauver l'état"; }, 1600);
    majInfosPartie();
  });
  $("charger-etat").addEventListener("click", async () => {
    try {
      let e = await lireDans("etats", cartoucheId).catch(() => null);
      const distant = await infoEtatCloud(cartoucheId);
      if (distant && (!e || distant.maj > e.maj)) {
        $("charger-etat").textContent = "Récupération…";
        e = { id: cartoucheId, ...(await lireEtatCloud(cartoucheId)) };
        ecrireDans("etats", e).catch(() => {});
        $("charger-etat").textContent = "Charger l'état";
      }
      if (!e) return;
      window.EJS_emulator.gameManager.loadState(e.etat);
      fermerPause();
    } catch (err) {
      $("charger-etat").textContent = "Échec, réessaie";
      setTimeout(() => { $("charger-etat").textContent = "Charger l'état"; }, 1600);
    }
  });

  // ---------- Insertion de la cartouche puis démarrage ----------
  const mouvementReduit = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function inserer(cart, blob, nomFichier, id) {
    if (jeuActif || spectateur) return;
    masquerApresAjout();
    jeuActif = true;
    cartoucheId = id || null;
    derniereEmpreinte = ""; sauvegardeDeDepart = ""; cloudVerifiePour = null;
    nomJeu = nomLisible(nomFichier);
    afficherOnglet("jeux");
    $("message-haut").textContent = "Lancement de " + nomJeu + "…";
    document.body.classList.add("chargement");

    if (cart && !mouvementReduit) {
      const zone = document.querySelector(".lcd.bas").getBoundingClientRect();
      const r = cart.getBoundingClientRect();
      const fantome = cart.cloneNode(true);
      fantome.classList.add("insertion");
      Object.assign(fantome.style, { left: (r.left - zone.left) + "px", top: (r.top - zone.top) + "px", width: r.width + "px", height: r.height + "px" });
      document.querySelector(".lcd.bas").appendChild(fantome);
      cart.style.visibility = "hidden";
      requestAnimationFrame(() => requestAnimationFrame(() => fantome.classList.add("entre")));
      setTimeout(() => { $("menu").classList.add("flash"); demarrer(blob, nomFichier); }, 430);
    } else {
      demarrer(blob, nomFichier);
    }
  }

  async function demarrer(blob, nomFichier) {
    majOnglets();
    systemeJeu = await systemeDuFichier(blob, nomFichier);
    const systeme = SYSTEMES[systemeJeu];
    document.body.classList.add("mode-" + systeme.mode);

    let revele = false;
    const reveler = () => {
      if (revele) return;
      revele = true;
      jeuDemarre = true;
      annoncerJeu();
      document.body.classList.remove("chargement");
      $("menu").classList.add("parti");
      setTimeout(() => { if (!menuOuvert) { $("menu").style.display = "none"; focusJeu(); } }, 350);
    };

    if (!$("game").dataset.sansMenu) {
      $("game").dataset.sansMenu = "1";
      $("game").addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); }, true);
    }
    window.EJS_player = "#game";
    window.EJS_core = systeme.coeur;
    window.EJS_gameName = nomLisible(nomFichier);
    window.EJS_gameUrl = URL.createObjectURL(blob);
    window.EJS_pathtodata = CDN;
    window.EJS_startOnLoaded = true;
    window.EJS_defaultControls = construireControles();
    window.EJS_defaultOptions = systemeJeu === "nds" ? { desmume_screens_gap: "64", desmume_screens_layout: "top/bottom" } : {};
    window.EJS_gameID = PRESETS[presetChoisi].gameId;
    window.EJS_ready = () => setTimeout(reveler, 150);
    window.EJS_volume = volume / 100;
    window.EJS_onGameStart = () => { reveler(); restaurerSram(); appliquerVolume(); setTimeout(focusJeu, 100); };
    // Tout se règle depuis la console : on masque les boutons et le menu clic droit d'EmulatorJS.
    window.EJS_Buttons = Object.fromEntries(["playPause", "restart", "mute", "settings", "fullscreen", "saveState", "loadState",
      "screenRecord", "gamepad", "cheat", "volumeSlider", "saveSavFiles", "loadSavFiles", "quickSave", "quickLoad", "screenshot",
      "cacheManager", "exitEmulation", "netplay", "diskButton"].map(b => [b, false]));
    codesJeu = codesDuPreset();
    // Si l'émulateur attend un clic (son bloqué), on montre son écran quand même.
    setTimeout(reveler, 12000);

    // Garder l'écran allumé : refusé par certains navigateurs, sans conséquence.
    try { if ("wakeLock" in navigator) Promise.resolve(navigator.wakeLock.request("screen")).catch(() => {}); } catch (e) {}

    const script = document.createElement("script");
    script.src = CDN + "loader.js";
    script.onerror = () => {
      jeuActif = false;
      document.body.classList.remove("chargement");
      majOnglets();
      $("message-haut").textContent = "Choisis une cartouche sur l'écran du bas.";
      $("erreur").textContent = "L'émulateur n'a pas pu se charger. Vérifie ta connexion, puis réessaie.";
      afficherCartouches();
    };
    discordPret.then(() => document.body.appendChild(script));
  }

  // ---------- Salon du vocal (canapé partagé) et sauvegardes dans le cloud ----------
  // L'hôte fait tourner le jeu et diffuse son écran ; les autres regardent et peuvent
  // recevoir la manette. Tout passe par le serveur de l'Activité (/.proxy/api).
  const API = "/.proxy/api";
  const salon = {
    etat: DANS_DISCORD ? "connexion" : "hors-discord",
    erreur: "",
    jeton: null,
    moi: null,
    ws: null,
    tentative: 0,
    infos: { joueurs: [], parties: [], hote: null, manette: null, jeu: null, pause: false, spectateurs: [] },
    regarde: null,            // hôte de la partie que tu regardes
    demandes: new Set(),
    listes: new Map(),        // jeux des autres joueurs (noms seulement)
    propositions: [],         // jeux que les autres te proposent de lancer
    proposeA: null,           // jeu que tu as proposé : { a, nom }
    donnerManetteA: null,     // à qui donner la manette quand ton jeu démarre
  };
  const moiId = () => salon.moi && salon.moi.id;
  const estHote = () => Boolean(salon.infos.hote) && salon.infos.hote === moiId();
  // Plusieurs parties peuvent tourner dans le salon. « La partie qui te concerne » : la tienne,
  // celle que tu regardes, celle dont tu as la manette, sinon la plus récente.
  function projeter(m) {
    const moi = moiId();
    const parties = m.parties || (m.hote ? [{ hote: m.hote, jeu: m.jeu, manette: m.manette, pause: m.pause, spectateurs: [] }] : []);
    const p = parties.find(x => x.hote === moi) || parties.find(x => x.hote === salon.regarde)
      || parties.find(x => x.manette === moi) || parties[parties.length - 1] || null;
    return { joueurs: m.joueurs || [], parties, hote: p ? p.hote : null, manette: p ? p.manette : null, jeu: p ? p.jeu : null, pause: p ? Boolean(p.pause) : false,
      spectateurs: (p && p.spectateurs) || [], relais: (p && (p.relais || p.spectateurs)) || [] };
  }
  const nomDe = id => { const j = salon.infos.joueurs.find(x => x.id === id); return j ? j.nom : "Quelqu'un"; };

  let derniereBulle = { texte: "", t: 0 };
  function bulle(texte) {
    const t = Date.now();
    if (texte === derniereBulle.texte && t - derniereBulle.t < 4500) return;
    derniereBulle = { texte, t };
    const b = $("bulle");
    b.hidden = true; b.textContent = texte; void b.offsetWidth; b.hidden = false;
    clearTimeout(bulle.minuteur);
    bulle.minuteur = setTimeout(() => { b.hidden = true; }, 4300);
  }

  async function connecterDiscord() {
    majSalon();
    try {
      await discordPret;
      if (!window.discordSdk) throw new Error("Le kit Discord n'a pas démarré.");
      const serveur = await fetch(API + "/etat").then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (!serveur) throw new Error("Le serveur du salon n'est pas encore en ligne.");
      if (!serveur.connexionDiscord) throw new Error("Le serveur attend encore le secret Discord.");
      // « guilds » permet au serveur de vérifier que tu es bien membre du serveur Discord de la console.
      const demande = { client_id: CONFIG.discordApplicationId, response_type: "code", state: "", scope: ["identify", "guilds"] };
      let code;
      try { ({ code } = await discordSdk.commands.authorize({ ...demande, prompt: "none" })); }
      catch (e) { ({ code } = await discordSdk.commands.authorize(demande)); }
      const r = await fetch(API + "/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json().catch(() => ({}));
      if (!d.access_token) throw new Error(d.erreur || "Discord a refusé la connexion.");
      const auth = await discordSdk.commands.authenticate({ access_token: d.access_token });
      salon.jeton = d.access_token;
      salon.moi = { id: auth.user.id, nom: auth.user.global_name || auth.user.username };
      await ouvrirSalle();
      if (salon.etat === "refuse") { salon.jeton = null; return; }
      if (jeuDemarre) verifierCloudEnCours();
      synchroniserLudotheque();
    } catch (e) {
      salon.etat = "indisponible";
      salon.erreur = (e && e.message) || "Connexion impossible.";
      majSalon();
    }
  }

  // Un ticket d'une minute, demandé avec le jeton : le jeton ne passe jamais dans l'adresse du salon.
  async function ouvrirSalle() {
    let ticket = null;
    try {
      const r = await fetch(API + "/ticket", {
        method: "POST",
        headers: { Authorization: "Bearer " + salon.jeton, "Content-Type": "application/json" },
        body: JSON.stringify({ instance: discordSdk.instanceId, guilde: discordSdk.guildId || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 403) {
        salon.etat = "refuse";
        salon.erreur = d.erreur || "Réservé aux membres du serveur Discord.";
        majSalon();
        return;
      }
      ticket = d.ticket || null;
    } catch (e) {}
    if (!ticket) {
      salon.etat = "deconnecte";
      majSalon();
      setTimeout(ouvrirSalle, Math.min(15000, 1000 * 2 ** salon.tentative++));
      return;
    }
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + API + "/salle/"
      + encodeURIComponent(discordSdk.instanceId) + "?ticket=" + encodeURIComponent(ticket);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    salon.ws = ws;
    ws.onopen = () => { salon.etat = "connecte"; salon.tentative = 0; majSalon(); envoyerMaListe(true); };
    ws.onmessage = e => {
      if (typeof e.data === "string") { try { recevoirMessage(JSON.parse(e.data)); } catch (err) {} }
      else recevoirImage(e.data);
    };
    ws.onclose = () => {
      if (salon.ws !== ws) return;
      salon.ws = null;
      salon.etat = "deconnecte";
      arreterDeRegarder();
      majSalon();
      setTimeout(ouvrirSalle, Math.min(15000, 1000 * 2 ** salon.tentative++));
    };
  }
  function envoyerSalon(message) {
    if (!salon.ws || salon.ws.readyState !== 1) return;
    salon.ws.send(message instanceof Blob || message instanceof ArrayBuffer ? message : JSON.stringify(message));
  }

  function recevoirMessage(m) {
    if (m.t === "etat") {
      const avant = salon.infos;
      if (salon.regarde && !(m.parties || []).some(p => p.hote === salon.regarde)) salon.regarde = null;
      m = salon.infos = projeter(m);
      const presents = new Set(m.joueurs.map(j => j.id));
      [...salon.listes.keys()].forEach(id => { if (!presents.has(id)) salon.listes.delete(id); });
      salon.propositions = salon.propositions.filter(p => presents.has(p.de.id));
      if (m.joueurs.length > avant.joueurs.length) envoyerMaListe(true);
      // Ton pote lance le jeu que tu lui as proposé : tu regardes directement, la manette arrive.
      if (salon.proposeA && m.parties.some(p => p.hote === salon.proposeA.a) && !jeuActif && !spectateur) {
        const hote = salon.proposeA.a;
        salon.proposeA = null;
        setTimeout(() => regarder(hote), 200);
      }
      // Tu viens de lancer un jeu proposé : la manette part chez celui qui l'a proposé.
      if (salon.donnerManetteA && m.hote === moiId() && presents.has(salon.donnerManetteA)) {
        envoyerSalon({ t: "manette", a: salon.donnerManetteA });
        salon.donnerManetteA = null;
      }
      if (avant.manette !== m.manette) relacherTouchesDistantes();
      if (spectateur && m.hote !== avant.hote) {
        arreterDeRegarder();
        bulle(nomDe(avant.hote) === "Quelqu'un" ? "La partie est terminée." : avant.jeu ? "Fin de la partie de " + avant.jeu + "." : "La partie est terminée.");
      }
      // Nouvelles parties lancées par les autres
      m.parties.filter(p => p.hote !== moiId() && !(avant.parties || []).some(a => a.hote === p.hote)).forEach(p => {
        bulle(nomDe(p.hote) + " joue à " + (p.jeu || "un jeu") + ". MENU, puis Salon pour regarder.");
        if (ongletActif !== "salon") $("point-salon").hidden = false;
        if (!jeuActif && !spectateur) $("message-haut").textContent = nomDe(p.hote) + " joue à " + (p.jeu || "un jeu") + ". Ouvre l'onglet Salon pour regarder.";
      });
      if (!m.hote && !jeuActif) $("message-haut").textContent = "Choisis une cartouche sur l'écran du bas.";
      if (m.manette === moiId() && avant.manette !== m.manette && m.hote && m.hote !== moiId()) bulle("Tu as la manette !");
      if (m.manette !== moiId() && avant.manette === moiId() && m.hote && m.hote !== moiId()) bulle("La manette est repartie chez " + nomDe(m.manette) + ".");
      if (jeuDemarre && !m.parties.some(p => p.hote === moiId())) annoncerJeu();
      majDirectHote();
      majSalon();
      afficherCatalogue();
    } else if (m.t === "demande") {
      salon.demandes.add(m.de.id);
      bulle(m.de.nom + " demande la manette. MENU, puis Salon pour la lui donner.");
      if (ongletActif !== "salon") $("point-salon").hidden = false;
      majSalon();
    } else if (m.t === "touche") {
      if (estHote()) toucheDistante(m.b, m.e);
    } else if (m.t === "tactile") {
      if (estHote()) tactileDistant(m);
    } else if (m.t === "liste") {
      salon.listes.set(m.de, m.jeux || []);
      majSalon();
      afficherCatalogue();
    } else if (m.t === "propose") {
      salon.propositions = salon.propositions.filter(p => !(p.de.id === m.de.id && p.jeu.id === m.jeu.id));
      salon.propositions.unshift(m);
      bulle(m.de.nom + " te propose " + m.jeu.nom + ". MENU, puis Salon pour le lancer.");
      if (ongletActif !== "salon") $("point-salon").hidden = false;
      majSalon();
    } else if (m.t === "rtc") {
      recevoirRtc(m).catch(() => {});
    } else if (m.t === "refus") {
      bulle(m.raison + " Ta partie reste en solo.");
    }
  }

  function annoncerJeu() {
    if (salon.etat === "connecte" && jeuDemarre) envoyerSalon({ t: "hote", jeu: nomJeu });
  }

  // Hôte : capture de l'écran du jeu, 20 images par seconde, seulement s'il y a du monde.
  let toileCapture = null, encodage = false;
  setInterval(() => {
    if (!estHote() || !jeuDemarre || menuOuvert || encodage || !salon.infos.relais.length) return;
    if (!salon.ws || salon.ws.readyState !== 1 || salon.ws.bufferedAmount > 256 * 1024) return;
    const source = document.querySelector("#game canvas");
    if (!source || !source.width) return;
    if (!toileCapture) { toileCapture = document.createElement("canvas"); toileCapture.width = 256; toileCapture.height = 448; }
    dessinerJeu(toileCapture.getContext("2d"), source);
    encodage = true;
    toileCapture.toBlob(b => { encodage = false; if (b) envoyerSalon(b); }, "image/jpeg", 0.75);
  }, 50);

  // Hôte : touches et tactile envoyés par le joueur qui a la manette.
  const touchesDistantes = new Set();
  function toucheDistante(b, enfonce) {
    if (menuOuvert || !Number.isInteger(b) || b < 0 || b > 11) return;
    if (enfonce) touchesDistantes.add(b); else touchesDistantes.delete(b);
    envoyerTouche(enfonce ? "keydown" : "keyup", b);
  }
  function relacherTouchesDistantes() {
    touchesDistantes.forEach(b => envoyerTouche("keyup", b));
    touchesDistantes.clear();
  }
  function tactileDistant(m) {
    if (menuOuvert || systemeJeu !== "nds" || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    const c = document.querySelector("#game canvas");
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = r.left + Math.min(1, Math.max(0, m.x)) * r.width;
    const y = r.top + (256 + Math.min(1, Math.max(0, m.y)) * 192) / 448 * r.height;
    const type = m.e === "bas" ? "mousedown" : m.e === "haut" ? "mouseup" : "mousemove";
    c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: m.e === "haut" ? 0 : 1, view: window }));
  }

  // ---------- Diffusion directe (WebRTC) : vidéo et son de l'hôte vers chaque spectateur ----------
  // Le salon sert seulement à présenter les deux consoles. Si la connexion directe échoue
  // (réseau, Discord), le spectateur reste sur les images relayées par le serveur, sans le son.
  // Image du jeu dans une toile 256 × 448 (les deux écrans de la DS, écart compris).
  // GBA : 240 × 160 au centre de l'écran du haut ; Game Boy : agrandi à la hauteur de l'écran du haut.
  const ZONES_ECRAN = { gba: [8, 16, 240, 160], gb: [21.333, 0, 213.333, 192] };
  function dessinerJeu(g, source) {
    const zone = ZONES_ECRAN[SYSTEMES[systemeJeu].mode];
    if (!zone) return g.drawImage(source, 0, 0, 256, 448);
    g.fillStyle = "#000"; g.fillRect(0, 0, 256, 448);
    g.drawImage(source, ...zone);
  }
  const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
  const pairs = new Map();          // chez l'hôte : spectateur → connexion
  const echecsDirects = new Set();  // spectateurs pour qui le direct a échoué (on ne réessaie pas en boucle)
  let fluxDirect = null, boucleDirecte = 0;
  function fluxHote() {
    if (fluxDirect) return fluxDirect;
    const toile = document.createElement("canvas");
    toile.width = 256; toile.height = 448;
    const g = toile.getContext("2d");
    const dessiner = () => {
      const source = document.querySelector("#game canvas");
      if (source && source.width && !menuOuvert) dessinerJeu(g, source);
      boucleDirecte = requestAnimationFrame(dessiner);
    };
    dessiner();
    fluxDirect = toile.captureStream(30);
    window.__sortiesAudio.forEach(d => d.stream.getAudioTracks().forEach(t => fluxDirect.addTrack(t)));
    return fluxDirect;
  }
  function fermerPairs() {
    pairs.forEach(pc => pc.close());
    pairs.clear();
    if (fluxDirect) { fluxDirect.getVideoTracks().forEach(t => t.stop()); fluxDirect = null; cancelAnimationFrame(boucleDirecte); }
  }
  function majDirectHote() {
    if (!estHote() || typeof RTCPeerConnection !== "function") { if (pairs.size || fluxDirect) fermerPairs(); return; }
    const voulus = new Set(salon.infos.spectateurs);
    for (const [id, pc] of pairs) if (!voulus.has(id)) { pc.close(); pairs.delete(id); }
    echecsDirects.forEach(id => { if (!voulus.has(id)) echecsDirects.delete(id); });
    for (const id of voulus) if (!pairs.has(id) && !echecsDirects.has(id)) ouvrirPairHote(id).catch(() => {});
    if (!pairs.size && fluxDirect) fermerPairs();
  }
  async function ouvrirPairHote(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pairs.set(id, pc);
    const flux = fluxHote();
    flux.getTracks().forEach(t => pc.addTrack(t, flux));
    pc.onicecandidate = e => { if (e.candidate) envoyerSalon({ t: "rtc", a: id, d: { candidate: e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && pairs.get(id) === pc) { echecsDirects.add(id); pc.close(); pairs.delete(id); }
    };
    await pc.setLocalDescription(await pc.createOffer());
    envoyerSalon({ t: "rtc", a: id, d: { description: pc.localDescription.toJSON() } });
  }

  let pairSpectateur = null, sonCoupe = false;
  async function recevoirRtc(m) {
    const d = m.d || {};
    if (estHote()) {
      const pc = pairs.get(m.de);
      if (!pc) return;
      if (d.description && d.description.type === "answer") await pc.setRemoteDescription(d.description);
      else if (d.candidate) await pc.addIceCandidate(d.candidate).catch(() => {});
      return;
    }
    if (!spectateur || m.de !== salon.regarde || typeof RTCPeerConnection !== "function") return;
    if (d.description && d.description.type === "offer") {
      fermerPairSpectateur();
      const pc = pairSpectateur = new RTCPeerConnection({ iceServers: ICE });
      const hote = m.de;
      pc.onicecandidate = e => { if (e.candidate) envoyerSalon({ t: "rtc", a: hote, d: { candidate: e.candidate.toJSON() } }); };
      pc.ontrack = e => afficherVideo(e.streams[0]);
      pc.onconnectionstatechange = () => {
        if (pc !== pairSpectateur) return;
        if (pc.connectionState === "connected") envoyerSalon({ t: "direct", oui: true });
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) { envoyerSalon({ t: "direct", oui: false }); cacherVideo(); }
      };
      await pc.setRemoteDescription(d.description);
      await pc.setLocalDescription(await pc.createAnswer());
      envoyerSalon({ t: "rtc", a: hote, d: { description: pc.localDescription.toJSON() } });
    } else if (d.candidate && pairSpectateur) {
      await pairSpectateur.addIceCandidate(d.candidate).catch(() => {});
    }
  }
  function afficherVideo(flux) {
    const v = $("video-distante");
    if (v.srcObject !== flux) v.srcObject = flux;
    v.hidden = false;
    v.muted = false;
    v.play().then(() => { sonCoupe = false; majSalon(); }).catch(() => {
      // Le navigateur refuse le son sans appui : on lance sans le son, un appui sur l'écran le remet.
      v.muted = true; sonCoupe = true;
      v.play().catch(() => {});
      majSalon();
    });
  }
  function remettreLeSon() {
    if (!sonCoupe) return;
    const v = $("video-distante");
    v.muted = false;
    v.play().then(() => { sonCoupe = false; majSalon(); }).catch(() => {});
  }
  function cacherVideo() {
    const v = $("video-distante");
    v.hidden = true;
    v.srcObject = null;
    sonCoupe = false;
  }
  function fermerPairSpectateur() {
    if (pairSpectateur) { const pc = pairSpectateur; pairSpectateur = null; pc.close(); }
    cacherVideo();
  }

  // Spectateur : affichage de l'écran de l'hôte.
  let imageEnCours = false;
  function recevoirImage(donnees) {
    if (!spectateur || imageEnCours) return;
    imageEnCours = true;
    createImageBitmap(new Blob([donnees], { type: "image/jpeg" }))
      .then(img => { $("ecran-distant").getContext("2d").drawImage(img, 0, 0, 256, 448); if (img.close) img.close(); })
      .catch(() => {})
      .finally(() => { imageEnCours = false; });
  }

  // Spectateur : envoi des touches quand on a la manette.
  const touchesSpectateur = new Set();
  function toucheSpectateur(b, enfonce) {
    if (!spectateur || menuOuvert) return;
    if (enfonce === touchesSpectateur.has(b)) return;
    if (salon.infos.manette !== moiId()) {
      if (enfonce) bulle("Pour jouer, demande la manette : MENU, puis Salon.");
      return;
    }
    if (enfonce) touchesSpectateur.add(b); else touchesSpectateur.delete(b);
    envoyerSalon({ t: "touche", b, e: enfonce ? 1 : 0 });
  }
  function relacherToutSpectateur() {
    touchesSpectateur.forEach(b => envoyerSalon({ t: "touche", b, e: 0 }));
    touchesSpectateur.clear();
  }
  const INDEX_MANETTE = { BUTTON_1: 0, BUTTON_2: 1, BUTTON_3: 2, BUTTON_4: 3, LEFT_TOP_SHOULDER: 4, RIGHT_TOP_SHOULDER: 5, SELECT: 8, START: 9, DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15 };
  function carteManette() {
    const carte = {};
    Object.entries({ ...MANETTE_COMMUNS, ...MANETTES[manetteChoisie].boutons }).forEach(([id, nom]) => { carte[id] = INDEX_MANETTE[nom]; });
    return carte;
  }

  // Spectateur : écran tactile (écran du bas de l'image reçue).
  const ecranDistant = $("ecran-distant");
  let doigtPose = false, dernierMouvement = 0;
  function positionTactile(e) {
    const r = ecranDistant.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: ((e.clientY - r.top) / r.height * 448 - 256) / 192 };
  }
  ecranDistant.addEventListener("pointerdown", e => {
    remettreLeSon();
    const p = positionTactile(e);
    if (p.y < 0 || p.y > 1) return;
    if (salon.infos.manette !== moiId()) { bulle("Pour jouer, demande la manette : MENU, puis Salon."); return; }
    doigtPose = true;
    try { ecranDistant.setPointerCapture(e.pointerId); } catch (err) {}
    envoyerSalon({ t: "tactile", e: "bas", ...p });
  });
  ecranDistant.addEventListener("pointermove", e => {
    if (!doigtPose || performance.now() - dernierMouvement < 30) return;
    dernierMouvement = performance.now();
    envoyerSalon({ t: "tactile", e: "bouge", ...positionTactile(e) });
  });
  const leverDoigt = e => {
    if (!doigtPose) return;
    doigtPose = false;
    envoyerSalon({ t: "tactile", e: "haut", ...positionTactile(e) });
  };
  ecranDistant.addEventListener("pointerup", leverDoigt);
  ecranDistant.addEventListener("pointercancel", leverDoigt);

  function regarder(hote) {
    hote = typeof hote === "string" ? hote : salon.infos.hote;
    if (!hote || hote === moiId() || jeuActif) return;
    if (spectateur && salon.regarde === hote) return;
    if (spectateur) { relacherToutSpectateur(); if (salon.infos.manette === moiId()) envoyerSalon({ t: "rendre" }); }
    fermerPairSpectateur();
    salon.regarde = hote;
    envoyerSalon({ t: "regarder", hote });
    salon.infos = projeter(salon.infos);
    spectateur = true;
    document.body.classList.add("spectateur");
    const c = $("ecran-distant");
    c.hidden = false;
    const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, 256, 448);
    menuOuvert = true;
    fermerPause();
    majOnglets();
    majSalon();
  }
  function arreterDeRegarder() {
    if (!spectateur) return;
    relacherToutSpectateur();
    if (salon.infos.manette === moiId()) envoyerSalon({ t: "rendre" });
    fermerPairSpectateur();
    salon.regarde = null;
    envoyerSalon({ t: "regarder", hote: null });
    salon.infos = projeter(salon.infos);
    spectateur = false;
    document.body.classList.remove("spectateur", "menu-ouvert");
    $("ecran-distant").hidden = true;
    menuOuvert = false;
    const m = $("menu");
    m.style.display = "";
    m.classList.remove("parti");
    majOnglets();
    afficherOnglet("salon");
  }

  function majSalon() {
    const i = salon.infos, moi = moiId(), nb = i.joueurs.length;
    $("salon-compte").textContent = salon.etat === "connecte" ? (nb <= 1 ? "1 joueur" : nb + " joueurs") : "";
    let sous = "", titre = "", message = "";
    if (salon.etat === "hors-discord") { titre = "Hors de Discord"; message = "Lance l'Activité dans un salon vocal pour jouer à plusieurs."; }
    else if (salon.etat === "connexion") { titre = "Connexion…"; message = "Connexion au salon vocal en cours."; }
    else if (salon.etat === "indisponible") { titre = "Indisponible"; message = salon.erreur + " Tu peux jouer en solo en attendant."; }
    else if (salon.etat === "refuse") { titre = "Accès réservé"; message = salon.erreur + " Tu peux jouer en solo, sans cloud ni salon."; }
    else if (salon.etat === "deconnecte") { titre = "Reconnexion…"; message = "La connexion au salon a coupé. Nouvel essai en cours."; }
    else if (!i.hote) { sous = nb > 1 ? "Personne ne joue" : "Tu es seul ici"; titre = "Salon libre"; message = "Lance un jeu : les autres pourront regarder et prendre la manette."; }
    else if (i.hote === moi) { sous = "Tu diffuses" + (i.spectateurs.length ? ", " + i.spectateurs.length + (i.spectateurs.length > 1 ? " regardent" : " regarde") : ""); titre = i.jeu || nomJeu; message = i.manette === moi ? "Tu as la manette. Tu peux la donner à un pote en dessous." : "Manette : " + nomDe(i.manette) + "."; }
    else {
      sous = nomDe(i.hote) + " joue"; titre = i.jeu || "un jeu";
      message = jeuActif ? "Tu joues déjà à ton propre jeu. Quitte-le pour regarder."
        : !spectateur ? "Touche Regarder pour voir son écran."
        : i.manette === moi ? "Tu as la manette." : "Manette : " + nomDe(i.manette) + ". Demande-la en dessous.";
    }
    $("salon-sous").textContent = sous;
    $("salon-titre").textContent = titre;
    $("salon-message").textContent = message;

    const actions = $("actions-salon");
    actions.innerHTML = "";
    const bouton = (texte, action, classe) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "choix " + (classe || "");
      b.textContent = texte;
      b.addEventListener("click", action);
      actions.appendChild(b);
    };
    if (salon.etat === "connecte" && i.hote && i.hote !== moi && !jeuActif) {
      if (spectateur) bouton("Arrêter de regarder", arreterDeRegarder);
      else bouton("Regarder", regarder, "principal");
      if (i.manette === moi) bouton("Rendre la manette", () => envoyerSalon({ t: "rendre" }));
      else bouton("Demander la manette", () => { envoyerSalon({ t: "demande", hote: i.hote }); bulle("Demande envoyée à " + nomDe(i.hote) + "."); });
    }

    const liste = $("liste-joueurs");
    liste.innerHTML = "";
    if (salon.etat === "connecte") {
      i.joueurs.forEach(j => {
        const ligne = document.createElement("div");
        ligne.className = "joueur";
        const rond = document.createElement("span");
        rond.className = "rond"; rond.style.setProperty("--teinte", teinte(j.nom));
        rond.textContent = (j.nom[0] || "?").toUpperCase();
        const qui = document.createElement("span");
        qui.className = "qui"; qui.textContent = j.nom + (j.id === moi ? " (toi)" : "");
        ligne.append(rond, qui);
        const etiquette = (texte, classe) => { const t = document.createElement("span"); t.className = "tag " + (classe || ""); t.textContent = texte; ligne.appendChild(t); };
        if (i.parties.some(p => p.hote === j.id)) etiquette("joue");
        if (j.id === i.manette) etiquette("manette", "manette");
        if (estHote() && j.id !== moi) {
          const b = document.createElement("button");
          b.type = "button";
          if (i.manette === j.id) {
            b.textContent = "Reprendre";
            b.addEventListener("click", () => envoyerSalon({ t: "manette", a: moi }));
          } else {
            b.textContent = "Donner la manette";
            if (salon.demandes.has(j.id)) b.classList.add("demande");
            b.addEventListener("click", () => { salon.demandes.delete(j.id); envoyerSalon({ t: "manette", a: j.id }); });
          }
          ligne.appendChild(b);
        }
        liste.appendChild(ligne);
      });
    }

    if (salon.etat === "connecte") {
      const titreSection = texte => { const t = document.createElement("div"); t.className = "sous-titre"; t.textContent = texte; liste.appendChild(t); };
      const ligneJeu = (texteNom, texteDetail, texteBouton, action, vif) => {
        const ligne = document.createElement("div");
        ligne.className = "joueur";
        const rond = document.createElement("span");
        rond.className = "rond"; rond.style.setProperty("--teinte", teinte(texteNom)); rond.textContent = initiales(texteNom).slice(0, 2);
        const qui = document.createElement("span");
        qui.className = "qui"; qui.textContent = texteNom + (texteDetail ? " · " + texteDetail : "");
        const b = document.createElement("button");
        b.type = "button"; b.textContent = texteBouton;
        if (vif) b.classList.add("demande");
        b.addEventListener("click", action);
        ligne.append(rond, qui, b);
        liste.appendChild(ligne);
      };
      const autresParties = i.parties.filter(p => p.hote !== moi && p.hote !== i.hote);
      if (autresParties.length && !jeuActif) {
        titreSection("Autres parties en cours");
        autresParties.forEach(p => ligneJeu(p.jeu || "Un jeu", nomDe(p.hote) + (p.spectateurs.length ? ", " + p.spectateurs.length + " spectateur" + (p.spectateurs.length > 1 ? "s" : "") : ""), "Regarder", () => regarder(p.hote)));
      }
      if (salon.propositions.length && !jeuActif) {
        titreSection("On te propose");
        salon.propositions.forEach(p => ligneJeu(p.jeu.nom, p.de.nom, "Lancer", () => lancerProposition(p), true));
      }
      const autres = [...salon.listes].filter(([id, jeux]) => id !== moi && jeux.length && i.joueurs.some(j => j.id === id));
      if (autres.length && !jeuActif) {
        const n = autres.reduce((t, [, jeux]) => t + jeux.length, 0);
        titreSection("Jeux de tes potes");
        const b = document.createElement("button");
        b.type = "button"; b.className = "choix centre";
        b.textContent = (n === 1 ? "1 jeu" : n + " jeux") + " au catalogue";
        b.addEventListener("click", () => { afficherOnglet("jeux"); afficherVueJeux("catalogue"); });
        liste.appendChild(b);
      }
    }

    const pastilles = $("pastilles-spectateur");
    pastilles.innerHTML = "";
    const pastille = (texte, vif) => { const p = document.createElement("span"); p.textContent = texte; if (vif) p.className = "vif"; pastilles.appendChild(p); };
    if (spectateur) {
      pastille("Écran de " + nomDe(i.hote));
      if (pairSpectateur && pairSpectateur.connectionState === "connected") pastille(sonCoupe ? "Touche l'écran pour le son" : "En direct, avec le son", sonCoupe);
      if (i.manette === moi) pastille("Tu as la manette", true);
      if (i.pause) pastille("En pause");
    } else if (estHote() && nb > 1) {
      pastille("En direct");
      if (i.manette !== moi) pastille("Manette : " + nomDe(i.manette), true);
    }
    pastilles.hidden = !pastilles.children.length;
  }

  // Ta liste de jeux (noms seulement) pour les autres joueurs du salon.
  let derniereListe = "";
  async function envoyerMaListe(forcer) {
    if (salon.etat !== "connecte") return;
    const locaux = await listerCartouches();
    const jeux = locaux.filter(c => c.catalogue).map(c => ({ id: c.id, nom: nomLisible(c.nom) }));
    try {
      for (const d of await jeuxSeulementDansLeCloud(locaux)) if (d.catalogue) jeux.push({ id: "nuage:" + d.id, nom: nomLisible(d.nom) });
    } catch (e) {}
    jeux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    const texte = JSON.stringify(jeux);
    if (!forcer && texte === derniereListe) return;
    derniereListe = texte;
    envoyerSalon({ t: "liste", jeux });
  }

  async function lancerProposition(p) {
    if (jeuActif || spectateur) return;
    salon.propositions = salon.propositions.filter(x => x !== p);
    salon.donnerManetteA = p.de.id;
    fermerPause();
    afficherOnglet("jeux");
    afficherVueJeux("perso");
    if (p.jeu.id.startsWith("nuage:")) {
      const d = ludo.distants.get(p.jeu.id.slice(6));
      if (d) return recupererDuCloud(null, d);
    } else {
      const c = await lireDans("cartouches", p.jeu.id).catch(() => null);
      if (c && c.blob) {
        c.joue = Date.now();
        ecrireDans("cartouches", c).catch(() => {});
        return inserer(document.querySelector(`.cart[data-id="${CSS.escape(c.id)}"]`), c.blob, c.nom, c.id);
      }
    }
    salon.donnerManetteA = null;
    $("erreur").textContent = "Ce jeu n'est plus dans tes cartouches.";
  }

  // Sauvegardes dans le cloud : une par joueur Discord et par jeu.
  const cloud = { derniereSync: 0, erreur: false, attente: null, minuteur: null };
  async function cleJeu(id) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
    return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // null = aucune sauvegarde dans le cloud ; undefined = cloud injoignable.
  async function lireCloud(id) {
    if (!salon.jeton) return undefined;
    try {
      const r = await fetch(API + "/sauvegardes/" + await cleJeu(id), { headers: { Authorization: "Bearer " + salon.jeton } });
      if (r.status === 404) return null;
      if (!r.ok) return undefined;
      return { donnees: new Uint8Array(await r.arrayBuffer()), maj: Number(r.headers.get("X-Maj")) || 0 };
    } catch (e) { return undefined; }
  }
  // On n'envoie rien au cloud tant qu'on ne l'a pas comparé avec la sauvegarde de cet appareil.
  let cloudVerifiePour = null;
  function programmerCloud(id, donnees, maj, urgent) {
    if (!salon.jeton || cloudVerifiePour !== id) return;
    cloud.attente = { id, donnees, maj };
    clearTimeout(cloud.minuteur);
    const delai = urgent ? 0 : Math.max(0, 60000 - (Date.now() - cloud.derniereSync));
    cloud.minuteur = setTimeout(viderCloud, delai);
  }
  async function viderCloud() {
    const a = cloud.attente;
    if (!a || !salon.jeton) return;
    cloud.attente = null;
    try {
      const r = await fetch(API + "/sauvegardes/" + await cleJeu(a.id), {
        method: "PUT", headers: { Authorization: "Bearer " + salon.jeton, "X-Maj": String(a.maj) }, body: a.donnees,
      });
      if (!r.ok && r.status !== 409) throw new Error(r.status);
      cloud.derniereSync = Date.now();
      cloud.erreur = false;
    } catch (e) {
      cloud.erreur = true;
      if (!cloud.attente) { cloud.attente = a; clearTimeout(cloud.minuteur); cloud.minuteur = setTimeout(viderCloud, 30000); }
    }
  }

  // ---------- Ludothèque privée : une copie de tes jeux dans ton cloud, pour toi seul ----------
  const TAILLE_MORCEAU = 1_900_000;
  const ludo = { distants: new Map(), cles: new Map(), file: [], actif: false, plein: false, charge: false, quota: 0, utilise: 0, raison: "" };
  function tailleLisible(octets) {
    if (octets >= 1e9) return (octets / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " Go";
    return Math.max(1, Math.round(octets / 1e6)) + " Mo";
  }

  async function cleLudo(idLocal) {
    if (!ludo.cles.has(idLocal)) ludo.cles.set(idLocal, await cleJeu("ludo:" + idLocal));
    return ludo.cles.get(idLocal);
  }
  // Appelées dès le premier affichage, avant que le salon soit prêt : on reste prudent.
  function ludoContient(idLocal) {
    try {
      const cle = ludo.cles.get(idLocal);
      const d = cle && ludo.distants.get(cle);
      return Boolean(d && d.recus === d.morceaux);
    } catch (e) { return false; }
  }
  async function jeuxSeulementDansLeCloud(locaux) {
    try { if (!salon.jeton || !ludo.charge) return []; } catch (e) { return []; }
    const clesLocales = new Set();
    for (const c of locaux) clesLocales.add(await cleLudo(c.id));
    return [...ludo.distants.values()].filter(d => d.recus === d.morceaux && !clesLocales.has(d.id));
  }
  async function appelLudo(chemin, options = {}) {
    return fetch(API + "/ludotheque" + chemin, { ...options, headers: { Authorization: "Bearer " + salon.jeton, ...(options.headers || {}) } });
  }
  function majEtatLudo(texte) {
    const el = $("etat-ludo");
    el.textContent = texte || "";
    el.hidden = !texte || vueJeux !== "perso";
  }

  async function chargerListeLudo() {
    const r = await appelLudo("");
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    ludo.distants = new Map(d.jeux.map(j => [j.id, j]));
    ludo.quota = d.quota; ludo.utilise = d.utilise;
    ludo.plein = ludo.plein || d.utilise >= d.quota * 0.98;
    ludo.charge = true;
  }

  async function synchroniserLudotheque() {
    if (!salon.jeton) return;
    // Déjà en cours : on refera un tour à la fin, pour ne pas oublier un jeu ajouté entre-temps.
    if (ludo.actif) { ludo.encore = true; return; }
    ludo.actif = true;
    ludo.encore = false;
    ludo.plein = false; ludo.raison = "";
    try {
      await chargerListeLudo();
      const locaux = await listerCartouches();
      for (const c of locaux) await cleLudo(c.id);
      await accorderCatalogue(locaux);
      await afficherCartouches();
      const aEnvoyer = locaux.filter(c => c.blob && !ludoContient(c.id));
      for (let i = 0; i < aEnvoyer.length; i++) {
        const c = aEnvoyer[i];
        const ok = await envoyerAuCloud(c, i + 1, aEnvoyer.length);
        if (!ok) break;
      }
      await chargerListeLudo();
      await accorderCatalogue(await listerCartouches());
      await afficherCartouches();
      const n = locaux.filter(c => ludoContient(c.id)).length;
      const place = " (" + tailleLisible(ludo.utilise) + " sur " + tailleLisible(ludo.quota) + ")";
      if (ludo.raison === "serveur-plein") majEtatLudo("Le cloud du serveur est plein (10 Go gratuits). Retire des jeux pour en sauvegarder d'autres.");
      else if (ludo.plein) majEtatLudo("Ton cloud est plein" + place + ". Retire des jeux pour en sauvegarder d'autres.");
      else majEtatLudo(n ? (n === 1 ? "Ce jeu est aussi dans ton cloud, rien que pour toi" : "Tes " + n + " jeux sont aussi dans ton cloud, rien que pour toi") + place + "." : "");
    } catch (e) {
      majEtatLudo("Ton cloud ne répond pas. Tes jeux restent sur cet appareil.");
    } finally {
      ludo.actif = false;
      if (ludo.encore) setTimeout(synchroniserLudotheque, 0);
    }
  }

  // « Au catalogue » suit le choix le plus récent, entre cet appareil et ton cloud.
  async function accorderCatalogue(locaux) {
    for (const c of locaux) {
      const d = ludo.distants.get(await cleLudo(c.id));
      if (!d) continue;
      const ici = c.catalogueMaj || 0, la = d.catalogue_maj || 0;
      if (la > ici) {
        if (Boolean(d.catalogue) !== Boolean(c.catalogue)) {
          c.catalogue = Boolean(d.catalogue); c.catalogueMaj = la;
          await ecrireDans("cartouches", c).catch(() => {});
        }
      } else if (ici > la) {
        d.catalogue = c.catalogue ? 1 : 0; d.catalogue_maj = ici;
        await appelLudo("/" + d.id, { method: "POST", headers: { "X-Catalogue": c.catalogue ? "1" : "0", "X-Maj": String(ici) } }).catch(() => {});
      }
    }
  }

  async function envoyerAuCloud(c, rang, total) {
    const cle = await cleLudo(c.id);
    const blob = c.blob;
    const n = Math.ceil(blob.size / TAILLE_MORCEAU);
    const etiquette = total > 1 ? " (" + rang + "/" + total + ")" : "";
    for (let i = 0; i < n; i++) {
      majEtatLudo("Copie dans ton cloud" + etiquette + " : " + nomLisible(c.nom) + "… " + Math.round(i / n * 100) + " %");
      const morceau = blob.slice(i * TAILLE_MORCEAU, (i + 1) * TAILLE_MORCEAU);
      let r;
      try {
        r = await appelLudo("/" + cle + "/" + i, {
          method: "PUT",
          headers: { "X-Nom": encodeURIComponent(c.nom), "X-Taille": String(blob.size), "X-Morceaux": String(n) },
          body: morceau,
        });
      } catch (e) { return false; }
      if (r.status === 507) {
        const d = await r.json().catch(() => ({}));
        ludo.plein = true; ludo.raison = d.raison || "quota";
        return false;
      }
      if (!r.ok) return false;
    }
    return true;
  }

  async function recupererDuCloud(cart, d) {
    if (jeuActif || spectateur || telechargement) return;
    telechargement = true;
    $("erreur").textContent = "";
    document.body.classList.add("chargement");
    const nom = nomLisible(d.nom);
    try {
      // Trois morceaux à la fois, remis dans l'ordre à la fin.
      const morceaux = new Array(d.morceaux);
      let suivant = 0, recus = 0;
      $("message-haut").textContent = "Récupération de " + nom + " depuis ton cloud… 0 %";
      const ouvrier = async () => {
        while (suivant < d.morceaux) {
          const i = suivant++;
          let r = await appelLudo("/" + d.id + "/" + i);
          if (!r.ok) r = await appelLudo("/" + d.id + "/" + i);
          if (!r.ok) throw new Error(r.status);
          morceaux[i] = new Uint8Array(await r.arrayBuffer());
          recus++;
          $("message-haut").textContent = "Récupération de " + nom + " depuis ton cloud… " + Math.round(recus / d.morceaux * 100) + " %";
        }
      };
      await Promise.all([ouvrier(), ouvrier(), ouvrier()]);
      const blob = new Blob(morceaux);
      const idLocal = d.nom + "|" + d.taille;
      ludo.cles.set(idLocal, d.id);
      await ecrireDans("cartouches", { id: idLocal, nom: d.nom, taille: d.taille, ajoute: Date.now(), joue: Date.now(), catalogue: Boolean(d.catalogue), catalogueMaj: d.catalogue_maj || 0, blob }).catch(() => {});
      telechargement = false;
      inserer(cart, blob, d.nom, idLocal);
    } catch (e) {
      telechargement = false;
      document.body.classList.remove("chargement");
      $("message-haut").textContent = MESSAGE_ACCUEIL;
      $("erreur").textContent = "Le jeu n'a pas pu être récupéré depuis ton cloud. Réessaie dans un instant.";
    }
  }

  async function retirerDuCloud(idLocal) {
    if (!salon.jeton) return;
    const cle = await cleLudo(idLocal);
    if (ludo.distants.has(cle)) await supprimerDuCloud(cle);
  }
  async function supprimerDuCloud(cle) {
    try { await appelLudo("/" + cle, { method: "DELETE" }); } catch (e) {}
    ludo.distants.delete(cle);
  }

  if (DANS_DISCORD) connecterDiscord(); else majSalon();
  afficherVueJeux(vueJeux);
  if (!catalogue && !chargementCatalogue) chargerCatalogue();

  // ---------- Navigation dans le menu (manette, croix de la console) ----------
  function elementsNavigables() {
    return [...document.querySelectorAll("#menu button:not([disabled])")].filter(b => {
      if (b.closest("[hidden]")) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  function naviguer(action) {
    if (!action) return;
    document.body.classList.add("nav-manette");
    const liste = elementsNavigables();
    const actuel = liste.includes(document.activeElement) ? document.activeElement : null;
    if (action === "onglet-" || action === "onglet+") {
      const dispo = ongletsDisponibles();
      const i = dispo.indexOf(ongletActif);
      const j = (i + (action === "onglet+" ? 1 : -1) + dispo.length) % dispo.length;
      afficherOnglet(dispo[j]);
      const premier = elementsNavigables().find(b => !b.classList.contains("onglet"));
      if (premier) premier.focus();
      return;
    }
    if (action === "valider") { if (actuel) actuel.click(); return; }
    if (action === "retour") {
      if (menuOuvert) fermerPause();
      else if (ongletActif !== "jeux" && !jeuActif) afficherOnglet("jeux");
      return;
    }
    if (!actuel) { const p = liste.find(b => !b.classList.contains("onglet")) || liste[0]; if (p) p.focus(); return; }
    const a = actuel.getBoundingClientRect();
    const ca = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
    let meilleur = null, score = Infinity;
    liste.forEach(b => {
      if (b === actuel) return;
      const r = b.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = c.x - ca.x, dy = c.y - ca.y;
      let principal, secondaire;
      if (action === "haut") { principal = -dy; secondaire = Math.abs(dx); }
      else if (action === "bas") { principal = dy; secondaire = Math.abs(dx); }
      else if (action === "gauche") { principal = -dx; secondaire = Math.abs(dy); }
      else { principal = dx; secondaire = Math.abs(dy); }
      if (principal <= 2) return;
      const s = principal + secondaire * 2.2;
      if (s < score) { score = s; meilleur = b; }
    });
    if (meilleur) meilleur.focus();
  }

  const precedents = {};
  const repetition = {};
  let boucleLancee = false;
  function boucleManette() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    $("manette-ok").hidden = !pads.length;
    const m = MANETTES[manetteChoisie];
    const maintenant = performance.now();
    pads.forEach(p => {
      const avant = precedents[p.index] || [];
      const appuye = i => !!(p.buttons[i] && p.buttons[i].pressed);
      const nouveau = i => appuye(i) && !avant[i];
      const axeX = p.axes[0] || 0, axeY = p.axes[1] || 0;
      const directions = {
        haut: appuye(12) || axeY < -0.6, bas: appuye(13) || axeY > 0.6,
        gauche: appuye(14) || axeX < -0.6, droite: appuye(15) || axeX > 0.6
      };
      if (menuVisible()) {
        Object.entries(directions).forEach(([dir, actif]) => {
          const cle = p.index + dir;
          if (!actif) { delete repetition[cle]; return; }
          if (!repetition[cle]) { repetition[cle] = maintenant + 380; naviguer(dir); }
          else if (maintenant > repetition[cle]) { repetition[cle] = maintenant + 140; naviguer(dir); }
        });
        if (nouveau(m.valider)) naviguer("valider");
        if (nouveau(m.retour)) naviguer("retour");
        if (nouveau(4)) naviguer("onglet-");
        if (nouveau(5)) naviguer("onglet+");
        if (jeuDemarre && (nouveau(9) || nouveau(16))) fermerPause();
      } else if (jeuDemarre || spectateur) {
        if (nouveau(16) || (appuye(8) && appuye(9) && (nouveau(8) || nouveau(9)))) ouvrirPause();
        else if (spectateur) {
          Object.entries(carteManette()).forEach(([id, i]) => {
            const maintenantAppuye = appuye(i) || (i === 12 && axeY < -0.6) || (i === 13 && axeY > 0.6) || (i === 14 && axeX < -0.6) || (i === 15 && axeX > 0.6);
            toucheSpectateur(Number(id), maintenantAppuye, true);
          });
        }
      }
      precedents[p.index] = p.buttons.map(b => b.pressed);
    });
    if (pads.length) requestAnimationFrame(boucleManette);
    else boucleLancee = false;
  }
  function lancerBoucle() { if (!boucleLancee) { boucleLancee = true; requestAnimationFrame(boucleManette); } }
  window.addEventListener("gamepadconnected", lancerBoucle);
  if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) lancerBoucle();
