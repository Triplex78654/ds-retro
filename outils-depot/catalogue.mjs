// Met à jour catalogue/jeux.json d'après les fichiers de jeux présents dans catalogue/.
// - Les fiches existantes (genre, auteur…) sont conservées ; les nouveaux fichiers sont ajoutés.
// - Un jeu découpé en morceaux (Jeu.7z.001, Jeu.7z.002…, comme le fait 7-Zip) devient une seule
//   entrée « Jeu.7z » avec la liste de ses parties ; la console les recolle au téléchargement.
import fs from "node:fs";
import path from "node:path";

const dossier = "catalogue";
const listePath = path.join(dossier, "jeux.json");
const extensions = [".nds", ".zip", ".7z"];
const partie = /^(.+\.(?:nds|zip|7z))\.(\d{3})$/i;

const tous = fs.readdirSync(dossier).sort();
const entrees = new Map(); // fichier -> liste des parties (ou null pour un fichier entier)
for (const f of tous) {
  const m = f.match(partie);
  if (m) {
    const base = m[1];
    if (!entrees.has(base) || entrees.get(base) === null) entrees.set(base, []);
    entrees.get(base).push(f);
  } else if (extensions.includes(path.extname(f).toLowerCase())) {
    if (!entrees.has(f)) entrees.set(f, null);
  }
}

let liste = { jeux: [] };
try { liste = JSON.parse(fs.readFileSync(listePath, "utf8")); } catch (e) {}
const existants = new Map((liste.jeux || []).map(j => [j.fichier, j]));

const nomLisible = f => f.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();

const jeux = [...entrees].map(([fichier, parties]) => {
  const jeu = { ...(existants.get(fichier) || { fichier, nom: nomLisible(fichier) }) };
  if (parties) jeu.parties = parties.sort(); else delete jeu.parties;
  return jeu;
});
jeux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

const contenu = JSON.stringify({ jeux }, null, 2) + "\n";
let avant = "";
try { avant = fs.readFileSync(listePath, "utf8"); } catch (e) {}
if (contenu !== avant) {
  fs.writeFileSync(listePath, contenu);
  console.log(`Catalogue mis à jour : ${jeux.length} jeu(x).`);
} else {
  console.log("Catalogue déjà à jour.");
}
