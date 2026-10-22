/* LOGISTICA — moteur commun des états financiers SYSCOHADA révisé : compte de résultat en soldes intermédiaires de gestion (marge commerciale, chiffre d'affaires, valeur ajoutée,
   excédent brut d'exploitation, résultats d'exploitation / financier / HAO / net), capacité d'autofinancement, bilan par rubriques, comparatif N-1.
   Tout est DÉRIVÉ des écritures de l'application hôte : rien n'est enregistré. Les comptes de gestion sont les classes 6, 7 ET 8 (HAO, participation, impôt sur le résultat).

   Contrat de l'hôte (host) :
     division : "distribution" | "transport" | "agro" ; can(a) : "v" consulter, "p" imprimer / exporter ; user() ; identite() ; render() ; util.fcfa ; audit(a, d)
     lignes()  : [{date:"AAAA-MM-JJ", compte, debit, credit, cloture?:bool}]  toutes les lignes des écritures VALIDÉES ; cloture = écriture de clôture / réouverture d'exercice
     libelle(compte) : intitulé du compte ; periode() : {from, to} période choisie dans l'écran de la division */
(function (G) {
  "use strict";
  var H = null, R = Math.round;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fcfa = function (n) { return H && H.util && H.util.fcfa ? H.util.fcfa(n) : R(n || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ") + " F"; };
  var fd = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : (d || "—"); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var UIS = { cmp: true, det: false };
  var moinsUnAn = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); if (!m) return d; var y = +m[1] - 1, mo = +m[2], j = +m[3], max = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return y + "-" + m[2] + "-" + ("0" + Math.min(j, max)).slice(-2); };

  /* ---------- Classement des comptes de gestion (ordre = priorité) ---------- */
  var AFF = [["^7091|^701", "TA"], ["^6091|^601", "RA"], ["^6031", "RB"], ["^7092|^7093|^7094|^702|^703|^704", "TB"], ["^7095|^7096|^705|^706", "TC"], ["^7097|^707|^709", "TD"],
    ["^73", "TE"], ["^72", "TF"], ["^71", "TG"], ["^759", "TJ"], ["^75", "TH"], ["^787", "TM"], ["^78", "TI"], ["^799", "TO"], ["^797", "TL"], ["^79", "TJ"], ["^77", "TK"],
    ["^6092|^602", "RC"], ["^6032", "RD"], ["^6094|^6095|^6098|^604|^605|^608|^609", "RE"], ["^6033|^6038", "RF"], ["^603", "RB"], ["^60", "RE"], ["^61", "RG"], ["^62|^63", "RH"], ["^64", "RI"],
    ["^659", "RL"], ["^65", "RJ"], ["^66", "RK"], ["^67", "RM"], ["^697", "RN"], ["^699", "RP"], ["^68|^69", "RL"], ["^81", "RO"], ["^82", "TN"], ["^83|^85", "RP"], ["^84|^86|^88", "TO"], ["^87", "RQ"], ["^89", "RS"]]
    .map(function (x) { return [new RegExp(x[0]), x[1]]; });
  function ligneDe(c) {
    for (var i = 0; i < AFF.length; i++) if (AFF[i][0].test(c)) return { code: AFF[i][1], defaut: false };
    var k = c[0]; if (k === "7") return { code: "TH", defaut: true }; if (k === "6") return { code: "RJ", defaut: true };
    return { code: (+c[1] % 2 === 1) ? "RP" : "TO", defaut: true };   /* classe 8 : rang impair = charge, pair = produit */
  }
  /* Présentation SYSCOHADA : [code, libellé] pour les lignes ; sous-totaux calculés ensuite */
  var LIB = { TA: "Ventes de marchandises", RA: "Achats de marchandises", RB: "Variation de stocks de marchandises", TB: "Ventes de produits fabriqués", TC: "Travaux, services vendus", TD: "Produits accessoires",
    TE: "Production stockée (ou déstockage)", TF: "Production immobilisée", TG: "Subventions d'exploitation", TH: "Autres produits", TI: "Transferts de charges d'exploitation",
    RC: "Achats de matières premières et fournitures liées", RD: "Variation de stocks de matières premières et fournitures liées", RE: "Autres achats", RF: "Variation de stocks d'autres approvisionnements",
    RG: "Transports", RH: "Services extérieurs", RI: "Impôts et taxes", RJ: "Autres charges", RK: "Charges de personnel",
    TJ: "Reprises d'amortissements, de provisions et dépréciations", RL: "Dotations aux amortissements, aux provisions et dépréciations",
    TK: "Revenus financiers et assimilés", TL: "Reprises de provisions et dépréciations financières", TM: "Transferts de charges financières", RM: "Frais financiers et charges assimilées", RN: "Dotations aux provisions et dépréciations financières",
    TN: "Produits des cessions d'immobilisations", TO: "Autres produits HAO", RO: "Valeurs comptables des cessions d'immobilisations", RP: "Autres charges HAO", RQ: "Participation des travailleurs", RS: "Impôts sur le résultat" };
  var PLAN = [["L", "TA"], ["L", "RA"], ["L", "RB"], ["S", "XA", "MARGE COMMERCIALE", ["TA", "RA", "RB"]], ["L", "TB"], ["L", "TC"], ["L", "TD"], ["S", "XB", "CHIFFRE D'AFFAIRES", ["TA", "TB", "TC", "TD"]],
    ["L", "TE"], ["L", "TF"], ["L", "TG"], ["L", "TH"], ["L", "TI"], ["L", "RC"], ["L", "RD"], ["L", "RE"], ["L", "RF"], ["L", "RG"], ["L", "RH"], ["L", "RI"], ["L", "RJ"],
    ["S", "XC", "VALEUR AJOUTÉE", ["XB", "RA", "RB", "TE", "TF", "TG", "TH", "TI", "RC", "RD", "RE", "RF", "RG", "RH", "RI", "RJ"]], ["L", "RK"], ["S", "XD", "EXCÉDENT BRUT D'EXPLOITATION (EBE)", ["XC", "RK"]],
    ["L", "TJ"], ["L", "RL"], ["S", "XE", "RÉSULTAT D'EXPLOITATION", ["XD", "TJ", "RL"]], ["L", "TK"], ["L", "TL"], ["L", "TM"], ["L", "RM"], ["L", "RN"], ["S", "XF", "RÉSULTAT FINANCIER", ["TK", "TL", "TM", "RM", "RN"]],
    ["S", "XG", "RÉSULTAT DES ACTIVITÉS ORDINAIRES", ["XE", "XF"]], ["L", "TN"], ["L", "TO"], ["L", "RO"], ["L", "RP"], ["S", "XH", "RÉSULTAT HORS ACTIVITÉS ORDINAIRES (HAO)", ["TN", "TO", "RO", "RP"]],
    ["L", "RQ"], ["L", "RS"], ["S", "XI", "RÉSULTAT NET", ["XG", "XH", "RQ", "RS"]]];

  /* ---------- Rubriques du bilan ---------- */
  var BIL = { A: [["IMMOBILISÉ", "ACTIF IMMOBILISÉ", [["imm_inc", "Immobilisations incorporelles"], ["imm_corp", "Immobilisations corporelles"], ["imm_av", "Avances et acomptes versés sur immobilisations"], ["imm_fin", "Immobilisations financières"]]],
      ["CIRCULANT", "ACTIF CIRCULANT", [["hao_a", "Actif circulant HAO"], ["stocks", "Stocks et encours"], ["fou_av", "Fournisseurs, avances versées"], ["clients", "Clients"], ["creances", "Autres créances"]]],
      ["TRESO", "TRÉSORERIE-ACTIF", [["titres", "Titres de placement"], ["valeurs", "Valeurs à encaisser"], ["banque", "Banques, chèques postaux, caisse"]]]],
    P: [["CP", "CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES", [["capital", "Capital"], ["reserves", "Primes et réserves"], ["report", "Report à nouveau"], ["resultat", "Résultat net de l'exercice"], ["subv", "Subventions d'investissement"], ["reglem", "Provisions réglementées"]]],
      ["DF", "DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES", [["dettes_fin", "Emprunts et dettes financières"], ["prov_rc", "Provisions pour risques et charges"]]],
      ["PC", "PASSIF CIRCULANT", [["hao_p", "Dettes circulantes HAO"], ["cli_av", "Clients, avances reçues"], ["fournisseurs", "Fournisseurs d'exploitation"], ["fisc_soc", "Dettes fiscales et sociales"], ["autres_d", "Autres dettes"], ["prov_ct", "Provisions pour risques à court terme"]]],
      ["TP", "TRÉSORERIE-PASSIF", [["treso_p", "Banques, crédits de trésorerie et découverts"]]]] };
  /* compte + solde (débit − crédit) → {c: côté A|P, r: rubrique} */
  function rubrique(c, s) {
    var k = c[0], p2 = c.slice(0, 2), p3 = c.slice(0, 3);
    if (k === "1") { if (p3 === "109" || /^10[1-4]/.test(c)) return { c: "P", r: "capital" }; if (/^10[56]|^11/.test(c)) return { c: "P", r: "reserves" }; if (p2 === "12" || p2 === "13") return { c: "P", r: "report" }; if (p2 === "14") return { c: "P", r: "subv" }; if (p2 === "15") return { c: "P", r: "reglem" }; if (p2 === "19") return { c: "P", r: "prov_rc" }; if (p2 === "16" || p2 === "17" || p2 === "18") return { c: "P", r: "dettes_fin" }; return { c: "P", r: "reserves" }; }
    if (k === "2") { if (p2 === "21" || p3 === "281" || p3 === "291") return { c: "A", r: "imm_inc" }; if (p2 === "25" || p3 === "295") return { c: "A", r: "imm_av" }; if (p2 === "26" || p2 === "27" || p3 === "296" || p3 === "297") return { c: "A", r: "imm_fin" }; return { c: "A", r: "imm_corp" }; }
    if (k === "3") return { c: "A", r: "stocks" };
    if (k === "4") {
      if (p3 === "491") return { c: "A", r: "clients" }; if (p3 === "499") return { c: "P", r: "prov_ct" }; if (p2 === "49") return { c: "A", r: "creances" };
      if (p2 === "40") return s >= 0 ? { c: "A", r: "fou_av" } : { c: "P", r: "fournisseurs" };
      if (p2 === "41") return s >= 0 ? { c: "A", r: "clients" } : { c: "P", r: "cli_av" };
      if (p2 === "42" || p2 === "43" || p2 === "44") return s >= 0 ? { c: "A", r: "creances" } : { c: "P", r: "fisc_soc" };
      if (p2 === "48") return s >= 0 ? { c: "A", r: "hao_a" } : { c: "P", r: "hao_p" };
      return s >= 0 ? { c: "A", r: "creances" } : { c: "P", r: "autres_d" };
    }
    if (k === "5") { if (p2 === "50" || p2 === "59") return { c: "A", r: "titres" }; if (p2 === "51") return s >= 0 ? { c: "A", r: "valeurs" } : { c: "P", r: "treso_p" }; return s >= 0 ? { c: "A", r: "banque" } : { c: "P", r: "treso_p" }; }
    return null;
  }

  /* ---------- Calcul ---------- */
  function lignes() { try { return (H.lignes() || []).map(function (x) { return { date: String(x.date || "").slice(0, 10), compte: String(x.compte || ""), debit: +x.debit || 0, credit: +x.credit || 0, cloture: !!x.cloture }; }).filter(function (x) { return x.compte && x.date; }); } catch (e) { return []; } }
  /* Modèle d'une période [from, to] : compte de résultat sur la période (hors écritures de clôture), bilan au « to » */
  function modele(L, from, to) {
    var Y = to.slice(0, 4), debY = Y + "-01-01", m = {}, net = {}, defaut = [];
    L.forEach(function (x) { if (x.date < from || x.date > to || x.cloture) return; var k = x.compte[0]; if (k !== "6" && k !== "7" && k !== "8") return; net[x.compte] = (net[x.compte] || 0) + x.credit - x.debit; });
    var det = {}; Object.keys(net).forEach(function (c) { if (!net[c]) return; var a = ligneDe(c); if (a.defaut) defaut.push(c); m[a.code] = (m[a.code] || 0) + net[c]; (det[a.code] = det[a.code] || []).push([c, net[c]]); });
    var v = {}; Object.keys(LIB).forEach(function (k) { v[k] = m[k] || 0; });
    PLAN.forEach(function (p) { if (p[0] === "S") v[p[1]] = p[3].reduce(function (s, k) { return s + (v[k] || 0); }, 0); });
    /* CAF : résultat net + dotations − reprises + valeur comptable des cessions − produits des cessions (HAO compris) */
    var sum = function (re) { return Object.keys(net).filter(function (c) { return re.test(c); }).reduce(function (s, c) { return s + net[c]; }, 0); };
    var dotHAO = -sum(/^85|^699/), repHAO = sum(/^86|^799/);
    var caf = { resultat: v.XI, dotations: -(v.RL + v.RN) + dotHAO, reprises: -(v.TJ + v.TL + repHAO), vnc: -v.RO, cessions: -v.TN };
    caf.total = caf.resultat + caf.dotations + caf.reprises + caf.vnc + caf.cessions;
    /* Bilan : soldes cumulés des classes 1 à 5 au « to » ; résultat non encore viré aux comptes 13 */
    var sold = {}, gest = 0, prior = 0, c13cur = 0;
    L.forEach(function (x) {
      if (x.date > to) return; var k = x.compte[0], d = x.debit - x.credit;
      if (k === "6" || k === "7" || k === "8") { gest -= d; if (x.date < debY) prior -= d; return; }
      if (k >= "1" && k <= "5") { if (x.compte.slice(0, 2) === "13") { if (x.date >= debY) { c13cur -= d; return; } } sold[x.compte] = (sold[x.compte] || 0) + d; }
    });
    var res = gest - prior + c13cur, bilan = { A: {}, P: {}, det: {}, resultat: res, priorNonClos: prior };
    Object.keys(sold).forEach(function (c) { var s = sold[c]; if (!s) return; var r = rubrique(c, s); if (!r) return; var val = r.c === "A" ? s : -s; bilan[r.c][r.r] = (bilan[r.c][r.r] || 0) + val; (bilan.det[r.c + r.r] = bilan.det[r.c + r.r] || []).push([c, val]); });
    if (prior) { bilan.P.report = (bilan.P.report || 0) + prior; (bilan.det.Preport = bilan.det.Preport || []).push(["—", prior, "résultat d'exercices antérieurs non clôturés"]); }
    bilan.P.resultat = (bilan.P.resultat || 0) + res;
    var tot = function (S) { return Object.keys(S).reduce(function (s, k) { return s + S[k]; }, 0); };
    bilan.totA = tot(bilan.A); bilan.totP = tot(bilan.P); bilan.ecart = R(bilan.totA - bilan.totP);
    return { from: from, to: to, v: v, det: det, caf: caf, bilan: bilan, defaut: defaut.filter(function (c, i, a) { return a.indexOf(c) === i; }) };
  }
  function etats(o) {
    var L = lignes(), p = o || (H.periode ? H.periode() : null) || {}, to = p.to || today(), from = p.from || (to.slice(0, 4) + "-01-01");
    var n = modele(L, from, to); n.n1 = UIS.cmp ? modele(L, moinsUnAn(from), moinsUnAn(to)) : null; return n;
  }

  /* ---------- Affichage ---------- */
  var CSS = ".et-w{overflow:auto}.et-w table{width:100%;border-collapse:collapse;font-size:13px}.et-w th,.et-w td{border-bottom:1px solid var(--bd,#d5dbe3);padding:5px 8px;text-align:left;vertical-align:top}.et-w th{font-size:12px;color:var(--mu,#5b6572);white-space:nowrap}.et-w td.n,.et-w th.n{text-align:right;white-space:nowrap}" +
    ".et-w tr.s td{font-weight:700;background:rgba(31,58,95,.08)}.et-w tr.g td{font-weight:800;background:rgba(31,58,95,.16)}.et-w td.d{padding-left:26px;color:var(--mu,#5b6572);font-size:12px}.et-b{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd,#d5dbe3);background:var(--card,#fff);color:var(--tx,#1c2430);cursor:pointer}.et-b.p{background:var(--b2,#1f3a5f);color:#fff;border-color:var(--b2,#1f3a5f)}" +
    ".et-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}.et-n{background:var(--card,#fff);border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13px;color:var(--mu,#5b6572)}.et-ok{border-left:4px solid #1f8a4c;color:#1f8a4c}.et-ko{border-left:4px solid #b3261e;color:#b3261e}";
  function css() { if (document.getElementById("et-css")) return; var s = document.createElement("style"); s.id = "et-css"; s.textContent = CSS; document.head.appendChild(s); }
  var num = function (v) { return v ? (v < 0 ? "(" + fcfa(-v) + ")" : fcfa(v)) : "—"; };
  var libC = function (c) { try { return (H.libelle && H.libelle(c)) || ""; } catch (e) { return ""; } };
  function tabCols(titre, cols) { return '<th>' + esc(titre) + "</th>" + cols.map(function (c) { return '<th class="n">' + esc(c) + "</th>"; }).join(""); }
  function vResultat(E, imp) {
    var cols = [fd(E.from) + " → " + fd(E.to)].concat(E.n1 ? [fd(E.n1.from) + " → " + fd(E.n1.to)] : []), rows = [];
    PLAN.forEach(function (p) {
      var k = p[1];
      if (p[0] === "L") { if (!E.v[k] && !(E.n1 && E.n1.v[k])) return; rows.push("<tr><td>" + esc(LIB[k]) + ' <small style="color:var(--mu,#5b6572)">' + k + "</small></td><td class=\"n\">" + num(E.v[k]) + "</td>" + (E.n1 ? '<td class="n">' + num(E.n1.v[k]) + "</td>" : "") + "</tr>");
        if (UIS.det && !imp) (E.det[k] || []).forEach(function (a) { rows.push('<tr><td class="d">' + esc(a[0] + " " + libC(a[0])) + '</td><td class="n d">' + num(a[1]) + "</td>" + (E.n1 ? "<td></td>" : "") + "</tr>"); }); }
      else rows.push('<tr class="' + (k === "XI" ? "g" : "s") + '"><td>' + esc(p[2]) + ' <small>' + k + '</small></td><td class="n">' + num(E.v[k]) + "</td>" + (E.n1 ? '<td class="n">' + num(E.n1.v[k]) + "</td>" : "") + "</tr>");
    });
    return '<div class="et-w"><table><thead><tr>' + tabCols("Compte de résultat — soldes intermédiaires de gestion", cols) + "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
  }
  function vCaf(E) {
    var c = E.caf, n = E.n1 && E.n1.caf, L = [["Résultat net", "resultat"], ["+ Dotations aux amortissements, provisions et dépréciations", "dotations"], ["− Reprises d'amortissements, provisions et dépréciations", "reprises"], ["+ Valeurs comptables des cessions d'immobilisations", "vnc"], ["− Produits des cessions d'immobilisations", "cessions"]];
    return '<div class="et-w"><table><thead><tr>' + tabCols("Capacité d'autofinancement (CAF)", [fd(E.from) + " → " + fd(E.to)].concat(n ? [fd(E.n1.from) + " → " + fd(E.n1.to)] : [])) + "</tr></thead><tbody>" +
      L.map(function (x) { return "<tr><td>" + esc(x[0]) + '</td><td class="n">' + num(c[x[1]]) + "</td>" + (n ? '<td class="n">' + num(n[x[1]]) + "</td>" : "") + "</tr>"; }).join("") + '<tr class="g"><td>CAPACITÉ D\'AUTOFINANCEMENT GLOBALE</td><td class="n">' + num(c.total) + "</td>" + (n ? '<td class="n">' + num(n.total) + "</td>" : "") + "</tr></tbody></table></div>";
  }
  function vBilan(E, imp) {
    var B = E.bilan, N = E.n1 && E.n1.bilan, side = function (c, titre) {
      var rows = [];
      BIL[c].forEach(function (g) {
        var sub = 0, subN = 0, r = [];
        g[2].forEach(function (x) { var v = B[c][x[0]] || 0, vn = N ? (N[c][x[0]] || 0) : 0; sub += v; subN += vn; if (!v && !vn) return;
          r.push("<tr><td>" + esc(x[1]) + '</td><td class="n">' + num(v) + "</td>" + (N ? '<td class="n">' + num(vn) + "</td>" : "") + "</tr>");
          if (UIS.det && !imp) (B.det[c + x[0]] || []).forEach(function (a) { r.push('<tr><td class="d">' + esc(a[0] + " " + (a[2] || libC(a[0]))) + '</td><td class="n d">' + num(a[1]) + "</td>" + (N ? "<td></td>" : "") + "</tr>"); }); });
        if (r.length || sub || subN) { rows.push('<tr class="s"><td>' + esc(g[1]) + '</td><td class="n">' + num(sub) + "</td>" + (N ? '<td class="n">' + num(subN) + "</td>" : "") + "</tr>"); rows = rows.concat(r); }
      });
      rows.push('<tr class="g"><td>TOTAL ' + (c === "A" ? "ACTIF" : "PASSIF") + '</td><td class="n">' + num(c === "A" ? B.totA : B.totP) + "</td>" + (N ? '<td class="n">' + num(c === "A" ? N.totA : N.totP) + "</td>" : "") + "</tr>");
      return '<div class="et-w"><table><thead><tr>' + tabCols(titre + " au " + fd(E.to), ["N"].concat(N ? ["N-1 (" + fd(E.n1.to) + ")"] : [])) + "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
    };
    return { actif: side("A", "ACTIF"), passif: side("P", "PASSIF") };
  }
  function controle(E) {
    var B = E.bilan, ok = B.ecart === 0, h = '<div class="et-n ' + (ok ? "et-ok" : "et-ko") + '">' + (ok ? "Bilan équilibré." : "Bilan déséquilibré : écart de " + fcfa(B.ecart) + " entre l'actif et le passif (une pièce déséquilibrée ou un compte hors classes 1 à 8).") + "</div>";
    if (E.from > E.to.slice(0, 4) + "-01-01") h += '<div class="et-n">Le compte de résultat porte sur la période choisie ; le bilan présente le <b>résultat cumulé de l\'exercice</b> (' + num(B.resultat) + ") depuis le 1er janvier.</div>";
    if (B.priorNonClos) h += '<div class="et-n">Résultat d\'exercices antérieurs non clôturés (' + num(B.priorNonClos) + ") : inclus dans le report à nouveau. Clôturez les exercices antérieurs pour les virer aux comptes de résultat 13.</div>";
    if (E.defaut.length) h += '<div class="et-n">' + E.defaut.length + " compte(s) de gestion classé(s) par défaut (non prévu(s) au plan SYSCOHADA habituel) : " + esc(E.defaut.slice(0, 6).join(", ")) + (E.defaut.length > 6 ? "…" : "") + ".</div>";
    return h;
  }
  function view(host) {
    H = host; css(); G.LOGISTICA_ETATS.host = host; if (!H.can("v")) return '<div class="et-n">Accès aux états financiers non autorisé pour votre profil.</div>';
    var E = etats(), bl = vBilan(E);
    return '<div class="et-root"><div class="et-bar"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-etf="cmp" ' + (UIS.cmp ? "checked" : "") + '> Comparatif N-1</label><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-etf="det" ' + (UIS.det ? "checked" : "") + "> Détail par compte</label>" +
      (H.can("p") ? '<button type="button" class="et-b p" data-et="imprimer">🖨 Imprimer / PDF</button><button type="button" class="et-b" data-et="csv">⬇ CSV</button>' : "") + '<span style="color:var(--mu,#5b6572);font-size:13px">Période du ' + fd(E.from) + " au " + fd(E.to) + " (bilan au " + fd(E.to) + ")</span></div>" +
      vResultat(E) + "<div style=\"height:12px\"></div>" + vCaf(E) + '<div style="height:12px"></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px">' + bl.actif + bl.passif + "</div>" + controle(E) +
      '<div class="et-n">États dérivés des écritures validées, selon le plan SYSCOHADA révisé (comptes de gestion : classes 6, 7 et 8). Charges entre parenthèses. À valider par votre expert-comptable avant tout dépôt ; les annexes ne sont pas produites ici.</div></div>';
  }
  function corpsImpression(E) {
    var bl = vBilan(E, true), t = function (h) { return h.replace(/class="et-w"/g, ""); };
    return '<p class="sub">Exercice ' + esc(E.to.slice(0, 4)) + " — période du " + fd(E.from) + " au " + fd(E.to) + (E.n1 ? ", comparée à la période du " + fd(E.n1.from) + " au " + fd(E.n1.to) : "") + ".</p>" + t(vResultat(E, true)) + "<br>" + t(vCaf(E)) + '<div style="page-break-before:always"></div>' + t(bl.actif) + "<br>" + t(bl.passif) +
      '<p class="sub" style="margin-top:8px">' + (E.bilan.ecart === 0 ? "Bilan équilibré." : "Bilan déséquilibré : écart de " + fcfa(E.bilan.ecart) + ".") + " Charges entre parenthèses. États dérivés de la comptabilité, à valider par l'expert-comptable.</p>";
  }
  function imprimer() {
    if (!G.LOGISTICA_PRINT) { alert("Moteur d'impression indisponible."); return; } if (!H.can("p")) { alert("Droits insuffisants pour imprimer."); return; }
    var E = etats(); G.LOGISTICA_PRINT.ouvrir({ division: H.division, emetteur: H.user(), fallback: H.identite ? H.identite() : null, titre: "États financiers", ref: "ETF-" + E.to.replace(/-/g, ""), date: E.to, montant: E.v.XI, paysage: false, corps: corpsImpression(E) }).catch(function (e) { alert("Impression impossible : " + e.message); });
    if (H.audit) H.audit("États financiers imprimés", fd(E.from) + " → " + fd(E.to));
  }
  function csv() {
    if (!H.can("p")) { alert("Droits insuffisants pour exporter."); return; } var E = etats(), q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/^([=+@\t\r]|-(?![\d.,]+$))/, "'$1") + '"'; };
    var rows = [["Partie", "Code", "Libellé", "N", "N-1"]];
    PLAN.forEach(function (p) { var k = p[1]; rows.push(["Résultat", k, p[0] === "L" ? LIB[k] : p[2], R(E.v[k]), E.n1 ? R(E.n1.v[k]) : ""]); });
    rows.push(["CAF", "", "Capacité d'autofinancement globale", R(E.caf.total), E.n1 ? R(E.n1.caf.total) : ""]);
    ["A", "P"].forEach(function (c) { BIL[c].forEach(function (g) { g[2].forEach(function (x) { rows.push([c === "A" ? "Actif" : "Passif", x[0], x[1], R(E.bilan[c][x[0]] || 0), E.n1 ? R(E.n1.bilan[c][x[0]] || 0) : ""]); }); }); });
    var b = new Blob(["﻿" + rows.map(function (r) { return r.map(q).join(";"); }).join("\n")], { type: "text/csv" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "etats-financiers-" + E.to + ".csv"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  document.addEventListener("click", function (e) { var t = e.target.closest && e.target.closest("[data-et]"); if (!t || !G.LOGISTICA_ETATS.host) return; e.preventDefault(); H = G.LOGISTICA_ETATS.host; try { if (t.dataset.et === "imprimer") imprimer(); else if (t.dataset.et === "csv") csv(); } catch (x) { alert(x.message); } });
  document.addEventListener("change", function (e) { var t = e.target; if (!t.dataset || !t.dataset.etf || !G.LOGISTICA_ETATS.host) return; H = G.LOGISTICA_ETATS.host; UIS[t.dataset.etf] = t.checked; H.render(); });

  /* Synthèse de l'exercice en cours (1er janvier → aujourd'hui), publiée pour le consolidé du groupe : aucune donnée nominative */
  function publier(host) {
    if (host) H = host;
    try {
      if (!H.can("v")) return null; var t = today(), m = modele(lignes(), t.slice(0, 4) + "-01-01", t), b = m.bilan, cp = 0;
      BIL.P[0][2].forEach(function (x) { cp += b.P[x[0]] || 0; });
      var r = { t: new Date().toISOString(), division: H.division, du: t.slice(0, 4) + "-01-01", au: t, marge: R(m.v.XA), ca: R(m.v.XB), va: R(m.v.XC), ebe: R(m.v.XD), rex: R(m.v.XE), rfin: R(m.v.XF), hao: R(m.v.XH), rn: R(m.v.XI), caf: R(m.caf.total), actif: R(b.totA), passif: R(b.totP), ecart: b.ecart, capitaux: R(cp), treso: R((b.A.banque || 0) + (b.A.valeurs || 0) + (b.A.titres || 0) - (b.P.treso_p || 0)), clients: R(b.A.clients || 0), fournisseurs: R(b.P.fournisseurs || 0), dettes_fin: R(b.P.dettes_fin || 0) };
      localStorage.setItem("logistica_etats_" + H.division, JSON.stringify(r)); return r;
    } catch (e) { return null; }
  }
  G.LOGISTICA_ETATS = { host: null, view: view, publier: publier, etats: function (o, h) { if (h) H = h; return etats(o); }, modele: function (L, from, to) { return modele(L, from, to); }, ligneDe: ligneDe, rubrique: rubrique, PLAN: PLAN, LIB: LIB, UI: UIS, use: function (h) { H = h; this.host = h; } };
})(window);
