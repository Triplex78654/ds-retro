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

