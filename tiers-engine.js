/* LOGISTICA — moteur commun « comptes de tiers » : relevé de compte individuel (client, fournisseur, vendeur partenaire, chauffeur…) et ancienneté des créances / dettes.
   Modèle : module « Comptes tiers » de Menko immo (relevé de compte, balance âgée), mais avec une ancienneté PAR PIÈCE : les règlements s'imputent sur les pièces les plus anciennes
   (et non un seul âge pour tout le solde du tiers). Rien n'est enregistré : tout est dérivé de la comptabilité de l'application hôte.

   Contrat de l'hôte (host) :
     division : "distribution" | "transport" | "agro"
     can(a)   : "v" consulter, "p" imprimer / exporter
     user()   : nom de l'utilisateur ; identite() : {nom, siege, tel, rccm, ncc} ; render() ; util.fcfa ; aller() : affiche l'écran du relevé
     comptes(): [{compte:"411", lib:"Clients", nature:"D"|"C"}]       nature : D = créance (le tiers nous doit), C = dette (nous lui devons)
     lignes(compte) : [{k, date:"AAAA-MM-JJ", piece, libelle, journal, debit, credit, tiers:"clé", tn:"nom", lettre:"", echeance?:"AAAA-MM-JJ"}]  (toutes les lignes du compte, tous tiers)
   Facultatif (provision pour créances douteuses, désactivée par défaut) :
     can("c") créer un brouillard, can("a") paramétrer ; run(fn) : exécute fn avec sauvegarde / annulation ; prov.get() / prov.set(cfg) : paramètres stockés par l'hôte
     soldeCompte(compte) : crédit − débit du compte ; brouillard({date, journal, piece, libelle, lignes:[{compte, debit, credit}]}) : crée une écriture en brouillard à faire viser ; brouillardEnAttente(prefixePiece) : bool */
