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
