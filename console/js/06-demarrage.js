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

