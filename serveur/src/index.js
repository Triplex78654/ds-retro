// Serveur de ds-retro (Cloudflare Workers + Durable Objects).
//
// Discord fait passer les requêtes de l'Activité par /.proxy/api/… vers ce Worker
// (mapping d'URL « /api » dans le portail développeur).
//
// Accès : le jeton doit venir de l'appli Discord de ds-retro, et le joueur doit être le propriétaire
// de l'appli ou membre d'un serveur Discord où le propriétaire a ouvert l'Activité.
//
//   POST /token                 échange le code OAuth de Discord contre un jeton (secret côté serveur)
//   POST /ticket                ticket d'une minute pour entrer dans un salon (corps : { instance, guilde })
//   GET  /salle/:instance       WebSocket du salon (?ticket=…) : écran de l'hôte, manette partagée
//   GET  /sauvegardes           liste des sauvegardes du joueur
//   GET  /sauvegardes/:jeu      télécharge une sauvegarde
//   PUT  /sauvegardes/:jeu      envoie une sauvegarde (en-tête X-Maj = date en ms) ; l'ancienne va dans l'historique
//   GET  /sauvegardes/:jeu/versions        anciennes versions d'une sauvegarde
//   GET  /sauvegardes/:jeu/versions/:maj   télécharge une ancienne version
//   GET  /etats/:jeu            état de partie (sauvegarde instantanée, compressée) ; /etats/:jeu/info = date et taille
//   PUT  /etats/:jeu            envoie l'état (en-tête X-Maj), rangé dans R2
//   GET  /ludotheque            jeux personnels du joueur (privés, seulement pour lui ; fichiers dans R2)
//   GET  /ludotheque/:id/:n     télécharge le morceau n d'un jeu
//   PUT  /ludotheque/:id/:n     envoie le morceau n (en-têtes X-Nom, X-Taille, X-Morceaux)
//   POST /ludotheque/:id        met le jeu au catalogue du salon ou l'en retire (en-têtes X-Catalogue = 1 ou 0, X-Maj)
//   DELETE /ludotheque/:id      retire un jeu

import { DurableObject } from "cloudflare:workers";

const DISCORD = "https://discord.com/api";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Maj, X-Nom, X-Taille, X-Morceaux, X-Catalogue",
  "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "X-Maj",
};
const TAILLE_MAX_SAUVEGARDE = 2_000_000;
const QUOTA_SAUVEGARDES = 300_000_000;
const TAILLE_MAX_ETAT = 30_000_000;        // un état DS compressé pèse quelques Mo     // sauvegardes + historique, par joueur
const VERSIONS_GARDEES = 12;               // anciennes versions par jeu, espacées d'au moins 10 min
const ESPACEMENT_VERSIONS = 10 * 60 * 1000;
const TAILLE_MORCEAU = 1_900_000;          // taille d'un morceau de jeu envoyé par la console
const PLAFOND_R2 = 9_500_000_000;          // R2 offre 10 Go par mois : on s'arrête avant pour ne jamais payer
const QUOTA_POTE = 1_000_000_000;          // 1 Go par pote ; le propriétaire de l'app a tout le reste

