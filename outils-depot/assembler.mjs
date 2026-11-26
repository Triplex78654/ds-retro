// Rassemble console/js/*.js (dans l'ordre des noms) en un seul console.js, chargé par index.html.
// Les morceaux partagent la même portée, comme quand tout était dans index.html.
//   node outils-depot/assembler.mjs             écrit console.js
//   node outils-depot/assembler.mjs --verifier  échoue si console.js n'est pas à jour
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dossier = path.join(racine, "console", "js");
const morceaux = fs.readdirSync(dossier).filter(f => f.endsWith(".js")).sort();
const entete = "// Fichier assemblé à partir de console/js/ par outils-depot/assembler.mjs : ne pas le modifier à la main.\n";
const contenu = entete + morceaux.map(f => fs.readFileSync(path.join(dossier, f), "utf8")).join("");
const cible = path.join(racine, "console.js");

if (process.argv.includes("--verifier")) {
  const actuel = fs.existsSync(cible) ? fs.readFileSync(cible, "utf8") : "";
  if (actuel !== contenu) {
    console.error("console.js n'est pas à jour : lance « node outils-depot/assembler.mjs ».");
    process.exit(1);
  }
  console.log(`console.js à jour (${morceaux.length} morceaux).`);
} else {
  fs.writeFileSync(cible, contenu);
  console.log(`console.js écrit (${morceaux.length} morceaux).`);
}
