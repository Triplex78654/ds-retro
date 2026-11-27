// Petit serveur local de l'appli : il sert la console (dossier site/) et les dossiers de jeux du PC.
// Si une adresse d'API est donnée (tests), /.proxy/api y est relayé ; l'appli n'en donne pas.
const http = require("node:http");
const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".wasm": "application/wasm", ".data": "application/octet-stream", ".txt": "text/plain; charset=utf-8",
};

// dossiers : { nes: "C:\\Users\\…\\Documents\\Rétro\\NES", … } — les jeux posés là apparaissent dans le catalogue.
// bibliotheque(c) : jeux trouvés ailleurs sur le PC par « Chercher mes jeux » ([{ nom, chemin, dossier }]).
function demarrer({ dossier, port, api, dossiers = {}, bibliotheque = () => [] }) {
  const hoteAttendu = "127.0.0.1:" + port;
  const cibleApi = new URL(api || "http://0.0.0.0/api");                  // ex. https://ds-retro-serveur.….workers.dev/api
  const securise = cibleApi.protocol === "https:";
  const portApi = Number(cibleApi.port) || (securise ? 443 : 80);
  const cheminApi = cibleApi.pathname.replace(/\/$/, "");
  const versApi = url => cheminApi + url.replace(/^\/\.proxy\/api/, "");

  const origineAttendue = "http://" + hoteAttendu;
  // Seulement l'appli elle-même :
  // - Host : bloque un site qui viserait ce serveur par un autre nom (rebinding DNS) ;
  // - Origin / Sec-Fetch-Site : bloque un site web ouvert dans le navigateur qui enverrait des requêtes ici.
  const autorisee = req => req.headers.host === hoteAttendu
    && (!req.headers.origin || req.headers.origin === origineAttendue)
    && !["cross-site", "same-site"].includes(req.headers["sec-fetch-site"]);
  const decoder = t => { try { return decodeURIComponent(t); } catch (e) { return null; } };

  const serveur = http.createServer((req, res) => {
    try { repondre(req, res); }
    catch (e) { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  function repondre(req, res) {
    if (!autorisee(req)) { res.writeHead(403); return res.end(); }
    // Dossier de jeux d'une console : liste, puis fichiers
    const dj = req.url.match(/^\/jeux-pc\/([a-z0-9]+)\/([^?]*)/);
    if (dj) {
      const racineJeux = dossiers[dj[1]];
      if (!racineJeux) { res.writeHead(404); return res.end(); }
      const nom = decoder(dj[2]);
      if (nom === null) { res.writeHead(400); return res.end(); }
      if (!nom) {
        return fs.readdir(racineJeux, { withFileTypes: true }, (e, liste) => {
          // Fichiers de jeux, et dossiers (jeux PS3 rangés en dossier, avec PS3_GAME ou EBOOT.BIN dedans)
          const fichiers = e ? [] : liste.filter(f => (f.isFile() || f.isDirectory()) && !f.name.startsWith(".")).map(f => {
            try {
              const st = fs.statSync(path.join(racineJeux, f.name));
              return f.isDirectory() ? { nom: f.name, taille: 0, maj: st.mtimeMs, dossier: true } : { nom: f.name, taille: st.size, maj: st.mtimeMs };
            } catch (x) { return null; }
          }).filter(Boolean);
          const noms = new Set(fichiers.map(f => f.nom));
          for (const b of bibliotheque(dj[1])) {
            if (noms.has(b.nom)) continue;
            try {
              const st = fs.statSync(b.chemin);
              fichiers.push(b.dossier ? { nom: b.nom, taille: 0, maj: st.mtimeMs, dossier: true, trouve: true } : { nom: b.nom, taille: st.size, maj: st.mtimeMs, trouve: true });
              noms.add(b.nom);
            } catch (x) { /* fichier déplacé ou supprimé */ }
          }
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
          res.end(JSON.stringify(fichiers));
        });
      }
      let fichier = path.join(racineJeux, nom);
      if (nom.includes("/") || nom.includes("\\") || path.dirname(fichier) !== path.resolve(racineJeux)) { res.writeHead(403); return res.end(); }
      // Pas dans le dossier : peut-être un jeu trouvé ailleurs (seulement ceux de la bibliothèque).
      if (!fs.existsSync(fichier)) { const b = bibliotheque(dj[1]).find(x => x.nom === nom && !x.dossier); if (b) fichier = b.chemin; }
      return fs.stat(fichier, (e, st) => {
        if (e || !st.isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-cache" });
        fs.createReadStream(fichier).on("error", () => res.destroy()).pipe(res);
      });
    }
    // API : relayée telle quelle
    if (req.url.startsWith("/.proxy/api")) {
      if (!api) { res.writeHead(404); return res.end(); }
      const module = securise ? require("node:https") : http;
      const entetes = { ...req.headers, host: cibleApi.host };
      delete entetes.origin; delete entetes.referer;
      const sortie = module.request({ hostname: cibleApi.hostname, port: portApi, method: req.method, path: versApi(req.url), headers: entetes }, r => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      sortie.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      return req.pipe(sortie);
    }
    // Fichiers de la console
    const chemin = decoder(req.url.split("?")[0]);
    if (chemin === null) { res.writeHead(400); return res.end(); }
    const fichier = path.normalize(path.join(dossier, chemin === "/" ? "accueil.html" : chemin));
    if (!fichier.startsWith(path.resolve(dossier) + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(fichier, (e, s) => {
      if (e || !s.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(fichier)] || "application/octet-stream", "Content-Length": s.size, "Cache-Control": "no-cache" });
      fs.createReadStream(fichier).on("error", () => res.destroy()).pipe(res);
    });
  }

  // WebSocket du salon : on recopie la demande vers le serveur puis on relie les deux connexions
  serveur.on("upgrade", (req, client, tete) => {
    client.on("error", () => {});
    if (!autorisee(req)) return client.destroy();
    if (!api || !req.url.startsWith("/.proxy/api")) return client.destroy();
    const distant = securise
      ? tls.connect({ host: cibleApi.hostname, port: portApi, servername: cibleApi.hostname })
      : net.connect({ host: cibleApi.hostname, port: portApi });
    distant.on("error", () => client.destroy());
    distant.on(securise ? "secureConnect" : "connect", () => {
      const lignes = [`GET ${versApi(req.url)} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        if (["origin", "referer"].includes(k)) continue;
        lignes.push(`${k}: ${k === "host" ? cibleApi.host : v}`);
      }
      distant.write(lignes.join("\r\n") + "\r\n\r\n");
      if (tete && tete.length) distant.write(tete);
      distant.pipe(client); client.pipe(distant);
    });
  });

  return new Promise((ok, ko) => {
    serveur.once("error", ko);
    serveur.listen(port, "127.0.0.1", () => ok(serveur));
  });
}

module.exports = { demarrer };

// Lancé seul (tests) : node serveur-local.js <dossier> <port> <api>
if (require.main === module) {
  const [dossier, port, api, jeux] = process.argv.slice(2);
  const dossiers = jeux ? Object.fromEntries(["ds", "nes", "snes", "n64", "psx", "3ds", "switch", "psp", "ps2", "ps3"].map(c => [c, path.join(path.resolve(jeux), c)])) : {};
  demarrer({ dossier: path.resolve(dossier), port: Number(port), api, dossiers }).then(() => console.log("Serveur local prêt sur " + port));
}
