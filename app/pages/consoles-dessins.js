// Dessins des consoles (SVG, sans logo ni marque) pour les tuiles de choix de console : accueil, pages de console, site.
// RetroDessins.console(id) rend le SVG (texte fixe défini ici, jamais de données de l'utilisateur).
(function () {
  "use strict";
  const svg = c => '<svg viewBox="0 0 160 100" aria-hidden="true" focusable="false">' + c + "</svg>";
  const DESSINS = {
    // NES : boîte grise, trappe à cartouche nervurée, bande noire en bas avec boutons et voyant rouge
    nes: svg(`
      <rect x="10" y="30" width="140" height="52" rx="3" fill="#cfcfd3"/>
      <rect x="10" y="30" width="140" height="6" rx="2" fill="#bdbdc2"/>
      <rect x="18" y="40" width="86" height="20" rx="1.5" fill="#b5b5ba"/>
      <path d="M22 45h78M22 49.5h78M22 54h78" stroke="#9d9da3" stroke-width="1.6"/>
      <rect x="10" y="62" width="140" height="20" rx="2" fill="#26262a"/>
      <rect x="20" y="67" width="11" height="9" rx="1" fill="#4a4a50"/><rect x="36" y="67" width="11" height="9" rx="1" fill="#4a4a50"/>
      <circle cx="107" cy="71.5" r="1.8" fill="#ff3b3b"/>
      <rect x="113" y="68" width="14" height="7" rx="1.5" fill="#d9d9dd"/><rect x="131" y="68" width="14" height="7" rx="1.5" fill="#d9d9dd"/>`),
    // Super Nintendo (modèle arrondi) : corps gris clair, fente à cartouche, curseurs et bouton d'éjection
    snes: svg(`
      <rect x="12" y="40" width="136" height="44" rx="16" fill="#d9dade"/>
      <rect x="34" y="26" width="92" height="22" rx="8" fill="#c9cad0"/>
      <rect x="48" y="31" width="64" height="5" rx="2" fill="#2d2e33"/>
      <rect x="24" y="52" width="14" height="6" rx="2" fill="#8e8f96"/><rect x="122" y="52" width="14" height="6" rx="2" fill="#8e8f96"/>
      <rect x="70" y="52" width="20" height="7" rx="3" fill="#b2b3ba"/>
      <rect x="30" y="70" width="12" height="7" rx="1.5" fill="#55565c"/><rect x="46" y="70" width="12" height="7" rx="1.5" fill="#55565c"/>
      <circle cx="112" cy="73" r="1.6" fill="#ff4444"/>`),
    // Nintendo 64 : corps anthracite, bosse centrale avec la fente, 4 prises manette devant
    n64: svg(`
      <path d="M8 60 Q10 46 30 44 L52 40 Q80 22 108 40 L130 44 Q150 46 152 60 L150 80 Q148 86 140 86 L20 86 Q12 86 10 80 Z" fill="#3a3c42"/>
      <path d="M58 40 Q80 26 102 40 Z" fill="#2c2e33"/>
      <rect x="62" y="35" width="36" height="4" rx="2" fill="#111215"/>
      <rect x="30" y="50" width="10" height="5" rx="2" fill="#6c6e75"/><rect x="120" y="50" width="10" height="5" rx="2" fill="#6c6e75"/>
      <g fill="#1b1c20"><rect x="40" y="70" width="14" height="9" rx="2"/><rect x="60" y="70" width="14" height="9" rx="2"/><rect x="86" y="70" width="14" height="9" rx="2"/><rect x="106" y="70" width="14" height="9" rx="2"/></g>`),
    // PlayStation : boîtier gris vu de dessus, grand couvercle rond, trois boutons ronds
    psx: svg(`
      <rect x="14" y="14" width="132" height="74" rx="6" fill="#c9cacf"/>
      <rect x="14" y="14" width="132" height="74" rx="6" fill="none" stroke="#b4b5bb" stroke-width="2"/>
      <circle cx="58" cy="51" r="31" fill="#bfc0c6" stroke="#a9aab0" stroke-width="2"/>
      <circle cx="58" cy="51" r="6" fill="#adaeb4"/>
      <circle cx="108" cy="34" r="7" fill="#9fa0a7"/><circle cx="126" cy="54" r="6" fill="#9fa0a7"/><circle cx="108" cy="70" r="6" fill="#9fa0a7"/>
      <circle cx="126" cy="72" r="1.6" fill="#3fd06a"/>`),
    // DS Lite ouverte : deux écrans, croix et boutons
    ds: svg(`
      <rect x="44" y="4" width="72" height="44" rx="5" fill="#eceef2"/>
      <rect x="56" y="10" width="48" height="33" rx="1.5" fill="#1b1d24"/><rect x="58" y="12" width="44" height="29" fill="hsl(220 60% 40%)"/>
      <rect x="40" y="52" width="80" height="44" rx="6" fill="#e3e5ea"/>
      <rect x="62" y="58" width="36" height="28" rx="1.5" fill="#1b1d24"/><rect x="64" y="60" width="32" height="24" fill="hsl(220 50% 30%)"/>
      <path d="M49 69h8v-4h4v4h0v4h-4v4h-4v-4h-4z" fill="#3a3c44"/>
      <g fill="#3a3c44"><circle cx="110" cy="64" r="2.3"/><circle cx="105" cy="69" r="2.3"/><circle cx="115" cy="69" r="2.3"/><circle cx="110" cy="74" r="2.3"/></g>`),
    // 3DS ouverte : écran du haut plus large, pad circulaire, croix, boutons
    "3ds": svg(`
      <rect x="36" y="4" width="88" height="44" rx="6" fill="#2b3040"/>
      <rect x="44" y="10" width="72" height="33" rx="1.5" fill="#0d0f14"/><rect x="46" y="12" width="68" height="29" fill="hsl(195 60% 40%)"/>
      <rect x="36" y="52" width="88" height="44" rx="6" fill="#323848"/>
      <rect x="62" y="58" width="36" height="28" rx="1.5" fill="#0d0f14"/><rect x="64" y="60" width="32" height="24" fill="hsl(195 50% 30%)"/>
      <circle cx="49" cy="63" r="5" fill="#1b1e27" stroke="#5a6072" stroke-width="1.2"/>
      <path d="M45 77h5v-3h3v3h0v3h-3v3h-3v-3h-2z" fill="#1b1e27"/>
      <g fill="#cfd3dd"><circle cx="112" cy="63" r="2"/><circle cx="108" cy="67" r="2"/><circle cx="116" cy="67" r="2"/><circle cx="112" cy="71" r="2"/></g>`),
    // Switch : écran noir au centre, manettes bleue à gauche et rouge à droite
    switch: svg(`
      <rect x="12" y="20" width="26" height="62" rx="12" fill="#18b7e6"/>
      <rect x="122" y="20" width="26" height="62" rx="12" fill="#ff5b53"/>
      <rect x="36" y="20" width="88" height="62" rx="3" fill="#222328"/>
      <rect x="42" y="25" width="76" height="52" rx="1" fill="#0c0d10"/><rect x="44" y="27" width="72" height="48" fill="hsl(260 30% 22%)"/>
      <circle cx="25" cy="38" r="5" fill="#2a2c32"/><circle cx="135" cy="60" r="5" fill="#2a2c32"/>
      <g fill="#2a2c32"><circle cx="25" cy="56" r="2"/><circle cx="21" cy="60" r="2"/><circle cx="29" cy="60" r="2"/><circle cx="25" cy="64" r="2"/>
      <circle cx="135" cy="34" r="2"/><circle cx="131" cy="38" r="2"/><circle cx="139" cy="38" r="2"/><circle cx="135" cy="42" r="2"/></g>`),
    // PSP : console noire allongée aux bouts arrondis, écran large
    psp: svg(`
      <rect x="6" y="28" width="148" height="48" rx="24" fill="#1d1e22"/>
      <rect x="6" y="28" width="148" height="48" rx="24" fill="none" stroke="#3b3d44" stroke-width="1.5"/>
      <rect x="40" y="33" width="80" height="38" rx="1.5" fill="#0a0b0d"/><rect x="42" y="35" width="76" height="34" fill="hsl(230 35% 26%)"/>
      <path d="M17 48h6v-4h4v4h6v4h-6v4h-4v-4h-6z" fill="#4a4c54"/>
      <circle cx="26" cy="64" r="3" fill="#3a3c43"/>
      <g fill="#4a4c54"><circle cx="138" cy="43" r="2.6"/><circle cx="132" cy="49" r="2.6"/><circle cx="144" cy="49" r="2.6"/><circle cx="138" cy="55" r="2.6"/></g>`),
    // PlayStation 2 : boîtier noir à deux étages, rainures, tiroir à disque
    ps2: svg(`
      <rect x="10" y="34" width="140" height="48" rx="2" fill="#17181c"/>
      <rect x="10" y="34" width="140" height="22" rx="2" fill="#202126"/>
      <path d="M96 40h50M96 44h50M96 48h50M96 52h50" stroke="#0c0c0f" stroke-width="2"/>
      <rect x="18" y="42" width="70" height="5" rx="1" fill="#0b0b0d"/>
      <rect x="10" y="56" width="140" height="2" fill="#2f3138"/>
      <circle cx="22" cy="68" r="2.2" fill="#3fa0ff"/>
      <g fill="#0b0b0d"><rect x="40" y="64" width="12" height="9" rx="1.5"/><rect x="56" y="64" width="12" height="9" rx="1.5"/><rect x="78" y="65" width="7" height="6" rx="1"/><rect x="88" y="65" width="7" height="6" rx="1"/></g>`),
    // PlayStation 3 (premier modèle) : noire et brillante, dessus bombé, fente à disque
    ps3: svg(`
      <path d="M10 82 L10 52 Q10 30 40 28 L120 28 Q150 30 150 52 L150 82 Z" fill="#141519"/>
      <path d="M14 50 Q16 34 42 32 L118 32 Q144 34 146 50" fill="none" stroke="#3a3c44" stroke-width="2"/>
      <rect x="10" y="60" width="140" height="22" fill="#1d1e23"/>
      <rect x="30" y="66" width="80" height="3" rx="1.5" fill="#050506"/>
      <rect x="10" y="80" width="140" height="3" fill="#2a2c32"/>
      <circle cx="132" cy="70" r="2" fill="#3fd06a"/>`),
    // PlayStation 4 : boîtier plat en biais, deux parties (mate et brillante), barre lumineuse bleue
    ps4: svg(`
      <path d="M14 70 L28 40 L146 40 L132 70 Z" fill="#16171b"/>
      <path d="M14 70 L28 40 L74 40 L60 70 Z" fill="#202127"/>
      <path d="M60 70 L74 40" stroke="#4fa3ff" stroke-width="2.4"/>
      <path d="M14 70 L132 70 L132 78 L14 78 Z" fill="#0d0e11"/>
      <rect x="24" y="73" width="40" height="2" rx="1" fill="#2c2e35"/>`),
    // Xbox : grosse boîte noire, gros rond vert (sans logo) au centre du dessus, tiroir à disque
    xbox: svg(`
      <rect x="14" y="30" width="132" height="54" rx="6" fill="#1b1c20"/>
      <rect x="14" y="30" width="132" height="14" rx="6" fill="#26282e"/>
      <circle cx="80" cy="44" r="15" fill="#1f2a1c" stroke="#5fbf3a" stroke-width="3"/>
      <circle cx="80" cy="44" r="6" fill="#2e4a26"/>
      <rect x="40" y="66" width="80" height="6" rx="2" fill="#0c0d10"/>
      <circle cx="26" cy="74" r="2.4" fill="#5fbf3a"/>`),
    // Xbox 360 : boîtier blanc légèrement creusé au milieu, voyant d'allumage en anneau
    x360: svg(`
      <path d="M12 34 Q12 28 18 28 L142 28 Q148 28 148 34 L148 80 Q148 86 142 86 L18 86 Q12 86 12 80 Z" fill="#e8e9ec"/>
      <path d="M40 30 Q80 38 120 30 L120 84 Q80 76 40 84 Z" fill="#d6d7db"/>
      <rect x="52" y="54" width="56" height="4" rx="2" fill="#a7a9ae"/>
      <circle cx="132" cy="44" r="5" fill="#c9cace" stroke="#6ad04a" stroke-width="2"/>
      <g fill="#b7b9be"><rect x="20" y="40" width="10" height="3" rx="1"/><rect x="20" y="46" width="10" height="3" rx="1"/></g>`),
    // GameCube : cube violet vu de dessus, couvercle rond, poignée à l'arrière
    gc: svg(`
      <rect x="54" y="6" width="52" height="12" rx="5" fill="none" stroke="#4b3f8f" stroke-width="5"/>
      <rect x="34" y="14" width="92" height="80" rx="7" fill="#6a5acd"/>
      <circle cx="80" cy="50" r="27" fill="#5b4cb8" stroke="#4b3f8f" stroke-width="2"/>
      <circle cx="80" cy="50" r="5" fill="#4b3f8f"/>
      <circle cx="44" cy="84" r="4" fill="#4b3f8f"/><circle cx="116" cy="84" r="4" fill="#4b3f8f"/>`),
  };
  window.RetroDessins = { console: id => DESSINS[id] || "" };
})();
