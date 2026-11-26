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

