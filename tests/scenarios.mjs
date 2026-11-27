// Scénarios de bout en bout. Chaque joueur est un navigateur ; Discord est simulé
// (jetons « dev:<id>:<serveur> », acceptés seulement par le serveur local).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const tests = [];
// reessai : les scénarios dans le navigateur ont droit à un second essai (lenteurs passagères).
const test = (nom, fn, options = {}) => tests.push({ nom, fn, ...options });
const attendre = ms => new Promise(r => setTimeout(r, ms));
// Couleur d'un point de l'écran que voit le spectateur (vidéo directe si elle tourne, sinon images relayées).
const pixelVu = () => {
  const v = document.getElementById("video-distante");
  let source = document.getElementById("ecran-distant");
  if (!v.hidden && v.videoWidth) { const t = document.createElement("canvas"); t.width = 256; t.height = 448; t.getContext("2d").drawImage(v, 0, 0, 256, 448); source = t; }
  return [...source.getContext("2d").getImageData(10, 10, 1, 1).data].slice(0, 3);
};
const estRouge = ([r, , b]) => r > 200 && b < 60, estBleu = ([r, , b]) => b > 200 && r < 60;
// Attend qu'une fonction asynchrone de la page renvoie vrai (waitForFunction n'attend pas les promesses).
async function attendreQue(p, fn, arg, delai = 15_000, message = "délai dépassé") {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (await p.evaluate(fn, arg).catch(() => false)) return;
    await attendre(300);
  }
  throw new Error(message);
}

