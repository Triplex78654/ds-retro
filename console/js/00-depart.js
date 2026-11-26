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

  if (DANS_DISCORD) {
    document.getElementById("lieu").textContent = "Discord";
    if (window.DiscordEmbedded && CONFIG.discordApplicationId) {
      const sdk = new DiscordEmbedded.DiscordSDK(CONFIG.discordApplicationId);
      window.discordSdk = sdk;
      discordPret = sdk.ready().catch(() => {});
    }
  }
  const EXTENSIONS = [".nds", ".zip", ".7z"];
  const $ = id => document.getElementById(id);
  const lire = (cle, defaut) => { try { return localStorage.getItem(cle) || defaut; } catch (e) { return defaut; } };
  const ecrire = (cle, val) => { try { localStorage.setItem(cle, val); } catch (e) {} };

