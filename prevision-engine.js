/* LOGISTICA — moteur commun de trésorerie prévisionnelle à 30 / 60 / 90 jours (13 semaines).
   Point de départ : les soldes de trésorerie (banque, caisse, mobile money) de la comptabilité de la division. Flux attendus :
     • encaissements : pièces ouvertes des comptes clients (échéance, ou habitude de règlement constatée du client, ou délai par défaut) ;
     • décaissements : pièces ouvertes des comptes fournisseurs / vendeurs (échéance, ou délai par défaut) ;
     • paie et charges sociales (synthèse publiée par le module RH, option) ;
     • engagements et flux prévus saisis ici (loyers, échéances d'emprunt, investissements, subventions…).
   Deux scénarios : « prévisible » (comportement de règlement habituel) et « prudent » (encaissements retardés de 15 jours, créances en retard de plus de 45 jours exclues).
   Rien n'est comptabilisé : c'est un outil de pilotage dérivé de la comptabilité.

   Contrat de l'hôte (host) :
     division ; can(a) : "v" consulter, "c" paramétrer, "p" imprimer / exporter ; user() ; identite() ; render() ; util.fcfa ; audit(a, d) ; run(fn)
     tiers : l'hôte du moteur de comptes de tiers (TIERS_HOST) — comptes() et lignes() fournissent les pièces ouvertes
     treso() : [{compte, lib, solde}] soldes (débit − crédit) des comptes de trésorerie
     store.get() / store.set(obj) : hypothèses et engagements stockés par l'hôte */
