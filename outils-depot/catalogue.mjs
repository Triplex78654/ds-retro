// Met à jour catalogue/jeux.json d'après les fichiers de jeux présents dans catalogue/.
// Les fiches existantes (genre, auteur…) sont conservées ; les nouveaux fichiers sont ajoutés.
import fs from "node:fs";
import path from "node:path";

const dossier = "catalogue";
const listePath = path.join(dossier, "jeux.json");
const extensions = [".nds", ".zip", ".7z"];

const fichiers = fs.readdirSync(dossier).filter(f => extensions.includes(path.extname(f).toLowerCase())).sort();
let liste = { jeux: [] };
try { liste = JSON.parse(fs.readFileSync(listePath, "utf8")); } catch (e) {}
const existants = new Map((liste.jeux || []).map(j => [j.fichier, j]));

const nomLisible = f => f.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();

const jeux = fichiers.map(f => existants.get(f) || { fichier: f, nom: nomLisible(f) });
jeux.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
const contenu = JSON.stringify({ jeux }, null, 2) + "\n";
if (contenu !== fs.readFileSync(listePath, "utf8").toString()) {
  fs.writeFileSync(listePath, contenu);
  console.log(`Catalogue mis à jour : ${jeux.length} jeu(x).`);
} else {
  console.log("Catalogue déjà à jour.");
}