function json(objet, statut = 200) {
  return new Response(JSON.stringify(objet), { status: statut, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Garde-fou : au plus 60 vérifications de nouveaux jetons ou codes par minute et par instance du
// serveur, pour qu'une avalanche de faux jetons ne fasse pas bloquer le serveur par Discord.
let appelsRecents = [];
function appelDiscordPermis() {
  const maintenant = Date.now();
  appelsRecents = appelsRecents.filter(t => t > maintenant - 60_000);
  if (appelsRecents.length >= 60) return false;
  appelsRecents.push(maintenant);
  return true;
}

// Jeton Discord → joueur. Le jeton doit avoir été créé pour CETTE appli (et non une autre appli Discord).
const cacheJoueurs = new Map();
async function joueurDepuisJeton(jeton, env, local) {
  if (!jeton || jeton.length > 200) return null;
  if (env.DEV_SANS_AUTH === "1" && local && jeton.startsWith("dev:")) {
    const [, id, guilde] = jeton.split(":");
    return { id, nom: "Joueur " + id, guildes: [guilde || "100000000000000001"] };
  }
  const memo = cacheJoueurs.get(jeton);
  if (memo && memo.expire > Date.now()) return memo.joueur;
  if (!appelDiscordPermis()) return null;
  const auth = { headers: { Authorization: "Bearer " + jeton } };
  let joueur = null;
  try {
    const r = await fetch(DISCORD + "/oauth2/@me", auth);
    const d = r.ok ? await r.json() : null;
    if (d && d.application && d.application.id === env.DISCORD_CLIENT_ID && d.user) {
      let guildes = [];
      if ((d.scopes || []).includes("guilds")) {
        const g = await fetch(DISCORD + "/users/@me/guilds", auth);
        if (g.ok) guildes = (await g.json()).map(x => x.id);
      }
      joueur = { id: d.user.id, nom: (d.user.global_name || d.user.username || "Joueur").slice(0, 32), guildes };
    }
  } catch (e) {}
  if (cacheJoueurs.size > 1000) cacheJoueurs.clear();
  cacheJoueurs.set(jeton, { joueur, expire: Date.now() + (joueur ? 10 : 1) * 60 * 1000 });
  return joueur;
}

// Serveurs Discord autorisés : ceux où le propriétaire a ouvert l'Activité.
const memoGuildes = { liste: null, expire: 0 };
function registre(env) {
  return env.REGISTRE.get(env.REGISTRE.idFromName("global"));
}
async function guildesAutorisees(env) {
  if (memoGuildes.liste && memoGuildes.expire > Date.now()) return memoGuildes.liste;
  memoGuildes.liste = await registre(env).guildes();
  memoGuildes.expire = Date.now() + 60_000;
  return memoGuildes.liste;
}
async function estAutorise(joueur, env) {
  if (joueur.id === await idProprietaire(env)) return true;
  const ok = await guildesAutorisees(env);
  return joueur.guildes.some(g => ok.includes(g));
}

// Joueur connecté et autorisé, ou réponse d'erreur.
async function joueurAutorise(req, env, url) {
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const joueur = await joueurDepuisJeton(jeton, env, estLocal(url));
  if (!joueur) return { refus: json({ erreur: "Non connecté." }, 401) };
  if (!await estAutorise(joueur, env)) return { refus: json({ erreur: "Réservé aux membres du serveur Discord." }, 403) };
  return { joueur };
}
const estLocal = url => ["localhost", "127.0.0.1"].includes(url.hostname);

// Ticket signé (HMAC) valable une minute pour un salon : le jeton Discord ne passe jamais dans une adresse.
const b64 = octets => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function cleTickets(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode("tickets:" + env.DISCORD_CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function creerTicket(joueur, instance, env) {
  const corps = b64(new TextEncoder().encode(JSON.stringify({ id: joueur.id, nom: joueur.nom, i: instance, exp: Date.now() + 60_000 })));
  const signature = await crypto.subtle.sign("HMAC", await cleTickets(env), new TextEncoder().encode(corps));
  return corps + "." + b64(signature);
}
async function lireTicket(ticket, instance, env) {
  const [corps, signature] = String(ticket || "").split(".");
  if (!corps || !signature) return null;
  const attendue = b64(await crypto.subtle.sign("HMAC", await cleTickets(env), new TextEncoder().encode(corps)));
  if (attendue.length !== signature.length) return null;
  let difference = 0;
  for (let i = 0; i < attendue.length; i++) difference |= attendue.charCodeAt(i) ^ signature.charCodeAt(i);
  if (difference) return null;
  try {
    const d = JSON.parse(atob(corps.replace(/-/g, "+").replace(/_/g, "/")));
    if (d.i !== instance || !(d.exp > Date.now())) return null;
    return { id: d.id, nom: d.nom };
  } catch (e) { return null; }
}

// Le propriétaire de l'application Discord (toi) a le gros quota.
// PROPRIETAIRE_ID peut le fixer à la main ; sinon on le demande à Discord une fois par heure.
const memoProprio = { id: null, expire: 0 };
async function idProprietaire(env) {
  if (env.PROPRIETAIRE_ID) return env.PROPRIETAIRE_ID;
  if (memoProprio.expire > Date.now()) return memoProprio.id;
  memoProprio.expire = Date.now() + 60 * 60 * 1000;
  try {
    const r = await fetch(DISCORD + "/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(env.DISCORD_CLIENT_ID + ":" + env.DISCORD_CLIENT_SECRET),
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "identify" }),
    });
    const d = await r.json();
    if (!d.access_token) throw new Error("jeton");
    const u = await (await fetch(DISCORD + "/users/@me", { headers: { Authorization: "Bearer " + d.access_token } })).json();
    memoProprio.id = u.id || null;
  } catch (e) {
    memoProprio.id = null;
    memoProprio.expire = Date.now() + 5 * 60 * 1000;
  }
  return memoProprio.id;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const chemin = url.pathname.replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";

    if (chemin === "/" || chemin === "/etat") {
      return json({ ok: true, connexionDiscord: Boolean(env.DISCORD_CLIENT_SECRET), proprietaireReconnu: Boolean(await idProprietaire(env)) });
    }

    if (chemin === "/token" && req.method === "POST") {
      if (!env.DISCORD_CLIENT_SECRET) return json({ erreur: "Le secret Discord n'est pas encore configuré." }, 503);
      const { code } = await req.json().catch(() => ({}));
      if (!code || typeof code !== "string" || code.length > 100) return json({ erreur: "Code manquant." }, 400);
      if (!appelDiscordPermis()) return json({ erreur: "Trop de connexions, réessaie dans une minute." }, 429);
      const r = await fetch(DISCORD + "/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.access_token) return json({ erreur: "Discord a refusé la connexion." }, 400);
      return json({ access_token: d.access_token });
    }

    if (chemin === "/ticket" && req.method === "POST") {
      const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const joueur = await joueurDepuisJeton(jeton, env, estLocal(url));
      if (!joueur) return json({ erreur: "Non connecté." }, 401);
      const { instance, guilde } = await req.json().catch(() => ({}));
      if (typeof instance !== "string" || !/^[\w-]{1,100}$/.test(instance)) return json({ erreur: "Salon inconnu." }, 400);
      // Le propriétaire ouvre l'Activité dans un de ses serveurs : ses membres y ont accès.
      if (typeof guilde === "string" && /^\d{5,25}$/.test(guilde) && joueur.guildes.includes(guilde) && joueur.id === await idProprietaire(env)) {
        await registre(env).ajouterGuilde(guilde);
        memoGuildes.expire = 0;
      }
      if (!await estAutorise(joueur, env)) return json({ erreur: "Réservé aux membres du serveur Discord." }, 403);
      return json({ ticket: await creerTicket(joueur, instance, env) });
    }

    let m = chemin.match(/^\/salle\/([\w-]{1,100})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return json({ erreur: "WebSocket attendu." }, 426);
      const joueur = await lireTicket(url.searchParams.get("ticket"), m[1], env);
      if (!joueur) return json({ erreur: "Ticket invalide ou expiré." }, 401);
      const salle = env.SALLES.get(env.SALLES.idFromName(m[1]));
      const entetes = new Headers(req.headers);
      entetes.set("X-Joueur", JSON.stringify(joueur));
      return salle.fetch(new Request(req, { headers: entetes }));
    }

    m = chemin.match(/^\/sauvegardes(?:\/([a-f0-9]{8,64})(?:\/versions(?:\/(\d{1,16}))?)?)?$/);
    if (m) {
      const { joueur, refus } = await joueurAutorise(req, env, url);
      if (refus) return refus;
      const coffre = env.COFFRES.get(env.COFFRES.idFromName(joueur.id));
      const suite = m[1] ? m[1] + (chemin.includes("/versions") ? "/versions" + (m[2] ? "/" + m[2] : "") : "") : "";
      const r = await coffre.fetch(new Request("https://coffre/" + suite, {
        method: req.method,
        headers: req.headers,
        body: req.method === "PUT" ? req.body : null,
      }));
      const entetes = new Headers(r.headers);
      for (const [k, v] of Object.entries(CORS)) entetes.set(k, v);
      return new Response(r.body, { status: r.status, headers: entetes });
    }

    m = chemin.match(/^\/etats\/([a-f0-9]{8,64})(\/info)?$/);
    if (m) {
      const { joueur, refus } = await joueurAutorise(req, env, url);
      if (refus) return refus;
      const coffre = env.COFFRES.get(env.COFFRES.idFromName(joueur.id));
      const entetes = new Headers(req.headers);
      entetes.set("X-Joueur-Id", joueur.id);
      entetes.set("X-Proprietaire", joueur.id === await idProprietaire(env) ? "1" : "0");
      const r = await coffre.fetch(new Request("https://coffre/etat/" + m[1] + (m[2] || ""), {
        method: req.method,
        headers: entetes,
        body: req.method === "PUT" ? req.body : null,
      }));
      const sortie = new Headers(r.headers);
      for (const [k, v] of Object.entries(CORS)) sortie.set(k, v);
      return new Response(r.body, { status: r.status, headers: sortie });
    }

    m = chemin.match(/^\/ludotheque(?:\/([a-f0-9]{16,64})(?:\/(\d{1,5}))?)?$/);
    if (m) {
      const { joueur, refus } = await joueurAutorise(req, env, url);
      if (refus) return refus;
      const coffre = env.COFFRES.get(env.COFFRES.idFromName(joueur.id));
      const entetes = new Headers(req.headers);
      entetes.set("X-Joueur-Id", joueur.id);
      entetes.set("X-Proprietaire", joueur.id === await idProprietaire(env) ? "1" : "0");
      const r = await coffre.fetch(new Request("https://coffre/ludo/" + (m[1] || "") + (m[2] !== undefined ? "/" + m[2] : ""), {
        method: req.method,
        headers: entetes,
        body: req.method === "PUT" ? req.body : null,
      }));
      const sortie = new Headers(r.headers);
      for (const [k, v] of Object.entries(CORS)) sortie.set(k, v);
      return new Response(r.body, { status: r.status, headers: sortie });
    }

    return json({ erreur: "Introuvable." }, 404);
  },
};

// ---------- Salon : une instance par Activité lancée dans un salon vocal ----------
// Chaque joueur peut diffuser sa propre partie. Les autres choisissent laquelle regarder :
// le serveur n'envoie les images d'une partie qu'à ceux qui la regardent. Le joueur qui a
// la manette d'une partie envoie ses touches, relayées à l'hôte de cette partie seulement.
export class Salle extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.etat = null;
    this.compteurs = new Map();   // limite de messages par joueur (remis à zéro au réveil, c'est voulu)
  }

  // Au plus 40 messages texte par seconde, et une demande ou proposition toutes les 2 secondes.
  permis(id, type) {
    const maintenant = Date.now();
    let c = this.compteurs.get(id);
    if (!c) { c = { debut: maintenant, n: 0, dernier: 0 }; this.compteurs.set(id, c); }
    if (maintenant - c.debut > 1000) { c.debut = maintenant; c.n = 0; }
    if (++c.n > 40) return false;
    if (type === "demande" || type === "propose") {
      if (maintenant - c.dernier < 2000) return false;
      c.dernier = maintenant;
    }
    return true;
  }

  async charger() {
    if (!this.etat) {
      const e = (await this.ctx.storage.get("parties")) || null;
      this.etat = { parties: (e && e.parties) || {} };
    }
    return this.etat;
  }

  async enregistrer() {
    await this.ctx.storage.put("parties", this.etat);
  }

  ouverts() {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === 1);
  }

  async fetch(req) {
    const joueur = JSON.parse(req.headers.get("X-Joueur"));
    // Un joueur = une connexion : on ferme une ancienne connexion du même joueur.
    for (const ancien of this.ctx.getWebSockets(joueur.id)) {
      try { ancien.close(4000, "Connexion remplacée"); } catch (e) {}
    }
    const [client, serveur] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(serveur, [joueur.id]);
    serveur.serializeAttachment({ id: joueur.id, nom: joueur.nom, regarde: null });
    await this.diffuserEtat();
    return new Response(null, { status: 101, webSocket: client });
  }

  async diffuserEtat() {
    const e = await this.charger();
    const presents = new Map(), spectateurs = {};
    for (const ws of this.ouverts()) {
      const j = ws.deserializeAttachment();
      if (!j) continue;
      presents.set(j.id, { id: j.id, nom: j.nom });
      if (j.regarde) (spectateurs[j.regarde] = spectateurs[j.regarde] || []).push(j.id);
    }
    let change = false;
    for (const [hote, p] of Object.entries(e.parties)) {
      if (!presents.has(hote)) { delete e.parties[hote]; change = true; continue; }
      if (p.manette && !presents.has(p.manette)) { p.manette = hote; change = true; }
    }
    if (change) await this.enregistrer();
    const parties = Object.entries(e.parties)
      .map(([hote, p]) => ({ hote, jeu: p.jeu, manette: p.manette, pause: p.pause, debut: p.debut, spectateurs: spectateurs[hote] || [] }))
      .sort((a, b) => a.debut - b.debut);
    // hote/manette/jeu/pause : la partie la plus ancienne, pour les consoles pas encore à jour.
    const premiere = parties[0] || {};
    this.envoyerATous({
      t: "etat", joueurs: [...presents.values()], parties,
      hote: premiere.hote || null, manette: premiere.manette || null, jeu: premiere.jeu || null, pause: Boolean(premiere.pause),
    });
  }

  envoyerATous(message, sauf) {
    const texte = JSON.stringify(message);
    for (const ws of this.ouverts()) {
      if (ws === sauf) continue;
      try { ws.send(texte); } catch (err) {}
    }
  }

  envoyerA(id, message) {
    const texte = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets(id)) {
      if (ws.readyState !== 1) continue;
      try { ws.send(texte); } catch (err) {}
    }
  }

  // Une seule manette par joueur : la lui prendre dans les autres parties.
  liberer(e, id, sauf) {
    for (const [hote, p] of Object.entries(e.parties)) if (hote !== sauf && p.manette === id && hote !== id) p.manette = hote;
  }

  async webSocketMessage(ws, message) {
    const joueur = ws.deserializeAttachment();
    if (!joueur) return;
    const e = await this.charger();
    const maPartie = e.parties[joueur.id];

    // Message binaire = une image de l'écran d'un hôte, pour ceux qui regardent sa partie.
    if (typeof message !== "string") {
      if (!maPartie || message.byteLength > 400_000) return;
      for (const autre of this.ouverts()) {
        if (autre === ws) continue;
        const a = autre.deserializeAttachment();
        if (!a || a.regarde !== joueur.id) continue;
        try { autre.send(message); } catch (err) {}
      }
      return;
    }

    if (message.length > 60_000) return;
    let m;
    try { m = JSON.parse(message); } catch (err) { return; }
    if (!m || typeof m.t !== "string" || !this.permis(joueur.id, m.t)) return;
    const partieTenue = () => Object.entries(e.parties).find(([hote, p]) => p.manette === joueur.id && hote !== joueur.id);

    switch (m.t) {
      case "hote":
        this.liberer(e, joueur.id);
        e.parties[joueur.id] = { jeu: String(m.jeu || "").slice(0, 80), manette: joueur.id, pause: false, debut: (maPartie && maPartie.debut) || Date.now() };
        if (joueur.regarde) ws.serializeAttachment({ ...joueur, regarde: null });
        await this.enregistrer();
        return this.diffuserEtat();
      case "fin":
        if (!maPartie) return;
        delete e.parties[joueur.id];
        await this.enregistrer();
        return this.diffuserEtat();
      case "pause":
        if (!maPartie) return;
        maPartie.pause = Boolean(m.pause);
        await this.enregistrer();
        return this.diffuserEtat();
      case "manette": {
        if (!maPartie) return;
        const a = typeof m.a === "string" ? m.a : joueur.id;
        if (a !== joueur.id && !this.ctx.getWebSockets(a).length) return;
        this.liberer(e, a, joueur.id);
        maPartie.manette = a;
        await this.enregistrer();
        return this.diffuserEtat();
      }
      case "rendre": {
        const tenue = partieTenue();
        if (!tenue) return;
        tenue[1].manette = tenue[0];
        await this.enregistrer();
        return this.diffuserEtat();
      }
      case "regarder": {
        const hote = typeof m.hote === "string" && e.parties[m.hote] && m.hote !== joueur.id ? m.hote : null;
        ws.serializeAttachment({ ...joueur, regarde: hote });
        return this.diffuserEtat();
      }
      case "demande": {
        const hote = typeof m.hote === "string" ? m.hote : Object.keys(e.parties)[0];
        if (hote && e.parties[hote] && hote !== joueur.id) this.envoyerA(hote, { t: "demande", de: { id: joueur.id, nom: joueur.nom } });
        return;
      }
      case "touche": {
        const tenue = partieTenue();
        if (!tenue || !Number.isInteger(m.b) || m.b < 0 || m.b > 11) return;
        return this.envoyerA(tenue[0], { t: "touche", b: m.b, e: m.e ? 1 : 0, de: joueur.id });
      }
      case "tactile": {
        const tenue = partieTenue();
        if (!tenue || !Number.isFinite(m.x) || !Number.isFinite(m.y) || !["bas", "haut", "bouge"].includes(m.e)) return;
        return this.envoyerA(tenue[0], { t: "tactile", x: Math.min(1, Math.max(0, m.x)), y: Math.min(1, Math.max(0, m.y)), e: m.e, de: joueur.id });
      }
      case "liste": {
        // Liste des jeux d'un joueur (noms seulement, jamais les fichiers), montrée aux autres.
        const jeux = Array.isArray(m.jeux)
          ? m.jeux.slice(0, 300).map(j => ({ id: String((j && j.id) || "").slice(0, 80), nom: String((j && j.nom) || "").slice(0, 80) })).filter(j => j.id && j.nom)
          : [];
        return this.envoyerATous({ t: "liste", de: joueur.id, jeux }, ws);
      }
      case "propose":
        if (typeof m.a === "string" && m.a !== joueur.id && m.jeu) {
          this.envoyerA(m.a, { t: "propose", de: { id: joueur.id, nom: joueur.nom }, jeu: { id: String(m.jeu.id || "").slice(0, 80), nom: String(m.jeu.nom || "").slice(0, 80) } });
        }
        return;
      case "ping":
        return ws.send(JSON.stringify({ t: "pong", n: m.n }));
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch (err) {}
    await this.diffuserEtat();
  }

  async webSocketError() {
    await this.diffuserEtat();
  }
}

