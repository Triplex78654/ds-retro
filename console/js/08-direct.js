  // ---------- Diffusion directe (WebRTC) : vidéo et son de l'hôte vers chaque spectateur ----------
  // Le salon sert seulement à présenter les deux consoles. Si la connexion directe échoue
  // (réseau, Discord), le spectateur reste sur les images relayées par le serveur, sans le son.
  // Image du jeu dans une toile 256 × 448 (les deux écrans de la DS, écart compris).
  // GBA : 240 × 160 au centre de l'écran du haut ; Game Boy : agrandi à la hauteur de l'écran du haut.
  const ZONES_ECRAN = { gba: [8, 16, 240, 160], gb: [21.333, 0, 213.333, 192] };
  function dessinerJeu(g, source) {
    const zone = ZONES_ECRAN[SYSTEMES[systemeJeu].mode];
    if (!zone) return g.drawImage(source, 0, 0, 256, 448);
    g.fillStyle = "#000"; g.fillRect(0, 0, 256, 448);
    g.drawImage(source, ...zone);
  }
  const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
  const pairs = new Map();          // chez l'hôte : spectateur → connexion
  const echecsDirects = new Set();  // spectateurs pour qui le direct a échoué (on ne réessaie pas en boucle)
  let fluxDirect = null, boucleDirecte = 0;
  function fluxHote() {
    if (fluxDirect) return fluxDirect;
    const toile = document.createElement("canvas");
    toile.width = 256; toile.height = 448;
    const g = toile.getContext("2d");
    const dessiner = () => {
      const source = document.querySelector("#game canvas");
      if (source && source.width && !menuOuvert) dessinerJeu(g, source);
      boucleDirecte = requestAnimationFrame(dessiner);
    };
    dessiner();
    fluxDirect = toile.captureStream(30);
    window.__sortiesAudio.forEach(d => d.stream.getAudioTracks().forEach(t => fluxDirect.addTrack(t)));
    return fluxDirect;
  }
  function fermerPairs() {
    pairs.forEach(pc => pc.close());
    pairs.clear();
    if (fluxDirect) { fluxDirect.getVideoTracks().forEach(t => t.stop()); fluxDirect = null; cancelAnimationFrame(boucleDirecte); }
  }
  function majDirectHote() {
    if (!estHote() || typeof RTCPeerConnection !== "function") { if (pairs.size || fluxDirect) fermerPairs(); return; }
    const voulus = new Set(salon.infos.spectateurs);
    for (const [id, pc] of pairs) if (!voulus.has(id)) { pc.close(); pairs.delete(id); }
    echecsDirects.forEach(id => { if (!voulus.has(id)) echecsDirects.delete(id); });
    for (const id of voulus) if (!pairs.has(id) && !echecsDirects.has(id)) ouvrirPairHote(id).catch(() => {});
    if (!pairs.size && fluxDirect) fermerPairs();
  }
  async function ouvrirPairHote(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pairs.set(id, pc);
    const flux = fluxHote();
    flux.getTracks().forEach(t => pc.addTrack(t, flux));
    pc.onicecandidate = e => { if (e.candidate) envoyerSalon({ t: "rtc", a: id, d: { candidate: e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && pairs.get(id) === pc) { echecsDirects.add(id); pc.close(); pairs.delete(id); }
    };
    await pc.setLocalDescription(await pc.createOffer());
    envoyerSalon({ t: "rtc", a: id, d: { description: pc.localDescription.toJSON() } });
  }

  let pairSpectateur = null, sonCoupe = false;
  async function recevoirRtc(m) {
    const d = m.d || {};
    if (estHote()) {
      const pc = pairs.get(m.de);
      if (!pc) return;
      if (d.description && d.description.type === "answer") await pc.setRemoteDescription(d.description);
      else if (d.candidate) await pc.addIceCandidate(d.candidate).catch(() => {});
      return;
    }
    if (!spectateur || m.de !== salon.regarde || typeof RTCPeerConnection !== "function") return;
    if (d.description && d.description.type === "offer") {
      fermerPairSpectateur();
      const pc = pairSpectateur = new RTCPeerConnection({ iceServers: ICE });
      const hote = m.de;
      pc.onicecandidate = e => { if (e.candidate) envoyerSalon({ t: "rtc", a: hote, d: { candidate: e.candidate.toJSON() } }); };
      pc.ontrack = e => afficherVideo(e.streams[0]);
      pc.onconnectionstatechange = () => {
        if (pc !== pairSpectateur) return;
        if (pc.connectionState === "connected") envoyerSalon({ t: "direct", oui: true });
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) { envoyerSalon({ t: "direct", oui: false }); cacherVideo(); }
      };
      await pc.setRemoteDescription(d.description);
      await pc.setLocalDescription(await pc.createAnswer());
      envoyerSalon({ t: "rtc", a: hote, d: { description: pc.localDescription.toJSON() } });
    } else if (d.candidate && pairSpectateur) {
      await pairSpectateur.addIceCandidate(d.candidate).catch(() => {});
    }
  }
  function afficherVideo(flux) {
    const v = $("video-distante");
    if (v.srcObject !== flux) v.srcObject = flux;
    v.hidden = false;
    v.muted = false;
    v.play().then(() => { sonCoupe = false; majSalon(); }).catch(() => {
      // Le navigateur refuse le son sans appui : on lance sans le son, un appui sur l'écran le remet.
      v.muted = true; sonCoupe = true;
      v.play().catch(() => {});
      majSalon();
    });
  }
  function remettreLeSon() {
    if (!sonCoupe) return;
    const v = $("video-distante");
    v.muted = false;
    v.play().then(() => { sonCoupe = false; majSalon(); }).catch(() => {});
  }
  function cacherVideo() {
    const v = $("video-distante");
    v.hidden = true;
    v.srcObject = null;
    sonCoupe = false;
  }
  function fermerPairSpectateur() {
    if (pairSpectateur) { const pc = pairSpectateur; pairSpectateur = null; pc.close(); }
    cacherVideo();
  }

