// Lance le serveur en local (wrangler dev), sert la console comme Discord le ferait,
// puis joue tous les scénarios de scenarios.mjs. Code de sortie 1 si un test échoue.
//   cd tests && npm install && npx playwright install chromium && node lancer.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, "..");
export const PORT_SERVEUR = 8787, PORT_SITE = 8790;

// --- Serveur du Worker en local ---
const etat = fs.mkdtempSync(path.join(os.tmpdir(), "ds-retro-tests-"));
const wrangler = spawn("npx", ["wrangler", "dev", "--port", String(PORT_SERVEUR), "--persist-to", etat,
  "--var", "DEV_SANS_AUTH:1", "--var", "PROPRIETAIRE_ID:111", "--var", "DISCORD_CLIENT_SECRET:secret-de-test"],
  { cwd: path.join(racine, "serveur"), env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let journal = "";
wrangler.stdout.on("data", d => { journal += d; });
wrangler.stderr.on("data", d => { journal += d; });
await new Promise((ok, ko) => {
  const fin = setTimeout(() => ko(new Error("wrangler dev n'a pas démarré :\n" + journal)), 90_000);
  const t = setInterval(() => { if (journal.includes("Ready on")) { clearTimeout(fin); clearInterval(t); ok(); } }, 200);
});

// --- Site : fichiers du dépôt + /.proxy/api → Worker, comme le proxy de Discord ---
const proxy = httpProxy.createProxyServer({ target: `http://localhost:${PORT_SERVEUR}`, ws: true });
proxy.on("error", (e, req, res) => { try { if (res && res.writeHead) { res.writeHead(502); res.end(); } else if (res && res.destroy) res.destroy(); } catch (x) {} });
const reecrire = req => { req.url = req.url.replace(/^\/\.proxy\/api/, "/api"); };
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".png": "image/png" };
const site = http.createServer((req, res) => {
  if (req.url.startsWith("/.proxy/api")) { reecrire(req); return proxy.web(req, res); }
  const chemin = decodeURIComponent(req.url.split("?")[0]);
  const fichier = path.join(racine, chemin === "/" ? "index.html" : chemin);
  if (!fichier.startsWith(racine)) { res.statusCode = 403; return res.end(); }
  fs.readFile(fichier, (e, d) => {
    if (e) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", types[path.extname(fichier)] || "application/octet-stream");
    res.end(d);
  });
});
site.on("upgrade", (req, sock, head) => { sock.on("error", () => {}); reecrire(req); proxy.ws(req, sock, head); });
await new Promise(ok => site.listen(PORT_SITE, ok));

// --- Scénarios ---
let code = 1;
try {
  const { lancerScenarios } = await import("./scenarios.mjs");
  code = await lancerScenarios({ site: `http://localhost:${PORT_SITE}`, racine }) ? 0 : 1;
} catch (e) {
  console.error(e);
} finally {
  site.close();
  try { process.kill(-wrangler.pid, "SIGTERM"); } catch (e) { wrangler.kill("SIGTERM"); }
  setTimeout(() => process.exit(code), 500);
}