export async function lancerScenarios({ site }) {
  const API = site + "/.proxy/api";
  const navigateur = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    // WebRtcHideLocalIpsWithMdns : sans ça, les consoles d'une même machine ne se trouvent pas en direct.
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required",
      "--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  const captures = path.join(path.dirname(new URL(import.meta.url).pathname), "captures");
  fs.mkdirSync(captures, { recursive: true });

  const appel = (chemin, jeton, options = {}) => fetch(API + chemin, { ...options, headers: { Authorization: "Bearer " + jeton, ...(options.headers || {}) } });

  // Un joueur : une page de la console « dans Discord ».
  async function joueur(id, nom, serveur, { mobile = false, emulateur = false, instance = "i-tests", sansDirect = false } = {}) {
    const ctx = await navigateur.newContext(mobile
      ? { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1100, height: 650 } });
    if (sansDirect) await ctx.addInitScript(() => { delete window.RTCPeerConnection; });
    const p = await ctx.newPage();
    p.erreurs = [];
    // Ignorées : la vérification de mise à jour d'EmulatorJS (hors ligne ici) et la demande d'écran
    // allumé faite par le cœur de l'émulateur, refusée par le navigateur des tests.
    p.on("pageerror", e => { if (!/Failed to fetch|Wake Lock permission/.test(String(e))) p.erreurs.push(String(e)); });
    const kit = `window.DiscordEmbedded = { patchUrlMappings() {}, DiscordSDK: class { constructor() { this.instanceId = ${JSON.stringify(instance)}; this.guildId = ${JSON.stringify(serveur)};
      this.commands = { authorize: async () => ({ code: "x" }), authenticate: async () => ({ user: { id: ${JSON.stringify(id)}, username: ${JSON.stringify(nom)}, global_name: ${JSON.stringify(nom)} } }) }; }
      ready() { return Promise.resolve(); } } };`;
    await p.route("**/discord-sdk.js", r => r.fulfill({ body: kit, contentType: "text/javascript" }));
    await p.route("**/.proxy/api/token", r => r.fulfill({ body: JSON.stringify({ access_token: `dev:${id}:${serveur}` }), contentType: "application/json" }));
    if (!emulateur) await p.route("**/emulateur/**", r => r.abort());
    await p.goto(site + "/index.html?frame_id=tests&instance_id=" + instance);
    await p.waitForFunction(() => salon.etat !== "connexion" && salon.etat !== "hors-discord", null, { timeout: 15_000 });
    return p;
  }
  const textes = (p, selecteur) => p.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.trim()), selecteur);
  const sha = octets => crypto.createHash("sha256").update(octets).digest("hex");
  const jeuAleatoire = (nom, taille) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jeu-")), nom);
    fs.writeFileSync(f, crypto.randomBytes(taille));
    return f;
  };

  // ---------------------------------------------------------------------------
  test("Accès : étranger refusé, pote accepté une fois que le propriétaire a ouvert l'Activité", async () => {
    assert.equal((await appel("/ludotheque", "dev:222:100000000000000001")).status, 403, "pote avant le propriétaire");
    const r = await appel("/ticket", "dev:111:100000000000000001", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instance: "i-tests", guilde: "100000000000000001" }) });
    assert.equal(r.status, 200, "ticket du propriétaire");
    assert.equal((await appel("/ludotheque", "dev:222:100000000000000001")).status, 200, "pote après");
    assert.equal((await appel("/sauvegardes", "dev:333:200000000000000002")).status, 403, "étranger");
    const t = await appel("/ticket", "dev:333:200000000000000002", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instance: "i-tests", guilde: "200000000000000002" }) });
    assert.equal(t.status, 403, "un étranger ne peut pas ajouter son serveur");
    assert.equal((await appel("/ludotheque", "n-importe-quoi")).status, 401, "faux jeton");
  });

  test("Salon : ticket obligatoire, lié au salon et infalsifiable", async () => {
    const essai = url => new Promise(ok => { const ws = new WebSocket(url); ws.onopen = () => { ws.close(); ok("ouvert"); }; ws.onerror = () => ok("refusé"); });
    const W = site.replace("http", "ws") + "/.proxy/api/salle/";
    const { ticket } = await (await appel("/ticket", "dev:222:100000000000000001", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instance: "i-tests" }) })).json();
    assert.equal(await essai(W + "i-tests?jeton=dev:222:100000000000000001"), "refusé", "ancien jeton dans l'adresse");
    assert.equal(await essai(W + "i-tests?ticket=" + encodeURIComponent(ticket)), "ouvert", "bon ticket");
    assert.equal(await essai(W + "i-autre?ticket=" + encodeURIComponent(ticket)), "refusé", "ticket d'un autre salon");
    const [corps, signature] = ticket.split(".");
    assert.equal(await essai(W + "i-tests?ticket=" + encodeURIComponent(corps.slice(0, -2) + "AA." + signature)), "refusé", "ticket modifié");
  });

  test("Sauvegardes : historique espacé de 10 min, date plus ancienne refusée", async () => {
    const jeu = "0123456789abcdef", t0 = 1_800_000_000_000, min = 60_000;
    const envoyer = (maj, octet) => appel("/sauvegardes/" + jeu, "dev:222:100000000000000001", { method: "PUT", headers: { "X-Maj": String(maj) }, body: new Uint8Array(500).fill(octet) });
    for (const [d, o] of [[0, 1], [11, 2], [12, 3], [13, 4]]) assert.equal((await envoyer(t0 + d * min, o)).status, 200);
    assert.equal((await envoyer(t0 + 5 * min, 9)).status, 409);
    const versions = await (await appel(`/sauvegardes/${jeu}/versions`, "dev:222:100000000000000001")).json();
    assert.deepEqual(versions.map(v => (v.maj - t0) / min), [13, 12, 0]);
    const v0 = new Uint8Array(await (await appel(`/sauvegardes/${jeu}/versions/${t0}`, "dev:222:100000000000000001")).arrayBuffer());
    assert.equal(v0[0], 1);
  });

  test("Console : catalogue partagé avec le pote, étranger bloqué", async () => {
    const raiden = await joueur("111", "Raiden", "100000000000000001");
    const kenji = await joueur("222", "Kenji", "100000000000000001", { mobile: true });
    const zoe = await joueur("333", "Zoe", "200000000000000002", { mobile: true });
    assert.equal(await raiden.evaluate(() => salon.etat), "connecte");
    assert.equal(await kenji.evaluate(() => salon.etat), "connecte");
    assert.equal(await zoe.evaluate(() => salon.etat), "refuse");
    await raiden.setInputFiles("#fichier", jeuAleatoire("Jeu Partage.nds", 300_000));
    await raiden.waitForSelector("#apres-ajout:not([hidden])");
    await raiden.click("#apres-ajout button:not(.principal)");
    await kenji.click('.vue-jeux[data-vue="catalogue"]');
    await kenji.waitForFunction(() => document.querySelector("#grille-catalogue").textContent.includes("Jeu Partage"), null, { timeout: 10_000 });
    assert.ok((await textes(kenji, "#grille-catalogue .titre-grille span:first-child")).some(t => t.startsWith("Chez ")));
    await kenji.click('#grille-catalogue .cart[aria-label^="Demander"]');
    await raiden.waitForFunction(() => salon.propositions.length === 1, null, { timeout: 5_000 });
    await zoe.click('.vue-jeux[data-vue="catalogue"]');
    assert.ok(!(await textes(zoe, "#grille-catalogue .titre-grille span:first-child")).some(t => t.startsWith("Chez ")), "l'étranger ne voit rien");
    await kenji.screenshot({ path: path.join(captures, "catalogue-pote.png") });
    for (const p of [raiden, kenji, zoe]) { assert.deepEqual(p.erreurs, []); await p.context().close(); }
  }, { reessai: true });

  test("Cloud : un jeu revient identique sur un autre appareil", async () => {
    const fichier = jeuAleatoire("Jeu Cloud.nds", 4_500_000);
    const attendu = sha(fs.readFileSync(fichier));
    const pc = await joueur("222", "Kenji", "100000000000000001", { instance: "i-cloud" });
    await pc.setInputFiles("#fichier", fichier);
    await pc.waitForFunction(() => document.getElementById("etat-ludo").textContent.includes("rien que pour toi"), null, { timeout: 30_000 });
    await pc.context().close();
    const tel = await joueur("222", "Kenji", "100000000000000001", { mobile: true, instance: "i-cloud" });
    await tel.waitForSelector('#grille .cart.nuage[aria-label*="Jeu Cloud"]', { timeout: 10_000 });
    await tel.click('#grille .cart.nuage[aria-label*="Jeu Cloud"]');
    await attendreQue(tel, () => listerCartouches().then(l => l.some(c => c.nom === "Jeu Cloud.nds")), null, 20_000, "jeu pas récupéré");
    const obtenu = await tel.evaluate(async () => {
      const c = (await listerCartouches()).find(x => x.nom === "Jeu Cloud.nds");
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await c.blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("");
    });
    assert.equal(obtenu, attendu);
    await tel.context().close();
  }, { reessai: true });

  test("Émulateur : démarre sans menus EmulatorJS, sauvegardes et états dans le cloud", async () => {
    const p = await joueur("111", "Raiden", "100000000000000001", { emulateur: true, instance: "i-emu" });
    await p.click('.vue-jeux[data-vue="catalogue"]');
    await p.click('#grille-catalogue .cart[aria-label="Jouer à Space Impakto DS"]');
    await p.waitForFunction(() => jeuDemarre, null, { timeout: 60_000 });
    assert.equal(await p.evaluate(() => EJS_emulator.ejs_version), "4.2.3");
    await attendre(1500);
    const boite = await p.locator("#game").boundingBox();
    await p.mouse.click(boite.x + boite.width / 2, boite.y + boite.height * 0.8, { button: "right" });
    assert.equal(await p.evaluate(() => [...document.querySelectorAll("#game .ejs_context_menu, #game .ejs_menu_bar")].filter(e => getComputedStyle(e).display !== "none").length), 0);
    await p.screenshot({ path: path.join(captures, "emulateur.png") });
    // État : sauvé, envoyé dans le cloud, puis rechargé sur un appareil qui ne l'a pas
    await p.evaluate(() => { ouvrirPause(); afficherOnglet("partie"); });
    await p.click("#sauver-etat");
    await attendreQue(p, () => infoEtatCloud(cartoucheId).then(i => Boolean(i)), null, 15_000, "état pas envoyé dans le cloud");
    const id = await p.evaluate(() => cartoucheId);
    await p.evaluate(i => magasin("etats", "readwrite", s => s.delete(i)), id);
    await p.evaluate(() => majInfosPartie());
    assert.equal(await p.evaluate(() => document.getElementById("charger-etat").disabled), false, "état disponible depuis le cloud");
    await p.click("#charger-etat");
    await attendreQue(p, i => lireDans("etats", i).then(e => Boolean(e)), id, 15_000, "état pas rechargé depuis le cloud");
    // Anciennes sauvegardes : l'écran s'ouvre
    await p.evaluate(() => { ouvrirPause(); afficherOnglet("partie"); });
    await p.click("#anciennes");
    await p.waitForFunction(() => !document.getElementById("versions").hidden && !document.getElementById("versions").textContent.includes("Chargement"), null, { timeout: 10_000 });
    assert.deepEqual(p.erreurs, []);
    await p.context().close();
  }, { reessai: true });

  // Fausse partie : un écran d'une seule couleur à la place de l'émulateur.
  const lancerFaussePartie = (p, couleur, jeu) => p.evaluate(([couleur, jeu]) => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 448; document.getElementById("game").appendChild(c);
    const g = c.getContext("2d"); setInterval(() => { g.fillStyle = couleur; g.fillRect(0, 0, 256, 448); }, 100);
    window.touchesRecues = [];
    const avant = envoyerTouche; envoyerTouche = (t, b) => { touchesRecues.push(t + ":" + b); avant(t, b); };
    jeuActif = true; jeuDemarre = true; nomJeu = jeu; cartoucheId = jeu + "|1";
    document.getElementById("menu").style.display = "none"; majOnglets(); annoncerJeu();
  }, [couleur, jeu]);
  const attendreEcran = async (p, test, message) => {
    const fin = Date.now() + 8_000;
    while (Date.now() < fin) { if (test(await p.evaluate(pixelVu))) return; await attendre(250); }
    throw new Error(message);
  };

  test("Salon : deux parties en même temps, on regarde l'une puis l'autre", async () => {
    const raiden = await joueur("111", "Raiden", "100000000000000001", { instance: "i-multi" });
    const kenji = await joueur("222", "Kenji", "100000000000000001", { instance: "i-multi" });
    const zoe = await joueur("444", "Zoe", "100000000000000001", { mobile: true, instance: "i-multi" });
    await lancerFaussePartie(raiden, "#ff0000", "Jeu Rouge");
    await lancerFaussePartie(kenji, "#0000ff", "Jeu Bleu");
    await attendreQue(zoe, () => salon.infos.parties.length === 2, null, 5_000, "les deux parties n'apparaissent pas");
    await zoe.evaluate(() => regarder("111"));
    await attendreEcran(zoe, estRouge, "l'écran rouge n'arrive pas");
    assert.equal(await kenji.evaluate(() => salon.infos.spectateurs.length), 0, "personne ne regarde Kenji");
    // Zoé passe sur la partie de Kenji depuis l'onglet Salon
    await zoe.evaluate(() => { ouvrirPause(); afficherOnglet("salon"); });
    await zoe.screenshot({ path: path.join(captures, "deux-parties-salon.png") });
    await zoe.locator("#liste-joueurs button", { hasText: "Regarder" }).first().click();
    await attendreEcran(zoe, estBleu, "l'écran bleu n'arrive pas");
    await zoe.evaluate(() => fermerPause());
    assert.equal(await raiden.evaluate(() => salon.infos.spectateurs.length), 0, "Raiden n'a plus de spectateur");
    // Manette de la partie de Kenji pour Zoé : ses touches vont chez Kenji, pas chez Raiden
    await kenji.evaluate(() => envoyerSalon({ t: "manette", a: "444" }));
    await attendreQue(zoe, () => salon.infos.manette === "444", null, 5_000, "la manette n'arrive pas");
    await zoe.evaluate(() => { toucheSpectateur(0, true); toucheSpectateur(0, false); });
    await attendreQue(kenji, () => touchesRecues.length >= 2, null, 5_000, "Kenji ne reçoit pas les touches");
    assert.deepEqual(await raiden.evaluate(() => touchesRecues), [], "Raiden ne reçoit rien");
    await zoe.screenshot({ path: path.join(captures, "deux-parties.png") });
    for (const p of [raiden, kenji, zoe]) { assert.deepEqual(p.erreurs, []); await p.context().close(); }
  }, { reessai: true });

  test("Diffusion directe : vidéo en direct sans relais, et secours si le direct est impossible", async () => {
    const raiden = await joueur("111", "Raiden", "100000000000000001", { instance: "i-direct" });
    const kenji = await joueur("222", "Kenji", "100000000000000001", { mobile: true, instance: "i-direct" });
    const zoe = await joueur("444", "Zoe", "100000000000000001", { mobile: true, instance: "i-direct", sansDirect: true });
    await lancerFaussePartie(raiden, "#ff0000", "Jeu Rouge");
    await attendreQue(kenji, () => salon.infos.parties.length === 1, null, 5_000, "la partie n'apparaît pas");
    await kenji.evaluate(() => regarder("111"));
    await attendreQue(kenji, () => !document.getElementById("video-distante").hidden && document.getElementById("video-distante").videoWidth > 0, null, 10_000, "la vidéo directe n'arrive pas");
    await attendreEcran(kenji, estRouge, "la vidéo directe n'est pas rouge");
    await attendreQue(raiden, () => salon.infos.spectateurs.length === 1 && salon.infos.relais.length === 0, null, 5_000, "le serveur relaie encore des images à Kenji");
    // Zoé n'a pas la connexion directe : elle reçoit les images relayées
    await zoe.evaluate(() => regarder("111"));
    await attendreEcran(zoe, estRouge, "les images relayées n'arrivent pas chez Zoé");
    assert.deepEqual(await raiden.evaluate(() => salon.infos.relais), ["444"]);
    assert.equal(await zoe.evaluate(() => document.getElementById("video-distante").hidden), true);
    await kenji.screenshot({ path: path.join(captures, "direct.png") });
    for (const p of [raiden, kenji, zoe]) { assert.deepEqual(p.erreurs, []); await p.context().close(); }
  }, { reessai: true });

  test("GBA : la cartouche démarre avec mGBA dans l'écran du haut, sa sauvegarde est copiée", async () => {
    const p = await joueur("111", "Raiden", "100000000000000001", { emulateur: true, instance: "i-gba" });
    await p.setInputFiles("#fichier", path.join(path.dirname(new URL(import.meta.url).pathname), "roms", "test-rouge.gba"));
    await p.waitForSelector("#apres-ajout:not([hidden])");
    assert.equal(await p.evaluate(() => { const c = document.querySelector('#grille .cart[aria-label*="test-rouge"]'); return c && c.classList.contains("gba") && c.querySelector(".systeme").textContent; }), "GBA");
    await p.screenshot({ path: path.join(captures, "gba-cartouche.png") });
    await p.click("#apres-ajout button.principal");
    await p.waitForFunction(() => jeuDemarre, null, { timeout: 60_000 });
    await p.waitForSelector("#game canvas", { state: "attached", timeout: 30_000 });
    assert.equal(await p.evaluate(() => [systemeJeu, document.body.classList.contains("mode-gba"), EJS_core]).then(x => x.join(",")), "gba,true,mgba");
    // Ce que verraient les spectateurs : rouge dans l'écran du haut, noir dans celui du bas
    const couleurs = async () => p.evaluate(() => {
      const t = document.createElement("canvas"); t.width = 256; t.height = 448;
      const g = t.getContext("2d"); dessinerJeu(g, document.querySelector("#game canvas"));
      return [[...g.getImageData(128, 96, 1, 1).data].slice(0, 3), [...g.getImageData(128, 350, 1, 1).data].slice(0, 3)];
    });
    const fin = Date.now() + 10_000;
    let vu;
    while (Date.now() < fin) { vu = await couleurs(); if (vu[0][0] > 200 && vu[0][2] < 60) break; await attendre(300); }
    assert.ok(vu[0][0] > 200 && vu[0][2] < 60, "écran du haut rouge : " + JSON.stringify(vu));
    assert.deepEqual(vu[1], [0, 0, 0], "écran du bas éteint");
    await p.screenshot({ path: path.join(captures, "gba-partie.png") });
    // La ROM écrit 0x42 dans sa sauvegarde : elle doit être copiée sur l'appareil
    await attendreQue(p, async () => { await sauverSram(true); const s = await lireDans("sauvegardes", cartoucheId); return Boolean(s && s.donnees[0] === 0x42); }, null, 15_000, "sauvegarde GBA pas copiée");
    assert.deepEqual(p.erreurs, []);
    await p.context().close();
  }, { reessai: true });

  // ---------------------------------------------------------------------------
  let reussis = 0;
  for (const t of tests) {
    const debut = Date.now();
    for (let essai = 1; essai <= (t.reessai ? 2 : 1); essai++) {
      try {
        await t.fn();
        reussis++;
        console.log(`✓ ${t.nom} (${((Date.now() - debut) / 1000).toFixed(1)} s${essai > 1 ? ", au 2e essai" : ""})`);
        break;
      } catch (e) {
        if (essai < (t.reessai ? 2 : 1)) { console.log(`… ${t.nom} : nouvel essai (${String(e && e.message || e).split("\n")[0]})`); continue; }
        console.log(`✗ ${t.nom}\n   ${String(e && e.message || e).split("\n").join("\n   ")}`);
      }
    }
  }
  await navigateur.close();
  console.log(`\n${reussis}/${tests.length} scénarios réussis`);
  return reussis === tests.length;
}
