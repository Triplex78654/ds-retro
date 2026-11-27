  // L'émulateur dessine en WebGL : on garde chaque image lisible pour pouvoir la diffuser au salon.
  (() => {
    const origine = HTMLCanvasElement.prototype.getContext;
    const connecter = AudioNode.prototype.connect;
    window.__sortiesAudio = [];
    AudioNode.prototype.connect = function (cible, ...reste) {
      const r = connecter.call(this, cible, ...reste);
      try {
        if (typeof AudioDestinationNode === "function" && cible instanceof AudioDestinationNode) {
          const ctx = this.context;
          if (!ctx.__sortieDirecte) { ctx.__sortieDirecte = ctx.createMediaStreamDestination(); window.__sortiesAudio.push(ctx.__sortieDirecte); }
          connecter.call(this, ctx.__sortieDirecte);
        }
      } catch (e) {}
      return r;
    };
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") options = Object.assign({}, options, { preserveDrawingBuffer: true });
      return origine.call(this, type, options);
    };
  })();
  const CONFIG = window.DS_RETRO_CONFIG || {};
  const DANS_DISCORD = new URLSearchParams(location.search).has("frame_id");
  // EmulatorJS 4.2.3 est hébergé avec la console (dossier emulateur/) : version figée, rien chargé d'ailleurs.
  const CDN = "emulateur/";
  let discordPret = Promise.resolve();

  // Dans l'appli Rétro pour PC : un bouton pour revenir au menu d'accueil.
  if (window.retroApp) {
    const retour = document.createElement("a");
    retour.href = "accueil.html"; retour.textContent = "← Accueil";
    retour.setAttribute("style", "position:fixed;left:14px;top:12px;z-index:50;font:600 14px/1 system-ui,sans-serif;color:#eef0f4;background:#2b303bcc;border:1px solid #ffffff22;border-radius:9px;padding:9px 12px;text-decoration:none");
    retour.addEventListener("click", e => { if (typeof jeuActif !== "undefined" && jeuActif) { e.preventDefault(); Promise.resolve(typeof sauverSram === "function" && sauverSram(true)).finally(() => { location.href = "accueil.html"; }); } });
    document.body.appendChild(retour);
  }

  if (DANS_DISCORD) {
    document.getElementById("lieu").textContent = "Discord";
    if (window.DiscordEmbedded && CONFIG.discordApplicationId) {
      const sdk = new DiscordEmbedded.DiscordSDK(CONFIG.discordApplicationId);
      window.discordSdk = sdk;
      discordPret = sdk.ready().catch(() => {});
    }
  }
  const EXTENSIONS = [".nds", ".gba", ".gb", ".gbc", ".zip", ".7z"];
  // Consoles prises en charge. Comme sur une DS Lite, une cartouche GBA se met dans la fente du bas
  // et le jeu s'affiche sur un seul écran. Le cœur mGBA lit aussi les jeux Game Boy et Game Boy Color.
  const SYSTEMES = {
    nds: { nom: "DS", coeur: "desmume", mode: "ds" },
    gba: { nom: "GBA", coeur: "mgba", mode: "gba" },
    gbc: { nom: "GBC", coeur: "mgba", mode: "gb" },
    gb: { nom: "GB", coeur: "mgba", mode: "gb" },
  };
  let systemeJeu = "nds";
  function systemeDuNom(nom) {
    const n = String(nom || "").toLowerCase();
    if (n.endsWith(".gba")) return "gba";
    if (n.endsWith(".gbc")) return "gbc";
    if (n.endsWith(".gb")) return "gb";
    if (n.endsWith(".nds")) return "nds";
    return null;
  }
  // Pour un .zip, on lit la liste des fichiers qu'il contient ; pour un .7z, on se fie au nom.
  async function systemeDuFichier(blob, nom) {
    const direct = systemeDuNom(nom);
    if (direct) return direct;
    if (/\.zip$/i.test(nom) && blob) {
      try {
        const fin = new Uint8Array(await blob.slice(Math.max(0, blob.size - 65_557)).arrayBuffer());
        for (let i = 0; i + 46 <= fin.length; i++) {
          if (fin[i] !== 0x50 || fin[i + 1] !== 0x4b || fin[i + 2] !== 0x01 || fin[i + 3] !== 0x02) continue;
          const longueur = fin[i + 28] | (fin[i + 29] << 8);
          const s = systemeDuNom(new TextDecoder().decode(fin.subarray(i + 46, i + 46 + longueur)));
          if (s) return s;
        }
      } catch (e) {}
    }
    if (/\bgba\b/i.test(nom)) return "gba";
    if (/\bgbc\b/i.test(nom)) return "gbc";
    return "nds";
  }
  const $ = id => document.getElementById(id);
  const lire = (cle, defaut) => { try { return localStorage.getItem(cle) || defaut; } catch (e) { return defaut; } };
  const ecrire = (cle, val) => { try { localStorage.setItem(cle, val); } catch (e) {} };