(function (G) {
  "use strict";
  var H = null, R = Math.round;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fcfa = function (n) { return H && H.util && H.util.fcfa ? H.util.fcfa(n) : R(n || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ") + " F"; };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var fd = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : (d || "—"); };
  var validDate = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !isNaN(Date.parse(d + "T00:00:00Z")); };
  var diffJ = function (a, b) { return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5); };
  var addJ = function (d, n) { return new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10); };
  var addM = function (d, n) { var y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, j = +d.slice(8, 10), Y = y + Math.floor(m / 12), M = ((m % 12) + 12) % 12, max = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate(); return new Date(Date.UTC(Y, M, Math.min(j, max))).toISOString().slice(0, 10); };
  var finMois = function (d) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).toISOString().slice(0, 10); };
  var HZ = 91;   /* 13 semaines */
  var UIS = { scenario: "" };
  var NAT = { creance: "Encaissements clients", dette: "Règlements fournisseurs et partenaires", paie: "Salaires nets", charges: "Charges sociales et retenues (CNPS, ITS, FDFP)", eng_in: "Autres entrées prévues", eng_out: "Autres sorties prévues" };
  var FREQ = { unique: "Une fois", hebdo: "Chaque semaine", mensuel: "Chaque mois", trimestriel: "Chaque trimestre" };

  /* ---------- Hypothèses ---------- */
  function cfg() {
    var s = {}; try { s = (H.store && H.store.get()) || {}; } catch (e) { s = {}; }
    return { seuil: Math.max(0, R(+s.seuil || 0)), delai_clients: s.delai_clients >= 0 && s.delai_clients <= 365 && s.delai_clients !== undefined ? R(+s.delai_clients) : 30, delai_fourn: s.delai_fourn >= 0 && s.delai_fourn <= 365 && s.delai_fourn !== undefined ? R(+s.delai_fourn) : 30, paie: s.paie !== false, scenario: s.scenario === "prudent" ? "prudent" : "prevu", engagements: Array.isArray(s.engagements) ? s.engagements : [] };
  }
  function ecrire(c) { if (!H.store) throw new Error("Cette division ne permet pas d'enregistrer les hypothèses."); H.store.set(JSON.parse(JSON.stringify({ seuil: c.seuil, delai_clients: c.delai_clients, delai_fourn: c.delai_fourn, paie: c.paie, scenario: c.scenario, engagements: c.engagements }))); }
  function hypotheses(f) {
    if (!H.can("c")) throw new Error("Droits insuffisants pour modifier les hypothèses."); var c = cfg();
    var dc = +f.delai_clients, df = +f.delai_fourn, se = +f.seuil;
    if (!(dc >= 0 && dc <= 365) || !(df >= 0 && df <= 365)) throw new Error("Délais invalides : entre 0 et 365 jours.");
    if (!(se >= 0)) throw new Error("Seuil d'alerte invalide.");
    c.delai_clients = R(dc); c.delai_fourn = R(df); c.seuil = R(se); c.paie = f.paie === true || f.paie === "oui"; ecrire(c);
    if (H.audit) H.audit("Trésorerie prévisionnelle : hypothèses", "seuil " + fcfa(c.seuil) + ", délais " + c.delai_clients + " / " + c.delai_fourn + " j");
  }
  function scenario(s) { var c = cfg(); c.scenario = s === "prudent" ? "prudent" : "prevu"; UIS.scenario = c.scenario; if (H.can("c") && H.store) ecrire(c); }
  function validEng(f) {
    f.libelle = String(f.libelle || "").trim(); if (!f.libelle) throw new Error("Libellé obligatoire.");
    if (f.sens !== "in" && f.sens !== "out") throw new Error("Sens invalide : entrée ou sortie."); f.montant = R(+f.montant || 0); if (!(f.montant > 0)) throw new Error("Montant invalide : il doit être supérieur à zéro.");
    if (!FREQ[f.freq]) throw new Error("Périodicité invalide."); if (!validDate(f.date)) throw new Error("Date invalide.");
    if (f.fin) { if (!validDate(f.fin)) throw new Error("Date de fin invalide."); if (f.fin < f.date) throw new Error("La date de fin est antérieure à la première échéance."); }
    return { libelle: f.libelle, sens: f.sens, montant: f.montant, freq: f.freq, date: f.date, fin: f.freq === "unique" ? "" : (f.fin || "") };
  }
  function ajouterEng(f) { if (!H.can("c")) throw new Error("Droits insuffisants."); var c = cfg(), e = validEng(Object.assign({}, f)); e.id = "pe" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); c.engagements.push(e); ecrire(c); if (H.audit) H.audit("Trésorerie prévisionnelle : flux prévu ajouté", e.libelle + " — " + fcfa(e.montant)); return e; }
  function modifierEng(id, f) { if (!H.can("c")) throw new Error("Droits insuffisants."); var c = cfg(), i = c.engagements.findIndex(function (x) { return x.id === id; }); if (i < 0) throw new Error("Flux prévu introuvable."); var e = validEng(Object.assign({}, f)); e.id = id; c.engagements[i] = e; ecrire(c); if (H.audit) H.audit("Trésorerie prévisionnelle : flux prévu modifié", e.libelle); return e; }
  function supprimerEng(id) { if (!H.can("c")) throw new Error("Droits insuffisants."); var c = cfg(), e = c.engagements.find(function (x) { return x.id === id; }); if (!e) throw new Error("Flux prévu introuvable."); c.engagements = c.engagements.filter(function (x) { return x.id !== id; }); ecrire(c); if (H.audit) H.audit("Trésorerie prévisionnelle : flux prévu supprimé", e.libelle); }

  /* ---------- Calcul ---------- */
  function occurrences(e, T, fin) {
    var out = [], d = e.date, n = 0;
    var suiv = function (x, k) { return e.freq === "hebdo" ? addJ(x, 7) : e.freq === "mensuel" ? addM(e.date, k) : addM(e.date, 3 * k); };
    if (e.freq === "unique") return e.date > T && e.date <= fin ? [e.date] : [];
    while (d <= fin && n < 400) { if (d > T && (!e.fin || d <= e.fin)) out.push(d); n++; d = suiv(d, n); if (e.fin && d > e.fin) break; }
    return out;
  }
  function rhPub() { try { return JSON.parse(localStorage.getItem("logistica_rh_" + H.division) || "null"); } catch (e) { return null; } }
  function calcul(o) {
    var c = cfg(), sc = (o && o.scenario) || UIS.scenario || c.scenario, P = sc === "prudent", T = today(), fin = addJ(T, HZ), ev = [], exclus = { nb: 0, montant: 0, items: [] };
    var comptes = []; try { comptes = H.tiers.comptes() || []; } catch (e) { comptes = []; }
    var jours = function (r) { return r && r.m > 0 ? Math.round(r.s / r.m) : null; };
    comptes.forEach(function (cp) {
      var liste = []; try { liste = G.LOGISTICA_TIERS.liste(cp.compte, H.tiers) || []; } catch (e) { liste = []; }
      liste.forEach(function (t) {
        (t.age.ouv || []).forEach(function (i) {
          var exp, nat = cp.nature;
          if (nat === "D") {
            var h = jours(t.reg); exp = h != null ? addJ(i.d, h) : (i.e || addJ(i.d, c.delai_clients)); if (P) exp = addJ(exp, 15);
            if (exp <= T) { var ret = diffJ(T, exp); if (ret > (P ? 45 : 90)) { exclus.nb++; exclus.montant += i.m; exclus.items.push({ tiers: t.nom, montant: i.m, retard: ret }); return; } exp = addJ(T, P ? 30 : 15); }
            ev.push({ d: exp, m: i.m, nat: "creance", lib: t.nom, tiers: t.nom });
          } else {
            exp = i.e || addJ(i.d, c.delai_fourn); if (exp <= T) exp = addJ(T, P ? 1 : 7);
            ev.push({ d: exp, m: -i.m, nat: "dette", lib: t.nom, tiers: t.nom });
          }
        });
      });
    });
    var rh = c.paie ? rhPub() : null;
    if (rh && rh.net_mois > 0) {
      var mois = T.slice(0, 7), debut = rh.dernier_mois && rh.dernier_mois >= mois ? addM(finMois(T), 1) : finMois(T), k = 0, d = debut;
      if (d <= T) d = finMois(addJ(finMois(T), 1));
      while (d <= fin && k < 6) { ev.push({ d: d, m: -R(rh.net_mois), nat: "paie", lib: "Salaires nets (" + d.slice(0, 7) + ")" }); k++; d = finMois(addJ(d, 1)); }
      var ch = Math.max(0, R(rh.cout_mois - rh.net_mois)), q = addM(T.slice(0, 8) + "15", T.slice(8, 10) >= "15" ? 1 : 0), first = true; k = 0;
      while (q <= fin && k < 6) { var mt = first && rh.charges_dues > 0 ? R(rh.charges_dues) : ch; if (mt > 0) ev.push({ d: q, m: -mt, nat: "charges", lib: "Charges sociales et retenues" }); first = false; k++; q = addM(q, 1); }
    }
    c.engagements.forEach(function (e) { occurrences(e, T, fin).forEach(function (d) { ev.push({ d: d, m: e.sens === "in" ? e.montant : -e.montant, nat: e.sens === "in" ? "eng_in" : "eng_out", lib: e.libelle }); }); });
    ev = ev.filter(function (x) { return x.m; }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : b.m - a.m; });
    var tr = []; try { tr = H.treso() || []; } catch (e) { tr = []; }
    var treso0 = R(tr.reduce(function (s, x) { return s + (+x.solde || 0); }, 0));
    /* Série quotidienne */
    var jr = {}; ev.forEach(function (x) { if (x.d <= fin) jr[x.d] = (jr[x.d] || 0) + x.m; });
    var sol = treso0, bas = { d: T, solde: treso0 }, neg = null, sous = null, dayS = {};
    for (var i = 1; i <= HZ; i++) { var dd = addJ(T, i); sol += jr[dd] || 0; dayS[dd] = sol; if (sol < bas.solde) bas = { d: dd, solde: sol }; if (neg === null && sol < 0) neg = dd; if (sous === null && sol < c.seuil) sous = dd; }
    if (treso0 < 0) neg = T; if (sous === null && treso0 < c.seuil) sous = T;
    var sem = []; for (var w = 0; w < 13; w++) { var a = addJ(T, 7 * w + 1), b = addJ(T, 7 * w + 7), enc = 0, dec = 0; ev.forEach(function (x) { if (x.d >= a && x.d <= b) { if (x.m > 0) enc += x.m; else dec -= x.m; } }); sem.push({ from: a, to: b, enc: enc, dec: dec, solde: dayS[b] }); }
    var hz = {}, nat = {}; [30, 60, 90].forEach(function (n) {
      var lim = addJ(T, n), enc = 0, dec = 0, N = {}; Object.keys(NAT).forEach(function (k) { N[k] = 0; });
      ev.forEach(function (x) { if (x.d <= lim) { if (x.m > 0) enc += x.m; else dec -= x.m; N[x.nat] += x.m; } });
      hz[n] = { enc: enc, dec: dec, solde: treso0 + enc - dec }; nat[n] = N;
    });
    var gr = function (sens) { var M = {}; ev.forEach(function (x) { if ((sens > 0) === (x.m > 0) && x.d <= addJ(T, 90)) { var k = x.tiers || x.lib; M[k] = (M[k] || 0) + Math.abs(x.m); } }); return Object.keys(M).map(function (k) { return { nom: k, montant: M[k] }; }).sort(function (a, b) { return b.montant - a.montant; }); };
    var tEnc = gr(1), tDec = gr(-1), totEnc = hz[90].enc;
    return { T: T, scenario: sc, treso0: treso0, treso: tr, ev: ev, sem: sem, h: hz, nat: nat, bas: bas, negatif: neg, sousSeuil: sous, seuil: c.seuil, besoin: Math.max(0, c.seuil - bas.solde), exclus: exclus,
      topEnc: tEnc.slice(0, 10), topDec: tDec.slice(0, 10), concentration: totEnc > 0 && tEnc.length ? tEnc[0].montant / totEnc : 0, rh: rh && rh.net_mois > 0 ? rh : null, cfg: c };
  }
  function alertes(P) {
    var a = [];
    if (P.negatif) a.push({ n: "er", t: P.negatif === P.T ? "La trésorerie est déjà négative aujourd'hui (" + fcfa(P.treso0) + ")." : "Rupture de trésorerie prévue le " + fd(P.negatif) + " : point bas de " + fcfa(P.bas.solde) + " le " + fd(P.bas.d) + ". Besoin de financement : " + fcfa(Math.max(0, -P.bas.solde)) + "." });
    else if (P.sousSeuil && P.seuil > 0) a.push({ n: "wa", t: "La trésorerie passe sous le seuil d'alerte (" + fcfa(P.seuil) + ") le " + fd(P.sousSeuil) + " ; point bas " + fcfa(P.bas.solde) + " le " + fd(P.bas.d) + "." });
    else a.push({ n: "ok", t: "Pas de rupture prévue sur 13 semaines (point bas " + fcfa(P.bas.solde) + " le " + fd(P.bas.d) + ")." });
    if (P.exclus.nb) a.push({ n: "wa", t: P.exclus.nb + " créance(s) en retard (" + fcfa(P.exclus.montant) + ") exclue(s) de la prévision car trop anciennes : leur recouvrement serait une bonne surprise." });
    if (P.concentration > 0.4) a.push({ n: "wa", t: "Concentration : " + Math.round(P.concentration * 100) + " % des encaissements à 90 jours dépendent d'un seul client (" + (P.topEnc[0] && P.topEnc[0].nom) + ")." });
    if (!P.treso.length) a.push({ n: "wa", t: "Aucun compte de trésorerie trouvé : le point de départ est à zéro." });
    return a;
  }
  function publier(host) {
    if (host) H = host; try {
      if (!H.can("v")) return null; var P = calcul({ scenario: "prevu" }), Q = calcul({ scenario: "prudent" });
      var r = { t: new Date().toISOString(), division: H.division, treso: P.treso0, seuil: P.seuil, h30: P.h[30], h60: P.h[60], h90: P.h[90], bas: P.bas, negatif: P.negatif || "", besoin: Math.max(0, -P.bas.solde), prudent: { h90: Q.h[90], bas: Q.bas, negatif: Q.negatif || "" }, exclus: P.exclus.montant };
      localStorage.setItem("logistica_prev_" + H.division, JSON.stringify(r)); return r;
    } catch (e) { return null; }
  }

  /* ---------- Affichage ---------- */
  var CSS = ".pv-w{overflow:auto}.pv-w table{width:100%;border-collapse:collapse;font-size:13px}.pv-w th,.pv-w td{border-bottom:1px solid var(--bd,#d5dbe3);padding:6px 8px;text-align:left;vertical-align:top}.pv-w th{font-size:12px;color:var(--mu,#5b6572);white-space:nowrap}.pv-w td.n,.pv-w th.n{text-align:right;white-space:nowrap}" +
    ".pv-b{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd,#d5dbe3);background:var(--card,#fff);color:var(--tx,#1c2430);cursor:pointer}.pv-b.p{background:var(--b2,#1f3a5f);color:#fff;border-color:var(--b2,#1f3a5f)}.pv-b.sm{padding:3px 8px;font-size:12px}" +
    ".pv-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0}.pv-k div{border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:9px 11px;background:var(--card,#fff)}.pv-k b{display:block;font-size:17px}.pv-k span{font-size:12px;color:var(--mu,#5b6572)}.pv-k .er b{color:#b3261e}" +
    ".pv-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.pv-n{background:var(--card,#fff);border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13px;color:var(--mu,#5b6572)}.pv-n.wa{border-left:4px solid #b26a00;color:#b26a00}.pv-n.er{border-left:4px solid #b3261e;color:#b3261e}.pv-n.ok{border-left:4px solid #1f8a4c;color:#1f8a4c}" +
    ".pv-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}.pv-svg{width:100%;height:auto;background:var(--card,#fff);border:1px solid var(--bd,#d5dbe3);border-radius:10px}";
  function css() { if (document.getElementById("pv-css")) return; var s = document.createElement("style"); s.id = "pv-css"; s.textContent = CSS; document.head.appendChild(s); }
  var kpi = function (v, l, c) { return '<div class="' + (c || "") + '"><b>' + v + "</b><span>" + esc(l) + "</span></div>"; };
  var btn = function (a, id, l, c) { return '<button type="button" class="pv-b ' + (c || "") + '" data-pv="' + a + '" data-id="' + esc(id == null ? "" : id) + '">' + l + "</button>"; };
  var num = function (v) { return v < 0 ? "(" + fcfa(-v) + ")" : fcfa(v); };
  function graphe(P) {
    var W = 640, Hh = 190, ml = 8, mr = 8, mt = 14, mb = 24, pts = [{ d: P.T, s: P.treso0 }].concat(P.sem.map(function (x) { return { d: x.to, s: x.solde }; })), vals = pts.map(function (p) { return p.s; }).concat([0, P.seuil]), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx === mn) mx = mn + 1; var X = function (i) { return ml + i * (W - ml - mr) / (pts.length - 1); }, Y = function (v) { return mt + (mx - v) * (Hh - mt - mb) / (mx - mn); };
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.s).toFixed(1); }).join(" "), z = Y(0).toFixed(1);
    var lab = pts.map(function (p, i) { return i % 3 === 0 || i === pts.length - 1 ? '<text x="' + X(i).toFixed(1) + '" y="' + (Hh - 8) + '" font-size="10" text-anchor="' + (i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle") + '" fill="#6b7280">' + fd(p.d).slice(0, 5) + "</text>" : ""; }).join("");
    var dots = pts.map(function (p, i) { return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.s).toFixed(1) + '" r="3" fill="' + (p.s < 0 ? "#b3261e" : "#1f3a5f") + '"/>'; }).join("");
    return '<svg class="pv-svg" viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="Solde de trésorerie projeté par semaine : de ' + fcfa(P.treso0) + " à " + fcfa(pts[pts.length - 1].s) + ', point bas ' + fcfa(P.bas.solde) + '"><line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + z + '" y2="' + z + '" stroke="#9aa3af" stroke-dasharray="4 3"/>' +
      (P.seuil > 0 ? '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(P.seuil).toFixed(1) + '" y2="' + Y(P.seuil).toFixed(1) + '" stroke="#b26a00" stroke-dasharray="2 3"/>' : "") + '<path d="' + line + '" fill="none" stroke="#1f3a5f" stroke-width="2"/>' + dots + lab + "</svg>";
  }
  function vue() {
    var P = calcul(), w = H.can("c"), A = alertes(P), c = P.cfg, h = '<div class="pv-root"><div class="pv-bar">' + btn("scn", "prevu", "Prévisible", P.scenario === "prevu" ? "p" : "") + btn("scn", "prudent", "Prudent", P.scenario === "prudent" ? "p" : "") +
      (w ? btn("hyp", "", "⚙ Hypothèses") + btn("eng", "", "➕ Flux prévu", "p") : "") + (H.can("p") ? btn("print", "", "🖨 Imprimer") + btn("csv", "", "⬇ CSV") : "") + '<span style="font-size:12px;color:var(--mu,#5b6572)">Du ' + fd(P.T) + " au " + fd(addJ(P.T, HZ)) + "</span></div>";
    h += '<div class="pv-k">' + kpi(num(P.treso0), "Trésorerie aujourd'hui") + [30, 60, 90].map(function (n) { return kpi(num(P.h[n].solde), "Solde projeté à " + n + " j (+" + fcfa(P.h[n].enc) + " / −" + fcfa(P.h[n].dec) + ")", P.h[n].solde < 0 ? "er" : ""); }).join("") + kpi(num(P.bas.solde), "Point bas (" + fd(P.bas.d) + ")", P.bas.solde < 0 ? "er" : "") + kpi(fcfa(P.besoin), "Besoin de financement" + (P.seuil ? " (seuil " + fcfa(P.seuil) + ")" : ""), P.besoin ? "er" : "") + "</div>";
    A.forEach(function (a) { h += '<div class="pv-n ' + a.n + '">' + esc(a.t) + "</div>"; });
    h += graphe(P);
    h += '<h3 style="margin:16px 0 4px;font-size:15px">Flux par nature</h3><div class="pv-w"><table><thead><tr><th>Nature</th><th class="n">à 30 jours</th><th class="n">à 60 jours</th><th class="n">à 90 jours</th></tr></thead><tbody>' + Object.keys(NAT).map(function (k) { return "<tr><td>" + esc(NAT[k]) + "</td>" + [30, 60, 90].map(function (n) { return '<td class="n">' + (P.nat[n][k] ? num(P.nat[n][k]) : "—") + "</td>"; }).join("") + "</tr>"; }).join("") +
      '<tr><td><b>Flux net</b></td>' + [30, 60, 90].map(function (n) { return '<td class="n"><b>' + num(P.h[n].enc - P.h[n].dec) + "</b></td>"; }).join("") + "</tr></tbody></table></div>";
    h += '<h3 style="margin:16px 0 4px;font-size:15px">Semaine par semaine</h3><div class="pv-w"><table><thead><tr><th>Semaine</th><th class="n">Encaissements</th><th class="n">Décaissements</th><th class="n">Solde en fin de semaine</th></tr></thead><tbody>' + P.sem.map(function (s) { return "<tr><td>" + fd(s.from) + " → " + fd(s.to) + '</td><td class="n">' + (s.enc ? fcfa(s.enc) : "—") + '</td><td class="n">' + (s.dec ? fcfa(s.dec) : "—") + '</td><td class="n" ' + (s.solde < 0 ? 'style="color:#b3261e;font-weight:700"' : "") + ">" + num(s.solde) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    var top = function (t, titre) { return '<div><h3 style="margin:16px 0 4px;font-size:15px">' + titre + '</h3><div class="pv-w"><table><tbody>' + (t.length ? t.map(function (x) { return "<tr><td>" + esc(x.nom) + '</td><td class="n">' + fcfa(x.montant) + "</td></tr>"; }).join("") : '<tr><td style="color:var(--mu,#5b6572)">Aucun flux.</td></tr>') + "</tbody></table></div></div>"; };
    h += '<div class="pv-g">' + top(P.topEnc, "Principaux encaissements à 90 jours") + top(P.topDec, "Principaux décaissements à 90 jours") + "</div>";
    h += '<h3 style="margin:16px 0 4px;font-size:15px">Flux prévus saisis</h3><div class="pv-w"><table><thead><tr><th>Libellé</th><th>Sens</th><th class="n">Montant</th><th>Périodicité</th><th>Première échéance</th><th>Fin</th><th></th></tr></thead><tbody>' + (c.engagements.length ? c.engagements.map(function (e) { return "<tr><td>" + esc(e.libelle) + "</td><td>" + (e.sens === "in" ? "Entrée" : "Sortie") + '</td><td class="n">' + fcfa(e.montant) + "</td><td>" + FREQ[e.freq] + "</td><td>" + fd(e.date) + "</td><td>" + (e.fin ? fd(e.fin) : "—") + "</td><td>" + (w ? btn("edeng", e.id, "✎", "sm") + " " + btn("deng", e.id, "🗑", "sm") : "") + "</td></tr>"; }).join("") : '<tr><td colspan="7" style="color:var(--mu,#5b6572)">Aucun flux prévu : ajoutez les loyers, échéances d\'emprunt, investissements ou subventions attendus.</td></tr>') + "</tbody></table></div>";
    h += '<div class="pv-n">Hypothèses : encaissements selon l\'habitude de règlement de chaque client (sinon échéance, sinon ' + c.delai_clients + ' j après la pièce) ; fournisseurs à l\'échéance (sinon ' + c.delai_fourn + ' j) ; créances en retard de plus de ' + (P.scenario === "prudent" ? 45 : 90) + ' j exclues ; arriérés fournisseurs réglés sous ' + (P.scenario === "prudent" ? 1 : 7) + ' j. ' + (P.scenario === "prudent" ? "Scénario prudent : encaissements retardés de 15 jours. " : "") + (c.paie ? (P.rh ? "Paie et charges sociales issues du module RH. " : "Aucune paie publiée par le module RH. ") : "Paie exclue. ") + "Estimation de pilotage, à ajuster : elle ne remplace pas un plan de trésorerie validé.</div></div>";
    return h;
  }
  function view(host) { H = host; css(); G.LOGISTICA_PREV.host = host; if (!H.can("v")) return '<div class="pv-n">Accès à la trésorerie prévisionnelle non autorisé pour votre profil.</div>'; if (!UIS.scenario) UIS.scenario = cfg().scenario; return vue(); }

  /* ---------- Impression / export ---------- */
  function imprimer() {
    if (!G.LOGISTICA_PRINT) { alert("Moteur d'impression indisponible."); return; } if (!H.can("p")) { alert("Droits insuffisants pour imprimer."); return; }
    var P = calcul(), A = alertes(P), tb = function (cols, rows) { return "<table><thead><tr>" + cols.map(function (c) { return '<th class="' + (c[1] || "") + '">' + esc(c[0]) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>"; };
    var nat = Object.keys(NAT).map(function (k) { return "<tr><td>" + esc(NAT[k]) + "</td>" + [30, 60, 90].map(function (n) { return '<td class="n">' + (P.nat[n][k] ? num(P.nat[n][k]) : "—") + "</td>"; }).join("") + "</tr>"; });
    nat.push('<tr class="tot"><td>Solde projeté</td>' + [30, 60, 90].map(function (n) { return '<td class="n">' + num(P.h[n].solde) + "</td>"; }).join("") + "</tr>");
    var sem = P.sem.map(function (s) { return "<tr><td>" + fd(s.from) + " → " + fd(s.to) + '</td><td class="n">' + fcfa(s.enc) + '</td><td class="n">' + fcfa(s.dec) + '</td><td class="n">' + num(s.solde) + "</td></tr>"; });
    G.LOGISTICA_PRINT.ouvrir({ division: H.division, emetteur: H.user(), fallback: H.identite ? H.identite() : null, titre: "Trésorerie prévisionnelle — 13 semaines (" + (P.scenario === "prudent" ? "scénario prudent" : "scénario prévisible") + ")", ref: "TRP-" + P.T.replace(/-/g, ""), date: P.T, montant: P.treso0, paysage: false,
      corps: "<p class=\"sub\">Trésorerie au " + fd(P.T) + " : " + num(P.treso0) + ". Point bas : " + num(P.bas.solde) + " le " + fd(P.bas.d) + ". " + A.map(function (a) { return esc(a.t); }).join(" ") + "</p>" + tb([["Nature"], ["À 30 jours", "n"], ["À 60 jours", "n"], ["À 90 jours", "n"]], nat) + "<br>" + tb([["Semaine"], ["Encaissements", "n"], ["Décaissements", "n"], ["Solde en fin de semaine", "n"]], sem) + '<p class="sub" style="margin-top:8px">Estimation de pilotage dérivée de la comptabilité (pièces ouvertes, habitudes de règlement, paie, flux prévus). Elle doit être ajustée par la direction.</p>' }).catch(function (e) { alert("Impression impossible : " + e.message); });
    if (H.audit) H.audit("Trésorerie prévisionnelle imprimée", P.scenario);
  }
  function csv() {
    if (!H.can("p")) { alert("Droits insuffisants pour exporter."); return; } var P = calcul(), q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/^([=+@\t\r]|-(?![\d.,]+$))/, "'$1") + '"'; };
    var rows = [["Date", "Nature", "Libellé", "Montant"]]; P.ev.forEach(function (x) { rows.push([x.d, NAT[x.nat], x.lib, R(x.m)]); });
    var b = new Blob(["﻿" + rows.map(function (r) { return r.map(q).join(";"); }).join("\n")], { type: "text/csv" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "tresorerie-previsionnelle-" + P.T + ".csv"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ---------- Formulaires et actions ---------- */
  function form(titre, champs, init, onSave, ok) {
    var ov = document.createElement("div"); ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,20,28,.6);z-index:9990;display:flex;align-items:center;justify-content:center;padding:12px");
    var f = champs.map(function (x) { var v = init && init[x.k] != null ? init[x.k] : "", inp = x.t === "select" ? '<select name="' + x.k + '">' + x.o.map(function (y) { return '<option value="' + esc(y[0]) + '" ' + (String(y[0]) === String(v) ? "selected" : "") + ">" + esc(y[1]) + "</option>"; }).join("") + "</select>" : '<input name="' + x.k + '" type="' + (x.t || "text") + '" ' + (x.t === "number" ? 'step="1" min="0"' : "") + ' value="' + esc(v) + '" autocomplete="off">';
      return '<label style="display:block;font-size:13px;margin:8px 0;color:var(--mu,#5b6572)">' + esc(x.l) + inp + "</label>"; }).join("");
    ov.innerHTML = '<div style="background:var(--card,#fff);color:var(--tx,#1c2430);border-radius:14px;width:100%;max-width:520px;max-height:92vh;overflow:auto;padding:18px"><h3 style="margin:0 0 6px">' + esc(titre) + '</h3><form novalidate>' + f + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="pv-b" data-x="1">Annuler</button><button class="pv-b p">' + esc(ok || "Valider") + "</button></div></form></div>";
    ov.querySelectorAll("input,select").forEach(function (i) { i.style.cssText = "width:100%;font:inherit;padding:8px;border:1px solid var(--bd,#d5dbe3);border-radius:8px;background:var(--bg,#fff);color:var(--tx,#1c2430);margin-top:3px"; });
    document.body.appendChild(ov); var fm = ov.querySelector("form");
    ov.querySelectorAll("[data-x]").forEach(function (b) { b.onclick = function () { ov.remove(); }; });
    fm.onsubmit = function (e) { e.preventDefault(); var o = {}; champs.forEach(function (x) { var v = fm.elements[x.k].value.trim(); o[x.k] = x.t === "number" ? (v === "" ? 0 : +v) : v; }); var r = H.run ? H.run(function () { return onSave(o); }) : (onSave(o), true); if (r !== false) { ov.remove(); H.render(); } };
    var f0 = fm.querySelector("input,select"); if (f0) f0.focus(); return ov;
  }
  var CE = [{ k: "libelle", l: "Libellé (loyer, échéance d'emprunt, subvention…)" }, { k: "sens", l: "Sens", t: "select", o: [["out", "Sortie d'argent"], ["in", "Entrée d'argent"]] }, { k: "montant", l: "Montant (FCFA)", t: "number" }, { k: "freq", l: "Périodicité", t: "select", o: Object.keys(FREQ).map(function (k) { return [k, FREQ[k]]; }) }, { k: "date", l: "Première échéance", t: "date" }, { k: "fin", l: "Dernière échéance (facultatif)", t: "date" }];
  var ACT = {
    scn: function (id) { var r = H.run ? H.run(function () { scenario(id); }) : (scenario(id), true); if (r !== false) H.render(); },
    hyp: function () { var c = cfg(); form("Hypothèses de la prévision", [{ k: "seuil", l: "Seuil d'alerte de trésorerie (FCFA)", t: "number" }, { k: "delai_clients", l: "Délai de règlement des clients par défaut (jours)", t: "number" }, { k: "delai_fourn", l: "Délai de paiement des fournisseurs par défaut (jours)", t: "number" }, { k: "paie", l: "Inclure la paie et les charges sociales du module RH", t: "select", o: [["oui", "Oui"], ["non", "Non"]] }], { seuil: c.seuil, delai_clients: c.delai_clients, delai_fourn: c.delai_fourn, paie: c.paie ? "oui" : "non" }, function (o) { hypotheses(o); }, "Enregistrer"); },
    eng: function () { form("Flux prévu", CE, { sens: "out", freq: "mensuel", date: addJ(today(), 7) }, function (o) { ajouterEng(o); }, "Enregistrer"); },
    edeng: function (id) { var e = cfg().engagements.find(function (x) { return x.id === id; }); if (!e) return; form("Modifier le flux prévu", CE, e, function (o) { modifierEng(id, o); }, "Enregistrer"); },
    deng: function (id) { if (!confirm("Supprimer ce flux prévu ?")) return; var r = H.run ? H.run(function () { supprimerEng(id); }) : (supprimerEng(id), true); if (r !== false) H.render(); },
    print: imprimer, csv: csv
  };
  document.addEventListener("click", function (e) { var t = e.target.closest && e.target.closest("[data-pv]"); if (!t || !G.LOGISTICA_PREV.host) return; var f = ACT[t.dataset.pv]; if (!f) return; e.preventDefault(); H = G.LOGISTICA_PREV.host; try { f(t.dataset.id, t); } catch (x) { alert(x.message); } });

  G.LOGISTICA_PREV = { host: null, view: view, calcul: function (o, h) { if (h) H = h; return calcul(o); }, alertes: alertes, hypotheses: function (f, h) { if (h) H = h; return hypotheses(f); }, ajouterEng: function (f, h) { if (h) H = h; return ajouterEng(f); }, modifierEng: function (i, f, h) { if (h) H = h; return modifierEng(i, f); }, supprimerEng: function (i, h) { if (h) H = h; return supprimerEng(i); },
    scenario: function (s, h) { if (h) H = h; return scenario(s); }, config: function (h) { if (h) H = h; return cfg(); }, publier: publier, imprimer: function (h) { if (h) H = h; return imprimer(); }, UI: UIS, use: function (h) { H = h; this.host = h; } };
})(window);
