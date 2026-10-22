/* LOGISTICA — moteur commun des opérations entre divisions (Distributions, Transport & négoce, Agro) : registre unique, double comptabilisation, rapprochement et éliminations de consolidation.
   Une division ÉMET une opération vers une autre (vente, prestation, refacturation de frais, avance de trésorerie) : elle l'enregistre en brouillard (Débit 466 « Groupe, comptes courants »
   / Crédit produit ou trésorerie). La division destinataire la CONFIRME (ou la conteste) : elle l'enregistre à son tour (Débit charge ou trésorerie / Crédit 466). Chaque règlement se constate des deux côtés.
   Les deux écritures portent la MÊME pièce (IG-AAAAMMJJ-NNN) : c'est ce qui permet le rapprochement et l'élimination des opérations réciproques dans le consolidé du groupe.
   Le registre est partagé entre les trois applications ouvertes sur le même appareil (stockage local) ; il n'est pas synchronisé entre appareils. Montants hors taxes.

   Contrat de l'hôte (host) :
     division ; can(a) : "v" consulter, "c" émettre / confirmer / régler, "p" imprimer ; user() ; render() ; util.fcfa ; audit(a, d) ; run(fn)
     brouillard({date, journal, piece, libelle, lignes:[{compte, debit, credit}]}) ; brouillardEnAttente(prefixePiece) ; soldeCompte(compte) : crédit − débit ; compteOk(compte) : "" ou erreur ; clos() : dernière date clôturée
     treso() : [{compte, lib, solde}] comptes de trésorerie ; liaison (facultatif) : compte de liaison, "466" par défaut */
