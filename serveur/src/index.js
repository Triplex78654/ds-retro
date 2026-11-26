// Serveur de ds-retro (Cloudflare Workers + Durable Objects).
//
// Discord fait passer les requêtes de l'Activité par /.proxy/api/… vers ce Worker
// (mapping d'URL « /api » dans le portail développeur).
//
//   POST /token                 échange le code OAuth de Discord contre un jeton (secret côté serveur)
//   GET  /salle/:instance       WebSocket du salon : écran de l'hôte, manette partagée
//   GET  /sauvegardes           liste des sauvegardes du joueur
//   GET  /sauvegardes/:jeu      télécharge une sauvegarde
//   PUT  /sauvegardes/:jeu      envoie une sauvegarde (en-tête X-Maj = date en ms)

import { DurableObject } from "cloudflare:workers";

const DISCORD = "https://discord.com/api";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Maj",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Maj",
};
const TAILLE_MAX_SAUVEGARDE = 2_000_000;

function json(objet, statut = 200) {
  return new Response(JSON.stringify(objet), { status: statut, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Jeton Discord → joueur. Petit cache pour ne pas interroger Discord à chaque requête.
const cacheJoueurs = new Map();
async function joueurDepuisJeton(jeton, env) {
  if (!jeton) return null;
  if (env.DEV_SANS_AUTH === "1" && jeton.startsWith("dev:")) {
    const id = jeton.slice(4);
    return { id, nom: "Joueur " + id };
  }
  const memo = cacheJoueurs.get(jeton);
  if (memo && memo.expire > Date.now()) return memo.joueur;
  const r = await fetch(DISCORD + "/users/@me", { headers: { Authorization: "Bearer " + jeton } });
  if (!r.ok) return null;
  const u = await r.json();
  const joueur = { id: u.id, nom: (u.global_name || u.username || "Joueur").slice(0, 32) };
  if (cacheJoueurs.size > 1000) cacheJoueurs.clear();
  cacheJoueurs.set(jeton, { joueur, expire: Date.now() + 10 * 60 * 1000 });
  return joueur;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const chemin = url.pathname.replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";

    if (chemin === "/" || chemin === "/etat") {
      return json({ ok: true, connexionDiscord: Boolean(env.DISCORD_CLIENT_SECRET) });
    }

    if (chemin === "/token" && req.method === "POST") {
      if (!env.DISCORD_CLIENT_SECRET) return json({ erreur: "Le secret Discord n'est pas encore configuré." }, 503);
      const { code } = await req.json().catch(() => ({}));
      if (!code) return json({ erreur: "Code manquant." }, 400);
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

    let m = chemin.match(/^\/salle\/([\w-]{1,100})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return json({ erreur: "WebSocket attendu." }, 426);
      const joueur = await joueurDepuisJeton(url.searchParams.get("jeton"), env);
      if (!joueur) return json({ erreur: "Non connecté." }, 401);
      const salle = env.SALLES.get(env.SALLES.idFromName(m[1]));
      const entetes = new Headers(req.headers);
      entetes.set("X-Joueur", JSON.stringify(joueur));
      return salle.fetch(new Request(req, { headers: entetes }));
    }

    m = chemin.match(/^\/sauvegardes(?:\/([a-f0-9]{8,64}))?$/);
    if (m) {
      const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const joueur = await joueurDepuisJeton(jeton, env);
      if (!joueur) return json({ erreur: "Non connecté." }, 401);
      const coffre = env.COFFRES.get(env.COFFRES.idFromName(joueur.id));
      const r = await coffre.fetch(new Request("https://coffre/" + (m[1] || ""), {
        method: req.method,
        headers: req.headers,
        body: req.method === "PUT" ? req.body : null,
      }));
      const entetes = new Headers(r.headers);
      for (const [k, v] of Object.entries(CORS)) entetes.set(k, v);
      return new Response(r.body, { status: r.status, headers: entetes });
    }

    return json({ erreur: "Introuvable." }, 404);
  },
};

// ---------- Salon : une instance par Activité lancée dans un salon vocal ----------
// L'hôte fait tourner le jeu et envoie ses images ; le serveur les relaie aux autres.
// Le joueur qui a la manette envoie ses touches, relayées à l'hôte seulement.
export class Salle extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.etat = null;
  }

  async charger() {
    if (!this.etat) this.etat = (await this.ctx.storage.get("etat")) || { hote: null, manette: null, jeu: null, pause: false };
    return this.etat;
  }

  async enregistrer() {
    await this.ctx.storage.put("etat", this.etat);
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
    serveur.serializeAttachment(joueur);
    await this.diffuserEtat();
    return new Response(null, { status: 101, webSocket: client });
  }

  async diffuserEtat() {
    const e = await this.charger();
    const presents = new Map();
    for (const ws of this.ouverts()) {
      const j = ws.deserializeAttachment();
      if (j) presents.set(j.id, j);
    }
    let change = false;
    if (e.hote && !presents.has(e.hote)) { Object.assign(e, { hote: null, manette: null, jeu: null, pause: false }); change = true; }
    if (e.manette && !presents.has(e.manette)) { e.manette = e.hote; change = true; }
    if (change) await this.enregistrer();
    this.envoyerATous({ t: "etat", joueurs: [...presents.values()], hote: e.hote, manette: e.manette, jeu: e.jeu, pause: e.pause });
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

  async webSocketMessage(ws, message) {
    const joueur = ws.deserializeAttachment();
    if (!joueur) return;
    const e = await this.charger();

    // Message binaire = une image de l'écran de l'hôte.
    if (typeof message !== "string") {
      if (e.hote !== joueur.id) return;
      for (const autre of this.ouverts()) {
        if (autre === ws) continue;
        try { autre.send(message); } catch (err) {}
      }
      return;
    }

    let m;
    try { m = JSON.parse(message); } catch (err) { return; }
    const estHote = e.hote === joueur.id;

    switch (m.t) {
      case "hote":
        if (e.hote && !estHote) return ws.send(JSON.stringify({ t: "refus", raison: "Quelqu'un diffuse déjà un jeu." }));
        Object.assign(e, { hote: joueur.id, manette: joueur.id, jeu: String(m.jeu || "").slice(0, 80), pause: false });
        await this.enregistrer();
        return this.diffuserEtat();
      case "fin":
        if (!estHote) return;
        Object.assign(e, { hote: null, manette: null, jeu: null, pause: false });
        await this.enregistrer();
        return this.diffuserEtat();
      case "pause":
        if (!estHote) return;
        e.pause = Boolean(m.pause);
        await this.enregistrer();
        return this.diffuserEtat();
      case "manette":
        if (!estHote) return;
        e.manette = typeof m.a === "string" ? m.a : joueur.id;
        await this.enregistrer();
        return this.diffuserEtat();
      case "rendre":
        if (e.manette !== joueur.id || !e.hote) return;
        e.manette = e.hote;
        await this.enregistrer();
        return this.diffuserEtat();
      case "demande":
        if (e.hote && !estHote) this.envoyerA(e.hote, { t: "demande", de: joueur });
        return;
      case "touche":
      case "tactile":
        if (e.hote && !estHote && e.manette === joueur.id) this.envoyerA(e.hote, { ...m, de: joueur.id });
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
  }

  async fetch(req) {
    const jeu = new URL(req.url).pathname.slice(1);
    const sql = this.ctx.storage.sql;

    if (!jeu) {
      if (req.method !== "GET") return new Response(null, { status: 405 });
      const lignes = [...sql.exec("SELECT jeu, maj, length(donnees) AS taille FROM sauvegardes ORDER BY maj DESC")];
      return Response.json(lignes);
    }
    if (req.method === "GET") {
      const ligne = [...sql.exec("SELECT maj, donnees FROM sauvegardes WHERE jeu = ?", jeu)][0];
      if (!ligne) return new Response(null, { status: 404 });
      return new Response(ligne.donnees, { headers: { "Content-Type": "application/octet-stream", "X-Maj": String(ligne.maj) } });
    }
    if (req.method === "PUT") {
      const donnees = await req.arrayBuffer();
      if (!donnees.byteLength) return new Response("Sauvegarde vide.", { status: 400 });
      if (donnees.byteLength > TAILLE_MAX_SAUVEGARDE) return new Response("Sauvegarde trop grosse.", { status: 413 });
      const maj = Number(req.headers.get("X-Maj")) || Date.now();
      const actuelle = [...sql.exec("SELECT maj FROM sauvegardes WHERE jeu = ?", jeu)][0];
      if (actuelle && actuelle.maj > maj) return Response.json({ ok: false, raison: "plus-recente", maj: actuelle.maj }, { status: 409 });
      sql.exec(
        "INSERT INTO sauvegardes (jeu, maj, donnees) VALUES (?, ?, ?) ON CONFLICT(jeu) DO UPDATE SET maj = excluded.maj, donnees = excluded.donnees",
        jeu, maj, donnees
      );
      return Response.json({ ok: true, maj });
    }
    return new Response(null, { status: 405 });
  }
}
