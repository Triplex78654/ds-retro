// Données partagées par les pages de l'appli : consoles, liste des jeux, favoris, jeux récents,
// cartes de jeu, navigation au clavier / à la manette, bouton de mise à jour.
(function () {
  "use strict";

  // ---------- Consoles ----------
  // coeur : cœur EmulatorJS (jeu dans l'appli) ; externe : émulateur Windows téléchargé au premier jeu.
  const CONSOLES = {
    // DS / GBA / Game Boy : catalogue ici, partie dans la console DS (index.html, partagée avec l'Activité Discord).
    ds: { nom: "DS, GBA et Game Boy", annee: 2004, sigle: "DS", support: "carteds", ds: true, h: 220, extensions: [".nds", ".gba", ".gb", ".gbc", ".zip", ".7z"],
      formats: "Jeux DS (.nds), GBA (.gba), Game Boy (.gb, .gbc), ou un .zip / .7z qui en contient un.",
      aide: "Les touches et la manette se règlent dans la console DS : son menu, onglet Touches." },
    nes: { nom: "NES", annee: 1983, sigle: "NES", support: "nes", coeur: "fceumm", h: 0, extensions: [".nes", ".zip", ".7z"], formats: "Fichiers .nes (ou un .zip / .7z qui en contient un).",
      aide: "Clavier : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> bouger · <kbd>Espace</kbd> ou <kbd>K</kbd> A · <kbd>J</kbd> B · <kbd>Entrée</kbd> Start · <kbd>Retour</kbd> Select. Manette : stick ou croix, A/B, gâchettes RT = B (tir) et LT = A." },
    snes: { nom: "Super Nintendo", annee: 1990, sigle: "SNES", support: "snes", coeur: "snes9x", h: 265, extensions: [".sfc", ".smc", ".zip", ".7z"], formats: "Fichiers .sfc ou .smc (ou un .zip / .7z).",
      aide: "Clavier : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> bouger · <kbd>K</kbd> B · <kbd>L</kbd> A · <kbd>J</kbd> Y · <kbd>I</kbd> X · <kbd>A</kbd> <kbd>E</kbd> L / R · <kbd>Entrée</kbd> Start. Manette : stick ou croix, gâchettes et bumpers = L / R." },
    n64: { nom: "Nintendo 64", annee: 1996, sigle: "N64", support: "n64", coeur: "mupen64plus_next", h: 140, extensions: [".z64", ".n64", ".v64", ".zip", ".7z"], formats: "Fichiers .z64, .n64 ou .v64 (ou un .zip / .7z).",
      aide: "Clavier : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> stick · souris caméra (boutons C) · clic gauche Z (tir) · clic droit R (viser) · <kbd>Espace</kbd> A · <kbd>J</kbd> B · <kbd>Maj</kbd> Z · <kbd>A</kbd> <kbd>E</kbd> L / R · <kbd>↑↓←→</kbd> boutons C · <kbd>Entrée</kbd> Start. Manette : stick gauche, stick droit = boutons C, gâchettes = Z, bumpers = L / R." },
    psx: { nom: "PlayStation", annee: 1994, sigle: "PS1", support: "cd", coeur: "pcsx_rearmed", h: 210, extensions: [".chd", ".pbp", ".zip", ".7z", ".iso"], formats: "Un fichier .chd ou .pbp, ou un .zip avec le .cue et les .bin du jeu.",
      aide: "Clavier : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> bouger · souris caméra · clic gauche R2 · clic droit L2 · <kbd>Espace</kbd> ✕ · <kbd>L</kbd> ○ · <kbd>J</kbd> □ · <kbd>I</kbd> △ · <kbd>A</kbd> <kbd>E</kbd> L1 / R1 · <kbd>Maj</kbd> L2 · <kbd>R</kbd> R2 · <kbd>Entrée</kbd> Start. Manette DualShock : deux sticks, gâchettes L2 / R2." },
    "3ds": { nom: "3DS", annee: 2011, sigle: "3DS", support: "carte3ds", externe: "Azahar", h: 350, extensions: [".cci", ".3ds", ".cxi", ".cia", ".3dsx", ".zcci", ".zcxi", ".z3dsx"], formats: "Tes jeux 3DS déchiffrés : .cia, .cci, .cxi ou .3dsx (un .3ds déchiffré renommé en .cci marche).",
      aide: "Clavier : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> stick · <kbd>Maj</kbd> marcher · <kbd>Entrée</kbd> A (valider) · <kbd>Espace</kbd> B (retour) · <kbd>I</kbd> X · <kbd>J</kbd> Y · <kbd>A</kbd> <kbd>E</kbd> L / R · <kbd>↑↓←→</kbd> croix · <kbd>P</kbd> Start · <kbd>O</kbd> Select · souris = écran tactile. Avec une manette branchée (appuie sur un bouton ici avant de lancer), tout passe par la manette." },
    switch: { nom: "Switch", annee: 2017, sigle: "NX", support: "switch", externe: "Eden", h: 355, extensions: [".nsp", ".xci", ".nca", ".nro", ".nso"], formats: "Tes jeux Switch : .nsp ou .xci (avec tes clés et ton firmware).",
      aide: "Clavier : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> stick · <kbd>Maj</kbd> marcher · souris caméra · clic gauche ZR · clic droit ZL · <kbd>Entrée</kbd> A · <kbd>Espace</kbd> B · <kbd>I</kbd> X · <kbd>J</kbd> Y · <kbd>A</kbd> <kbd>E</kbd> L / R · <kbd>↑↓←→</kbd> croix · <kbd>P</kbd> + · <kbd>O</kbd> − · <kbd>C</kbd> <kbd>V</kbd> clic des sticks. Manette : règle-la une fois dans Eden, l'appli la remet ensuite toute seule quand elle est branchée (appuie sur un de ses boutons ici avant de lancer)." },
    psp: { nom: "PSP", annee: 2004, sigle: "PSP", support: "umd", externe: "PPSSPP", h: 200, extensions: [".iso", ".cso", ".chd", ".pbp"], formats: "Tes jeux PSP : .iso, .cso, .chd ou .pbp." },
    ps2: { nom: "PlayStation 2", annee: 2000, sigle: "PS2", support: "dvd", externe: "PCSX2", h: 230, extensions: [".iso", ".chd", ".cso", ".zso", ".cue"], formats: "Tes jeux PS2 : .iso, .chd, .cso ou .cue (avec le BIOS de ta PS2)." },
    ps3: { nom: "PlayStation 3", annee: 2006, sigle: "PS3", support: "bluray", externe: "RPCS3", h: 0, dossiers: true, extensions: [".iso"], formats: "Tes jeux PS3 : un dossier de jeu (avec PS3_GAME ou EBOOT.BIN dedans) ou un .iso." },
  };
  for (const [id, c] of Object.entries(CONSOLES)) { c.id = id; c.page = "salon.html?console=" + encodeURIComponent(id); }
  const BIENTOT = [{ id: "gc", nom: "GameCube et Wii", sigle: "GC", support: "minidisque", h: 255, detail: "avec Dolphin" }];

  // ---------- Stockage local (IndexedDB) : jeux ajoutés à la main, sauvegardes, états ----------
  let base;
  const ouvrir = () => base || (base = new Promise((ok, ko) => {
    const r = indexedDB.open("retro-salon", 1);
    r.onupgradeneeded = () => { for (const s of ["jeux", "sauvegardes", "etats"]) r.result.createObjectStore(s, { keyPath: "id" }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  }));
  const magasin = async (s, mode, f) => { const db = await ouvrir(); return new Promise((ok, ko) => { const t = db.transaction(s, mode); const q = f(t.objectStore(s)); t.oncomplete = () => ok(q && q.result); t.onerror = () => ko(t.error); }); };
  const db = {
    lire: (s, k) => magasin(s, "readonly", o => o.get(k)),
    ecrire: (s, v) => magasin(s, "readwrite", o => o.put(v)),
    effacer: (s, k) => magasin(s, "readwrite", o => o.delete(k)),
    tous: s => magasin(s, "readonly", o => o.getAll()),
  };

  // ---------- Jeux ----------
  // Nom abîmé par une archive faite sur Mac (« Poke╠ümon ») : les caractères de cadre trahissent de l'UTF-8 lu en CP437.
  const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
  function reparer(t) {
    if (!/[─-╿]/.test(t)) return t;
    const octets = [];
    for (const c of t) {
      if (c.charCodeAt(0) < 128) { octets.push(c.charCodeAt(0)); continue; }
      const i = CP437.indexOf(c);
      if (i < 0) return t;
      octets.push(128 + i);
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(octets)).normalize("NFC"); } catch (e) { return t; }
  }
  const nomLisible = n => reparer(String(n)).replace(/\.(nds|gba|gbc|gb|nes|sfc|smc|z64|n64|v64|chd|pbp|zip|7z|iso|cci|3ds|cxi|cia|3dsx|zcci|zcxi|z3dsx|nsp|xci|nca|nro|nso|cso|zso|cue)$/i, "").replace(/[_]+/g, " ").trim();
  const teinte = t => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initiales = t => nomLisible(t).split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join("").toUpperCase() || "?";
  const cle = j => j.console + ":" + j.nom;
  const accepte = (C, n) => C.extensions.some(x => n.toLowerCase().endsWith(x));
  const taille = o => !o ? "" : o >= 1e9 ? (o / 1e9).toFixed(1).replace(".", ",") + " Go" : o >= 1e6 ? Math.round(o / 1e6) + " Mo" : Math.max(1, Math.round(o / 1e3)) + " Ko";

  async function jeuxDuDossier(id) {
    const C = CONSOLES[id];
    try {
      const r = await fetch("jeux-pc/" + id + "/", { cache: "no-store" });
      if (!r.ok) return [];
      return (await r.json()).filter(f => (f.dossier ? C.dossiers : accepte(C, f.nom)))
        .map(f => ({ id: id + ":" + f.nom + "|" + f.taille, console: id, nom: f.nom, taille: f.taille, maj: f.maj, source: "pc", dossier: Boolean(f.dossier), trouve: Boolean(f.trouve) }));
    } catch (e) { return []; }
  }
  // Tous les jeux d'une console : dossier du PC, jeux trouvés par la recherche, jeux ajoutés à la main.
  async function lister(id, ajoutesDeja) {
    const ajoutes = (ajoutesDeja || await db.tous("jeux").catch(() => [])).filter(j => j.console === id).map(j => ({ ...j, source: "ajoute" }));
    const pc = await jeuxDuDossier(id);
    const vus = new Set(pc.map(j => j.id));
    return pc.concat(ajoutes.filter(j => !vus.has(j.id))).sort((a, b) => nomLisible(a.nom).localeCompare(nomLisible(b.nom), "fr"));
  }
  async function listerTout() {
    const ajoutes = await db.tous("jeux").catch(() => []);
    const listes = await Promise.all(Object.keys(CONSOLES).map(id => lister(id, ajoutes)));
    return listes.flat();
  }
  const provenance = j => j.source === "pc" ? (j.trouve ? "Trouvé sur ton PC" : j.dossier ? "Dossier de jeu" : "Dans ton dossier Rétro") : "Ajouté à l'appli";

  // ---------- Favoris et jeux récents (sur ce PC) ----------
  const lireListe = k => { try { const v = JSON.parse(localStorage.getItem(k) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const ecrireListe = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const favoris = () => new Set(lireListe("retro-favoris"));
  const estFavori = j => favoris().has(cle(j));
  function basculerFavori(j) {
    const f = favoris(), k = cle(j);
    f.has(k) ? f.delete(k) : f.add(k);
    ecrireListe("retro-favoris", [...f]);
    return f.has(k);
  }
  const recents = () => lireListe("retro-recents");
  function noterLancement(j) {
    const k = cle(j);
    ecrireListe("retro-recents", [{ cle: k, console: j.console, nom: j.nom, date: Date.now() }].concat(recents().filter(r => r.cle !== k)).slice(0, 24));
    try { localStorage.setItem("retro-lancements", String((Number(localStorage.getItem("retro-lancements")) || 0) + 1)); } catch (e) {}
  }
  const lancements = () => { try { return Number(localStorage.getItem("retro-lancements")) || 0; } catch (e) { return 0; } };
  const dernierLancement = j => { const r = recents().find(x => x.cle === cle(j)); return r ? r.date : 0; };
  const ilYA = t => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "à l'instant";
    if (s < 3600) return "il y a " + Math.round(s / 60) + " min";
    if (s < 86400) return "il y a " + Math.round(s / 3600) + " h";
    const j = Math.round(s / 86400);
    return j === 1 ? "hier" : "il y a " + j + " jours";
  };

  // ---------- Carte d'un jeu ----------
  function carte(j, { sousTitre } = {}) {
    const C = CONSOLES[j.console];
    const b = document.createElement("button"); b.type = "button"; b.className = "carte";
    b.style.setProperty("--t", teinte(j.nom));
    b.style.setProperty("--h", C ? C.h : 260);
    b.setAttribute("aria-label", nomLisible(j.nom) + (C ? ", " + C.nom : ""));
    const jaq = document.createElement("span"); jaq.className = "jaquette"; jaq.dataset.support = !C ? "nes" : C.ds && /\.gba$/i.test(j.nom) ? "gba" : C.ds && /\.gbc?$/i.test(j.nom) ? "gb" : C.support;
    jaq.innerHTML = '<span class="media"><span class="etiquette"></span></span>';
    jaq.querySelector(".etiquette").textContent = initiales(j.nom);
    const t = document.createElement("span"); t.className = "titre-jeu";
    const nom = document.createElement("span"); nom.textContent = nomLisible(j.nom);
    const sous = document.createElement("small"); sous.textContent = sousTitre != null ? sousTitre : provenance(j);
    t.append(nom, sous);
    b.append(jaq, t);
    if (estFavori(j)) { const e = document.createElement("span"); e.className = "etoile"; e.textContent = "★"; e.title = "Favori"; b.appendChild(e); }
    return b;
  }
  const lienFiche = j => "salon.html?console=" + encodeURIComponent(j.console) + "&jeu=" + encodeURIComponent(j.nom);

  // ---------- Navigation au clavier et à la manette ----------
  // Flèches / croix : élément le plus proche dans la direction ; A : valider ; B : retour.
  function deplacer(selecteur, dx, dy) {
    const liste = [...document.querySelectorAll(selecteur)].filter(e => e.offsetParent !== null);
    if (!liste.length) return;
    const actuel = liste.includes(document.activeElement) ? document.activeElement : null;
    if (!actuel) return liste[0].focus();
    const r = actuel.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let meilleur = null, score = Infinity;
    for (const e of liste) {
      if (e === actuel) continue;
      const s = e.getBoundingClientRect(), x = s.left + s.width / 2 - cx, y = s.top + s.height / 2 - cy;
      if (dx && (Math.sign(x) !== dx || Math.abs(y) > Math.max(r.height, s.height) / 2)) continue;
      if (dy && (Math.sign(y) !== dy || Math.abs(y) < 4)) continue;
      const d = Math.abs(x) * (dy ? 2 : 1) + Math.abs(y) * (dx ? 2 : 1);
      if (d < score) { score = d; meilleur = e; }
    }
    if (meilleur) { meilleur.focus(); meilleur.scrollIntoView({ block: "nearest" }); }
  }
  function navigation(selecteur, { retour, actif = () => true } = {}) {
    addEventListener("keydown", e => {
      if (!actif() || e.target.closest("input:not([type=checkbox]):not([type=radio]), textarea, select")) return;
      const t = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (t) { e.preventDefault(); deplacer(selecteur, ...t); }
    });
    let avant = {};
    (function boucle() {
      const m = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
      if (m && actif() && document.hasFocus()) {
        const b = i => Boolean(m.buttons[i] && m.buttons[i].pressed);
        const e = { g: b(14) || m.axes[0] < -0.6, d: b(15) || m.axes[0] > 0.6, h: b(12) || m.axes[1] < -0.6, bas: b(13) || m.axes[1] > 0.6, a: b(0), b: b(1) };
        if (e.g && !avant.g) deplacer(selecteur, -1, 0);
        if (e.d && !avant.d) deplacer(selecteur, 1, 0);
        if (e.h && !avant.h) deplacer(selecteur, 0, -1);
        if (e.bas && !avant.bas) deplacer(selecteur, 0, 1);
        if (e.a && !avant.a && document.activeElement && document.activeElement.matches(selecteur)) document.activeElement.click();
        if (e.b && !avant.b && retour) retour();
        avant = e;
      } else avant = {};
      requestAnimationFrame(boucle);
    })();
  }

  // ---------- Bouton de mise à jour de l'appli ----------
  function boutonMaj(bouton) {
    if (!window.retroApp || !retroApp.majEtat) return;
    bouton.hidden = false;
    const TEXTES = {
      inconnue: ["Chercher une mise à jour"], "a-jour": ["À jour · revérifier"], recherche: ["Recherche…", true],
      developpement: ["Mises à jour : appli installée seulement", true], portable: ["Télécharger la nouvelle version"],
      erreur: ["Mise à jour impossible · réessayer"],
    };
    let etat = { phase: "inconnue" };
    const afficher = e => {
      etat = e;
      let [texte, inactif] = TEXTES[e.phase] || [];
      if (e.phase === "disponible") texte = "Mettre à jour vers " + e.nouvelle;
      if (e.phase === "telechargement") { texte = "Téléchargement " + (e.pourcent || 0) + " %"; inactif = true; }
      if (e.phase === "prete") texte = "Redémarrer pour passer à " + e.nouvelle;
      bouton.textContent = texte || "Chercher une mise à jour";
      bouton.disabled = Boolean(inactif);
      bouton.classList.toggle("principal", e.phase === "disponible" || e.phase === "prete");
      bouton.title = e.phase === "erreur" ? e.erreur || "" : "";
    };
    retroApp.surMaj(afficher);
    retroApp.majEtat().then(afficher);
    bouton.addEventListener("click", () => {
      if (etat.phase === "disponible") return retroApp.majTelecharger();
      if (etat.phase === "prete") return retroApp.majInstaller();
      if (etat.phase === "portable") return retroApp.majPage();
      retroApp.majVerifier().then(afficher);
    });
  }

  window.RetroJeux = {
    CONSOLES, BIENTOT, db, nomLisible, teinte, initiales, cle, accepte, taille, provenance,
    jeuxDuDossier, lister, listerTout, favoris, estFavori, basculerFavori, recents, noterLancement, lancements, dernierLancement, ilYA,
    carte, lienFiche, deplacer, navigation, boutonMaj,
  };
})();