// ---------- Coffre : les sauvegardes d'un joueur Discord ----------
export class Coffre extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sauvegardes (jeu TEXT PRIMARY KEY, maj INTEGER NOT NULL, donnees BLOB NOT NULL)");
    // Anciennes versions : pour revenir en arrière si une mauvaise sauvegarde écrase la bonne.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS historique (jeu TEXT NOT NULL, maj INTEGER NOT NULL, donnees BLOB NOT NULL, PRIMARY KEY (jeu, maj))");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cartouches (id TEXT PRIMARY KEY, nom TEXT NOT NULL, taille INTEGER NOT NULL, morceaux INTEGER NOT NULL, ajoute INTEGER NOT NULL)");
    // Anciens morceaux gardés dans le Durable Object : déplacés peu à peu vers R2.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS morceaux (id TEXT NOT NULL, n INTEGER NOT NULL, donnees BLOB NOT NULL, PRIMARY KEY (id, n))");
    // Morceaux rangés dans R2 : ici seulement leur taille.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS pieces (id TEXT NOT NULL, n INTEGER NOT NULL, octets INTEGER NOT NULL, PRIMARY KEY (id, n))");
    // États de partie rangés dans R2 : ici seulement leur date et leur taille.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS etats (jeu TEXT PRIMARY KEY, maj INTEGER NOT NULL, octets INTEGER NOT NULL)");
    // « Au catalogue » : le nom du jeu est montré aux potes du salon (jamais le fichier).
    const colonnes = new Set([...ctx.storage.sql.exec("PRAGMA table_info(cartouches)")].map(c => c.name));
    if (!colonnes.has("catalogue")) ctx.storage.sql.exec("ALTER TABLE cartouches ADD COLUMN catalogue INTEGER NOT NULL DEFAULT 0");
    if (!colonnes.has("catalogue_maj")) ctx.storage.sql.exec("ALTER TABLE cartouches ADD COLUMN catalogue_maj INTEGER NOT NULL DEFAULT 0");
  }

  // Ludothèque : les jeux personnels du joueur, découpés en morceaux rangés dans R2.
  utilise(sauf) {
    const sql = this.ctx.storage.sql;
    const [id, n] = sauf || ["", -1];
    const a = [...sql.exec("SELECT COALESCE(SUM(octets), 0) AS t FROM pieces WHERE NOT (id = ? AND n = ?)", id, n)][0].t;
    const b = [...sql.exec("SELECT COALESCE(SUM(length(donnees)), 0) AS t FROM morceaux WHERE NOT (id = ? AND n = ?)", id, n)][0].t;
    const c = [...sql.exec("SELECT COALESCE(SUM(octets), 0) AS t FROM etats WHERE jeu != ?", sauf && sauf[2] ? sauf[2] : "")][0].t;
    return a + b + c;
  }

  // États de partie : un par jeu, dans R2, comptés dans la place du joueur.
  async etat(req, jeu, info) {
    const sql = this.ctx.storage.sql;
    const joueur = req.headers.get("X-Joueur-Id");
    if (!joueur) return new Response(null, { status: 400 });
    const cle = "etats/" + joueur + "/" + jeu;
    const meta = [...sql.exec("SELECT maj, octets FROM etats WHERE jeu = ?", jeu)][0];
    if (req.method === "GET") {
      if (!meta) return new Response(null, { status: 404 });
      if (info) return Response.json(meta);
      const objet = await this.env.JEUX.get(cle);
      if (!objet) return new Response(null, { status: 404 });
      return new Response(objet.body, { headers: { "Content-Type": "application/octet-stream", "X-Maj": String(meta.maj) } });
    }
    if (req.method === "PUT" && !info) {
      const donnees = await req.arrayBuffer();
      if (!donnees.byteLength || donnees.byteLength > TAILLE_MAX_ETAT) return new Response("État invalide.", { status: 400 });
      const maj = Number(req.headers.get("X-Maj")) || Date.now();
      if (meta && meta.maj > maj) return Response.json({ ok: false, raison: "plus-recent" }, { status: 409 });
      const quota = req.headers.get("X-Proprietaire") === "1" ? PLAFOND_R2 : QUOTA_POTE;
      const total = this.utilise(["", -1, jeu]) + donnees.byteLength;
      if (total > quota) return Response.json({ ok: false, raison: "quota" }, { status: 507 });
      const place = await this.registre().reserver(joueur, total, PLAFOND_R2);
      if (!place.ok) return Response.json({ ok: false, raison: "serveur-plein" }, { status: 507 });
      await this.env.JEUX.put(cle, donnees);
      sql.exec("INSERT INTO etats (jeu, maj, octets) VALUES (?, ?, ?) ON CONFLICT(jeu) DO UPDATE SET maj = excluded.maj, octets = excluded.octets", jeu, maj, donnees.byteLength);
      return Response.json({ ok: true, maj });
    }
    return new Response(null, { status: 405 });
  }

  registre() {
    return this.env.REGISTRE.get(this.env.REGISTRE.idFromName("global"));
  }

  // Déplace un petit lot d'anciens morceaux vers R2 à chaque passage.
  async migrer(cle) {
    const sql = this.ctx.storage.sql;
    for (const m of [...sql.exec("SELECT id, n, donnees FROM morceaux LIMIT 20")]) {
      await this.env.JEUX.put(cle(m.id, m.n), m.donnees);
      sql.exec("INSERT OR REPLACE INTO pieces (id, n, octets) VALUES (?, ?, ?)", m.id, m.n, m.donnees.byteLength);
      sql.exec("DELETE FROM morceaux WHERE id = ? AND n = ?", m.id, m.n);
    }
  }

  async ludotheque(req, id, n) {
    const sql = this.ctx.storage.sql;
    const ligne = requete => [...requete][0];
    const joueur = req.headers.get("X-Joueur-Id");
    if (!joueur) return new Response(null, { status: 400 });
    const proprietaire = req.headers.get("X-Proprietaire") === "1";
    const quota = proprietaire ? PLAFOND_R2 : QUOTA_POTE;
    const cle = (jeu, k) => "ludo/" + joueur + "/" + jeu + "/" + k;
    await this.migrer(cle);

    if (!id) {
      if (req.method !== "GET") return new Response(null, { status: 405 });
      // Envois interrompus depuis plus d'un jour : invisibles, mais ils prennent de la place. On les retire.
      const inacheves = [...sql.exec(
        "SELECT c.id FROM cartouches c WHERE c.ajoute < ? AND (SELECT COUNT(*) FROM pieces p WHERE p.id = c.id) + (SELECT COUNT(*) FROM morceaux m WHERE m.id = c.id) < c.morceaux",
        Date.now() - 24 * 60 * 60 * 1000
      )].map(r => r.id);
      for (const jeu of inacheves) {
        const ns = [...sql.exec("SELECT n FROM pieces WHERE id = ?", jeu)].map(r => cle(jeu, r.n));
        if (ns.length) await this.env.JEUX.delete(ns);
        sql.exec("DELETE FROM pieces WHERE id = ?", jeu);
        sql.exec("DELETE FROM morceaux WHERE id = ?", jeu);
        sql.exec("DELETE FROM cartouches WHERE id = ?", jeu);
      }
      const jeux = [...sql.exec(
        "SELECT c.id, c.nom, c.taille, c.morceaux, c.ajoute, c.catalogue, c.catalogue_maj, " +
        "(SELECT COUNT(*) FROM pieces p WHERE p.id = c.id) + (SELECT COUNT(*) FROM morceaux m WHERE m.id = c.id) AS recus " +
        "FROM cartouches c ORDER BY c.ajoute DESC"
      )];
      const utilise = this.utilise();
      const serveur = await this.registre().noter(joueur, utilise);
      return Response.json({ jeux, utilise, quota, proprietaire, serveur, plafond: PLAFOND_R2 });
    }

    if (req.method === "DELETE") {
      const ns = [...sql.exec("SELECT n FROM pieces WHERE id = ?", id)].map(r => r.n);
      for (let i = 0; i < ns.length; i += 1000) await this.env.JEUX.delete(ns.slice(i, i + 1000).map(k => cle(id, k)));
      sql.exec("DELETE FROM pieces WHERE id = ?", id);
      sql.exec("DELETE FROM morceaux WHERE id = ?", id);
      sql.exec("DELETE FROM cartouches WHERE id = ?", id);
      await this.registre().noter(joueur, this.utilise());
      return Response.json({ ok: true });
    }

    if (req.method === "POST" && n === null) {
      const existe = ligne(sql.exec("SELECT catalogue_maj FROM cartouches WHERE id = ?", id));
      if (!existe) return new Response(null, { status: 404 });
      const maj = Number(req.headers.get("X-Maj")) || Date.now();
      if (existe.catalogue_maj > maj) return Response.json({ ok: false, raison: "plus-recent" }, { status: 409 });
      const oui = req.headers.get("X-Catalogue") === "1" ? 1 : 0;
      sql.exec("UPDATE cartouches SET catalogue = ?, catalogue_maj = ? WHERE id = ?", oui, maj, id);
      return Response.json({ ok: true, catalogue: oui, catalogue_maj: maj });
    }

    if (n === null) return new Response(null, { status: 404 });

    if (req.method === "GET") {
      if (ligne(sql.exec("SELECT 1 AS x FROM pieces WHERE id = ? AND n = ?", id, n))) {
        const objet = await this.env.JEUX.get(cle(id, n));
        if (!objet) return new Response(null, { status: 404 });
        return new Response(objet.body, { headers: { "Content-Type": "application/octet-stream" } });
      }
      const m = ligne(sql.exec("SELECT donnees FROM morceaux WHERE id = ? AND n = ?", id, n));
      if (!m) return new Response(null, { status: 404 });
      return new Response(m.donnees, { headers: { "Content-Type": "application/octet-stream" } });
    }

    if (req.method === "PUT") {
      const nom = decodeURIComponent(req.headers.get("X-Nom") || "").slice(0, 200);
      const taille = Number(req.headers.get("X-Taille"));
      const morceaux = Number(req.headers.get("X-Morceaux"));
      if (!nom || !(taille > 0) || !(morceaux > 0) || n >= morceaux) return new Response("En-têtes invalides.", { status: 400 });
      const donnees = await req.arrayBuffer();
      if (!donnees.byteLength || donnees.byteLength > TAILLE_MORCEAU) return new Response("Morceau invalide.", { status: 400 });
      const total = this.utilise([id, n]) + donnees.byteLength;
      if (total > quota) return Response.json({ ok: false, raison: "quota", quota }, { status: 507 });
      const place = await this.registre().reserver(joueur, total, PLAFOND_R2);
      if (!place.ok) return Response.json({ ok: false, raison: "serveur-plein", plafond: PLAFOND_R2 }, { status: 507 });
      await this.env.JEUX.put(cle(id, n), donnees);
      sql.exec(
        "INSERT INTO cartouches (id, nom, taille, morceaux, ajoute) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET nom = excluded.nom, taille = excluded.taille, morceaux = excluded.morceaux",
        id, nom, taille, morceaux, Date.now()
      );
      sql.exec("INSERT OR REPLACE INTO pieces (id, n, octets) VALUES (?, ?, ?)", id, n, donnees.byteLength);
      sql.exec("DELETE FROM morceaux WHERE id = ? AND n = ?", id, n);
      const recus = ligne(sql.exec("SELECT (SELECT COUNT(*) FROM pieces WHERE id = ?) + (SELECT COUNT(*) FROM morceaux WHERE id = ?) AS c", id, id)).c;
      return Response.json({ ok: true, recus, morceaux });
    }

    return new Response(null, { status: 405 });
  }

  async fetch(req) {
    const chemin = new URL(req.url).pathname;
    const ludo = chemin.match(/^\/ludo\/?([a-f0-9]*)(?:\/(\d+))?$/);
    if (ludo) return this.ludotheque(req, ludo[1] || null, ludo[2] !== undefined ? Number(ludo[2]) : null);
    const et = chemin.match(/^\/etat\/([a-f0-9]{8,64})(\/info)?$/);
    if (et) return this.etat(req, et[1], Boolean(et[2]));

    const sql = this.ctx.storage.sql;
    const ligne = requete => [...requete][0];
    const sv = chemin.match(/^\/([a-f0-9]{8,64})?(\/versions(?:\/(\d+))?)?$/);
    if (!sv) return new Response(null, { status: 404 });
    const jeu = sv[1] || "";

    if (!jeu) {
      if (req.method !== "GET") return new Response(null, { status: 405 });
      const lignes = [...sql.exec("SELECT jeu, maj, length(donnees) AS taille FROM sauvegardes ORDER BY maj DESC")];
      return Response.json(lignes);
    }

    if (sv[2]) {
      if (req.method !== "GET") return new Response(null, { status: 405 });
      if (sv[3]) {
        const v = ligne(sql.exec("SELECT donnees FROM historique WHERE jeu = ? AND maj = ?", jeu, Number(sv[3])))
          || ligne(sql.exec("SELECT donnees FROM sauvegardes WHERE jeu = ? AND maj = ?", jeu, Number(sv[3])));
        if (!v) return new Response(null, { status: 404 });
        return new Response(v.donnees, { headers: { "Content-Type": "application/octet-stream" } });
      }
      const actuelle = [...sql.exec("SELECT maj, length(donnees) AS taille, 1 AS actuelle FROM sauvegardes WHERE jeu = ?", jeu)];
      const anciennes = [...sql.exec("SELECT maj, length(donnees) AS taille, 0 AS actuelle FROM historique WHERE jeu = ? ORDER BY maj DESC", jeu)];
      return Response.json(actuelle.concat(anciennes));
    }

    if (req.method === "GET") {
      const l = ligne(sql.exec("SELECT maj, donnees FROM sauvegardes WHERE jeu = ?", jeu));
      if (!l) return new Response(null, { status: 404 });
      return new Response(l.donnees, { headers: { "Content-Type": "application/octet-stream", "X-Maj": String(l.maj) } });
    }

    if (req.method === "PUT") {
      const donnees = await req.arrayBuffer();
      if (!donnees.byteLength) return new Response("Sauvegarde vide.", { status: 400 });
      if (donnees.byteLength > TAILLE_MAX_SAUVEGARDE) return new Response("Sauvegarde trop grosse.", { status: 413 });
      const maj = Number(req.headers.get("X-Maj")) || Date.now();
      const actuelle = ligne(sql.exec("SELECT maj, donnees FROM sauvegardes WHERE jeu = ?", jeu));
      if (actuelle && actuelle.maj > maj) return Response.json({ ok: false, raison: "plus-recente", maj: actuelle.maj }, { status: 409 });

      // La version remplacée part dans l'historique (si elle est différente).
      if (actuelle && actuelle.maj !== maj) {
        sql.exec("INSERT OR REPLACE INTO historique (jeu, maj, donnees) VALUES (?, ?, ?)", jeu, actuelle.maj, actuelle.donnees);
        this.elaguer(jeu);
      }
      // Place : au besoin on retire les plus vieilles versions de l'historique, jamais une sauvegarde actuelle.
      const totalApres = () => {
        const a = ligne(sql.exec("SELECT COALESCE(SUM(length(donnees)), 0) AS t FROM sauvegardes WHERE jeu != ?", jeu)).t;
        const b = ligne(sql.exec("SELECT COALESCE(SUM(length(donnees)), 0) AS t FROM historique")).t;
        return a + b + donnees.byteLength;
      };
      while (totalApres() > QUOTA_SAUVEGARDES) {
        const vieille = ligne(sql.exec("SELECT jeu, maj FROM historique ORDER BY maj ASC LIMIT 1"));
        if (!vieille) return Response.json({ ok: false, raison: "quota" }, { status: 507 });
        sql.exec("DELETE FROM historique WHERE jeu = ? AND maj = ?", vieille.jeu, vieille.maj);
      }
      sql.exec(
        "INSERT INTO sauvegardes (jeu, maj, donnees) VALUES (?, ?, ?) ON CONFLICT(jeu) DO UPDATE SET maj = excluded.maj, donnees = excluded.donnees",
        jeu, maj, donnees
      );
      return Response.json({ ok: true, maj });
    }
    return new Response(null, { status: 405 });
  }

  // Garde la version la plus récente de l'historique, puis des versions espacées d'au moins 10 min.
  elaguer(jeu) {
    const sql = this.ctx.storage.sql;
    const versions = [...sql.exec("SELECT maj FROM historique WHERE jeu = ? ORDER BY maj DESC", jeu)].map(r => r.maj);
    const gardees = [];
    for (const v of versions) {
      if (!gardees.length || (gardees[gardees.length - 1] - v >= ESPACEMENT_VERSIONS && gardees.length < VERSIONS_GARDEES)) gardees.push(v);
      else sql.exec("DELETE FROM historique WHERE jeu = ? AND maj = ?", jeu, v);
    }
  }
}

