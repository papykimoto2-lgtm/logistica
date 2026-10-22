/* Données de DÉMONSTRATION (placement de personnel, assurance, CRM) : fictives, locales à l'appareil, datées par rapport à aujourd'hui.
   Utilisé uniquement par demo.html. Jamais envoyées au serveur (la synchronisation est coupée tant que « logistica_demo_local » vaut 1).
   Aucune vraie personne ni vraie entreprise : noms et numéros inventés (numéros 07 00 00 xx xx). */
(function (G) {
  "use strict";
  var PAR = "Démonstration";
  var J = function (n) { return new Date(Date.now() + n * 864e5).toISOString().slice(0, 10); };
  function jours(a, b) { var L = [], i; for (i = a; i <= b; i++) L.push(J(i)); return L; }
  function essayer(f) { try { return f(); } catch (e) { return null; } }

  function placement(P) {
    var T = {}, mk = function (k, nom, tel, type, ville, comp, taux, op) { T[k] = P.ajouterTravailleur(PAR, { nom: nom, tel: tel, type: type, ville: ville, competences: comp, taux: taux, momo_op: op || "Orange Money", momo_num: tel.replace(/\D/g, "") }); };
    mk("t1", "Koné Ibrahim", "0700000001", "moto", "Yopougon", "permis A, Abidjan, ponctuel", 6000);
    mk("t2", "Ouattara Moussa", "0700000002", "moto", "Cocody", "permis A, Riviera", 6000);
    mk("t3", "Yao Kouadio Serge", "0700000003", "voiture", "Marcory", "permis B, Abidjan", 9000, "MTN MoMo");
    mk("t4", "Traoré Aminata", "0700000004", "bureau", "Plateau", "secrétariat, Word, Excel", 12000, "Wave");
    mk("t5", "Bamba Fatou", "0700000005", "bureau", "Cocody", "standard, accueil", 10000, "Wave");
    mk("t6", "Diallo Seydou", "0700000006", "pied", "Adjamé", "coursier à pied, Plateau", 5000);
    mk("t7", "N'Guessan Paul", "0700000007", "journalier", "Abobo", "manutention", 5000);
    mk("t8", "Coulibaly Adama", "0700000008", "moto", "Treichville", "permis A", 6000);
    mk("t9", "Kouassi Marie", "0700000009", "bureau", "Marcory", "réception, accueil", 10000, "Moov Money");
    mk("t10", "Soro Lacina", "0700000010", "voiture", "Koumassi", "permis B, livraison", 9000);
    mk("t11", "Fofana Drissa", "0700000011", "journalier", "Yopougon", "manutention, chargement", 5000);
    mk("t12", "Aka Josiane", "0700000012", "temporaire", "Cocody", "comptabilité, Sage", 16000, "Wave");
    var C = {}, mc = function (k, nom, contact, tel, adr) { C[k] = P.ajouterClient(PAR, { nom: nom, contact: contact, tel: tel, adresse: adr, email: "" }); };
    mc("ph", "Pharmacie Les Deux Plateaux", "Dr Kouamé", "0700000101", "Deux Plateaux, Cocody");
    mc("cab", "Cabinet Koffi & Associés", "Me Koffi", "0700000102", "Plateau, Abidjan");
    mc("eb", "Groupe Ébène Industries", "M. Diomandé", "0700000103", "Zone industrielle, Yopougon");
    mc("cl", "Clinique Les Palmiers", "Mme Séka", "0700000104", "Marcory, Abidjan");
    mc("sip", "SIPRA Distribution SARL", "M. Gnagne", "0700000105", "Koumassi, Abidjan");
    mc("lag", "Société Lagune Négoce", "Mme Ahoua", "0700000106", "Treichville, Abidjan");
    var besoin = function (cli, poste, type, nb, d, f, tc, tt) { return P.creerBesoin(PAR, { client_id: C[cli].id, poste: poste, type: type, nb: nb, debut: J(d), fin: J(f), taux_client: tc, taux_travailleur: tt }); };
    var aff = function (b, t) { return P.affecter(PAR, b.id, T[t].id); };
    var pointer = function (a, de, a2) { jours(de, a2).forEach(function (d, i) { essayer(function () { P.pointer(PAR, a.id, d, i % 7 === 5 ? 0.5 : 1); }); }); };
    /* 1. Pharmacie : 2 coursiers moto, facturé, encaissé en partie, payé */
    var b1 = besoin("ph", "Coursier moto (livraison d'ordonnances)", "moto", 2, -12, 10, 9000, 6000), a1 = aff(b1, "t1"), a2 = aff(b1, "t2");
    pointer(a1, -12, -1); pointer(a2, -12, -1);
    var f1 = P.facturer(PAR, C.ph.id, J(-4)); P.encaisser(PAR, f1.id, Math.round(f1.ttc * 0.6), "Wave", "WAV-DEMO-0001");
    P.payer(PAR, T.t1.id, "Orange Money", "OM-DEMO-0001", J(-4)); P.payer(PAR, T.t2.id, "Orange Money", "OM-DEMO-0002", J(-4));
    /* 2. Cabinet : 1 secrétaire, facture soldée */
    var b2 = besoin("cab", "Secrétaire de direction", "bureau", 1, -20, 30, 18000, 12000), a3 = aff(b2, "t4");
    pointer(a3, -20, -1);
    var f2 = P.facturer(PAR, C.cab.id, J(-8)); P.encaisser(PAR, f2.id, f2.ttc, "Virement", "VIR-DEMO-0001"); P.payer(PAR, T.t4.id, "Wave", "WAV-DEMO-0002", J(-8));
    /* 3. Groupe Ébène : 3 journaliers, 6 jours pointés, pas encore facturés */
    var b3 = besoin("eb", "Manutentionnaire (inventaire annuel)", "journalier", 3, -6, -1, 8000, 5000);
    ["t7", "t11", "t6"].forEach(function (k) { pointer(aff(b3, k), -6, -1); });
    /* 4. Clinique : 1 réceptionniste en cours, journée du jour à pointer */
    var b4 = besoin("cl", "Réceptionniste", "bureau", 1, -3, 14, 15000, 10000), a4 = aff(b4, "t9");
    pointer(a4, -3, -1);
    /* 5. SIPRA : 2 coursiers voiture à pourvoir */
    besoin("sip", "Coursier voiture (tournées de livraison)", "voiture", 2, 3, 8, 22000, 15000);
    /* 6. Société Lagune : comptable temporaire terminée */
    var b6 = besoin("lag", "Comptable temporaire (clôture)", "temporaire", 1, -15, -1, 25000, 16000), a6 = aff(b6, "t12");
    pointer(a6, -15, -1); P.terminerAffectation(PAR, a6.id);
    return { travailleurs: 12, entreprises: 6, besoins: 6 };
  }

  function assurance(A) {
    var Cp = {}, mcp = function (k, nom, tel, taux, contact) { Cp[k] = A.ajouterCompagnie(PAR, { nom: nom, tel: tel, taux: taux, contact: contact, email: "" }); };
    mcp("atl", "Atlantique Assurances (démo)", "0700000201", 12, "Service courtage");
    mcp("sah", "Sahel Protection (démo)", "0700000202", 10, "Service courtage");
    mcp("ivg", "Ivoire Garantie (démo)", "0700000203", 11, "Service courtage");
    mcp("lag", "Lagune Mutuelle (démo)", "0700000204", 9, "Service courtage");
    essayer(function () { A.tauxBranche(PAR, Cp.lag.id, "sante", 8); A.tauxBranche(PAR, Cp.atl.id, "auto", 13); });
    var As = {}, mas = function (k, nom, tel, type) { As[k] = A.ajouterAssure(PAR, { nom: nom, tel: tel, type: type, email: "", adresse: "Abidjan" }); };
    mas("koffi", "Koffi Jean-Marc", "0700000301", "particulier");
    mas("ebene", "Groupe Ébène Industries", "0700000103", "entreprise");   /* même numéro que l'entreprise cliente du Placement : une seule fiche CRM */
    mas("amina", "Coulibaly Aminata", "0700000302", "particulier");
    mas("bamba", "Transports Bamba & Fils", "0700000303", "entreprise");
    mas("yao", "Dr Yao Marie-Claire", "0700000304", "particulier");
    mas("ph", "Pharmacie Les Deux Plateaux", "0700000101", "entreprise");   /* idem */
    mas("konan", "Konan Éric", "0700000305", "particulier");
    var dev = A.creerDevis(PAR, { assure_id: As.koffi.id, branche: "auto", risque: "Toyota Yaris AB-123-CI, usage personnel", propositions: [
      { compagnie_id: Cp.atl.id, prime_nette: 95000, accessoires: 6000, taxes: 16000, garanties: "Tous risques, bris de glace", franchise: "50 000 F" },
      { compagnie_id: Cp.sah.id, prime_nette: 82000, accessoires: 5000, taxes: 14000, garanties: "RC + vol + incendie", franchise: "30 000 F" },
      { compagnie_id: Cp.ivg.id, prime_nette: 88000, accessoires: 5500, taxes: 15000, garanties: "RC + vol + incendie + bris de glace" }] });
    var p1 = A.emettreDepuisDevis(PAR, dev.id, 0, { numero: "ATL-AUTO-2026-0412", effet: J(-40) });
    A.encaisserPrime(PAR, p1.id, 60000, "Wave", "WAV-ASS-0001"); A.encaisserPrime(PAR, p1.id, A.ttcPolice(A.etat(), p1) - 60000, "Orange Money", "OM-ASS-0001");
    A.avenant(PAR, p1.id, { objet: "Ajout garantie bris de glace", delta: 12000 }); A.encaisserPrime(PAR, p1.id, 12000, "Espèces", "");
    A.reverserCompagnie(PAR, p1.id, 100000, "Virement", "VIR-ASS-0001");
    A.creerDevis(PAR, { assure_id: As.ebene.id, branche: "pro", risque: "Multirisque professionnelle : entrepôt de 800 m², stock 150 M F", propositions: [
      { compagnie_id: Cp.sah.id, prime_nette: 460000, accessoires: 15000, taxes: 70000, garanties: "Incendie, dégâts des eaux, vol, bris de machines", franchise: "1 % du sinistre" },
      { compagnie_id: Cp.ivg.id, prime_nette: 430000, accessoires: 12000, taxes: 66000, garanties: "Incendie, dégâts des eaux, vol", franchise: "2 % du sinistre" }] });
    var p2 = A.emettrePolice(PAR, { assure_id: As.ebene.id, compagnie_id: Cp.sah.id, branche: "pro", numero: "SAH-MRP-2025-0187", effet: J(-335), prime_nette: 420000, accessoires: 12000, taxes: 64000, risque: "Multirisque professionnelle : entrepôt de Yopougon" });
    A.encaisserPrime(PAR, p2.id, 496000, "Virement", "VIR-ASS-0002"); A.reverserCompagnie(PAR, p2.id, A.dueCompagnie(A.etat(), p2), "Virement", "VIR-ASS-0003");
    var p3 = A.emettrePolice(PAR, { assure_id: As.bamba.id, compagnie_id: Cp.ivg.id, branche: "transport", numero: "IVG-TRM-2026-0033", effet: J(-200), prime_nette: 680000, accessoires: 20000, taxes: 105000, encaisse_par: "assureur", risque: "Transport de marchandises, 6 camions" });
    A.recevoirCommission(PAR, p3.id, 30000, "Virement", "VIR-ASS-0004");
    var p4 = A.emettrePolice(PAR, { assure_id: As.amina.id, compagnie_id: Cp.lag.id, branche: "sante", numero: "LAG-SAN-2026-0902", effet: J(-20), prime_nette: 180000, accessoires: 5000, taxes: 20000, risque: "Santé famille (4 personnes)" });
    A.encaisserPrime(PAR, p4.id, 100000, "Orange Money", "OM-ASS-0002");
    var p5 = A.emettrePolice(PAR, { assure_id: As.yao.id, compagnie_id: Cp.atl.id, branche: "rc", numero: "ATL-RCP-2026-0150", effet: J(-100), prime_nette: 75000, accessoires: 3000, taxes: 11000, risque: "Responsabilité civile professionnelle (médecin)" });
    A.emettrePolice(PAR, { assure_id: As.konan.id, compagnie_id: Cp.sah.id, branche: "incendie", numero: "SAH-MRH-2025-0071", effet: J(-400), prime_nette: 64000, accessoires: 3000, taxes: 9000, risque: "Multirisque habitation" });
    var p7 = A.emettrePolice(PAR, { assure_id: As.ph.id, compagnie_id: Cp.atl.id, branche: "pro", numero: "ATL-MRP-2026-0220", effet: J(-300), echeance: J(60), prime_nette: 210000, accessoires: 8000, taxes: 32000, risque: "Multirisque professionnelle : pharmacie" });
    A.encaisserPrime(PAR, p7.id, 250000, "Virement", "VIR-ASS-0005"); A.reverserCompagnie(PAR, p7.id, A.dueCompagnie(A.etat(), p7), "Virement", "VIR-ASS-0006");
    var s1 = A.declarerSinistre(PAR, { police_id: p1.id, date: J(-10), nature: "Collision avec un tiers au carrefour de la Riviera", lieu: "Cocody", estime: 450000 });
    A.avancerSinistre(PAR, s1.id, "transmis", "Constat amiable et photos envoyés"); A.avancerSinistre(PAR, s1.id, "expertise", "Expert passé le lendemain");
    var s2 = A.declarerSinistre(PAR, { police_id: p2.id, date: J(-60), nature: "Début d'incendie dans l'entrepôt (court-circuit)", lieu: "Yopougon", estime: 1500000 });
    ["transmis", "expertise", "accepte"].forEach(function (e) { A.avancerSinistre(PAR, s2.id, e, ""); }); A.avancerSinistre(PAR, s2.id, "indemnise", "Virement reçu de la compagnie", 1250000); A.avancerSinistre(PAR, s2.id, "clos", "Dossier réglé");
    A.declarerSinistre(PAR, { police_id: p4.id, date: J(-5), nature: "Hospitalisation (paludisme grave), prise en charge à instruire", lieu: "Marcory", estime: 320000 });
    return { assures: 7, compagnies: 4, polices: A.etat().polices.length, sinistres: 3 };
  }

  function crm(C) {
    var L = C.contacts(), par = PAR;
    var cle = function (tel) { return C.cleTel(tel); };
    essayer(function () { C.creerOpp(par, { nom: "Groupe Ébène Industries — extension du contrat de placement", tel: "0700000103", cle: cle("0700000103"), valeur: 1800000, source: "Placement" }); });
    essayer(function () { C.creerOpp(par, { nom: "Pharmacie Les Deux Plateaux — assurance flotte motos", tel: "0700000101", cle: cle("0700000101"), valeur: 650000, source: "Assurance" }); });
    essayer(function () { C.creerOpp(par, { nom: "Clinique Les Palmiers — 3 réceptionnistes", tel: "0700000104", cle: cle("0700000104"), valeur: 900000, source: "Recommandation" }); });
    essayer(function () { C.ajouterTache(par, cle("0700000103"), "Rappeler M. Diomandé : devis personnel inventaire", J(1)); });
    essayer(function () { C.ajouterTache(par, cle("0700000101"), "Renouvellement multirisque : envoyer la cotation", J(7)); });
    essayer(function () { C.ajouterTache(par, "", "Relancer les factures impayées du mois", J(-1)); });
    essayer(function () { C.ajouterInteraction(par, cle("0700000102"), "appel", "Satisfaite de la secrétaire de direction, souhaite une remplaçante pour les congés"); });
    return { contacts: L.length };
  }

  /* Efface les données de démonstration de cet appareil (et seulement les clés de l'ERP) puis coupe le mode démo. */
  var CLES = ["logistica_erp_v1", "logistica_transport_v3", "logistica_agro_v1", "logistica_placement_v1", "logistica_assurance_v1", "logistica_crm_v1", "logistica_compta_distribution", "logistica_compta_transport", "logistica_compta_agro", "logistica_portail_v1", "logistica_transport_files", "logistica_demo", "logistica_demo_local", "logistica_panier"];
  function effacer() {
    CLES.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { } });
    try { Object.keys(localStorage).filter(function (k) { return /^logistica_(sync_base_|demo_garde_)/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { }
    try { sessionStorage.clear(); } catch (e) { }
  }
  G.LOGISTICA_DEMO = { placement: placement, assurance: assurance, crm: crm, effacer: effacer };
})(window);
