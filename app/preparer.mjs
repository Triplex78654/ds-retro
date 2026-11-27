// Copie la console (les fichiers du site) dans app/site/ avant de lancer ou de construire l'appli.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const racine = path.resolve(ici, "..");
const cible = path.join(ici, "site");
const aCopier = ["index.html", "console.js", "config.js", "discord-sdk.js", "console", "emulateur", "polices", "images", "catalogue"];

fs.rmSync(cible, { recursive: true, force: true });
fs.mkdirSync(cible, { recursive: true });
for (const nom of aCopier) {
  const source = path.join(racine, nom);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(cible, nom), { recursive: true });
}
for (const nom of fs.readdirSync(path.join(ici, "pages"))) fs.cpSync(path.join(ici, "pages", nom), path.join(cible, nom), { recursive: true });
console.log("Console copiée dans app/site/");
