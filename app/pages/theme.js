// Moteur de thèmes de Rétro : chargé dans le <head> de chaque page (script classique, pas defer)
// pour appliquer l'apparence avant le premier affichage. Tout passe par des variables CSS (theme.css).
(function () {
  "use strict";
  const CLE = "retro-theme";
  const PALETTES = {
    violet: { nom: "Violet néon", couleur: "#8b5cf6" },
    bleu: { nom: "Bleu électrique", couleur: "#2f8cff" },
    rouge: { nom: "Rouge gaming", couleur: "#ff3b5c" },
    vert: { nom: "Vert néon", couleur: "#1fd67a" },
    orange: { nom: "Orange premium", couleur: "#ff9419" },
    rose: { nom: "Rose néon", couleur: "#ff4fd8" },
  };
  // schema : "dark" | "light" | "light dark" (suit Windows). Sombre par défaut : c'est l'identité de Rétro.
  const DEFAUT = { palette: "violet", perso: "#8b5cf6", schema: "dark", lueur: 60, animations: true, taille: 190, accueilRecents: true, accueilStats: true };

  const lire = () => { try { return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) || "{}") }; } catch (e) { return { ...DEFAUT }; } };
  const couleurDe = p => (p.palette === "perso" ? p.perso : (PALETTES[p.palette] || PALETTES.violet).couleur);
  // Texte lisible sur la couleur d'accent (noir sur vert/orange, blanc sur violet/bleu…).
  function surAccent(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const lin = i => { const v = parseInt(m[1].slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#0b0a12" : "#fff";
  }
  function appliquer(p) {
    const r = document.documentElement;
    let meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "color-scheme"; document.head.prepend(meta); }
    meta.content = ["dark", "light", "light dark"].includes(p.schema) ? p.schema : "dark";
    const c = couleurDe(p);
    r.style.setProperty("--accent", c);
    r.style.setProperty("--sur-accent", surAccent(c));
    r.style.setProperty("--lueur", String(Math.max(0, Math.min(100, Number(p.lueur) || 0)) / 100));
    r.style.setProperty("--taille-carte", Math.max(140, Math.min(280, Number(p.taille) || 190)) + "px");
    r.dataset.animations = p.animations ? "oui" : "non";
  }
  function enregistrer(changement) {
    const p = { ...lire(), ...changement };
    try { localStorage.setItem(CLE, JSON.stringify(p)); } catch (e) {}
    appliquer(p);
    return p;
  }
  function reinitialiser() { try { localStorage.removeItem(CLE); } catch (e) {} appliquer(lire()); }

  window.RetroTheme = { PALETTES, DEFAUT, lire, enregistrer, reinitialiser, couleurDe, surAccent };
  appliquer(lire());
  // Changement fait dans une autre page de l'appli : appliqué tout de suite ici aussi.
  addEventListener("storage", e => { if (e.key === CLE || e.key === null) appliquer(lire()); });

  // Raccourcis communs à toutes les pages (sauf pendant une partie).
  addEventListener("keydown", e => {
    if (document.body && document.body.classList.contains("en-jeu")) return;
    const saisie = e.target.closest && e.target.closest("input, textarea, select");
    if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      const aller = { "1": "accueil.html", "2": "bibliotheque.html", ",": "reglages.html" }[e.key];
      if (aller) { e.preventDefault(); location.href = aller; return; }
      if (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "f") {
        const champ = document.querySelector("[data-recherche]");
        if (champ) { e.preventDefault(); champ.focus(); champ.select(); }
        else if (e.key.toLowerCase() === "k") { e.preventDefault(); location.href = "bibliotheque.html"; }
      }
    } else if (e.key === "/" && !saisie) {
      const champ = document.querySelector("[data-recherche]");
      if (champ) { e.preventDefault(); champ.focus(); }
    }
  });
})();