(function (G) {
  "use strict";
  var H = null, R = Math.round, KEY = "angels_inter";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fcfa = function (n) { return H && H.util && H.util.fcfa ? H.util.fcfa(n) : R(n || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ") + " F"; };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var fd = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : (d || "—"); };
  var validDate = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !isNaN(Date.parse(d + "T00:00:00Z")); };
  var diffJ = function (a, b) { return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5); };
  var DIV = { distribution: "Distributions", transport: "Transport & négoce", agro: "Agro" };
  var NAT = {
    vente: { lib: "Vente de biens", de: "7011", a: "6011", cl: ["7", "6"] }, service: { lib: "Prestation de services", de: "7061", a: "638", cl: ["7", "6"] },
    refact: { lib: "Refacturation de frais", de: "707", a: "638", cl: ["7", "6"] }, avance: { lib: "Avance de trésorerie", de: "", a: "", cl: ["5", "5"] }
  };
  var UIS = { f: "traiter" };
  var liaison = function () { return (H && H.liaison) || "466"; };

  /* ---------- Registre (partagé) ---------- */
  function lire() { try { var r = JSON.parse(localStorage.getItem(KEY) || "null"); if (r && Array.isArray(r.ops)) return r; } catch (e) { } return { v: 1, ops: [] }; }
  function ecrire(r) { localStorage.setItem(KEY, JSON.stringify(r)); }
  function maj(fn) { var r = lire(); fn(r); ecrire(r); return r; }
  function clos() { try { return (H.clos && H.clos()) || ""; } catch (e) { return ""; } }
  function ref(r, date) { var n = r.ops.filter(function (o) { return o.date === date; }).length + 1, k; do { k = "IG-" + date.replace(/-/g, "") + "-" + ("00" + n).slice(-3); n++; } while (r.ops.some(function (o) { return o.ref === k; })); return k; }
  var pieceReg = function (o) { return "IGR-" + o.ref.slice(3); };
  var autre = function (o) { return o.de === H.division ? o.a : o.de; };
  var moi = function (o) { return o.de === H.division || o.a === H.division; };
  var cote = function (o) { return o.de === H.division ? "de" : "a"; };

  function brou(date, piece, libelle, lignes) {
    if (!H.brouillard) throw new Error("Cette division ne permet pas de générer l'écriture depuis cet écran.");
    var c = clos(); if (c && date <= c) throw new Error("Période clôturée jusqu'au " + fd(c) + " : choisissez une date de comptabilisation postérieure.");
    lignes.forEach(function (l) { var er = H.compteOk ? H.compteOk(l.compte) : ""; if (er) throw new Error(er); });
    H.brouillard({ date: date, journal: "OD", piece: piece, libelle: libelle, lignes: lignes });
  }
  var lib = function (o) { return NAT[o.nature].lib + " " + DIV[o.de] + " → " + DIV[o.a] + " — " + o.objet; };

  /* ---------- Actions ---------- */
  function emettre(f) {
    if (!H.can("c")) throw new Error("Droits insuffisants pour émettre une opération entre divisions.");
    var n = NAT[f.nature]; if (!n) throw new Error("Nature d'opération inconnue.");
    if (!DIV[f.a]) throw new Error("Division destinataire inconnue."); if (f.a === H.division) throw new Error("La division destinataire doit être différente de la vôtre.");
    f.objet = String(f.objet || "").trim(); if (!f.objet) throw new Error("Objet de l'opération obligatoire.");
    f.montant = R(+f.montant || 0); if (!(f.montant > 0)) throw new Error("Montant invalide : il doit être supérieur à zéro.");
    if (!validDate(f.date)) throw new Error("Date invalide."); if (f.date > today()) throw new Error("La date de l'opération ne peut pas être dans le futur.");
    f.cpt = String(f.cpt || n.de).trim(); if (!/^\d{3,8}$/.test(f.cpt)) throw new Error("Compte " + (f.nature === "avance" ? "de trésorerie" : "de produit") + " invalide.");
    if (f.cpt[0] !== n.cl[0]) throw new Error("Le compte " + f.cpt + " doit être un compte de " + (f.nature === "avance" ? "trésorerie (classe 5)" : "produits (classe 7)") + ".");
    var op, r = lire(); op = { id: "io" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ref: ref(r, f.date), date: f.date, de: H.division, a: f.a, nature: f.nature, objet: f.objet, montant: f.montant, cpt_de: f.cpt, cpt_a: "", statut: "emise", par: H.user(), t: new Date().toISOString(), reg: { de: null, a: null } };
    brou(op.date, op.ref, lib(op), [{ compte: liaison(), debit: op.montant, credit: 0 }, { compte: op.cpt_de, debit: 0, credit: op.montant }]);
    r = lire(); r.ops.push(op); ecrire(r); if (H.audit) H.audit("Opération inter-divisions émise", op.ref + " — " + DIV[op.a] + " — " + fcfa(op.montant)); return op;
  }
  function trouver(r, id) { var o = r.ops.filter(function (x) { return x.id === id; })[0]; if (!o) throw new Error("Opération introuvable (le registre est propre à cet appareil)."); return o; }
  function confirmer(id, f) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var r = lire(), o = trouver(r, id);
    if (o.a !== H.division) throw new Error("Seule la division destinataire peut confirmer cette opération."); if (o.statut !== "emise") throw new Error("Cette opération n'est plus en attente de confirmation (" + o.statut + ").");
    var n = NAT[o.nature]; f = f || {}; var cpt = String(f.cpt || n.a).trim(), date = f.date || o.date;
    if (!/^\d{3,8}$/.test(cpt)) throw new Error("Compte invalide."); if (cpt[0] !== n.cl[1]) throw new Error("Le compte " + cpt + " doit être un compte de " + (o.nature === "avance" ? "trésorerie (classe 5)" : "charges (classe 6)") + ".");
    if (!validDate(date)) throw new Error("Date de comptabilisation invalide."); if (date > today()) throw new Error("La date ne peut pas être dans le futur."); if (date < o.date) throw new Error("La date de comptabilisation ne peut pas précéder l'opération (" + fd(o.date) + ").");
    brou(date, o.ref, lib(o), [{ compte: cpt, debit: o.montant, credit: 0 }, { compte: liaison(), debit: 0, credit: o.montant }]);
    r = lire(); o = trouver(r, id);   /* relecture : un autre onglet a pu écrire pendant la création du brouillard */
    o.statut = "confirmee"; o.cpt_a = cpt; o.date_a = date; o.conf = { par: H.user(), le: new Date().toISOString() }; delete o.motif; ecrire(r);
    if (H.audit) H.audit("Opération inter-divisions confirmée", o.ref + " — " + fcfa(o.montant)); return o;
  }
  function contester(id, motif) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var r = lire(), o = trouver(r, id); motif = String(motif || "").trim();
    if (o.a !== H.division) throw new Error("Seule la division destinataire peut contester cette opération."); if (o.statut !== "emise") throw new Error("Cette opération n'est plus en attente de confirmation.");
    if (motif.length < 5) throw new Error("Motif obligatoire (5 caractères au moins).");
    o.statut = "contestee"; o.motif = motif; o.conteste_par = H.user(); ecrire(r); if (H.audit) H.audit("Opération inter-divisions contestée", o.ref + " — " + motif); return o;
  }
  function representer(id) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var r = lire(), o = trouver(r, id);
    if (o.de !== H.division) throw new Error("Seule la division émettrice peut représenter l'opération."); if (o.statut !== "contestee") throw new Error("Seule une opération contestée peut être représentée.");
    o.statut = "emise"; o.motif_precedent = o.motif; delete o.motif; ecrire(r); if (H.audit) H.audit("Opération inter-divisions représentée", o.ref); return o;
  }
  function annuler(id, motif) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var r = lire(), o = trouver(r, id); motif = String(motif || "").trim();
    if (o.de !== H.division) throw new Error("Seule la division émettrice peut annuler l'opération."); if (o.statut === "confirmee") throw new Error("Opération déjà confirmée : elle ne s'annule plus. Passez une opération inverse après accord des deux divisions.");
    if (o.statut === "annulee") throw new Error("Opération déjà annulée."); if (motif.length < 5) throw new Error("Motif obligatoire (5 caractères au moins).");
    o.statut = "annulee"; o.motif = motif; ecrire(r); if (H.audit) H.audit("Opération inter-divisions annulée", o.ref + " — " + motif); return o;
  }
  function regler(id, f) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var r = lire(), o = trouver(r, id), c = cote(o);
    if (!moi(o)) throw new Error("Cette opération ne concerne pas votre division."); if (o.statut !== "confirmee") throw new Error("Seule une opération confirmée se règle.");
    if (o.reg[c]) throw new Error("Votre règlement est déjà constaté (" + fd(o.reg[c].date) + ")."); f = f || {};
    var cpt = String(f.compte || "").trim(), date = f.date || today(); if (!/^5\d{2,7}$/.test(cpt)) throw new Error("Compte de trésorerie (classe 5) obligatoire.");
    if (!validDate(date)) throw new Error("Date de règlement invalide."); if (date > today()) throw new Error("La date de règlement ne peut pas être dans le futur."); if (date < o.date) throw new Error("Le règlement ne peut pas précéder l'opération (" + fd(o.date) + ").");
    var piece = pieceReg(o), cree = c === "de";   /* l'émetteur encaisse, le destinataire paie */
    brou(date, piece, "Règlement " + (cree ? "reçu de " + DIV[o.a] : "versé à " + DIV[o.de]) + " — " + o.ref, cree ? [{ compte: cpt, debit: o.montant, credit: 0 }, { compte: liaison(), debit: 0, credit: o.montant }] : [{ compte: liaison(), debit: o.montant, credit: 0 }, { compte: cpt, debit: 0, credit: o.montant }]);
    r = lire(); o = trouver(r, id); o.reg[c] = { date: date, compte: cpt, piece: piece, par: H.user() }; ecrire(r); if (H.audit) H.audit("Opération inter-divisions : règlement constaté", o.ref + " — " + fcfa(o.montant)); return o;
  }

  /* ---------- Contrôles et agrégats (utilisables par le consolidé du groupe) ---------- */
  var enCours = function (o) { return o.statut === "emise" || o.statut === "contestee"; };
  function attendu(ops, d, pend) {   /* solde attendu du compte de liaison de la division d (débit − crédit), d'après le registre ; les écritures encore en brouillard ne comptent pas */
    pend = pend || function () { return false; }; var s = 0;
    ops.forEach(function (o) {
      if (o.statut === "annulee") return;
      if (o.de === d) s += (!pend(o.ref) ? o.montant : 0) - (o.reg.de && !pend(pieceReg(o)) ? o.montant : 0);
      if (o.a === d && o.statut === "confirmee") s -= (!pend(o.ref) ? o.montant : 0) - (o.reg.a && !pend(pieceReg(o)) ? o.montant : 0);
    }); return s;
  }
  function agreger(ops) {
    ops = ops || lire().ops; var mat = {}, pl = { ca: 0, par: {} }, att = [], cont = [], desac = [];
    Object.keys(DIV).forEach(function (a) { mat[a] = {}; Object.keys(DIV).forEach(function (b) { mat[a][b] = 0; }); });
    ops.forEach(function (o) {
      if (o.statut === "annulee") return;
      if (o.statut === "emise") att.push(o); if (o.statut === "contestee") cont.push(o);
      if (o.statut !== "confirmee") return;
      var rd = !!o.reg.de, ra = !!o.reg.a;
      if (rd !== ra) desac.push(o);
      if (!rd && !ra) mat[o.de][o.a] += o.montant;   /* encours réciproque : créance de l'émetteur = dette du destinataire */
      if (o.nature !== "avance") { pl.ca += o.montant; pl.par[o.de] = (pl.par[o.de] || 0) + o.montant; }
    });
    var enc = 0; Object.keys(DIV).forEach(function (a) { Object.keys(DIV).forEach(function (b) { enc += mat[a][b]; }); });
    return { matrice: mat, pl: pl, enAttente: att, contestees: cont, desaccord: desac, encours: enc, nb: ops.filter(function (o) { return o.statut !== "annulee"; }).length };
  }
  function controle() {
    var ops = lire().ops.filter(moi), pend = function (p) { try { return !!(H.brouillardEnAttente && H.brouillardEnAttente(p)); } catch (e) { return false; } }, a = attendu(ops, H.division, pend), s = 0, nb = 0; ops.forEach(function (o) { if (pend(o.ref)) nb++; if (o.reg[cote(o)] && pend(pieceReg(o))) nb++; }); try { s = -R(H.soldeCompte(liaison())); } catch (e) { s = 0; }
    var A = [], t = today();
    ops.forEach(function (o) {
      if (o.de === H.division && o.statut === "emise") { var j = diffJ(t, o.date); if (j >= 7) A.push({ n: "wa", t: o.ref + " : en attente de confirmation de " + DIV[o.a] + " depuis " + j + " jours." }); }
      if (o.a === H.division && o.statut === "emise") A.push({ n: "wa", t: o.ref + " : " + DIV[o.de] + " vous a facturé " + fcfa(o.montant) + " — à confirmer ou contester." });
      if (o.de === H.division && o.statut === "contestee") A.push({ n: "er", t: o.ref + " : contestée par " + DIV[o.a] + " (« " + o.motif + " »). Représentez-la ou annulez-la." });
      if (o.statut === "confirmee" && (o.reg.de === null) !== (o.reg.a === null)) A.push({ n: "wa", t: o.ref + " : règlement constaté par " + (o.reg.de ? DIV[o.de] : DIV[o.a]) + " seulement — en attente de l'autre division." });
    });
    if (s !== a) A.push({ n: "er", t: "Le solde du compte " + liaison() + " (" + fcfa(s) + ") diffère de celui attendu d'après le registre (" + fcfa(a) + ") : écart de " + fcfa(s - a) + ". Des écritures manuelles ont-elles été passées sur ce compte hors du registre ?" });
    if (nb) A.push({ n: "mu", t: nb + " écriture(s) inter-divisions encore en brouillard : elles seront comptées après visa." });
    return { alertes: A, solde: s, attendu: a, enBrouillard: nb };
  }
  function resume() {
    var ops = lire().ops.filter(moi), c = controle(), cre = {}, det = {};
    ops.forEach(function (o) { if (o.statut === "annulee") return; if (o.de === H.division && !o.reg.de) cre[o.a] = (cre[o.a] || 0) + o.montant; if (o.a === H.division && o.statut === "confirmee" && !o.reg.a) det[o.de] = (det[o.de] || 0) + o.montant; });
    return { t: new Date().toISOString(), division: H.division, nb: ops.filter(function (o) { return o.statut !== "annulee"; }).length, a_confirmer: ops.filter(function (o) { return o.a === H.division && o.statut === "emise"; }).length, contestees: ops.filter(function (o) { return o.statut === "contestee"; }).length, creances: cre, dettes: det, solde: c.solde, attendu: c.attendu, ecart: c.solde - c.attendu, alertes: c.alertes.length };
  }
  function publier(host) { if (host) H = host; try { if (!H.can("v")) return null; var r = resume(); localStorage.setItem("angels_inter_" + H.division, JSON.stringify(r)); return r; } catch (e) { return null; } }

  /* ---------- Affichage ---------- */
  var CSS = ".ig-w{overflow:auto}.ig-w table{width:100%;border-collapse:collapse;font-size:13px}.ig-w th,.ig-w td{border-bottom:1px solid var(--bd,#d5dbe3);padding:6px 8px;text-align:left;vertical-align:top}.ig-w th{font-size:12px;color:var(--mu,#5b6572);white-space:nowrap}.ig-w td.n,.ig-w th.n{text-align:right;white-space:nowrap}" +
    ".ig-b{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd,#d5dbe3);background:var(--card,#fff);color:var(--tx,#1c2430);cursor:pointer}.ig-b.p{background:var(--b2,#1f3a5f);color:#fff;border-color:var(--b2,#1f3a5f)}.ig-b.sm{padding:3px 8px;font-size:12px}" +
    ".ig-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0}.ig-k div{border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:9px 11px;background:var(--card,#fff)}.ig-k b{display:block;font-size:17px}.ig-k span{font-size:12px;color:var(--mu,#5b6572)}" +
    ".ig-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.ig-n{background:var(--card,#fff);border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13px;color:var(--mu,#5b6572)}.ig-n.wa{border-left:4px solid #b26a00;color:#b26a00}.ig-n.er{border-left:4px solid #b3261e;color:#b3261e}.ig-n.ok{border-left:4px solid #1f8a4c;color:#1f8a4c}" +
    ".ig-bd{display:inline-block;border-radius:99px;padding:1px 8px;font-size:12px;border:1px solid var(--bd,#d5dbe3)}.ig-bd.ok{border-color:#1f8a4c;color:#1f8a4c}.ig-bd.wa{border-color:#b26a00;color:#b26a00}.ig-bd.er{border-color:#b3261e;color:#b3261e}";
  function css() { if (document.getElementById("ig-css")) return; var s = document.createElement("style"); s.id = "ig-css"; s.textContent = CSS; document.head.appendChild(s); }
  var kpi = function (v, l) { return "<div><b>" + v + "</b><span>" + esc(l) + "</span></div>"; };
  var btn = function (a, id, l, c) { return '<button type="button" class="ig-b ' + (c || "") + '" data-ig="' + a + '" data-id="' + esc(id == null ? "" : id) + '">' + l + "</button>"; };
  function etat(o) {
    var c = cote(o), s = { emise: ["wa", "En attente de confirmation"], contestee: ["er", "Contestée"], annulee: ["", "Annulée"] }[o.statut];
    if (o.statut === "confirmee") s = o.reg.de && o.reg.a ? ["ok", "Soldée"] : o.reg.de || o.reg.a ? ["wa", "Règlement partiel"] : ["ok", "Confirmée"];
    return '<span class="ig-bd ' + s[0] + '">' + s[1] + "</span>";
  }
  function actions(o) {
    if (!H.can("c")) return ""; var b = [], c = cote(o);
    if (o.a === H.division && o.statut === "emise") b.push(btn("conf", o.id, "✔ Confirmer", "sm"), btn("cont", o.id, "✖ Contester", "sm"));
    if (o.de === H.division && o.statut === "contestee") b.push(btn("repr", o.id, "↻ Représenter", "sm"));
    if (o.de === H.division && (o.statut === "emise" || o.statut === "contestee")) b.push(btn("ann", o.id, "Annuler", "sm"));
    if (o.statut === "confirmee" && !o.reg[c]) b.push(btn("reg", o.id, c === "de" ? "💰 Constater l'encaissement" : "💸 Constater le paiement", "sm"));
    return b.join(" ");
  }
  function vue() {
    var ops = lire().ops.filter(moi).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.ref.localeCompare(a.ref); }), C = controle(), cre = 0, det = 0;
    ops.forEach(function (o) { if (o.statut === "annulee") return; if (o.de === H.division && !o.reg.de) cre += o.montant; if (o.a === H.division && o.statut === "confirmee" && !o.reg.a) det += o.montant; });
    var traiter = ops.filter(function (o) { return (o.a === H.division && o.statut === "emise") || (o.de === H.division && o.statut === "contestee") || (o.statut === "confirmee" && !o.reg[cote(o)]); });
    var liste = UIS.f === "traiter" ? traiter : ops;
    var h = '<div class="ig-root"><div class="ig-n">Opérations <b>entre les divisions du groupe</b> : chaque opération est enregistrée par l\'émetteur, confirmée par le destinataire, puis réglée ; les deux divisions la comptabilisent sur le compte <b>' + esc(liaison()) + '</b> avec la même pièce, ce qui permet de les éliminer dans le consolidé du groupe.</div>';
    h += '<div class="ig-k">' + kpi(fcfa(cre), "Créances sur les autres divisions") + kpi(fcfa(det), "Dettes envers les autres divisions") + kpi(traiter.length, "Opérations à traiter") + kpi(fcfa(C.solde), "Solde du compte " + liaison() + " (attendu " + fcfa(C.attendu) + ")") + "</div>";
    C.alertes.forEach(function (a) { h += '<div class="ig-n ' + a.n + '">' + esc(a.t) + "</div>"; });
    if (!C.alertes.length && ops.length) h += '<div class="ig-n ok">Rapprochement : aucun écart avec le registre du groupe.</div>';
    h += '<div class="ig-bar">' + (H.can("c") ? btn("new", "", "➕ Nouvelle opération", "p") : "") + btn("f", "traiter", "À traiter (" + traiter.length + ")", UIS.f === "traiter" ? "p" : "") + btn("f", "toutes", "Toutes (" + ops.length + ")", UIS.f === "toutes" ? "p" : "") + (H.can("p") ? btn("print", "", "🖨 Imprimer") : "") + "</div>";
    h += '<div class="ig-w"><table><thead><tr><th>Pièce</th><th>Date</th><th>Sens</th><th>Nature / objet</th><th class="n">Montant</th><th>État</th><th></th></tr></thead><tbody>' + (liste.length ? liste.map(function (o) {
      return "<tr><td>" + esc(o.ref) + "</td><td>" + fd(o.date) + "</td><td>" + (o.de === H.division ? "→ " + esc(DIV[o.a]) : "← " + esc(DIV[o.de])) + "</td><td>" + esc(NAT[o.nature].lib) + "<br><small>" + esc(o.objet) + (o.motif ? " — " + esc(o.motif) : "") + '</small></td><td class="n">' + fcfa(o.montant) + "</td><td>" + etat(o) + "</td><td>" + actions(o) + "</td></tr>"; }).join("") : '<tr><td colspan="7" style="color:var(--mu,#5b6572)">' + (UIS.f === "traiter" ? "Rien à traiter." : "Aucune opération entre divisions.") + "</td></tr>") + "</tbody></table></div>";
    h += '<div class="ig-n">Le registre est partagé entre les applications ouvertes sur cet appareil. Montants hors taxes (la TVA se comptabilise séparément). Une opération confirmée ne s\'annule plus : passez une opération inverse après accord des deux divisions.</div></div>';
    return h;
  }
  function view(host) { H = host; css(); G.ANGELS_INTER.host = host; if (!H.can("v")) return '<div class="ig-n">Accès aux opérations entre divisions non autorisé pour votre profil.</div>'; return vue(); }

  function imprimer() {
    if (!G.ANGELS_PRINT) { alert("Moteur d'impression indisponible."); return; } if (!H.can("p")) { alert("Droits insuffisants pour imprimer."); return; }
    var ops = lire().ops.filter(moi).sort(function (a, b) { return a.date < b.date ? -1 : 1; }), C = controle();
    var rows = ops.map(function (o) { return "<tr><td>" + esc(o.ref) + "</td><td>" + fd(o.date) + "</td><td>" + (o.de === H.division ? "→ " + esc(DIV[o.a]) : "← " + esc(DIV[o.de])) + "</td><td>" + esc(NAT[o.nature].lib + " — " + o.objet) + '</td><td class="n">' + fcfa(o.montant) + "</td><td>" + ({ emise: "En attente", contestee: "Contestée", annulee: "Annulée", confirmee: o.reg.de && o.reg.a ? "Soldée" : "Confirmée" }[o.statut]) + "</td></tr>"; });
    G.ANGELS_PRINT.ouvrir({ division: H.division, emetteur: H.user(), fallback: H.identite ? H.identite() : null, titre: "Opérations entre divisions du groupe", ref: "IGL-" + today().replace(/-/g, ""), date: today(), montant: 0, paysage: true,
      corps: '<p class="sub">Solde du compte ' + esc(liaison()) + " : " + fcfa(C.solde) + " — attendu d'après le registre : " + fcfa(C.attendu) + '.</p><table><thead><tr><th>Pièce</th><th>Date</th><th>Sens</th><th>Opération</th><th class="n">Montant</th><th>État</th></tr></thead><tbody>' + rows.join("") + '</tbody></table><p class="sub" style="margin-top:8px">Montants hors taxes. Registre propre à l\'appareil.</p>' }).catch(function (e) { alert("Impression impossible : " + e.message); });
    if (H.audit) H.audit("Opérations inter-divisions imprimées", String(ops.length));
  }

  function form(titre, champs, init, onSave, ok) {
    var ov = document.createElement("div"); ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,20,28,.6);z-index:9990;display:flex;align-items:center;justify-content:center;padding:12px");
    var f = champs.map(function (x) { var v = init && init[x.k] != null ? init[x.k] : "", inp = x.t === "select" ? '<select name="' + x.k + '">' + x.o.map(function (y) { return '<option value="' + esc(y[0]) + '" ' + (String(y[0]) === String(v) ? "selected" : "") + ">" + esc(y[1]) + "</option>"; }).join("") + "</select>" : '<input name="' + x.k + '" type="' + (x.t || "text") + '" ' + (x.t === "number" ? 'step="1" min="0"' : "") + ' value="' + esc(v) + '" autocomplete="off">';
      return '<label style="display:block;font-size:13px;margin:8px 0;color:var(--mu,#5b6572)">' + esc(x.l) + inp + "</label>"; }).join("");
    ov.innerHTML = '<div style="background:var(--card,#fff);color:var(--tx,#1c2430);border-radius:14px;width:100%;max-width:520px;max-height:92vh;overflow:auto;padding:18px"><h3 style="margin:0 0 6px">' + esc(titre) + '</h3><form novalidate>' + f + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="ig-b" data-x="1">Annuler</button><button class="ig-b p">' + esc(ok || "Valider") + "</button></div></form></div>";
    ov.querySelectorAll("input,select").forEach(function (i) { i.style.cssText = "width:100%;font:inherit;padding:8px;border:1px solid var(--bd,#d5dbe3);border-radius:8px;background:var(--bg,#fff);color:var(--tx,#1c2430);margin-top:3px"; });
    document.body.appendChild(ov); var fm = ov.querySelector("form");
    ov.querySelectorAll("[data-x]").forEach(function (b) { b.onclick = function () { ov.remove(); }; });
    fm.onsubmit = function (e) { e.preventDefault(); var o = {}; champs.forEach(function (x) { var v = fm.elements[x.k].value.trim(); o[x.k] = x.t === "number" ? (v === "" ? 0 : +v) : v; }); var r = H.run ? H.run(function () { return onSave(o); }) : (onSave(o), true); if (r !== false) { ov.remove(); H.render(); } };
    var f0 = fm.querySelector("input,select"); if (f0) f0.focus(); return ov;
  }
  var tresoOpts = function () { var t = []; try { t = H.treso() || []; } catch (e) { t = []; } return t.map(function (x) { return [x.compte, x.compte + " — " + (x.lib || "")]; }); };
  var ACT = {
    f: function (id) { UIS.f = id; H.render(); },
    new: function () {
      var dests = Object.keys(DIV).filter(function (k) { return k !== H.division; }).map(function (k) { return [k, DIV[k]]; });
      var ov = form("Nouvelle opération vers une autre division", [{ k: "a", l: "Division destinataire", t: "select", o: dests }, { k: "nature", l: "Nature", t: "select", o: Object.keys(NAT).map(function (k) { return [k, NAT[k].lib]; }) }, { k: "objet", l: "Objet (facture, mission, frais refacturés…)" }, { k: "montant", l: "Montant hors taxes (FCFA)", t: "number" }, { k: "date", l: "Date", t: "date" }, { k: "cpt", l: "Compte de produit (7…) ou de trésorerie (5…) pour une avance" }], { a: dests[0][0], nature: "service", date: today(), cpt: NAT.service.de }, function (o) { emettre(o); }, "Enregistrer en brouillard");
      var fm = ov.querySelector("form"); fm.elements.nature.onchange = function () { var n = NAT[fm.elements.nature.value]; fm.elements.cpt.value = n.de || (tresoOpts()[0] || [""])[0]; };
    },
    conf: function (id) { var o = lire().ops.filter(function (x) { return x.id === id; })[0]; if (!o) return; form("Confirmer l'opération " + o.ref, [{ k: "cpt", l: o.nature === "avance" ? "Compte de trésorerie crédité (5…)" : "Compte de charge (6…)" }, { k: "date", l: "Date de comptabilisation", t: "date" }], { cpt: NAT[o.nature].a || (tresoOpts()[0] || [""])[0], date: o.date }, function (f) { confirmer(id, f); }, "Confirmer et comptabiliser"); },
    cont: function (id) { form("Contester l'opération", [{ k: "motif", l: "Motif (montant, objet, doublon…)" }], {}, function (f) { contester(id, f.motif); }, "Contester"); },
    repr: function (id) { var r = H.run ? H.run(function () { representer(id); }) : (representer(id), true); if (r !== false) H.render(); },
    ann: function (id) { form("Annuler l'opération", [{ k: "motif", l: "Motif" }], {}, function (f) { annuler(id, f.motif); alert("Opération annulée. Supprimez le brouillard de la pièce (Comptabilité → Saisie & visa) ou extournez l'écriture si elle a déjà été visée."); }, "Annuler l'opération"); },
    reg: function (id) { form("Constater le règlement", [{ k: "compte", l: "Compte de trésorerie", t: "select", o: tresoOpts() }, { k: "date", l: "Date du règlement", t: "date" }], { date: today() }, function (f) { regler(id, f); }, "Enregistrer en brouillard"); },
    print: imprimer
  };
  document.addEventListener("click", function (e) { var t = e.target.closest && e.target.closest("[data-ig]"); if (!t || !G.ANGELS_INTER.host) return; var f = ACT[t.dataset.ig]; if (!f) return; e.preventDefault(); H = G.ANGELS_INTER.host; try { f(t.dataset.id, t); } catch (x) { alert(x.message); } });

  G.ANGELS_INTER = { host: null, view: view, DIV: DIV, NAT: NAT, KEY: KEY, UI: UIS, lire: lire, agreger: agreger, attendu: attendu, controle: function (h) { if (h) H = h; return controle(); }, emettre: function (f, h) { if (h) H = h; return emettre(f); }, confirmer: function (i, f, h) { if (h) H = h; return confirmer(i, f); }, contester: function (i, m, h) { if (h) H = h; return contester(i, m); },
    representer: function (i, h) { if (h) H = h; return representer(i); }, annuler: function (i, m, h) { if (h) H = h; return annuler(i, m); }, regler: function (i, f, h) { if (h) H = h; return regler(i, f); }, resume: function (h) { if (h) H = h; return resume(); }, publier: publier, imprimer: function (h) { if (h) H = h; return imprimer(); }, use: function (h) { H = h; this.host = h; } };
})(window);
