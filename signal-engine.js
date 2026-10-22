/* LOGISTICA — signaux sonores pour tablettes et téléphones en environnement bruyant.
   Moteur commun (Distribution, application livreur) : sons synthétisés par le navigateur (aucun fichier), volume et sourdine propres à chaque appareil,
   répétition et vibration. Les règles (quels événements sonnent, avec quel son) sont définies par chaque application ; ce moteur ne fait que jouer.

   ANGELS_SIGNAL.jouer(son, { rep, vib, force, dire })   joue un son (rep : 1 à 5 répétitions) puis, si « dire » est fourni, lit ce texte à voix haute ; renvoie false si coupé ou si l'audio n'est pas encore débloqué
   ANGELS_SIGNAL.parler(texte, { force })          lecture vocale seule (synthèse vocale du navigateur, voix française) ; false si coupée, non prise en charge ou désactivée sur l'appareil
   ANGELS_SIGNAL.tester(son)                       joue même en sourdine (bouton « Tester »)
   ANGELS_SIGNAL.dev() / setDev({ mute, vol, vib })   réglages de l'appareil (stockage local : « angels_signal_dev »)
   ANGELS_SIGNAL.pret()                            vrai quand le navigateur a autorisé le son (après un premier toucher de l'écran) */
(function (G) {
  "use strict";
  var KEY = "angels_signal_dev", ctx = null, debloque = false;
  var SONS = [
    { id: "carillon", nom: "Carillon (doux)" },
    { id: "cloche", nom: "Cloche" },
    { id: "bip", nom: "Bip court" },
    { id: "alerte", nom: "Alerte forte" },
    { id: "sirene", nom: "Sirène (urgent)" }
  ];
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  function dev() {
    var o = {}; try { o = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { o = {}; }
    return { mute: o.mute === true, vol: clamp(+o.vol || 0.8, 0.1, 1), vib: o.vib !== false, voice: o.voice !== false, rate: clamp(+o.rate || 1, 0.7, 1.4) };
  }
  function setDev(p) { var d = dev(); if (p && p.mute != null) d.mute = !!p.mute; if (p && p.vol != null) d.vol = clamp(+p.vol || 0.8, 0.1, 1); if (p && p.vib != null) d.vib = !!p.vib; if (p && p.voice != null) d.voice = !!p.voice; if (p && p.rate != null) d.rate = clamp(+p.rate || 1, 0.7, 1.4); try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { } return d; }

  function unlock() {
    try {
      if (!ctx) { var AC = G.AudioContext || G.webkitAudioContext; if (AC) ctx = new AC(); }
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (ctx && ctx.state === "running") debloque = true;
    } catch (e) { }
  }
  ["pointerdown", "touchstart", "keydown", "click"].forEach(function (ev) { document.addEventListener(ev, unlock, { passive: true }); });

  /* une note : fréquence, début (s), durée (s), forme d'onde, force (0-1) */
  function note(f, t0, d, type, g) {
    var o = ctx.createOscillator(), v = ctx.createGain(), t = ctx.currentTime + t0;
    o.type = type || "sine"; o.frequency.setValueAtTime(f, t); o.connect(v); v.connect(ctx.destination);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.start(t); o.stop(t + d + 0.05);
  }
  function glisse(f1, f2, t0, d, type, g) {
    var o = ctx.createOscillator(), v = ctx.createGain(), t = ctx.currentTime + t0;
    o.type = type || "sawtooth"; o.frequency.setValueAtTime(f1, t); o.frequency.linearRampToValueAtTime(f2, t + d); o.connect(v); v.connect(ctx.destination);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), t + 0.03); v.gain.setValueAtTime(Math.max(0.0002, g), t + d - 0.05); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.start(t); o.stop(t + d + 0.05);
  }
  /* durée de chaque son (s), pour espacer les répétitions */
  var DUREE = { carillon: 1.0, cloche: 1.3, bip: 0.5, alerte: 1.1, sirene: 1.4 };
  function une(son, vol) {
    var g = 0.9 * vol;
    if (son === "cloche") { note(660, 0, 1.2, "sine", g); note(1320, 0, 0.8, "sine", g * 0.45); note(1980, 0, 0.4, "sine", g * 0.2); }
    else if (son === "bip") { note(1200, 0, 0.18, "square", g * 0.55); note(1200, 0.26, 0.18, "square", g * 0.55); }
    else if (son === "alerte") { for (var i = 0; i < 3; i++) note(1000, i * 0.32, 0.22, "square", g * 0.6); }
    else if (son === "sirene") { glisse(600, 1000, 0, 0.6, "sawtooth", g * 0.5); glisse(1000, 600, 0.6, 0.6, "sawtooth", g * 0.5); }
    else { note(880, 0, 0.35, "triangle", g); note(1175, 0.28, 0.6, "triangle", g); }   /* carillon */
  }

  /* ---------- Lecture vocale ---------- */
  function vocal() { return !!(G.speechSynthesis && G.SpeechSynthesisUtterance); }
  function voixFr() { try { var L = G.speechSynthesis.getVoices() || []; return L.filter(function (v) { return /^fr/i.test(v.lang); }).sort(function (a, b) { return (/fr[-_]FR/i.test(b.lang) ? 1 : 0) - (/fr[-_]FR/i.test(a.lang) ? 1 : 0); })[0] || null; } catch (e) { return null; } }
  if (vocal()) { try { G.speechSynthesis.getVoices(); if (G.speechSynthesis.addEventListener) G.speechSynthesis.addEventListener("voiceschanged", function () { G.speechSynthesis.getVoices(); }); } catch (e) { } }
  function parler(txt, o) {
    o = o || {}; if (!vocal()) return false; var d = dev();
    if (!o.force && (d.mute || !d.voice)) return false;
    txt = String(txt == null ? "" : txt).replace(/\s+/g, " ").trim(); if (!txt) return false;
    try {
      var u = new G.SpeechSynthesisUtterance(txt), v = voixFr(); u.lang = (v && v.lang) || "fr-FR"; if (v) u.voice = v; u.volume = d.vol; u.rate = d.rate;
      G.speechSynthesis.cancel(); G.speechSynthesis.speak(u); return true;
    } catch (e) { return false; }
  }
  function jouer(son, o) {
    o = o || {}; var d = dev();
    if (!o.force && d.mute) return false;
    unlock(); if (!ctx || ctx.state !== "running") return false;
    var id = DUREE[son] ? son : "carillon", n = clamp(Math.round(+o.rep || 1), 1, 5), vol = d.vol;
    for (var k = 0; k < n; k++) (function (k) { setTimeout(function () { try { une(id, vol); } catch (e) { } }, k * (DUREE[id] + 0.5) * 1000); })(k);
    if (o.vib !== false && d.vib && G.navigator && G.navigator.vibrate) { try { G.navigator.vibrate([250, 120, 250, 120, 450]); } catch (e) { } }
    if (o.dire) setTimeout(function () { parler(o.dire, { force: !!o.force }); }, Math.round(n * (DUREE[id] + 0.5) * 1000) + 150);   /* la voix suit le son */
    return true;
  }
  function tester(son) { return jouer(son, { force: true, rep: 1 }); }

  G.ANGELS_SIGNAL = { SONS: SONS, jouer: jouer, parler: parler, vocal: vocal, tester: tester, dev: dev, setDev: setDev, unlock: unlock, pret: function () { unlock(); return !!ctx && ctx.state === "running"; } };
})(window);