// ---------- Registre : place utilisée par chaque joueur dans R2, pour rester sous les 10 Go gratuits ----------
export class Registre extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS place (joueur TEXT PRIMARY KEY, octets INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS guildes (id TEXT PRIMARY KEY, ajoute INTEGER NOT NULL)");
  }

  // Serveurs Discord où le propriétaire a ouvert l'Activité : leurs membres ont accès.
  guildes() {
    return [...this.ctx.storage.sql.exec("SELECT id FROM guildes")].map(r => r.id);
  }
  ajouterGuilde(id) {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO guildes (id, ajoute) VALUES (?, ?)", id, Date.now());
  }

  total() {
    return [...this.ctx.storage.sql.exec("SELECT COALESCE(SUM(octets), 0) AS t FROM place")][0].t;
  }

  // Réserve la place si le total de tout le monde reste sous le plafond.
  reserver(joueur, octets, plafond) {
    const sql = this.ctx.storage.sql;
    const autres = [...sql.exec("SELECT COALESCE(SUM(octets), 0) AS t FROM place WHERE joueur != ?", joueur)][0].t;
    if (autres + octets > plafond) return { ok: false, total: autres };
    sql.exec("INSERT INTO place (joueur, octets) VALUES (?, ?) ON CONFLICT(joueur) DO UPDATE SET octets = excluded.octets", joueur, octets);
    return { ok: true, total: autres + octets };
  }

  // Remet le compte d'un joueur à sa vraie valeur et renvoie le total de tout le monde.
  noter(joueur, octets) {
    this.ctx.storage.sql.exec("INSERT INTO place (joueur, octets) VALUES (?, ?) ON CONFLICT(joueur) DO UPDATE SET octets = excluded.octets", joueur, octets);
    return this.total();
  }
}
