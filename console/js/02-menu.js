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

