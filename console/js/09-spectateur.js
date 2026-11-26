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