(function (G) {
  "use strict";
  var H = null;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fcfa = function (n) { return H && H.util && H.util.fcfa ? H.util.fcfa(n) : Math.round(n || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ") + " F"; };
  var R = Math.round;
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var fd = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : (d || "—"); };
  var diffJ = function (a, b) { return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5); };
  var norm = function (s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); };
  var TR = ["Non échu", "0-30 j", "31-60 j", "61-90 j", "> 90 j"];
  var UIS = { compte: "", tiers: "", du: "", au: "", nl: false, q: "", mode: "tiers", provdate: "" };

  /* ---------- Calculs ---------- */
  function comptes() { try { return H.comptes() || []; } catch (e) { return []; } }
  function infoCompte(c) { return comptes().filter(function (x) { return x.compte === c; })[0] || null; }
  function lignesDe(compte) {
    var L = [];
    try { L = H.lignes(compte) || []; } catch (e) { L = []; }
    return L.map(function (x) { return { k: x.k, date: String(x.date || "").slice(0, 10), piece: x.piece || "", libelle: x.libelle || "", journal: x.journal || "", debit: R(+x.debit || 0), credit: R(+x.credit || 0), tiers: x.tiers == null ? "" : String(x.tiers), tn: x.tn || "(sans tiers)", lettre: x.lettre || "", echeance: x.echeance ? String(x.echeance).slice(0, 10) : "" }; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.piece).localeCompare(String(b.piece)); });
  }
  var signe = function (nat, x) { return nat === "C" ? x.credit - x.debit : x.debit - x.credit; };   // solde « dû » positif dans le sens de la nature du compte

  /* Ancienneté par pièce : les règlements s'imputent sur les pièces les plus anciennes. Résultat : tranches [non échu, 0-30, 31-60, 61-90, >90] + avance (excédent de règlements) */
  function age(lignes, nat, au) {
    au = au || today();
    var items = [], pay = 0;
    lignes.forEach(function (x) { var m = nat === "C" ? x.credit - x.debit : x.debit - x.credit; if (m > 0) items.push({ d: x.date, e: x.echeance, m: m }); else pay += -m; });
    var tr = [0, 0, 0, 0, 0], ouv = [];
    items.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; }).forEach(function (i) {
      var r = i.m, u = Math.min(pay, r); pay -= u; r -= u;
      if (r > 0) { var ref = i.e || i.d, j = diffJ(au, ref); tr[i.e && j < 0 ? 0 : j <= 30 ? 1 : j <= 60 ? 2 : j <= 90 ? 3 : 4] += r; ouv.push({ d: i.d, e: i.e, m: r, j: Math.max(0, j) }); }
    });
    return { tr: tr, tot: tr.reduce(function (a, b) { return a + b; }, 0), avance: pay, ouv: ouv };
  }
  /* Délai moyen de règlement : pour chaque règlement (pris dans l'ordre), nombre de jours entre la date de la pièce la plus ancienne qu'il solde et la date du règlement, pondéré par les montants.
     Retourne {s: somme(montant × jours), m: montant réglé, nb: règlements, ret: montant réglé après l'échéance, ech: montant réglé dont l'échéance est connue} */
  function delai(lignes, nat) {
    var items = [], pays = [];
    lignes.forEach(function (x) { var m = nat === "C" ? x.credit - x.debit : x.debit - x.credit; if (m > 0) items.push({ d: x.date, e: x.echeance, m: m }); else if (m < 0) pays.push({ d: x.date, m: -m }); });
    items.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; }); pays.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var r = { s: 0, m: 0, nb: 0, ret: 0, ech: 0 }, k = 0;
    pays.forEach(function (p) {
      var reste = p.m; r.nb++;
      while (reste > 0 && k < items.length) {
        var it = items[k], u = Math.min(reste, it.m), j = Math.max(0, diffJ(p.d, it.d));
        r.s += u * j; r.m += u; if (it.e) { r.ech += u; if (p.d > it.e) r.ret += u; }
        it.m -= u; reste -= u; if (it.m <= 0) k++;
      }
    });
    return r;
  }
  /* Liste des tiers d'un compte : solde, nombre de pièces, pièces non lettrées, ancienneté */
  function liste(compte) {
    var inf = infoCompte(compte); if (!inf) return [];
    var L = lignesDe(compte), G = {};
    L.forEach(function (x) { var g = G[x.tiers] || (G[x.tiers] = { id: x.tiers, nom: x.tn, lignes: [] }); g.lignes.push(x); });
    return Object.keys(G).map(function (k) {
      var g = G[k], d = g.lignes.reduce(function (s, x) { return s + x.debit; }, 0), c = g.lignes.reduce(function (s, x) { return s + x.credit; }, 0), a = age(g.lignes, inf.nature);
      var plus = g.lignes.reduce(function (m, x) { return x.date > m ? x.date : m; }, "");
      return { id: g.id, nom: g.nom, debit: d, credit: c, solde: inf.nature === "C" ? c - d : d - c, nb: g.lignes.length, nl: g.lignes.filter(function (x) { return !x.lettre; }).length, age: a, derniere: plus, reg: delai(g.lignes, inf.nature) };
    }).sort(function (a, b) { return Math.abs(b.solde) - Math.abs(a.solde) || a.nom.localeCompare(b.nom); });
  }
  /* Relevé d'un tiers : report, lignes avec solde cumulé, totaux, ancienneté des pièces ouvertes */
  function releve(compte, tid, o) {
    o = o || {}; var inf = infoCompte(compte); if (!inf) throw new Error("Compte de tiers inconnu.");
    var tous = lignesDe(compte).filter(function (x) { return x.tiers === String(tid); }); if (!tous.length) throw new Error("Aucun mouvement pour ce tiers sur le compte " + compte + ".");
    var du = o.du || "", au = o.au || "";
    if (du && au && au < du) throw new Error("La date de fin est antérieure à la date de début.");
    var base = o.nl ? tous.filter(function (x) { return !x.lettre; }) : tous;
    var avant = du ? base.filter(function (x) { return x.date < du; }) : [], per = base.filter(function (x) { return (!du || x.date >= du) && (!au || x.date <= au); });
    var rep = avant.reduce(function (s, x) { return s + signe(inf.nature, x); }, 0), cum = rep, td = 0, tc = 0;
    var lignes = per.map(function (x) { cum += signe(inf.nature, x); td += x.debit; tc += x.credit; return Object.assign({}, x, { cumul: cum }); });
    var jusque = au ? tous.filter(function (x) { return x.date <= au; }) : tous;
    return { compte: compte, lib: inf.lib, nature: inf.nature, tiers: { id: String(tid), nom: tous[0].tn }, du: du, au: au, nl: !!o.nl, report: rep, lignes: lignes, debit: td, credit: tc, solde: cum, age: age(jusque, inf.nature, au || today()), nbLettrees: per.filter(function (x) { return x.lettre; }).length, edite: today() };
  }

  /* Synthèse d'un compte : ancienneté globale, concentration, délai moyen de règlement, délai moyen d'écoulement (DSO / DPO) */
  var jMoy = function (r) { return r.m > 0 ? Math.round(r.s / r.m) : null; };
  function synthese(compte) {
    var inf = infoCompte(compte); if (!inf) throw new Error("Compte de tiers inconnu.");
    var L = liste(compte), tr = [0, 0, 0, 0, 0], reg = { s: 0, m: 0, nb: 0, ret: 0, ech: 0 }, avance = 0;
    L.forEach(function (t) { t.age.tr.forEach(function (v, i) { tr[i] += v; }); avance += t.age.avance; ["s", "m", "nb", "ret", "ech"].forEach(function (k) { reg[k] += t.reg[k]; }); });
    var tot = tr.reduce(function (a, b) { return a + b; }, 0), top = L.filter(function (t) { return t.age.tot > 0; }).sort(function (a, b) { return b.age.tot - a.age.tot; });
    var cum = 0, top10 = top.slice(0, 10).map(function (t) { cum += t.age.tot; return { id: t.id, nom: t.nom, tot: t.age.tot, part: tot ? t.age.tot / tot : 0, cumul: tot ? cum / tot : 0, p90: t.age.tr[4], jours: jMoy(t.reg) }; });
    var flux = lignesDe(compte).filter(function (x) { return diffJ(today(), x.date) <= 365; }).reduce(function (s, x) { return s + (inf.nature === "C" ? x.credit : x.debit); }, 0);
    return { compte: compte, lib: inf.lib, nature: inf.nature, nbTiers: top.length, tot: tot, tr: tr, echu: tr[1] + tr[2] + tr[3] + tr[4], p90: tr[4], avance: avance, top10: top10, top5: tot ? top.slice(0, 5).reduce(function (s, t) { return s + t.age.tot; }, 0) / tot : 0, reg: reg, delai: jMoy(reg), dansDelai: reg.ech ? 1 - reg.ret / reg.ech : null, flux: flux, dso: flux > 0 ? Math.round(tot / flux * 365) : null, tiers90: top.filter(function (t) { return t.age.tr[4] > 0; }).length };
  }

  /* ---------- Provision pour créances douteuses (désactivée par défaut) : propose, ne comptabilise jamais seule ---------- */
  var SUGG = [0, 0, 0, 25, 50];
  function provCfg() {
    var c = {}; try { c = (H.prov && H.prov.get()) || {}; } catch (e) { c = {}; }
    return { actif: c.actif === true, taux: (c.taux && c.taux.length === 5 ? c.taux : SUGG).map(function (x) { return Math.min(100, Math.max(0, +x || 0)); }), forces: c.forces || {}, compte_prov: c.compte_prov || "491", compte_dot: c.compte_dot || "659", compte_rep: c.compte_rep || "759" };
  }
  function provision() {
    var cfg = provCfg(), L = [], req = 0;
    comptes().filter(function (c) { return c.nature === "D"; }).forEach(function (c) {
      liste(c.compte).forEach(function (t) {
        if (!(t.age.tot > 0)) return; var cle = c.compte + "|" + t.id, f = cfg.forces[cle], p;
        if (f) p = R(t.age.tot * f.taux / 100); else p = R(t.age.tr.reduce(function (s, v, i) { return s + v * cfg.taux[i] / 100; }, 0));
        if (p > 0 || f) L.push({ cle: cle, compte: c.compte, id: t.id, nom: t.nom, tr: t.age.tr, ouvert: t.age.tot, prov: p, force: f || null }); req += p;
      });
    });
    var cons = 0; try { cons = R(H.soldeCompte ? H.soldeCompte(cfg.compte_prov) : 0); } catch (e) { cons = 0; }
    return { cfg: cfg, lignes: L.sort(function (a, b) { return b.prov - a.prov; }), requise: req, constatee: cons, ajust: req - cons };
  }
  function ecritureProvision(date) {
    if (!H.brouillard) throw new Error("Cette division ne permet pas de générer l'écriture depuis cet écran.");
    if (!H.can("c")) throw new Error("Droits insuffisants pour créer une écriture en brouillard.");
    var P = provision(), c = P.cfg; if (!c.actif) throw new Error("La provision pour créances douteuses n'est pas activée.");
    if (!validDate(date)) throw new Error("Date de l'écriture invalide."); if (date > today()) throw new Error("L'écriture ne peut pas être datée dans le futur.");
    if (P.ajust === 0) throw new Error("Aucun ajustement : la dépréciation constatée (" + fcfa(P.constatee) + ") égale la dépréciation requise.");
    if (H.brouillardEnAttente && H.brouillardEnAttente("PROV-")) throw new Error("Une écriture de provision est déjà en attente de visa : visez-la ou supprimez-la avant d'en créer une autre.");
    var a = Math.abs(P.ajust), dot = P.ajust > 0;
    var o = { date: date, journal: "OD", piece: "PROV-" + date.replace(/-/g, ""), libelle: (dot ? "Dotation à la dépréciation des créances clients" : "Reprise de dépréciation des créances clients") + " au " + fd(date) + " (requise " + fcfa(P.requise) + ", constatée " + fcfa(P.constatee) + ")",
      lignes: dot ? [{ compte: c.compte_dot, debit: a, credit: 0 }, { compte: c.compte_prov, debit: 0, credit: a }] : [{ compte: c.compte_prov, debit: a, credit: 0 }, { compte: c.compte_rep, debit: 0, credit: a }] };
    H.brouillard(o); if (H.audit) H.audit("Provision créances douteuses : écriture en brouillard", (dot ? "dotation " : "reprise ") + fcfa(a)); return o;
  }
  function validDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !isNaN(Date.parse(d + "T00:00:00Z")); }
  function enregistrerProv(cfg, motif) {
    if (!H.can("a") || !H.prov) throw new Error("Droits insuffisants pour paramétrer la provision.");
    var av = provCfg(), n = { actif: cfg.actif === true, taux: cfg.taux, forces: cfg.forces || av.forces, compte_prov: String(cfg.compte_prov || "491").trim(), compte_dot: String(cfg.compte_dot || "659").trim(), compte_rep: String(cfg.compte_rep || "759").trim() };
    if (n.taux.length !== 5 || n.taux.some(function (x) { return !(x >= 0 && x <= 100); })) throw new Error("Taux invalides : entre 0 et 100 %.");
    [n.compte_prov, n.compte_dot, n.compte_rep].forEach(function (x) { if (!/^\d{2,8}$/.test(x)) throw new Error("Numéro de compte invalide : " + x); });
    H.prov.set(n); if (H.audit) H.audit("Provision créances douteuses : paramètres", (n.actif ? "activée" : "désactivée") + " — taux " + n.taux.join(" / ") + " %" + (motif ? " — " + motif : ""));
  }
  function forcerTaux(cle, taux, motif) {
    if (!H.can("a") || !H.prov) throw new Error("Droits insuffisants."); taux = +taux; if (!(taux >= 0 && taux <= 100)) throw new Error("Taux : entre 0 et 100 %.");
    if (String(motif || "").trim().length < 5) throw new Error("Motif obligatoire (5 caractères minimum) : litige, procédure, insolvabilité…");
    var c = provCfg(); c.forces = Object.assign({}, c.forces); c.forces[cle] = { taux: taux, motif: String(motif).trim(), par: H.user(), le: today() }; H.prov.set(Object.assign({}, c)); if (H.audit) H.audit("Provision : taux forcé", cle + " — " + taux + " % — " + motif);
  }
  function retirerForce(cle) { if (!H.can("a") || !H.prov) throw new Error("Droits insuffisants."); var c = provCfg(); c.forces = Object.assign({}, c.forces); delete c.forces[cle]; H.prov.set(Object.assign({}, c)); if (H.audit) H.audit("Provision : taux forcé retiré", cle); }

  /* ---------- Résumé pour la consolidation du groupe (sans noms de tiers : seules les parts sont publiées) ---------- */
  function resume() {
    var C = comptes(), out = { t: new Date().toISOString(), division: H.division };
    ["D", "C"].forEach(function (nat) {
      var S = C.filter(function (c) { return c.nature === nat; }).map(function (c) { try { return synthese(c.compte); } catch (e) { return null; } }).filter(Boolean), tr = [0, 0, 0, 0, 0], reg = { s: 0, m: 0 }, flux = 0, nb = 0, top5 = 0, tot = 0, t90 = 0, av = 0;
      S.forEach(function (x) { x.tr.forEach(function (v, i) { tr[i] += v; }); reg.s += x.reg.s; reg.m += x.reg.m; flux += x.flux; nb += x.nbTiers; t90 += x.tiers90; av += x.avance; tot += x.tot; top5 += x.top5 * x.tot; });
      out[nat === "D" ? "creances" : "dettes"] = { nb: nb, total: tot, tr: tr, echu: tr[1] + tr[2] + tr[3] + tr[4], p90: tr[4], tiers90: t90, avance: av, top5: tot ? top5 / tot : 0, delai: reg.m > 0 ? Math.round(reg.s / reg.m) : null, dso: flux > 0 ? Math.round(tot / flux * 365) : null };
    });
    var P = provision(); out.prov = { actif: P.cfg.actif, requise: P.cfg.actif ? P.requise : 0, constatee: P.constatee, ajust: P.cfg.actif ? P.ajust : 0 };
    return out;
  }
  function publier(host) { if (host) H = host; try { if (!H.can("v")) return null; var r = resume(); localStorage.setItem("logistica_tiers_" + H.division, JSON.stringify(r)); return r; } catch (e) { return null; } }

  /* ---------- Affichage ---------- */
  var CSS = ".tr-w{overflow:auto}.tr-w table{width:100%;border-collapse:collapse;font-size:13px}.tr-w th,.tr-w td{border-bottom:1px solid var(--bd,#d5dbe3);padding:6px 8px;text-align:left;vertical-align:top}.tr-w th{font-size:12px;color:var(--mu,#5b6572);white-space:nowrap}.tr-w td.n,.tr-w th.n{text-align:right;white-space:nowrap}" +
    ".tr-b{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd,#d5dbe3);background:var(--card,#fff);color:var(--tx,#1c2430);cursor:pointer}.tr-b.p{background:var(--b2,#1f3a5f);color:#fff;border-color:var(--b2,#1f3a5f)}" +
    ".tr-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0}.tr-k div{border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:9px 11px;background:var(--card,#fff)}.tr-k b{display:block;font-size:17px}.tr-k span{font-size:12px;color:var(--mu,#5b6572)}" +
    ".tr-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:8px 0}.tr-bar label{font-size:12px;color:var(--mu,#5b6572);display:block}.tr-bar input,.tr-bar select{font:inherit;padding:7px;border:1px solid var(--bd,#d5dbe3);border-radius:8px;background:var(--bg,#fff);color:var(--tx,#1c2430)}" +
    ".tr-n{background:var(--card,#fff);border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13px;color:var(--mu,#5b6572)}.tr-bd{display:inline-block;border-radius:99px;padding:1px 8px;font-size:12px;border:1px solid var(--bd,#d5dbe3)}.tr-bd.ok{border-color:#1f8a4c;color:#1f8a4c}.tr-bd.wa{border-color:#b26a00;color:#b26a00}.tr-bd.er{border-color:#b3261e;color:#b3261e}";
  function css() { if (document.getElementById("tr-css")) return; var s = document.createElement("style"); s.id = "tr-css"; s.textContent = CSS; document.head.appendChild(s); }
  var kpi = function (v, l) { return "<div><b>" + v + "</b><span>" + esc(l) + "</span></div>"; };
  var btn = function (a, id, l, c) { return '<button type="button" class="tr-b ' + (c || "") + '" data-tr="' + a + '" data-id="' + esc(id == null ? "" : id) + '">' + l + "</button>"; };
  var tbl = function (cols, rows, empty) { return '<div class="tr-w"><table><thead><tr>' + cols.map(function (c) { return '<th class="' + (c[1] || "") + '">' + esc(c[0]) + "</th>"; }).join("") + "</tr></thead><tbody>" + (rows.length ? rows.join("") : '<tr><td colspan="' + cols.length + '" style="color:var(--mu,#5b6572)">' + esc(empty || "Aucune donnée.") + "</td></tr>") + "</tbody></table></div>"; };
  var nature = function (r) { return r.nature === "C" ? ["Nous lui devons", "Avance versée (il nous doit)"] : ["Il nous doit", "Avance reçue (nous lui devons)"]; };
  var cellsAge = function (a) { return a.tr.map(function (v, i) { return '<td class="n"' + (i === 4 && v ? ' style="color:#b3261e;font-weight:700"' : "") + ">" + (v ? fcfa(v) : "") + "</td>"; }).join(""); };

  function vListe(compte) {
    var inf = infoCompte(compte), L = liste(compte), q = norm(UIS.q);
    var F = L.filter(function (t) { return !q || norm(t.nom).indexOf(q) >= 0; });
    var tot = F.reduce(function (s, t) { return s + t.solde; }, 0), plus90 = F.reduce(function (s, t) { return s + t.age.tr[4]; }, 0);
    return '<div class="tr-k">' + kpi(F.length, "Tiers" + (q ? " (filtrés)" : "")) + kpi(fcfa(tot), inf.nature === "C" ? "Total des dettes" : "Total des créances") + kpi(fcfa(plus90), "Dont de plus de 90 jours") + kpi(F.filter(function (t) { return t.solde < 0; }).length, "Tiers en avance (solde inverse)") + "</div>" +
      tbl([["Tiers"], ["Pièces", "n"], ["Non lettrées", "n"], ["Dernier mouvement"], ["Solde", "n"]].concat(TR.map(function (t) { return [t, "n"]; }), [[""]]), F.map(function (t) {
        return "<tr><td><b>" + esc(t.nom) + "</b></td><td class=\"n\">" + t.nb + "</td><td class=\"n\">" + t.nl + "</td><td>" + fd(t.derniere) + '</td><td class="n"><b>' + fcfa(t.solde) + "</b>" + (t.age.avance ? '<br><small style="color:#1f8a4c">avance ' + fcfa(t.age.avance) + "</small>" : "") + "</td>" + cellsAge(t.age) + "<td>" + btn("ouvrir", t.id, "Relevé", "p") + "</td></tr>";
      }), "Aucun tiers sur ce compte.");
  }
  function vReleve(compte, tid) {
    var r; try { r = releve(compte, tid, UIS); } catch (e) { return '<div class="tr-n">' + esc(e.message) + "</div>" + btn("liste", "", "← Liste des tiers"); }
    var nt = nature(r), s = r.solde, a = r.age;
    var rows = r.lignes.map(function (x) { return "<tr><td>" + fd(x.date) + "</td><td>" + esc(x.piece) + "</td><td>" + esc(x.libelle) + "</td><td>" + (x.lettre ? '<span class="tr-bd ok">' + esc(x.lettre) + "</span>" : "") + '</td><td class="n">' + (x.debit ? fcfa(x.debit) : "") + '</td><td class="n">' + (x.credit ? fcfa(x.credit) : "") + '</td><td class="n"><b>' + fcfa(x.cumul) + "</b></td></tr>"; });
    if (r.du) rows.unshift('<tr><td colspan="6"><i>Report au ' + fd(r.du) + '</i></td><td class="n"><b>' + fcfa(r.report) + "</b></td></tr>");
    return '<div class="tr-bar">' + btn("liste", "", "← Liste des tiers") + (H.can("p") ? btn("imprimer", "", "🖨 Imprimer / PDF", "p") + btn("csv", "", "⬇ CSV") : "") + "</div>" +
      "<h3>" + esc(r.tiers.nom) + ' <small style="color:var(--mu,#5b6572)">— compte ' + esc(r.compte) + " " + esc(r.lib) + "</small></h3>" +
      '<div class="tr-bar"><div><label>Du</label><input type="date" data-trf="du" value="' + esc(UIS.du) + '"></div><div><label>Au</label><input type="date" data-trf="au" value="' + esc(UIS.au) + '"></div><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-trf="nl" ' + (UIS.nl ? "checked" : "") + '> Pièces non lettrées seulement</label></div>' +
      '<div class="tr-k">' + kpi(fcfa(Math.abs(s)), s >= 0 ? nt[0] : nt[1]) + kpi(fcfa(r.debit), "Total débit") + kpi(fcfa(r.credit), "Total crédit") + kpi(fcfa(a.tr[4]), "Dont de plus de 90 jours") + "</div>" +
      tbl([["Date"], ["Pièce"], ["Libellé"], ["Lettre"], ["Débit", "n"], ["Crédit", "n"], [r.nature === "C" ? "Solde dû" : "Solde", "n"]], rows, "Aucun mouvement sur la période.") +
      "<h3>Ancienneté des pièces ouvertes</h3>" + tbl(TR.map(function (t) { return [t, "n"]; }).concat([["Total", "n"]]), ["<tr>" + cellsAge(a) + '<td class="n"><b>' + fcfa(a.tot) + "</b></td></tr>"], "") +
      '<div class="tr-n">Les règlements s\'imputent sur les pièces les plus anciennes' + (a.avance ? " ; excédent de règlements (avance) : <b>" + fcfa(a.avance) + "</b>" : "") + ". Lettre = pièces rapprochées entre elles (lettrage de la comptabilité)." + (r.nl ? " <b>Filtre actif : pièces non lettrées seulement.</b>" : "") + "</div>";
  }
  var pct = function (x) { return Math.round((x || 0) * 100) + " %"; };
  var barres = function (rows) { var mx = Math.max.apply(null, rows.map(function (x) { return x.v; }).concat([1])); return rows.map(function (x) { return '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px"><span style="width:90px;flex:none">' + esc(x.l) + '</span><span style="flex:1;background:var(--bd,#d5dbe3);border-radius:6px;height:14px"><span style="display:block;height:14px;border-radius:6px;background:' + (x.c || "var(--b2,#1f3a5f)") + ";width:" + Math.round(x.v / mx * 100) + '%"></span></span><b style="width:120px;text-align:right">' + fcfa(x.v) + "</b></div>"; }).join(""); };
  function vSynthese(compte) {
    var x = synthese(compte), inf = infoCompte(compte), dette = inf.nature === "C", jr = x.delai == null ? "—" : x.delai + " j";
    return '<div class="tr-k">' + kpi(fcfa(x.tot), dette ? "Dettes ouvertes" : "Créances ouvertes") + kpi(x.tot ? pct(x.echu / x.tot) : "—", "Part échue (hors « non échu »)") + kpi(fcfa(x.p90), "Dont de plus de 90 jours (" + x.tiers90 + " tiers)") + kpi(jr, dette ? "Délai moyen de paiement (observé)" : "Délai moyen de règlement (observé)") + kpi(x.dso == null ? "—" : x.dso + " j", dette ? "Délai fournisseurs (DPO)" : "Délai clients (DSO)") + kpi(pct(x.top5), "Poids des 5 premiers tiers") + "</div>" +
      "<h3>Ancienneté globale</h3>" + barres(TR.map(function (t, i) { return { l: t, v: x.tr[i], c: i === 4 ? "#b3261e" : i === 3 ? "#b26a00" : undefined }; })) +
      "<h3>Les 10 premiers tiers</h3>" + tbl([["Tiers"], ["Solde ouvert", "n"], ["Part", "n"], ["Cumul", "n"], ["Dont > 90 j", "n"], ["Délai moyen de règlement", "n"], [""]], x.top10.map(function (t) { return "<tr><td><b>" + esc(t.nom) + '</b></td><td class="n">' + fcfa(t.tot) + '</td><td class="n">' + pct(t.part) + '</td><td class="n">' + pct(t.cumul) + '</td><td class="n"' + (t.p90 ? ' style="color:#b3261e;font-weight:700"' : "") + ">" + (t.p90 ? fcfa(t.p90) : "") + '</td><td class="n">' + (t.jours == null ? "—" : t.jours + " j") + "</td><td>" + btn("ouvrir", t.id, "Relevé", "p") + "</td></tr>"; }), "Aucun solde ouvert.") +
      '<div class="tr-n">Délai moyen de règlement = moyenne, pondérée par les montants, des jours écoulés entre la date de chaque pièce et celle du règlement qui la solde (règlements imputés sur les pièces les plus anciennes)' + (x.dansDelai != null ? " ; <b>" + pct(x.dansDelai) + "</b> des montants réglés l'ont été dans le délai (échéance connue)" : "") + ". " + (dette ? "DPO" : "DSO") + " = solde ouvert ÷ flux des 12 derniers mois × 365. Les pourcentages portent sur le solde ouvert (avances exclues" + (x.avance ? " : " + fcfa(x.avance) + " d'avances" : "") + ").</div>";
  }
  function vProvision() {
    var P = provision(), c = P.cfg, ok = H.can("a") && H.prov, att = H.brouillardEnAttente ? H.brouillardEnAttente("PROV-") : false;
    if (!comptes().some(function (x) { return x.nature === "D"; })) return '<div class="tr-n">Aucun compte de créances (clients) dans cette division.</div>';
    var rows = P.lignes.map(function (l) {
      return "<tr><td><b>" + esc(l.nom) + "</b></td>" + l.tr.map(function (v) { return '<td class="n">' + (v ? fcfa(v) : "") + "</td>"; }).join("") + '<td class="n"><b>' + fcfa(l.prov) + "</b></td><td>" + (l.force ? '<span class="tr-bd wa">' + l.force.taux + " % forcé</span><br><small>" + esc(l.force.motif) + "</small> " + (ok ? btn("retirer", l.cle, "Retirer") : "") : (ok ? btn("forcer", l.cle, "Forcer un taux") : "")) + "</td></tr>";
    });
    return '<div class="tr-n"><b>Provision pour créances douteuses</b> (dépréciation des comptes clients, SYSCOHADA : dotation au débit de ' + esc(c.compte_dot) + ", dépréciation au crédit de " + esc(c.compte_prov) + ", reprise au crédit de " + esc(c.compte_rep) + "). Fonction <b>" + (c.actif ? "activée" : "désactivée") + "</b>. Elle <b>propose</b> un montant d'après l'ancienneté des créances ; l'écriture est générée <b>en brouillard</b> et ne compte qu'après visa. <b>Les taux sont à valider par votre expert-comptable</b> (traitement fiscal, TVA).</div>" +
      '<div class="tr-bar">' + (ok ? btn("provcfg", "", "⚙ Paramètres et taux", "p") : "") + (c.actif && H.can("p") ? btn("provprint", "", "🖨 État des provisions") : "") + "</div>" +
      (c.actif ? '<div class="tr-k">' + kpi(fcfa(P.requise), "Dépréciation requise") + kpi(fcfa(P.constatee), "Dépréciation constatée (compte " + c.compte_prov + ")") + kpi(fcfa(Math.abs(P.ajust)), P.ajust > 0 ? "Dotation à passer" : P.ajust < 0 ? "Reprise à passer" : "Aucun ajustement") + "</div>" +
        (P.ajust !== 0 && H.can("c") && H.brouillard ? '<div class="tr-bar"><div><label>Date de l\'écriture</label><input type="date" data-trf="provdate" value="' + esc(UIS.provdate || today()) + '" max="' + today() + '"></div>' + btn("provecr", "", "Générer l'écriture en brouillard", "p") + (att ? ' <span class="tr-bd wa">un brouillard de provision attend déjà son visa</span>' : "") + "</div>" : "") +
        tbl([["Client"]].concat(TR.map(function (t) { return [t, "n"]; }), [["Provision", "n"], [""]]), rows, "Aucune créance à déprécier avec ces taux.") +
        '<div class="tr-n">Taux appliqués par tranche : ' + TR.map(function (t, i) { return t + " " + c.taux[i] + " %"; }).join(" · ") + ". Un client en litige ou insolvable peut recevoir un taux forcé (motif obligatoire, tracé).</div>" : '<div class="tr-n">Activez la fonction dans « Paramètres et taux » pour calculer la dépréciation proposée.</div>');
  }
  function vue() {
    var C = comptes(); if (!C.length) return '<div class="tr-n">Aucun compte de tiers n\'est configuré pour cette division.</div>';
    if (!UIS.compte || !infoCompte(UIS.compte)) UIS.compte = (C.filter(function (c) { return liste(c.compte).length; })[0] || C[0]).compte;   /* premier compte qui a des mouvements */
    var sel = '<div class="tr-bar"><div><label>Compte de tiers</label><select data-trf="compte">' + C.map(function (c) { return '<option value="' + esc(c.compte) + '" ' + (c.compte === UIS.compte ? "selected" : "") + ">" + esc(c.compte + " — " + c.lib) + "</option>"; }).join("") + "</select></div>" +
      (UIS.tiers ? "" : '<div><label>Rechercher un tiers</label><input data-trf="q" value="' + esc(UIS.q) + '" placeholder="Nom…"></div>') + "</div>";
    var modes = '<div class="tr-bar">' + [["tiers", "Tiers et relevés"], ["synthese", "Synthèse âgée"], ["prov", "Provision créances douteuses"]].map(function (m) { return '<button type="button" class="tr-b ' + (UIS.mode === m[0] ? "p" : "") + '" data-tr="mode" data-id="' + m[0] + '">' + m[1] + "</button>"; }).join("") + "</div>";
    if (UIS.mode === "prov") return '<div class="tr-root">' + modes + vProvision() + "</div>";
    return '<div class="tr-root">' + modes + sel + (UIS.mode === "synthese" && !UIS.tiers ? vSynthese(UIS.compte) : UIS.tiers ? vReleve(UIS.compte, UIS.tiers) : vListe(UIS.compte)) + "</div>";
  }
  function view(host) {
    H = host; css(); G.LOGISTICA_TIERS.host = host;
    if (!H.can("v")) return '<div class="tr-n">Accès aux comptes de tiers non autorisé pour votre profil.</div>';
    return vue();
  }

  /* ---------- Impression et export ---------- */
  function corpsImpression(r) {
    var nt = nature(r), tb = function (cols, rows) { return "<table><thead><tr>" + cols.map(function (c) { return '<th class="' + (c[1] || "") + '">' + esc(c[0]) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>"; };
    var l = r.lignes.map(function (x) { return "<tr><td class=\"nw\">" + fd(x.date) + "</td><td>" + esc(x.piece) + "</td><td>" + esc(x.libelle) + "</td><td>" + esc(x.lettre) + '</td><td class="n">' + (x.debit ? fcfa(x.debit) : "") + '</td><td class="n">' + (x.credit ? fcfa(x.credit) : "") + '</td><td class="n">' + fcfa(x.cumul) + "</td></tr>"; });
    if (r.du) l.unshift('<tr><td colspan="6"><i>Report au ' + fd(r.du) + '</i></td><td class="n">' + fcfa(r.report) + "</td></tr>");
    l.push('<tr class="tot"><td colspan="4">Totaux de la période</td><td class="n">' + fcfa(r.debit) + '</td><td class="n">' + fcfa(r.credit) + '</td><td class="n">' + fcfa(r.solde) + "</td></tr>");
    var a = r.age;
    return '<p class="sub">Tiers : <b>' + esc(r.tiers.nom) + "</b> · compte " + esc(r.compte) + " " + esc(r.lib) + " · période " + (r.du ? "du " + fd(r.du) : "depuis l'origine") + " " + (r.au ? "au " + fd(r.au) : "au " + fd(r.edite)) + (r.nl ? " · pièces non lettrées seulement" : "") + "</p>" +
      tb([["Date"], ["Pièce"], ["Libellé"], ["Lettre"], ["Débit", "n"], ["Crédit", "n"], [r.nature === "C" ? "Solde dû" : "Solde", "n"]], l) +
      '<p style="margin-top:10px"><b>Solde au ' + fd(r.au || r.edite) + " : " + fcfa(Math.abs(r.solde)) + "</b> — " + (r.solde >= 0 ? nt[0] : nt[1]) + ".</p>" +
      "<h3>Ancienneté des pièces ouvertes</h3>" + tb(TR.map(function (t) { return [t, "n"]; }).concat([["Total", "n"]]), ["<tr>" + a.tr.map(function (v) { return '<td class="n">' + (v ? fcfa(v) : "—") + "</td>"; }).join("") + '<td class="n"><b>' + fcfa(a.tot) + "</b></td></tr>"]) +
      '<p class="sub" style="margin-top:8px">Les règlements sont imputés sur les pièces les plus anciennes. Merci de signaler toute différence dans un délai de 15 jours.</p>';
  }
  function imprimer() {
    if (!G.LOGISTICA_PRINT) { alert("Moteur d'impression indisponible."); return; }
    if (!H.can("p")) { alert("Droits insuffisants pour imprimer."); return; }
    var r = releve(UIS.compte, UIS.tiers, UIS);
    G.LOGISTICA_PRINT.ouvrir({ division: H.division, emetteur: H.user(), fallback: H.identite ? H.identite() : null, titre: "Relevé de compte " + (r.nature === "C" ? "fournisseur" : "client"), ref: "RC-" + r.compte + "-" + norm(r.tiers.nom).replace(/[^a-z0-9]+/g, "").slice(0, 8).toUpperCase(), date: r.au || r.edite, montant: Math.abs(r.solde), corps: corpsImpression(r) }).catch(function (e) { alert("Impression impossible : " + e.message); });
    if (H.audit) H.audit("Relevé de compte imprimé", r.tiers.nom + " — " + r.compte);
  }
  function csv() {
    if (!H.can("p")) { alert("Droits insuffisants pour exporter."); return; }
    var r = releve(UIS.compte, UIS.tiers, UIS), q = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/^([=+@\t\r]|-(?![\d.,]+$))/, "'$1") + '"'; };
    var rows = [["Date", "Pièce", "Libellé", "Lettre", "Débit", "Crédit", "Solde"]];
    if (r.du) rows.push([r.du, "", "Report", "", "", "", r.report]);
    r.lignes.forEach(function (x) { rows.push([x.date, x.piece, x.libelle, x.lettre, x.debit, x.credit, x.cumul]); });
    var b = new Blob(["﻿" + rows.map(function (x) { return x.map(q).join(";"); }).join("\n")], { type: "text/csv" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "releve-" + r.compte + "-" + norm(r.tiers.nom).replace(/[^a-z0-9]+/g, "-") + ".csv"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ---------- Formulaires ---------- */
  function form(titre, champs, init, onSave, ok) {
    var ov = document.createElement("div"); ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,20,28,.6);z-index:9990;display:flex;align-items:center;justify-content:center;padding:12px");
    var f = champs.map(function (x) { var v = init && init[x.k] != null ? init[x.k] : "", inp = x.t === "select" ? '<select name="' + x.k + '">' + x.o.map(function (y) { return '<option value="' + esc(y[0]) + '" ' + (String(y[0]) === String(v) ? "selected" : "") + ">" + esc(y[1]) + "</option>"; }).join("") + "</select>" : '<input name="' + x.k + '" type="' + (x.t || "text") + '" ' + (x.t === "number" ? 'step="any" min="0" max="100"' : "") + ' value="' + esc(v) + '" autocomplete="off">';
      return '<label style="display:block;font-size:13px;margin:8px 0;color:var(--mu,#5b6572)">' + esc(x.l) + (x.h ? ' <small>' + esc(x.h) + "</small>" : "") + inp + "</label>"; }).join("");
    ov.innerHTML = '<div style="background:var(--card,#fff);color:var(--tx,#1c2430);border-radius:14px;width:100%;max-width:520px;max-height:92vh;overflow:auto;padding:18px"><h3 style="margin:0 0 6px">' + esc(titre) + '</h3><form novalidate>' + f + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="tr-b" data-x="1">Annuler</button><button class="tr-b p">' + esc(ok || "Valider") + "</button></div></form></div>";
    ov.querySelectorAll("input,select").forEach(function (i) { i.style.cssText = "width:100%;font:inherit;padding:8px;border:1px solid var(--bd,#d5dbe3);border-radius:8px;background:var(--bg,#fff);color:var(--tx,#1c2430);margin-top:3px"; });
    document.body.appendChild(ov); var fm = ov.querySelector("form");
    ov.querySelectorAll("[data-x]").forEach(function (b) { b.onclick = function () { ov.remove(); }; });
    fm.onsubmit = function (e) { e.preventDefault(); var o = {}; champs.forEach(function (x) { var v = fm.elements[x.k].value.trim(); o[x.k] = x.t === "number" ? (v === "" ? 0 : +v) : v; }); var r = H.run ? H.run(function () { return onSave(o); }) : (onSave(o), true); if (r !== false) { ov.remove(); H.render(); } };
    var f0 = fm.querySelector("input,select"); if (f0) f0.focus(); return ov;
  }

  /* ---------- Actions ---------- */
  function ouvrir(host, compte, tiers) { if (host) H = host; UIS.mode = "tiers"; UIS.compte = compte; UIS.tiers = tiers == null ? "" : String(tiers); UIS.du = ""; UIS.au = ""; UIS.nl = false; UIS.q = ""; if (H.aller) H.aller(); else H.render(); }
  var ACT = {
    ouvrir: function (id) { UIS.tiers = id; UIS.du = ""; UIS.au = ""; UIS.nl = false; H.render(); },
    liste: function () { UIS.tiers = ""; H.render(); },
    imprimer: imprimer, csv: csv,
    mode: function (id) { UIS.mode = id; UIS.tiers = ""; H.render(); },
    provcfg: function () { var c = provCfg(); form("Provision pour créances douteuses", [{ k: "actif", l: "Fonction", t: "select", o: [["non", "Désactivée"], ["oui", "Activée"]] }].concat(TR.map(function (t, i) { return { k: "t" + i, l: "Taux — " + t + " (%)", t: "number" }; }), [{ k: "cp", l: "Compte de dépréciation (crédit)" }, { k: "cd", l: "Compte de dotation (débit)" }, { k: "cr", l: "Compte de reprise (crédit)" }]), { actif: c.actif ? "oui" : "non", t0: c.taux[0], t1: c.taux[1], t2: c.taux[2], t3: c.taux[3], t4: c.taux[4], cp: c.compte_prov, cd: c.compte_dot, cr: c.compte_rep },
      function (o) { enregistrerProv({ actif: o.actif === "oui", taux: [o.t0, o.t1, o.t2, o.t3, o.t4], compte_prov: o.cp, compte_dot: o.cd, compte_rep: o.cr }); }, "Enregistrer"); },
    forcer: function (cle) { form("Forcer le taux de provision", [{ k: "taux", l: "Taux de dépréciation (%)", t: "number" }, { k: "motif", l: "Motif (litige, procédure, insolvabilité…)" }], { taux: 100 }, function (o) { forcerTaux(cle, o.taux, o.motif); }, "Enregistrer"); },
    retirer: function (cle) { if (!confirm("Retirer le taux forcé ?")) return; var r = H.run ? H.run(function () { retirerForce(cle); }) : (retirerForce(cle), true); if (r !== false) H.render(); },
    provecr: function () { var r = H.run ? H.run(function () { ecritureProvision(UIS.provdate || today()); }) : (ecritureProvision(UIS.provdate || today()), true); if (r !== false) { alert("Écriture générée en brouillard : elle sera comptabilisée après visa (Comptabilité → Saisie & visa)."); H.render(); } },
    provprint: function () {
      if (!G.LOGISTICA_PRINT || !H.can("p")) return; var P = provision(), tb = function (cols, rows) { return "<table><thead><tr>" + cols.map(function (c) { return '<th class="' + (c[1] || "") + '">' + esc(c[0]) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>"; };
      var rows = P.lignes.map(function (l) { return "<tr><td>" + esc(l.nom) + "</td>" + l.tr.map(function (v) { return '<td class="n">' + (v ? fcfa(v) : "") + "</td>"; }).join("") + '<td class="n">' + fcfa(l.prov) + "</td><td>" + (l.force ? l.force.taux + " % — " + esc(l.force.motif) : "") + "</td></tr>"; }); rows.push('<tr class="tot"><td colspan="6">Dépréciation requise</td><td class="n">' + fcfa(P.requise) + "</td><td></td></tr>");
      G.LOGISTICA_PRINT.ouvrir({ division: H.division, emetteur: H.user(), fallback: H.identite ? H.identite() : null, titre: "État des provisions pour créances douteuses", ref: "PROV-" + today().replace(/-/g, ""), date: today(), montant: P.requise, paysage: true,
        corps: '<p class="sub">Taux par tranche : ' + TR.map(function (t, i) { return t + " " + P.cfg.taux[i] + " %"; }).join(" · ") + ". Dépréciation constatée (compte " + esc(P.cfg.compte_prov) + ") : " + fcfa(P.constatee) + ". Ajustement : " + fcfa(P.ajust) + ".</p>" + tb([["Client"]].concat(TR.map(function (t) { return [t, "n"]; }), [["Provision", "n"], ["Taux forcé / motif"]]), rows) + '<p class="sub" style="margin-top:8px">Montants à valider par l\'expert-comptable avant comptabilisation.</p>' }).catch(function (e) { alert("Impression impossible : " + e.message); });
      if (H.audit) H.audit("État des provisions imprimé", fcfa(P.requise));
    }
  };
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-tr]"); if (!t || !G.LOGISTICA_TIERS.host) return; var f = ACT[t.dataset.tr]; if (!f) return; e.preventDefault(); H = G.LOGISTICA_TIERS.host;
    try { f(t.dataset.id, t); } catch (x) { alert(x.message); }
  });
  document.addEventListener("input", function (e) { var t = e.target; if (!t.dataset || t.dataset.trf !== "q" || !H) return; UIS.q = t.value; var pos = t.selectionStart; H.render(); var n = document.querySelector('[data-trf="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { } } });
  document.addEventListener("change", function (e) {
    var t = e.target; if (!H || !t.dataset || !t.dataset.trf) return; var k = t.dataset.trf;
    if (k === "compte") { UIS.compte = t.value; UIS.tiers = ""; UIS.q = ""; } else if (k === "du" || k === "au") UIS[k] = t.value; else if (k === "nl") UIS.nl = t.checked; else if (k === "provdate") { UIS.provdate = t.value; return; } else return;
    H.render();
  });

  /* Ouvre le relevé d'un tiers à partir de son nom (utilisé par les balances âgées de chaque division) */
  function ouvrirParNom(host, nom, nature) {
    if (host) H = host;
    var cs = comptes().filter(function (c) { return !nature || c.nature === nature; });
    for (var i = 0; i < cs.length; i++) { var t = liste(cs[i].compte).filter(function (x) { return x.nom === nom; })[0]; if (t) { ouvrir(H, cs[i].compte, t.id); return true; } }
    return false;
  }
  G.LOGISTICA_TIERS = { host: null, view: view, ouvrir: ouvrir, ouvrirParNom: ouvrirParNom, synthese: function (c, h) { if (h) H = h; return synthese(c); }, delai: delai, provision: function (h) { if (h) H = h; return provision(); }, ecritureProvision: function (d, h) { if (h) H = h; return ecritureProvision(d); }, enregistrerProv: function (c, m, h) { if (h) H = h; return enregistrerProv(c, m); }, forcerTaux: function (k, t, m, h) { if (h) H = h; return forcerTaux(k, t, m); }, retirerForce: function (k, h) { if (h) H = h; return retirerForce(k); }, resume: function (h) { if (h) H = h; return resume(); }, publier: publier, releve: function (compte, tid, o, h) { if (h) H = h; return releve(compte, tid, o); }, liste: function (compte, h) { if (h) H = h; return liste(compte); }, age: age, UI: UIS, TRANCHES: TR, use: function (h) { H = h; this.host = h; } };
})(window);
