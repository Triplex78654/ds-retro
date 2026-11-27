// Petit serveur local de l'appli : il sert la console (dossier site/) et relaie /.proxy/api vers le
// serveur Cloudflare, comme le fait le proxy de Discord pour l'Activité. La console n'a rien à changer.
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
function demarrer({ dossier, port, api, dossiers = {} }) {
  const hoteAttendu = "127.0.0.1:" + port;
  const cibleApi = new URL(api);                  // ex. https://ds-retro-serveur.….workers.dev/api
  const securise = cibleApi.protocol === "https:";
  const portApi = Number(cibleApi.port) || (securise ? 443 : 80);
  const cheminApi = cibleApi.pathname.replace(/\/$/, "");
  const versApi = url => cheminApi + url.replace(/^\/\.proxy\/api/, "");

  const serveur = http.createServer((req, res) => {
    // Seulement l'appli elle-même (bloque un site web qui viserait ce serveur par une autre adresse).
    if (req.headers.host !== hoteAttendu) { res.writeHead(403); return res.end(); }
    // Dossier de jeux d'une console : liste, puis fichiers
    const dj = req.url.match(/^\/jeux-pc\/([a-z0-9]+)\/([^?]*)/);
    if (dj) {
      const racineJeux = dossiers[dj[1]];
      if (!racineJeux) { res.writeHead(404); return res.end(); }
      const nom = decodeURIComponent(dj[2]);
      if (!nom) {
        return fs.readdir(racineJeux, { withFileTypes: true }, (e, liste) => {
          const fichiers = e ? [] : liste.filter(f => f.isFile()).map(f => {
            try { const st = fs.statSync(path.join(racineJeux, f.name)); return { nom: f.name, taille: st.size, maj: st.mtimeMs }; } catch (x) { return null; }
          }).filter(Boolean);
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
          res.end(JSON.stringify(fichiers));
        });
      }
      const fichier = path.join(racineJeux, nom);
      if (nom.includes("/") || nom.includes("\\") || path.dirname(fichier) !== path.resolve(racineJeux)) { res.writeHead(403); return res.end(); }
      return fs.stat(fichier, (e, st) => {
        if (e || !st.isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-cache" });
        fs.createReadStream(fichier).pipe(res);
      });
    }
    // API : relayée telle quelle
    if (req.url.startsWith("/.proxy/api")) {
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
    const chemin = decodeURIComponent(req.url.split("?")[0]);
    const fichier = path.normalize(path.join(dossier, chemin === "/" ? "accueil.html" : chemin));
    if (!fichier.startsWith(dossier)) { res.writeHead(403); return res.end(); }
    fs.stat(fichier, (e, s) => {
      if (e || !s.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(fichier)] || "application/octet-stream", "Content-Length": s.size, "Cache-Control": "no-cache" });
      fs.createReadStream(fichier).pipe(res);
    });
  });

  // WebSocket du salon : on recopie la demande vers le serveur puis on relie les deux connexions
  serveur.on("upgrade", (req, client, tete) => {
    client.on("error", () => {});
    if (req.headers.host !== hoteAttendu) return client.destroy();
    if (!req.url.startsWith("/.proxy/api")) return client.destroy();
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
  const dossiers = jeux ? Object.fromEntries(["ds", "nes", "snes", "n64", "psx"].map(c => [c, path.join(path.resolve(jeux), c)])) : {};
  demarrer({ dossier: path.resolve(dossier), port: Number(port), api, dossiers }).then(() => console.log("Serveur local prêt sur " + port));
}
