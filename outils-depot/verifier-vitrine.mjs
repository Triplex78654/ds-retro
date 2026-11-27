// Vérifie les liens du site vitrine : fichiers locaux, ancres (#…) et liens externes.
//   node outils-depot/verifier-vitrine.mjs            (tout)
//   node outils-depot/verifier-vitrine.mjs --local    (sans Internet)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitrine = path.join(racine, "vitrine");
const local = process.argv.includes("--local");
const ids = f => new Set([...fs.readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const erreurs = [], externes = new Set();

for (const nom of fs.readdirSync(vitrine).filter(f => f.endsWith(".html"))) {
  const page = path.join(vitrine, nom), html = fs.readFileSync(page, "utf8");
  for (const [, attr, url] of html.matchAll(/\s(href|src)="([^"]+)"/g)) {
    if (/^https?:/.test(url)) { externes.add(url); continue; }
    if (/^(mailto|data):/.test(url)) continue;
    const [chemin, ancre] = url.split("#");
    const cible = chemin ? path.resolve(path.dirname(page), chemin) : page;
    if (!cible.startsWith(racine)) { erreurs.push(`${nom} : ${url} sort du dépôt`); continue; }
    if (!fs.existsSync(cible)) { erreurs.push(`${nom} : ${attr} ${url} introuvable`); continue; }
    if (ancre && cible.endsWith(".html") && !ids(cible).has(ancre)) erreurs.push(`${nom} : ancre #${ancre} absente de ${path.basename(cible)}`);
  }
}
if (!local) {
  await Promise.all([...externes].map(async url => {
    try {
      const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (verification de liens)" } });
      // Site derrière une vérification anti-robots de Cloudflare : il s'ouvre dans un navigateur, pas ici.
      if (r.headers.get("cf-mitigated") === "challenge") console.log("? protégé contre les robots, à ouvrir à la main :", url);
      else if (r.status >= 400) erreurs.push(`${url} : HTTP ${r.status}`);
      else console.log("✓", r.status, url);
    } catch (e) { erreurs.push(`${url} : ${e.cause?.code || e.message}`); }
  }));
}
console.log(erreurs.length ? "\n✗ " + erreurs.join("\n✗ ") : "\nTous les liens sont bons.");
process.exit(erreurs.length ? 1 : 0);
