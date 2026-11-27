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

    // Appli Rétro pour PC : jeux de Documents\Rétro\DS et jeux trouvés sur le PC, lus sur place (rien n'est copié).
    const dejaLa = new Set(liste.map(c => c.id));
    for (const j of await jeuxDuPc()) {
      const id = j.nom + "|" + j.taille; // même identifiant qu'un jeu ajouté à la main : mêmes sauvegardes
      if (dejaLa.has(id)) continue;
      const nom = nomLisible(j.nom);
      const emplacement = document.createElement("div");
      emplacement.className = "emplacement";
      const cart = document.createElement("button");
      cart.type = "button"; cart.className = "cart";
      cart.dataset.id = id;
      cart.title = j.trouve ? "Trouvé sur ton PC" : "Dans ton dossier Rétro";
      cart.style.setProperty("--teinte", teinte(nom));
      cart.setAttribute("aria-label", "Jouer à " + nom);
      const etiquette = document.createElement("span");
      etiquette.className = "etiquette"; etiquette.textContent = initiales(nom);
      const titre = document.createElement("span");
      titre.className = "nom"; titre.textContent = nom;
      cart.append(etiquette, titre);
      marquerSysteme(cart, systemeDuNom(j.nom));
      cart.addEventListener("click", () => jouerDuPc(cart, j.nom, id));
      emplacement.appendChild(cart);
      grille.appendChild(emplacement);
    }

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

  // Jeux DS / GBA / Game Boy que l'appli Rétro a sur le PC (servis par son serveur local).
  async function jeuxDuPc() {
    if (!window.retroApp) return [];
    try {
      const r = await fetch("jeux-pc/ds/", { cache: "no-store" });
      if (!r.ok) return [];
      return (await r.json()).filter(f => !f.dossier && EXTENSIONS.some(ext => f.nom.toLowerCase().endsWith(ext)));
    } catch (e) { return []; }
  }
  async function jouerDuPc(cart, nomFichier, id) {
    $("erreur").textContent = "";
    try {
      const r = await fetch("jeux-pc/ds/" + encodeURIComponent(nomFichier));
      if (!r.ok) throw new Error(r.status);
      inserer(cart, await r.blob(), nomFichier, id);
    } catch (e) {
      $("erreur").textContent = "Ce jeu n'est plus à sa place sur ton PC.";
      afficherCartouches();
    }
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
  // La recherche automatique de l'appli a rangé de nouveaux jeux : la liste se met à jour.
  if (window.retroApp && retroApp.surRecherche) retroApp.surRecherche(p => { if (p.etape === "fini" && p.resultat && p.resultat.ok && !jeuActif) afficherCartouches(); });
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

