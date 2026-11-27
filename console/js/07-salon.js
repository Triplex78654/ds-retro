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

