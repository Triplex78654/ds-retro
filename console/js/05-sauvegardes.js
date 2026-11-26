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

