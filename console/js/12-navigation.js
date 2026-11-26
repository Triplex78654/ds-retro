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
