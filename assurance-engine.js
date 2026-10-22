/* Moteur « Courtage d'assurance » : le courtier conseille, compare, place les risques de ses clients auprès des compagnies, suit les polices, encaisse ou non les primes, perçoit ses commissions et accompagne les sinistres.
   Chaîne : assuré → devis comparatif (propositions de plusieurs compagnies) → police (prime nette + accessoires + taxes tels que fixés PAR LA COMPAGNIE : le logiciel ne calcule aucune taxe d'assurance) → encaissement de la prime →
   reversement à la compagnie (prime encaissée − commission) ou commission facturée à la compagnie → renouvellement → sinistres.
   Garde-fous : un numéro de police par compagnie ; dates cohérentes ; sinistre seulement sur police en cours à la date du sinistre ; jamais plus encaissé que la prime TTC ; jamais plus reversé que le dû ;
   référence Mobile Money unique ; commission bornée ; chaque action tracée. Écritures SYSCOHADA générées à la demande (équilibrées).
   État local « angels_assurance_v1 », synchronisé entre postes (profil « assurance »). Le courtage relève de la réglementation CIMA : numéro d'agrément et mentions légales à renseigner par le cabinet (Réglages). */
(function (G) {
  "use strict";
  var K = "angels_assurance_v1", DJ = 864e5;
  var BRANCHES = { auto: "Automobile", sante: "Santé / maladie", incendie: "Incendie et multirisque habitation", pro: "Multirisque professionnelle", transport: "Transport de marchandises", rc: "Responsabilité civile", accident: "Individuelle accident", vie: "Vie / épargne / retraite", autre: "Autre" };
  var MODES = ["Espèces", "Wave", "Orange Money", "MTN MoMo", "Moov Money", "Virement"];
  var CFG0 = { tva_commission: 0, alerte_renouvellement: 30, delai_prime: 15 };
  var COMPTES0 = { clients: "4111", commissions: "7061", tva: "4431", compagnies: "4712", caisse: "571", banque: "5211", mobile: "553" };
  var ETAPES_SIN = { declare: "Déclaré", transmis: "Transmis à la compagnie", expertise: "En expertise", accepte: "Accepté", refuse: "Refusé", indemnise: "Indemnisé", clos: "Clos" };
  var SUIVANT = { declare: ["transmis", "clos"], transmis: ["expertise", "accepte", "refuse", "clos"], expertise: ["accepte", "refuse", "clos"], accepte: ["indemnise", "clos"], refuse: ["clos"], indemnise: ["clos"], clos: [] };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var R = Math.round, nowIso = function () { return new Date().toISOString(); }, auj = function () { return nowIso().slice(0, 10); };
  var uid = function (p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var norm = function (s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); };
  var chiffres = function (t) { return String(t == null ? "" : t).replace(/\D/g, ""); };
  function lire(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  var COLL = ["assures", "compagnies", "devis", "polices", "encaissements", "reversements", "commissions_recues", "avenants", "sinistres", "audit"];
  function vide() { var S = { v: 1, cfg: {}, seq: {} }; COLL.forEach(function (k) { S[k] = []; }); return S; }
  var CACHE = null;
  function normaliser(S) { COLL.forEach(function (k) { if (!Array.isArray(S[k])) S[k] = []; }); if (!S.cfg || typeof S.cfg !== "object" || Array.isArray(S.cfg)) S.cfg = {}; if (!S.seq || typeof S.seq !== "object") S.seq = {}; return S; }
  function etat() { if (!CACHE) CACHE = normaliser(lire(K) || vide()); return CACHE; }
  function sauver(S) {
    S = S || etat(); S.audit = S.audit.slice(-1500); var ok = true;
    try { localStorage.setItem(K, JSON.stringify(S)); } catch (e) { ok = false; }
    try { if (G.ANGELS_SYNC) G.ANGELS_SYNC.signal(); } catch (e) { }
    return ok;
  }
  if (G.addEventListener) G.addEventListener("storage", function (e) { if (e.key === K) { CACHE = null; try { if (G.ANGELS_ASSURANCE_RAFRAICHIR) G.ANGELS_ASSURANCE_RAFRAICHIR(); } catch (x) { } } });
  function cfg(S) { var c = Object.assign({}, CFG0), u = (S || etat()).cfg || {}; Object.keys(CFG0).forEach(function (k) { var v = +u[k]; if (isFinite(v) && v >= 0 && u[k] !== "" && u[k] != null) c[k] = v; }); c.agrement = String(u.agrement || ""); return c; }
  function comptes(S) { return Object.assign({}, COMPTES0, (S || etat()).cfg.comptes || {}); }
  function audit(S, par, action, detail) { S.audit.push({ id: uid("au"), t: nowIso(), par: par || "?", action: action, detail: String(detail || "").slice(0, 300) }); }
  function err(m) { throw new Error(m); }
  function montant(v, nom, nul) { var n = +v; if (!isFinite(n) || n < 0 || (!nul && n === 0)) err(nom + " invalide (nombre positif attendu)."); return R(n); }
  function dateOk(d, nom) { d = String(d || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + "T00:00:00Z"))) err(nom + " invalide."); return d; }
  function plusMois(d, n) { var x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); }
  function jr(d) { return Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(auj() + "T00:00:00Z")) / DJ); }
  function numero(S, pre) { var a = new Date().getFullYear(), k = pre + a; S.seq[k] = (S.seq[k] || 0) + 1; return pre + "-" + a + "-" + String(S.seq[k]).padStart(4, "0"); }
  function trouver(L, id, nom) { var x = L.filter(function (y) { return y.id === id; })[0]; if (!x) err(nom + " introuvable."); return x; }
  function refOk(S, mode, ref) {
    ref = String(ref || "").trim(); if (mode === "Espèces") return "";
    if (ref.length < 4) err("Référence de la transaction obligatoire.");
    if (S.encaissements.concat(S.reversements, S.commissions_recues).some(function (x) { return x.ref && x.ref.toLowerCase() === ref.toLowerCase(); })) err("Cette référence a déjà été utilisée.");
    return ref;
  }
  /* ---------- Assurés et compagnies ---------- */
  function ajouterAssure(par, d) {
    var S = etat(), nom = String(d.nom || "").trim(); if (nom.length < 2) err("Nom obligatoire.");
    var tel = chiffres(d.tel); if (tel.length < 8) err("Téléphone invalide (8 chiffres minimum).");
    var cle = tel.slice(-10); if (S.assures.some(function (a) { return chiffres(a.tel).slice(-10) === cle; })) err("Ce numéro existe déjà : une seule fiche par assuré.");
    var a = { id: uid("as"), nom: nom.slice(0, 100), type: d.type === "entreprise" ? "entreprise" : "particulier", tel: String(d.tel).trim().slice(0, 25), email: String(d.email || "").trim().slice(0, 100), adresse: String(d.adresse || "").trim().slice(0, 160), cree_le: nowIso() };
    S.assures.push(a); audit(S, par, "Assuré créé", a.nom); sauver(S); return a;
  }
  function ajouterCompagnie(par, d) {
    var S = etat(), nom = String(d.nom || "").trim(); if (nom.length < 2) err("Nom de la compagnie obligatoire.");
    if (S.compagnies.some(function (c) { return norm(c.nom) === norm(nom); })) err("Cette compagnie existe déjà.");
    var t = d.taux === "" || d.taux == null ? 10 : +d.taux; if (!(t >= 0 && t <= 40)) err("Taux de commission invalide (0 à 40 %).");
    var c = { id: uid("co"), nom: nom.slice(0, 100), contact: String(d.contact || "").trim().slice(0, 80), tel: String(d.tel || "").trim().slice(0, 25), email: String(d.email || "").trim().slice(0, 100), taux: t, taux_branche: {}, cree_le: nowIso() };
    S.compagnies.push(c); audit(S, par, "Compagnie créée", c.nom + " — " + t + " %"); sauver(S); return c;
  }
  function tauxBranche(par, compId, branche, taux) {
    var S = etat(), c = trouver(S.compagnies, compId, "Compagnie"), t = +taux; if (!BRANCHES[branche]) err("Branche inconnue."); if (!(t >= 0 && t <= 40)) err("Taux invalide (0 à 40 %).");
    c.taux_branche[branche] = t; audit(S, par, "Taux de commission", c.nom + " · " + BRANCHES[branche] + " : " + t + " %"); sauver(S); return c;
  }
  function tauxDe(c, branche) { return c.taux_branche && c.taux_branche[branche] != null ? c.taux_branche[branche] : c.taux; }
  /* ---------- Devis comparatif ---------- */
  function prop(S, p) {
    var c = trouver(S.compagnies, p.compagnie_id, "Compagnie"), pn = montant(p.prime_nette, "Prime nette"), ac = montant(p.accessoires || 0, "Accessoires", 1), tx = montant(p.taxes || 0, "Taxes", 1);
    return { compagnie_id: c.id, prime_nette: pn, accessoires: ac, taxes: tx, ttc: pn + ac + tx, garanties: String(p.garanties || "").trim().slice(0, 600), franchise: String(p.franchise || "").trim().slice(0, 120) };
  }
  function creerDevis(par, d) {
    var S = etat(), a = trouver(S.assures, d.assure_id, "Assuré"); if (!BRANCHES[d.branche]) err("Branche inconnue.");
    var P = (d.propositions || []).map(function (p) { return prop(S, p); }); if (!P.length) err("Au moins une proposition de compagnie.");
    var ids = P.map(function (p) { return p.compagnie_id; }); if (ids.some(function (x, i) { return ids.indexOf(x) !== i; })) err("Une seule proposition par compagnie.");
    var q = { id: uid("dv"), numero: numero(S, "DEV"), assure_id: a.id, branche: d.branche, risque: String(d.risque || "").trim().slice(0, 300), date: auj(), propositions: P, choix: -1, statut: "en_cours", cree_le: nowIso() };
    if (q.risque.length < 3) err("Décrivez le risque à assurer.");
    S.devis.push(q); audit(S, par, "Devis créé", q.numero + " — " + a.nom + " — " + P.length + " proposition(s)"); sauver(S); return q;
  }
  function meilleure(q) { return q.propositions.slice().sort(function (a, b) { return a.ttc - b.ttc; })[0]; }
  function refuserDevis(par, id, motif) { var S = etat(), q = trouver(S.devis, id, "Devis"); if (!String(motif || "").trim()) err("Motif obligatoire."); q.statut = "refuse"; q.motif = String(motif).trim().slice(0, 200); audit(S, par, "Devis refusé", q.numero + " — " + motif); sauver(S); return q; }
  /* ---------- Polices ---------- */
  function emettrePolice(par, d) {
    var S = etat(), a = trouver(S.assures, d.assure_id, "Assuré"), c = trouver(S.compagnies, d.compagnie_id, "Compagnie"); if (!BRANCHES[d.branche]) err("Branche inconnue.");
    var num = String(d.numero || "").trim(); if (num.length < 3) err("Numéro de police (donné par la compagnie) obligatoire.");
    if (S.polices.some(function (p) { return p.compagnie_id === c.id && norm(p.numero) === norm(num); })) err("Ce numéro de police existe déjà chez cette compagnie.");
    var eff = dateOk(d.effet, "Date d'effet"), ech = d.echeance ? dateOk(d.echeance, "Échéance") : plusMois(eff, 12); if (ech <= eff) err("L'échéance doit suivre la date d'effet.");
    if (Date.parse(ech) - Date.parse(eff) > 5 * 366 * DJ) err("Durée de police supérieure à 5 ans.");
    var pn = montant(d.prime_nette, "Prime nette"), ac = montant(d.accessoires || 0, "Accessoires", 1), tx = montant(d.taxes || 0, "Taxes", 1);
    var taux = d.taux_commission === "" || d.taux_commission == null ? tauxDe(c, d.branche) : +d.taux_commission; if (!(taux >= 0 && taux <= 40)) err("Taux de commission invalide (0 à 40 %).");
    var enc = d.encaisse_par === "assureur" ? "assureur" : "courtier";
    var tv = cfg(S).tva_commission, comm = R(pn * taux / 100), p = { id: uid("po"), numero: num.slice(0, 40), assure_id: a.id, compagnie_id: c.id, branche: d.branche, risque: String(d.risque || "").trim().slice(0, 300), effet: eff, echeance: ech, prime_nette: pn, accessoires: ac, taxes: tx, ttc: pn + ac + tx, taux: taux, commission: comm, tva_commission: R(comm * tv / 100), encaisse_par: enc, devis_id: d.devis_id || "", statut: "en_cours", cree_le: nowIso() };
    if (d.devis_id) { var q = S.devis.filter(function (x) { return x.id === d.devis_id; })[0]; if (q) { q.statut = "accepte"; q.police_id = p.id; } }
    if (d.renouvelle_id) { var o = S.polices.filter(function (x) { return x.id === d.renouvelle_id; })[0]; if (o) { o.renouvelee_par = p.id; p.renouvelle_id = o.id; } }
    S.polices.push(p); audit(S, par, "Police émise", num + " — " + a.nom + " — " + c.nom + " — " + p.ttc + " F"); sauver(S); return p;
  }
  function emettreDepuisDevis(par, devisId, idx, d) {
    var S = etat(), q = trouver(S.devis, devisId, "Devis"), p = q.propositions[+idx]; if (!p) err("Proposition inconnue."); if (q.statut === "accepte") err("Devis déjà accepté.");
    return emettrePolice(par, Object.assign({ assure_id: q.assure_id, compagnie_id: p.compagnie_id, branche: q.branche, risque: q.risque, prime_nette: p.prime_nette, accessoires: p.accessoires, taxes: p.taxes, devis_id: q.id }, d || {}));
  }
  var encPrime = function (S, p) { return S.encaissements.filter(function (e) { return e.police_id === p.id; }).reduce(function (s, e) { return s + e.montant; }, 0); };
  var reverse = function (S, p) { return S.reversements.filter(function (e) { return e.police_id === p.id; }).reduce(function (s, e) { return s + e.montant; }, 0); };
  var commRecue = function (S, p) { return S.commissions_recues.filter(function (e) { return e.police_id === p.id; }).reduce(function (s, e) { return s + e.montant; }, 0); };
  var ttcPolice = function (S, p) { return p.ttc + S.avenants.filter(function (a) { return a.police_id === p.id; }).reduce(function (s, a) { return s + a.delta; }, 0); };
  var tvaPolice = function (S, p) { return R(p.tva_commission + S.avenants.filter(function (a) { return a.police_id === p.id; }).reduce(function (s, a) { return s + (a.delta_tva || 0); }, 0)); };
  var commPolice = function (S, p) { return R(p.commission + S.avenants.filter(function (a) { return a.police_id === p.id; }).reduce(function (s, a) { return s + a.delta_commission; }, 0)); };
  function encaisserPrime(par, policeId, m, mode, ref) {
    var S = etat(), p = trouver(S.polices, policeId, "Police"); if (p.encaisse_par !== "courtier") err("Cette prime est payée directement à la compagnie.");
    m = montant(m, "Montant"); if (MODES.indexOf(mode) < 0) err("Mode de paiement inconnu.");
    var reste = ttcPolice(S, p) - encPrime(S, p); if (m > reste) err("Montant supérieur au reste à payer (" + reste + " F).");
    var e = { id: uid("en"), police_id: p.id, date: auj(), montant: m, mode: mode, ref: refOk(S, mode, ref), par: par }; S.encaissements.push(e);
    audit(S, par, "Prime encaissée", p.numero + " — " + m + " F (" + mode + ")"); sauver(S); return e;
  }
  function dueCompagnie(S, p) { var enc = encPrime(S, p), ttc = ttcPolice(S, p); return Math.max(0, enc - (ttc > 0 ? R(commPolice(S, p) * enc / ttc) : 0) - reverse(S, p)); }
  function reverserCompagnie(par, policeId, m, mode, ref) {
    var S = etat(), p = trouver(S.polices, policeId, "Police"); if (p.encaisse_par !== "courtier") err("Rien à reverser : la compagnie a encaissé directement.");
    m = montant(m, "Montant"); if (MODES.indexOf(mode) < 0) err("Mode de paiement inconnu.");
    var du = dueCompagnie(S, p); if (m > du) err("Montant supérieur au dû à la compagnie (" + du + " F).");
    var e = { id: uid("rv"), police_id: p.id, date: auj(), montant: m, mode: mode, ref: refOk(S, mode, ref), par: par }; S.reversements.push(e);
    audit(S, par, "Reversement à la compagnie", p.numero + " — " + m + " F"); sauver(S); return e;
  }
  function recevoirCommission(par, policeId, m, mode, ref) {
    var S = etat(), p = trouver(S.polices, policeId, "Police"); if (p.encaisse_par !== "assureur") err("La commission de cette police est retenue sur la prime encaissée.");
    m = montant(m, "Montant"); if (MODES.indexOf(mode) < 0) err("Mode de paiement inconnu.");
    var reste = commPolice(S, p) + tvaPolice(S, p) - commRecue(S, p); if (m > reste) err("Montant supérieur à la commission restant due (" + reste + " F).");
    var e = { id: uid("cr"), police_id: p.id, date: auj(), montant: m, mode: mode, ref: refOk(S, mode, ref), par: par }; S.commissions_recues.push(e);
    audit(S, par, "Commission reçue", p.numero + " — " + m + " F"); sauver(S); return e;
  }
  function avenant(par, policeId, d) {
    var S = etat(), p = trouver(S.polices, policeId, "Police"); if (p.statut !== "en_cours") err("Police non en cours.");
    var obj = String(d.objet || "").trim(); if (obj.length < 3) err("Objet de l'avenant obligatoire.");
    var delta = Math.round(+d.delta || 0); if (!isFinite(delta)) err("Montant invalide."); if (ttcPolice(S, p) + delta < 0) err("La prime ne peut devenir négative.");
    if (delta < 0 && encPrime(S, p) > ttcPolice(S, p) + delta) err("Ristourne supérieure au reste à payer : remboursez d'abord via la compagnie.");
    var dn = d.delta_net === "" || d.delta_net == null ? delta : Math.round(+d.delta_net), dc = R(dn * p.taux / 100);
    var a = { id: uid("av"), police_id: p.id, date: auj(), objet: obj.slice(0, 200), delta: delta, delta_commission: dc, delta_tva: R(dc * cfg(S).tva_commission / 100) }; S.avenants.push(a); audit(S, par, "Avenant", p.numero + " — " + obj + " (" + (delta >= 0 ? "+" : "") + delta + " F)"); sauver(S); return a;
  }
  function resilier(par, policeId, date, motif) {
    var S = etat(), p = trouver(S.polices, policeId, "Police"); if (p.statut !== "en_cours") err("Police non en cours."); if (!String(motif || "").trim()) err("Motif obligatoire.");
    date = dateOk(date || auj(), "Date de résiliation"); if (date < p.effet) err("Résiliation avant la date d'effet.");
    p.statut = "resiliee"; p.resiliee_le = date; p.motif = String(motif).trim().slice(0, 200); audit(S, par, "Police résiliée", p.numero + " — " + motif); sauver(S); return p;
  }
  function statutPolice(S, p) { if (p.statut === "resiliee") return "resiliee"; if (p.echeance < auj()) return "expiree"; if (p.effet > auj()) return "a_venir"; return "en_cours"; }
  function renouveler(par, policeId, d) {
    var S = etat(), o = trouver(S.polices, policeId, "Police"); if (o.renouvelee_par) err("Police déjà renouvelée."); if (o.statut === "resiliee") err("Police résiliée : créez une nouvelle police.");
    d = d || {}; var d0 = new Date(o.echeance + "T00:00:00Z"); d0.setUTCDate(d0.getUTCDate() + 1); var eff = d.effet ? dateOk(d.effet, "Date d'effet") : d0.toISOString().slice(0, 10);
    return emettrePolice(par, { assure_id: o.assure_id, compagnie_id: d.compagnie_id || o.compagnie_id, branche: o.branche, risque: o.risque, numero: d.numero, effet: eff, prime_nette: d.prime_nette || o.prime_nette, accessoires: d.accessoires != null ? d.accessoires : o.accessoires, taxes: d.taxes != null ? d.taxes : o.taxes, encaisse_par: o.encaisse_par, renouvelle_id: o.id });
  }
  /* ---------- Sinistres ---------- */
  function declarerSinistre(par, d) {
    var S = etat(), p = trouver(S.polices, d.police_id, "Police"), dt = dateOk(d.date, "Date du sinistre");
    if (dt > auj()) err("Date du sinistre dans le futur."); if (p.statut === "resiliee" && dt > p.resiliee_le) err("Police résiliée à cette date.");
    if (dt < p.effet || dt > p.echeance) err("Sinistre hors de la période de garantie (" + p.effet + " au " + p.echeance + ").");
    var nat = String(d.nature || "").trim(); if (nat.length < 3) err("Nature du sinistre obligatoire.");
    var s = { id: uid("si"), numero: numero(S, "SIN"), police_id: p.id, date: dt, lieu: String(d.lieu || "").trim().slice(0, 160), nature: nat.slice(0, 300), estime: montant(d.estime || 0, "Montant estimé", 1), indemnite: 0, statut: "declare", historique: [{ t: nowIso(), statut: "declare", note: "Déclaration", par: par }], cree_le: nowIso() };
    S.sinistres.push(s); audit(S, par, "Sinistre déclaré", s.numero + " — " + p.numero); sauver(S); return s;
  }
  function avancerSinistre(par, id, statut, note, indemnite) {
    var S = etat(), s = trouver(S.sinistres, id, "Sinistre"); if ((SUIVANT[s.statut] || []).indexOf(statut) < 0) err("Passage impossible de « " + ETAPES_SIN[s.statut] + " » à « " + (ETAPES_SIN[statut] || statut) + " ».");
    if ((statut === "refuse" || statut === "clos") && !String(note || "").trim()) err("Motif obligatoire.");
    if (statut === "indemnise") s.indemnite = montant(indemnite, "Indemnité");
    s.statut = statut; s.historique.push({ t: nowIso(), statut: statut, note: String(note || "").trim().slice(0, 300), par: par }); audit(S, par, "Sinistre : " + ETAPES_SIN[statut], s.numero); sauver(S); return s;
  }
  /* ---------- Indicateurs ---------- */
  function resume(S) {
    S = S || etat(); var m = auj().slice(0, 7), al = cfg(S).alerte_renouvellement, comm = 0, enc = 0, prem = 0, aEnc = 0, aRev = 0, aCom = 0;
    S.polices.forEach(function (p) {
      if (String(p.cree_le).slice(0, 7) === m) { prem += p.ttc; comm += commPolice(S, p); }
      if (p.encaisse_par === "courtier") { aEnc += Math.max(0, ttcPolice(S, p) - encPrime(S, p)); aRev += dueCompagnie(S, p); } else aCom += Math.max(0, commPolice(S, p) + tvaPolice(S, p) - commRecue(S, p));
    });
    S.encaissements.forEach(function (e) { if (String(e.date).slice(0, 7) === m) enc += e.montant; });
    var ren = S.polices.filter(function (p) { return statutPolice(S, p) === "en_cours" && !p.renouvelee_par && jr(p.echeance) <= al; }), exp = S.polices.filter(function (p) { return statutPolice(S, p) === "expiree" && !p.renouvelee_par && p.statut !== "resiliee"; });
    var imp = S.polices.filter(function (p) { return p.encaisse_par === "courtier" && ttcPolice(S, p) > encPrime(S, p) && jr(p.effet) < -cfg(S).delai_prime && p.statut === "en_cours"; });
    return { primes_mois: prem, commissions_mois: comm, encaisse_mois: enc, a_encaisser: aEnc, a_reverser: aRev, commissions_a_recevoir: aCom, polices_en_cours: S.polices.filter(function (p) { return statutPolice(S, p) === "en_cours"; }).length, a_renouveler: ren.length, expirees: exp.length, impayes: imp.length, sinistres_ouverts: S.sinistres.filter(function (s) { return ["declare", "transmis", "expertise", "accepte"].indexOf(s.statut) >= 0; }).length, assures: S.assures.length };
  }
  function aRenouveler(S) { S = S || etat(); var al = cfg(S).alerte_renouvellement; return S.polices.filter(function (p) { return p.statut !== "resiliee" && !p.renouvelee_par && jr(p.echeance) <= al; }).sort(function (a, b) { return a.echeance.localeCompare(b.echeance); }); }
  /* ---------- Écritures SYSCOHADA (lecture seule, équilibrées) ----------
     Prime encaissée par le courtier : trésorerie (553 Mobile Money, 571 caisse, 5211 banque) / 4712 Créditeurs divers (prime reçue pour le compte de la compagnie) ;
     commission acquise : 4712 / 7061 Services vendus (+ 4431 si TVA sur commission) ; reversement : 4712 / trésorerie.
     Prime payée directement à la compagnie : commission facturée 4111 Clients / 7061 (+ 4431), reçue : trésorerie / 4111.
     Aucune taxe d'assurance n'est calculée : elle figure dans la prime TTC fixée par la compagnie. Comptes modifiables (réglages) ; à valider avec l'expert-comptable. */
  function ecritures(S) {
    S = S || etat(); var C = comptes(S), E = [], tres = function (m) { return m === "Espèces" ? C.caisse : m === "Virement" ? C.banque : C.mobile; };
    var P = function (id) { return S.polices.filter(function (p) { return p.id === id; })[0] || {}; };
    S.polices.forEach(function (p) {
      var comm = commPolice(S, p), tv = tvaPolice(S, p), ttc = ttcPolice(S, p); if (!comm) return;
      if (p.encaisse_par === "courtier") {
        /* commission acquise au fil des encaissements (cumul arrondi : la somme des écritures égale exactement la commission) */
        var cum = 0, avant = 0, avantT = 0;
        S.encaissements.filter(function (e) { return e.police_id === p.id; }).forEach(function (e) {
          cum += e.montant; var c1 = ttc > 0 ? R(comm * cum / ttc) : 0, t1 = ttc > 0 ? R(tv * cum / ttc) : 0, part = c1 - avant, tvp = t1 - avantT; avant = c1; avantT = t1;
          if (part || tvp) E.push({ date: e.date, journal: "VE", piece: p.numero, libelle: "Commission " + p.numero, lignes: [{ compte: C.compagnies, debit: part + tvp, credit: 0 }, { compte: C.commissions, debit: 0, credit: part }].concat(tvp ? [{ compte: C.tva, debit: 0, credit: tvp }] : []) });
        });
      } else E.push({ date: p.cree_le.slice(0, 10), journal: "VE", piece: p.numero, libelle: "Commission " + p.numero, lignes: [{ compte: C.clients, debit: comm + tv, credit: 0 }, { compte: C.commissions, debit: 0, credit: comm }].concat(tv ? [{ compte: C.tva, debit: 0, credit: tv }] : []) });
    });
    S.encaissements.forEach(function (e) { E.push({ date: e.date, journal: "TR", piece: P(e.police_id).numero || e.id, libelle: "Prime encaissée", lignes: [{ compte: tres(e.mode), debit: e.montant, credit: 0 }, { compte: C.compagnies, debit: 0, credit: e.montant }] }); });
    S.reversements.forEach(function (e) { E.push({ date: e.date, journal: "TR", piece: P(e.police_id).numero || e.id, libelle: "Reversement à la compagnie", lignes: [{ compte: C.compagnies, debit: e.montant, credit: 0 }, { compte: tres(e.mode), debit: 0, credit: e.montant }] }); });
    S.commissions_recues.forEach(function (e) { E.push({ date: e.date, journal: "TR", piece: P(e.police_id).numero || e.id, libelle: "Commission reçue", lignes: [{ compte: tres(e.mode), debit: e.montant, credit: 0 }, { compte: C.clients, debit: 0, credit: e.montant }] }); });
    return E;
  }
  function equilibre(E) { return E.every(function (e) { var d = 0, c = 0; e.lignes.forEach(function (l) { d += l.debit; c += l.credit; }); return d === c; }); }
  function reglages(par, d) {
    var S = etat(), t = +d.tva_commission, al = +d.alerte_renouvellement, dp = +d.delai_prime; if (!(t >= 0 && t <= 30)) err("TVA sur commission invalide (0 à 30 %)."); if (!(al >= 0 && al <= 180)) err("Délai d'alerte invalide."); if (!(dp >= 0 && dp <= 180)) err("Délai de prime invalide.");
    S.cfg.tva_commission = t; S.cfg.alerte_renouvellement = al; S.cfg.delai_prime = dp; S.cfg.agrement = String(d.agrement || "").trim().slice(0, 80); audit(S, par, "Réglages", "TVA commission " + t + " % · alerte " + al + " j"); sauver(S); return cfg(S);
  }
  function csv(rows) { var f = function (v) { v = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }; return "﻿" + rows.map(function (r) { return r.map(f).join(";"); }).join("\r\n"); }
  function exportPolices(S) { S = S || etat(); var A = function (id) { return S.assures.filter(function (x) { return x.id === id; })[0] || {}; }, Cc = function (id) { return S.compagnies.filter(function (x) { return x.id === id; })[0] || {}; };
    return csv([["Police", "Assuré", "Compagnie", "Branche", "Effet", "Échéance", "Prime nette", "TTC", "Commission", "État"]].concat(S.polices.map(function (p) { return [p.numero, A(p.assure_id).nom, Cc(p.compagnie_id).nom, BRANCHES[p.branche], p.effet, p.echeance, p.prime_nette, ttcPolice(S, p), commPolice(S, p), statutPolice(S, p)]; }))); }
  function csvEcritures(S) { var rows = [["Date", "Journal", "Pièce", "Libellé", "Compte", "Débit", "Crédit"]]; ecritures(S).forEach(function (e) { e.lignes.forEach(function (l) { rows.push([e.date, e.journal, e.piece, e.libelle, l.compte, l.debit, l.credit]); }); }); return csv(rows); }

  G.ANGELS_ASSURANCE = { K: K, BRANCHES: BRANCHES, MODES: MODES, ETAPES_SIN: ETAPES_SIN, SUIVANT: SUIVANT, esc: esc, norm: norm, etat: etat, sauver: sauver, cfg: cfg, ajouterAssure: ajouterAssure, ajouterCompagnie: ajouterCompagnie, tauxBranche: tauxBranche, tauxDe: tauxDe, creerDevis: creerDevis, meilleure: meilleure, refuserDevis: refuserDevis, emettrePolice: emettrePolice, emettreDepuisDevis: emettreDepuisDevis, encaisserPrime: encaisserPrime, reverserCompagnie: reverserCompagnie, recevoirCommission: recevoirCommission, avenant: avenant, resilier: resilier, renouveler: renouveler, declarerSinistre: declarerSinistre, avancerSinistre: avancerSinistre, resume: resume, aRenouveler: aRenouveler, statutPolice: statutPolice, ttcPolice: ttcPolice, commPolice: commPolice, encPrime: encPrime, dueCompagnie: dueCompagnie, commRecue: commRecue, ecritures: ecritures, equilibre: equilibre, reglages: reglages, exportPolices: exportPolices, csvEcritures: csvEcritures, plusMois: plusMois };
})(typeof window !== "undefined" ? window : globalThis);
