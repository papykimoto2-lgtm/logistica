/* Moteur « Placement de personnel » : travailleurs temporaires et journaliers (coursiers, personnel de bureau…) mis à disposition d'entreprises.
   Chaîne : travailleur → besoin d'une entreprise → affectation (taux client / taux travailleur) → pointage journalier validé → facture client + paie du travailleur → marge.
   Garde-fous : jamais deux affectations qui se chevauchent pour la même personne ; un pointage par affectation et par jour ; un pointage n'est facturé qu'une fois et payé qu'une fois ;
   référence Mobile Money unique ; aucun montant négatif ; chaque action tracée. Écritures SYSCOHADA générées à la demande (équilibrées), jamais saisies à la main.
   État local « angels_placement_v1 », synchronisé entre postes comme les autres applications (profil « placement »). */
(function (G) {
  "use strict";
  var K = "angels_placement_v1", DJ = 864e5;
  var TYPES = { journalier: "Journalier", temporaire: "Temporaire", moto: "Coursier moto", voiture: "Coursier voiture", pied: "Coursier non motorisé", bureau: "Personnel de bureau" };
  var MODES = ["Espèces", "Wave", "Orange Money", "MTN MoMo", "Moov Money", "Virement"];
  var CFG0 = { tva: 18, delai_facture: 30 };
  var COMPTES0 = { clients: "4111", services: "7061", tva: "4431", salaires: "6611", personnel: "422", caisse: "571", banque: "5211", mobile: "553" };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var R = Math.round, nowIso = function () { return new Date().toISOString(); }, auj = function () { return nowIso().slice(0, 10); };
  var uid = function (p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var norm = function (s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); };
  var chiffres = function (t) { return String(t == null ? "" : t).replace(/\D/g, ""); };
  function lire(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function vide() { return { v: 1, travailleurs: [], clients: [], besoins: [], affectations: [], pointages: [], factures: [], paies: [], encaissements: [], audit: [], cfg: {}, seq: {} }; }
  var CACHE = null, COLL = ["travailleurs", "clients", "besoins", "affectations", "pointages", "factures", "paies", "encaissements", "audit"];
  function normaliser(S) { COLL.forEach(function (k) { if (!Array.isArray(S[k])) S[k] = []; }); if (!S.cfg || typeof S.cfg !== "object" || Array.isArray(S.cfg)) S.cfg = {}; if (!S.seq || typeof S.seq !== "object") S.seq = {}; return S; }
  function etat() { if (!CACHE) CACHE = normaliser(lire(K) || vide()); return CACHE; }
  function sauver(S) {
    S = S || etat(); S.audit = S.audit.slice(-1500); var ok = true;
    try { localStorage.setItem(K, JSON.stringify(S)); } catch (e) { ok = false; }
    try { if (G.ANGELS_SYNC) G.ANGELS_SYNC.signal(); } catch (e) { }
    return ok;
  }
  if (G.addEventListener) G.addEventListener("storage", function (e) { if (e.key === K) { CACHE = null; try { if (G.ANGELS_PLACEMENT_RAFRAICHIR) G.ANGELS_PLACEMENT_RAFRAICHIR(); } catch (x) { } } });
  function cfg(S) { var c = Object.assign({}, CFG0), u = (S || etat()).cfg || {}; Object.keys(CFG0).forEach(function (k) { var v = +u[k]; if (isFinite(v) && v >= 0 && u[k] !== "" && u[k] != null) c[k] = v; }); return c; }
  function comptes(S) { return Object.assign({}, COMPTES0, (S || etat()).cfg.comptes || {}); }
  function audit(S, par, action, detail) { S.audit.push({ id: uid("au"), t: nowIso(), par: par || "?", action: action, detail: String(detail || "").slice(0, 300) }); }
  function err(m) { throw new Error(m); }
  function montant(v, nom, nul) { var n = +v; if (!isFinite(n) || n < 0 || (!nul && n === 0)) err(nom + " invalide (nombre positif attendu)."); return R(n); }
  function dateOk(d, nom) { d = String(d || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + "T00:00:00Z"))) err(nom + " invalide."); return d; }
  function jours(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DJ) + 1; }
  function numero(S, pre) { var a = new Date().getFullYear(), k = pre + a; S.seq[k] = (S.seq[k] || 0) + 1; return pre + "-" + a + "-" + String(S.seq[k]).padStart(4, "0"); }
  function trouver(L, id, nom) { var x = L.filter(function (y) { return y.id === id; })[0]; if (!x) err(nom + " introuvable."); return x; }

  /* ---------- Travailleurs ---------- */
  function ajouterTravailleur(par, d) {
    var S = etat(), nom = String(d.nom || "").trim();
    if (nom.length < 2) err("Nom obligatoire.");
    var tel = chiffres(d.tel); if (tel.length < 8) err("Téléphone invalide (8 chiffres minimum).");
    if (!TYPES[d.type]) err("Type de travailleur inconnu.");
    var cle = tel.slice(-10);
    if (S.travailleurs.some(function (t) { return chiffres(t.tel).slice(-10) === cle; })) err("Ce numéro existe déjà : une seule fiche par personne.");
    var t = { id: uid("tr"), nom: nom.slice(0, 80), tel: String(d.tel).trim().slice(0, 25), type: d.type, ville: String(d.ville || "").trim().slice(0, 60), competences: String(d.competences || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12), cni: String(d.cni || "").trim().slice(0, 30), momo_op: MODES.indexOf(d.momo_op) >= 0 ? d.momo_op : "", momo_num: chiffres(d.momo_num).slice(0, 15), taux: d.taux ? montant(d.taux, "Tarif journalier souhaité") : 0, statut: "disponible", cree_le: nowIso() };
    S.travailleurs.push(t); audit(S, par, "Travailleur créé", t.nom); sauver(S); return t;
  }
  function statutTravailleur(par, id, statut, motif) {
    var S = etat(), t = trouver(S.travailleurs, id, "Travailleur");
    if (["disponible", "indisponible", "exclu"].indexOf(statut) < 0) err("Statut inconnu.");
    if (statut === "exclu" && !String(motif || "").trim()) err("Motif obligatoire pour exclure un travailleur.");
    t.statut = statut; if (statut === "exclu") t.motif = String(motif).trim().slice(0, 200); audit(S, par, "Statut travailleur : " + statut, t.nom + (motif ? " — " + motif : "")); sauver(S); return t;
  }
  /* ---------- Entreprises clientes ---------- */
  function ajouterClient(par, d) {
    var S = etat(), nom = String(d.nom || "").trim(); if (nom.length < 2) err("Nom de l'entreprise obligatoire.");
    if (S.clients.some(function (c) { return norm(c.nom) === norm(nom); })) err("Cette entreprise existe déjà.");
    var c = { id: uid("cl"), nom: nom.slice(0, 100), contact: String(d.contact || "").trim().slice(0, 80), tel: String(d.tel || "").trim().slice(0, 25), email: String(d.email || "").trim().slice(0, 100), adresse: String(d.adresse || "").trim().slice(0, 160), cree_le: nowIso() };
    S.clients.push(c); audit(S, par, "Entreprise créée", c.nom); sauver(S); return c;
  }
  /* ---------- Besoins (demandes des entreprises) ---------- */
  function creerBesoin(par, d) {
    var S = etat(), c = trouver(S.clients, d.client_id, "Entreprise");
    if (!TYPES[d.type]) err("Type de poste inconnu.");
    var poste = String(d.poste || "").trim(); if (poste.length < 2) err("Intitulé du poste obligatoire.");
    var nb = +d.nb; if (!(nb >= 1 && nb <= 500 && Math.floor(nb) === nb)) err("Nombre de personnes invalide (1 à 500).");
    var deb = dateOk(d.debut, "Date de début"), fin = dateOk(d.fin || d.debut, "Date de fin"); if (fin < deb) err("La fin précède le début.");
    var tc = montant(d.taux_client, "Tarif facturé au client (par jour)"), tt = montant(d.taux_travailleur, "Rémunération du travailleur (par jour)");
    if (tt > tc) err("La rémunération du travailleur dépasse le tarif facturé : marge négative.");
    var b = { id: uid("bs"), numero: numero(S, "BES"), client_id: c.id, poste: poste.slice(0, 80), type: d.type, nb: nb, debut: deb, fin: fin, taux_client: tc, taux_travailleur: tt, statut: "ouvert", cree_le: nowIso() };
    S.besoins.push(b); audit(S, par, "Besoin créé", b.numero + " — " + c.nom + " — " + nb + " × " + poste); sauver(S); return b;
  }
  function pourvus(S, b) { return S.affectations.filter(function (a) { return a.besoin_id === b.id && a.statut !== "annulee"; }).length; }
  function annulerBesoin(par, id, motif) {
    var S = etat(), b = trouver(S.besoins, id, "Besoin"); if (!String(motif || "").trim()) err("Motif obligatoire.");
    if (S.pointages.some(function (p) { return S.affectations.some(function (a) { return a.id === p.affectation_id && a.besoin_id === id; }); })) err("Des journées sont déjà pointées : clôturez au lieu d'annuler.");
    b.statut = "annule"; S.affectations.forEach(function (a) { if (a.besoin_id === id) a.statut = "annulee"; }); audit(S, par, "Besoin annulé", b.numero + " — " + motif); sauver(S); return b;
  }
  /* ---------- Affectations ---------- */
  function chevauche(S, trId, deb, fin, sauf) {
    return S.affectations.filter(function (a) { return a.travailleur_id === trId && a.statut !== "annulee" && a.id !== sauf && !(fin < a.debut || deb > a.fin); })[0] || null;
  }
  function affecter(par, besoinId, trId, opt) {
    var S = etat(), b = trouver(S.besoins, besoinId, "Besoin"), t = trouver(S.travailleurs, trId, "Travailleur"); opt = opt || {};
    if (b.statut !== "ouvert") err("Ce besoin n'est plus ouvert.");
    if (t.statut === "exclu") err("Travailleur exclu : affectation impossible.");
    if (t.statut === "indisponible") err("Travailleur indisponible.");
    if (pourvus(S, b) >= b.nb) err("Besoin déjà pourvu.");
    var deb = opt.debut ? dateOk(opt.debut, "Début") : b.debut, fin = opt.fin ? dateOk(opt.fin, "Fin") : b.fin;
    if (fin < deb || deb < b.debut || fin > b.fin) err("Période hors de celle du besoin.");
    var c = chevauche(S, trId, deb, fin); if (c) err("Conflit : " + t.nom + " est déjà affecté du " + c.debut + " au " + c.fin + ".");
    var a = { id: uid("af"), besoin_id: b.id, travailleur_id: t.id, debut: deb, fin: fin, taux_client: b.taux_client, taux_travailleur: b.taux_travailleur, statut: "planifiee", cree_le: nowIso() };
    S.affectations.push(a); if (pourvus(S, b) >= b.nb) b.statut = "pourvu"; audit(S, par, "Affectation", t.nom + " → " + b.numero + " (" + deb + " au " + fin + ")"); sauver(S); return a;
  }
  function annulerAffectation(par, id, motif) {
    var S = etat(), a = trouver(S.affectations, id, "Affectation"); if (!String(motif || "").trim()) err("Motif obligatoire.");
    if (S.pointages.some(function (p) { return p.affectation_id === id; })) err("Des journées sont pointées : terminez l'affectation au lieu de l'annuler.");
    a.statut = "annulee"; var b = S.besoins.filter(function (x) { return x.id === a.besoin_id; })[0]; if (b && b.statut === "pourvu") b.statut = "ouvert";
    audit(S, par, "Affectation annulée", id + " — " + motif); sauver(S); return a;
  }
  function terminerAffectation(par, id) { var S = etat(), a = trouver(S.affectations, id, "Affectation"); a.statut = "terminee"; audit(S, par, "Affectation terminée", id); sauver(S); return a; }
  /* ---------- Pointage ---------- */
  function pointer(par, affId, date, fraction, note) {
    var S = etat(), a = trouver(S.affectations, affId, "Affectation"); date = dateOk(date, "Date");
    if (a.statut === "annulee") err("Affectation annulée.");
    if (date < a.debut || date > a.fin) err("Date hors de la période d'affectation.");
    if (date > auj()) err("Impossible de pointer un jour futur.");
    var f = +fraction; if ([0, 0.5, 1].indexOf(f) < 0) err("Présence : 0 (absent), 0,5 (demi-journée) ou 1 (journée).");
    if (S.pointages.some(function (p) { return p.affectation_id === affId && p.date === date; })) err("Journée déjà pointée.");
    var p = { id: uid("pt"), affectation_id: affId, date: date, fraction: f, note: String(note || "").trim().slice(0, 160), par: par, facture_id: "", paie_id: "", cree_le: nowIso() };
    S.pointages.push(p); if (a.statut === "planifiee") a.statut = "en_cours"; audit(S, par, "Pointage", date + " · " + f + " j · " + affId); sauver(S); return p;
  }
  function corrigerPointage(par, id, fraction, motif) {
    var S = etat(), p = trouver(S.pointages, id, "Pointage"); if (p.facture_id || p.paie_id) err("Pointage déjà facturé ou payé : non modifiable.");
    if (!String(motif || "").trim()) err("Motif obligatoire."); var f = +fraction; if ([0, 0.5, 1].indexOf(f) < 0) err("Présence invalide.");
    audit(S, par, "Pointage corrigé", p.date + " : " + p.fraction + " → " + f + " — " + motif); p.fraction = f; sauver(S); return p;
  }
  /* ---------- Facturation client ---------- */
  var aff = function (S, id) { return S.affectations.filter(function (a) { return a.id === id; })[0]; };
  var bes = function (S, id) { return S.besoins.filter(function (a) { return a.id === id; })[0]; };
  function afacturer(S, clientId) {
    return S.pointages.filter(function (p) { if (p.facture_id || !(p.fraction > 0)) return false; var a = aff(S, p.affectation_id), b = a && bes(S, a.besoin_id); return b && b.client_id === clientId; });
  }
  function facturer(par, clientId, jusqu) {
    var S = etat(), c = trouver(S.clients, clientId, "Entreprise"), fin = jusqu ? dateOk(jusqu, "Date limite") : auj(), P = afacturer(S, clientId).filter(function (p) { return p.date <= fin; });
    if (!P.length) err("Aucune journée à facturer pour cette entreprise.");
    var lignes = {}, ht = 0;
    P.forEach(function (p) { var a = aff(S, p.affectation_id), b = bes(S, a.besoin_id), k = b.id + "|" + a.taux_client; var l = lignes[k] = lignes[k] || { besoin: b.numero, poste: b.poste, taux: a.taux_client, jours: 0, montant: 0 }; l.jours += p.fraction; l.montant += R(p.fraction * a.taux_client); });
    var L = Object.keys(lignes).map(function (k) { return lignes[k]; }); L.forEach(function (l) { ht += l.montant; });
    var tv = cfg(S).tva, tva = R(ht * tv / 100), f = { id: uid("fa"), numero: numero(S, "FAC"), client_id: c.id, date: auj(), echeance: new Date(Date.now() + cfg(S).delai_facture * DJ).toISOString().slice(0, 10), lignes: L, ht: ht, tva_taux: tv, tva: tva, ttc: ht + tva, statut: "emise", pointages: P.map(function (p) { return p.id; }), cree_le: nowIso() };
    S.factures.push(f); P.forEach(function (p) { p.facture_id = f.id; }); audit(S, par, "Facture émise", f.numero + " — " + c.nom + " — " + f.ttc + " F"); sauver(S); return f;
  }
  function paye(S, f) { return S.encaissements.filter(function (e) { return e.facture_id === f.id; }).reduce(function (s, e) { return s + e.montant; }, 0); }
  function encaisser(par, factureId, m, mode, ref) {
    var S = etat(), f = trouver(S.factures, factureId, "Facture"); m = montant(m, "Montant"); if (MODES.indexOf(mode) < 0) err("Mode de paiement inconnu.");
    var reste = f.ttc - paye(S, f); if (m > reste) err("Montant supérieur au reste à payer (" + reste + " F).");
    ref = String(ref || "").trim(); if (mode !== "Espèces") { if (ref.length < 4) err("Référence de la transaction obligatoire."); if (S.encaissements.concat(S.paies).some(function (x) { return x.ref && x.ref.toLowerCase() === ref.toLowerCase(); })) err("Cette référence a déjà été utilisée."); }
    var e = { id: uid("en"), facture_id: f.id, date: auj(), montant: m, mode: mode, ref: ref, par: par }; S.encaissements.push(e);
    f.statut = paye(S, f) >= f.ttc ? "payee" : "partielle"; audit(S, par, "Encaissement", f.numero + " — " + m + " F (" + mode + ")"); sauver(S); return e;
  }
  /* ---------- Paie du travailleur ---------- */
  function apayer(S, trId) {
    return S.pointages.filter(function (p) { if (p.paie_id || !(p.fraction > 0)) return false; var a = aff(S, p.affectation_id); return a && a.travailleur_id === trId; });
  }
  function payer(par, trId, mode, ref, jusqu) {
    var S = etat(), t = trouver(S.travailleurs, trId, "Travailleur"), fin = jusqu ? dateOk(jusqu, "Date limite") : auj(), P = apayer(S, trId).filter(function (p) { return p.date <= fin; });
    if (!P.length) err("Aucune journée à payer pour ce travailleur.");
    if (MODES.indexOf(mode) < 0) err("Mode de paiement inconnu.");
    ref = String(ref || "").trim(); if (mode !== "Espèces") { if (ref.length < 4) err("Référence de la transaction obligatoire."); if (S.encaissements.concat(S.paies).some(function (x) { return x.ref && x.ref.toLowerCase() === ref.toLowerCase(); })) err("Cette référence a déjà été utilisée."); }
    var brut = 0, jr = 0; P.forEach(function (p) { var a = aff(S, p.affectation_id); brut += R(p.fraction * a.taux_travailleur); jr += p.fraction; });
    var pa = { id: uid("pa"), numero: numero(S, "PAI"), travailleur_id: t.id, date: auj(), jours: jr, brut: brut, net: brut, mode: mode, ref: ref, par: par, pointages: P.map(function (p) { return p.id; }) };
    S.paies.push(pa); P.forEach(function (p) { p.paie_id = pa.id; }); audit(S, par, "Paie", pa.numero + " — " + t.nom + " — " + pa.net + " F"); sauver(S); return pa;
  }
  /* ---------- Calculs, indicateurs ---------- */
  function resume(S) {
    S = S || etat(); var m = auj().slice(0, 7), ca = 0, cout = 0, du = 0, aPayer = 0, aFact = 0;
    S.factures.forEach(function (f) { if (String(f.date).slice(0, 7) === m) ca += f.ht; du += f.ttc - paye(S, f); });
    S.paies.forEach(function (p) { if (String(p.date).slice(0, 7) === m) cout += p.brut; });
    S.travailleurs.forEach(function (t) { apayer(S, t.id).forEach(function (p) { aPayer += R(p.fraction * aff(S, p.affectation_id).taux_travailleur); }); });
    S.clients.forEach(function (c) { afacturer(S, c.id).forEach(function (p) { aFact += R(p.fraction * aff(S, p.affectation_id).taux_client); }); });
    var t = auj(), enCours = S.affectations.filter(function (a) { return a.statut !== "annulee" && a.statut !== "terminee" && a.debut <= t && a.fin >= t; }).length;
    var nonPointes = S.affectations.filter(function (a) { return (a.statut === "planifiee" || a.statut === "en_cours") && a.debut <= t && a.fin >= t && !S.pointages.some(function (p) { return p.affectation_id === a.id && p.date === t; }); }).length;
    var retard = S.factures.filter(function (f) { return f.statut !== "payee" && f.echeance < t; }).length;
    return { ca_mois: ca, cout_mois: cout, marge_mois: ca - cout, creances: du, a_facturer: aFact, a_payer: aPayer, en_poste: enCours, non_pointes: nonPointes, besoins_ouverts: S.besoins.filter(function (b) { return b.statut === "ouvert"; }).length, factures_retard: retard, disponibles: S.travailleurs.filter(function (x) { return x.statut === "disponible"; }).length };
  }
  function candidats(S, besoinId) {
    S = S || etat(); var b = trouver(S.besoins, besoinId, "Besoin");
    return S.travailleurs.filter(function (t) { return t.statut === "disponible" && !chevauche(S, t.id, b.debut, b.fin); }).sort(function (x, y) { return (x.type === b.type ? 0 : 1) - (y.type === b.type ? 0 : 1) || x.nom.localeCompare(y.nom); });
  }
  /* ---------- Écritures SYSCOHADA (lecture seule, équilibrées) ----------
     Facture : 4111 Clients (TTC) / 7061 Services vendus (HT) + 4431 TVA facturée ; encaissement : 553/571/5211 / 4111 ;
     paie : 6611 Appointements, salaires et commissions / 422 Personnel, rémunérations dues ; paiement : 422 / 553, 571 ou 5211 selon le mode.
     Aucune retenue sociale ou fiscale n'est calculée ici (journaliers payés au montant convenu) : à traiter avec l'expert-comptable avant tout usage de paie salariée. */
  function ecritures(S) {
    S = S || etat(); var C = comptes(S), E = [];
    var tres = function (mode) { return mode === "Espèces" ? C.caisse : mode === "Virement" ? C.banque : C.mobile; };
    S.factures.forEach(function (f) { E.push({ date: f.date, journal: "VE", piece: f.numero, libelle: "Facture " + f.numero, lignes: [{ compte: C.clients, debit: f.ttc, credit: 0 }, { compte: C.services, debit: 0, credit: f.ht }].concat(f.tva ? [{ compte: C.tva, debit: 0, credit: f.tva }] : []) }); });
    S.encaissements.forEach(function (e) { var f = S.factures.filter(function (x) { return x.id === e.facture_id; })[0]; E.push({ date: e.date, journal: "TR", piece: f ? f.numero : e.id, libelle: "Encaissement " + (f ? f.numero : ""), lignes: [{ compte: tres(e.mode), debit: e.montant, credit: 0 }, { compte: C.clients, debit: 0, credit: e.montant }] }); });
    S.paies.forEach(function (p) {
      E.push({ date: p.date, journal: "OD", piece: p.numero, libelle: "Rémunération " + p.numero, lignes: [{ compte: C.salaires, debit: p.brut, credit: 0 }, { compte: C.personnel, debit: 0, credit: p.brut }] });
      E.push({ date: p.date, journal: "TR", piece: p.numero, libelle: "Paiement " + p.numero, lignes: [{ compte: C.personnel, debit: p.brut, credit: 0 }, { compte: tres(p.mode), debit: 0, credit: p.brut }] });
    });
    return E;
  }
  function equilibre(E) { return E.every(function (e) { var d = 0, c = 0; e.lignes.forEach(function (l) { d += l.debit; c += l.credit; }); return d === c; }); }
  function reglages(par, d) {
    var S = etat(), t = +d.tva; if (!(t >= 0 && t <= 30)) err("TVA invalide (0 à 30 %).");
    var dl = +d.delai_facture; if (!(dl >= 0 && dl <= 180)) err("Délai de paiement invalide.");
    S.cfg.tva = t; S.cfg.delai_facture = dl; audit(S, par, "Réglages", "TVA " + t + " % · délai " + dl + " j"); sauver(S); return cfg(S);
  }
  function csv(rows) { var f = function (v) { v = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }; return "﻿" + rows.map(function (r) { return r.map(f).join(";"); }).join("\r\n"); }
  function exportPaies(S) { S = S || etat(); return csv([["Numéro", "Date", "Travailleur", "Téléphone", "Jours", "Montant", "Mode", "Référence"]].concat(S.paies.map(function (p) { var t = S.travailleurs.filter(function (x) { return x.id === p.travailleur_id; })[0] || {}; return [p.numero, p.date, t.nom, t.tel, p.jours, p.net, p.mode, p.ref]; }))); }

  function csvEcritures(S) { var rows = [["Date", "Journal", "Pièce", "Libellé", "Compte", "Débit", "Crédit"]]; ecritures(S).forEach(function (e) { e.lignes.forEach(function (l) { rows.push([e.date, e.journal, e.piece, e.libelle, l.compte, l.debit, l.credit]); }); }); return csv(rows); }
  G.ANGELS_PLACEMENT = { K: K, TYPES: TYPES, MODES: MODES, esc: esc, norm: norm, etat: etat, sauver: sauver, cfg: cfg, ajouterTravailleur: ajouterTravailleur, statutTravailleur: statutTravailleur, ajouterClient: ajouterClient, creerBesoin: creerBesoin, annulerBesoin: annulerBesoin, affecter: affecter, annulerAffectation: annulerAffectation, terminerAffectation: terminerAffectation, pointer: pointer, corrigerPointage: corrigerPointage, afacturer: afacturer, facturer: facturer, encaisser: encaisser, payeFacture: paye, apayer: apayer, payer: payer, resume: resume, candidats: candidats, pourvus: pourvus, ecritures: ecritures, equilibre: equilibre, reglages: reglages, exportPaies: exportPaies, csvEcritures: csvEcritures, jours: jours };
})(typeof window !== "undefined" ? window : globalThis);
