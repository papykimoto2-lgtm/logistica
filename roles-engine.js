/* Rôles et droits LOGISTICA (Distributions, Transport, Agro) : rôles personnalisés + droits module par module et action par action.
   - Chaque application déclare ici son CATALOGUE de droits (modules → droits), avec les rôles d'origine qui les ont par défaut.
   - Un rôle personnalisé (« Chef d'équipe »…) = un nom + une liste de droits ; les rôles d'origine peuvent aussi être modifiés (sauf l'administrateur
     et les profils rattachés à une fiche : livreur, vendeur, chauffeur) et rétablis à leurs droits d'origine.
   - Stockage dans l'état de l'application (donc synchronisé entre postes) : S.roles_perso (rôles créés), S.droits_roles (droits modifiés des rôles d'origine).
     Transport garde sa matrice native S.perms[rôle][module] : le moteur la lit et l'écrit telle quelle.
   - ANGELS_ROLES.ouvrir(...) affiche le gestionnaire (même écran dans les applications et dans le Hub). */
(function (G) {
  "use strict";
  var E = function (x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* ---------- Catalogues ---------- */
  function V(id, nom, def) { return { id: "v." + id, l: "Voir : " + nom, def: def }; }
  var DIST = {
    nom: "Distributions", externes: ["livreur", "vendeur"],
    roles: { admin: "Administrateur", direction: "Direction générale", superviseur: "Superviseur des livraisons", commercial: "Responsable commercial", preparateur: "Préparateur", caissier: "Caissier", livreur: "Livreur", vendeur: "Vendeur partenaire" },
    modules: [
      { id: "pilotage", nom: "Pilotage", droits: [V("dashboard", "Tableau de bord", ["admin", "direction", "superviseur"]), V("carte", "Carte en direct", ["admin", "superviseur", "direction"]), { id: "sos.voir", l: "Recevoir et suivre les alertes SOS des livreurs", def: ["admin", "direction", "superviseur"], hors: true }] },
      { id: "tiers", nom: "Tiers et partenaires", droits: [V("vendeurs", "Vendeurs partenaires", ["admin", "commercial", "superviseur"]), V("clients", "Clients", ["admin", "superviseur", "commercial"])] },
      { id: "commandes", nom: "Commandes", droits: [V("commandes", "Commandes", ["admin", "superviseur", "commercial", "preparateur"]), V("notifs", "Notifications", ["admin", "superviseur", "commercial"]), V("prestations", "Prestations", ["admin", "commercial"]), V("abonnements", "Abonnements", ["admin", "commercial", "caissier"]), V("vente_ligne", "Vente en ligne", ["admin", "superviseur", "commercial", "caissier"]),
        { id: "commandes.gerer", l: "Créer, confirmer et importer des commandes", def: ["admin", "commercial", "superviseur"] }, { id: "commandes.etiquettes", l: "Imprimer les étiquettes de colis", def: ["admin", "preparateur", "superviseur", "commercial"] }, { id: "preparation.gerer", l: "Préparer les commandes et réceptionner les collectes", def: ["admin", "preparateur"] }] },
      { id: "stock", nom: "Stock et préparation", droits: [V("produits", "Produits et stock", ["admin", "commercial", "preparateur"]), V("journal", "Journal des mouvements", ["admin", "direction", "superviseur", "commercial", "preparateur"]), V("inventaire", "Inventaire", ["admin", "direction", "superviseur", "commercial", "preparateur"]),
        { id: "produits.gerer", l: "Créer des produits et traiter les candidatures de vendeurs", def: ["admin", "commercial"] }, { id: "stock.mouvements", l: "Saisir des entrées de stock et des inventaires", def: ["admin", "commercial", "preparateur"] }] },
      { id: "livraison", nom: "Livraison", droits: [V("livraisons", "Centre de livraison", ["admin", "superviseur"]), V("livreurs", "Livreurs et motos", ["admin", "superviseur"]), V("incidents", "Incidents et retours", ["admin", "superviseur", "preparateur"]),
        { id: "livraison.gerer", l: "Affecter les livreurs, planifier les collectes, suivre les courses", def: ["admin", "superviseur"] }, { id: "retours.receptionner", l: "Réceptionner les retours de colis", def: ["admin", "preparateur", "superviseur"] }] },
      { id: "argent", nom: "Argent", droits: [V("finance", "Finance", ["admin", "direction", "caissier"]), V("caisse", "Caisse", ["admin", "direction", "caissier"]), V("versements", "Versements vendeurs", ["admin", "direction", "caissier"]), V("compta", "Comptabilité", ["admin", "direction"]),
        { id: "caisse.encaisser", l: "Valider les versements, reverser et payer livreurs et vendeurs", def: ["admin", "caissier"] }, { id: "ecarts.accepter", l: "Accepter ou refuser les écarts de caisse", def: ["admin", "superviseur", "direction"] }, { id: "finance.attentes", l: "Voir les opérations d'argent en attente", def: ["admin", "caissier", "direction"] }, { id: "direction.valider", l: "Valider les mouvements de caisse et les opérations RH", def: ["admin", "direction"] }] },
      { id: "controle", nom: "Contrôle et documents", droits: [V("etats", "États périodiques", ["admin", "direction", "superviseur", "commercial", "caissier"]), V("documents", "Documents", ["admin", "direction", "commercial", "caissier", "superviseur"]), V("audit", "Journal d'audit", ["admin", "direction"]),
        { id: "etats.activite", l: "Voir l'état d'activité détaillé", def: ["admin", "direction", "superviseur", "commercial", "caissier"] }, { id: "documents.emettre", l: "Établir factures et reçus", def: ["admin", "commercial", "caissier", "superviseur"] }, { id: "documents.avoir", l: "Émettre un avoir", def: ["admin", "commercial", "caissier"] }, { id: "documents.livraison", l: "Imprimer les bons de livraison", def: ["admin", "superviseur", "commercial", "preparateur", "caissier"] }] },
      { id: "admin", nom: "Administration", droits: [V("rh", "Ressources humaines et paie", ["admin", "direction"]), V("utilisateurs", "Utilisateurs", ["admin"]), V("params", "Paramètres", ["admin"]),
        { id: "admin.exceptionnel", l: "Corrections exceptionnelles (forcer un statut, valider un inventaire, ouvrir une caisse avec écart)", def: ["admin"], sensible: true }] }
    ]
  };
  /* L'atome d'une vérification can(...) de Distributions se retrouve par l'ensemble de rôles qu'elle cite (sans livreur ni vendeur). */
  var AGRO = {
    nom: "Agro", externes: [],
    roles: { admin: "Administrateur", direction: "Direction générale", chef: "Chef d'exploitation", soigneur: "Soigneur", magasinier: "Magasinier", commercial: "Commercial", caissier: "Caissier", comptable: "Comptable" },
    modules: [
      { id: "pilotage", nom: "Pilotage", droits: [V("dash", "Tableau de bord", ["admin", "direction", "chef", "soigneur", "magasinier", "commercial", "caissier", "comptable"]), V("rapports", "Rapports", ["admin", "direction", "chef", "comptable"])] },
      { id: "elevage", nom: "Élevage", droits: [V("lots", "Lots et élevage", ["admin", "direction", "chef", "soigneur"]), V("suivi", "Suivi quotidien", ["admin", "chef", "soigneur"]), V("sante", "Santé et prophylaxie", ["admin", "chef", "soigneur"]), V("couvoir", "Couvoir", ["admin", "chef"]), V("batiments", "Bâtiments", ["admin", "chef", "direction"]), { id: "lot", l: "Gérer les lots d'élevage", def: ["admin", "chef"] }, { id: "suivi", l: "Saisir le suivi quotidien", def: ["admin", "chef", "soigneur"] }, { id: "sante", l: "Santé : soins et vaccins", def: ["admin", "chef", "soigneur"] }, { id: "couvoir", l: "Couvoir et incubation", def: ["admin", "chef"] }, { id: "batiment", l: "Bâtiments", def: ["admin", "chef"] }, { id: "nutri", l: "Nutrition et formulation", def: ["admin", "chef"] }, { id: "cond", l: "Conditionnement des œufs", def: ["admin", "chef", "magasinier"] }] },
      { id: "stock", nom: "Stock et achats", droits: [V("stock", "Stock", ["admin", "direction", "chef", "magasinier", "comptable"]), V("fab", "Fabrication d'aliments", ["admin", "chef", "magasinier"]), V("cond", "Conditionnement", ["admin", "direction", "chef", "magasinier"]), V("achats", "Achats et fournisseurs", ["admin", "direction", "magasinier", "comptable"]), { id: "stock", l: "Mouvements de stock", def: ["admin", "chef", "magasinier"] }, { id: "ajust", l: "Ajustements d'inventaire", def: ["admin", "magasinier", "direction"] }, { id: "fab", l: "Fabrication d'aliment", def: ["admin", "chef", "magasinier"] }, { id: "achat", l: "Achats et réceptions", def: ["admin", "magasinier"] }] },
      { id: "ventes", nom: "Ventes et clients", droits: [V("ventes", "Ventes et clients", ["admin", "direction", "commercial", "caissier", "comptable"]), { id: "vente", l: "Créer des ventes", def: ["admin", "commercial", "caissier"] }, { id: "annulvente", l: "Annuler une vente", def: ["admin", "direction"] }, { id: "paiement", l: "Enregistrer des encaissements", def: ["admin", "caissier", "commercial"] }, { id: "relance", l: "Relancer les clients", def: ["admin", "commercial", "caissier", "comptable"] }, { id: "tiers", l: "Gérer clients et fournisseurs", def: ["admin", "commercial", "magasinier", "comptable"] }] },
      { id: "finance", nom: "Finance et comptabilité", droits: [V("tresor", "Caisse et trésorerie", ["admin", "direction", "caissier", "comptable"]), V("charges", "Charges", ["admin", "direction", "chef", "caissier", "comptable"]), V("finance", "Rentabilité", ["admin", "direction", "chef", "comptable"]), V("compta", "Comptabilité SYSCOHADA", ["admin", "direction", "comptable"]), { id: "charge", l: "Saisir des charges", def: ["admin", "chef", "comptable", "caissier"] }, { id: "treso", l: "Trésorerie", def: ["admin", "caissier", "comptable"] }, { id: "compta", l: "Comptabilité (écritures)", def: ["admin", "comptable"] }, { id: "plan", l: "Plan comptable", def: ["admin", "comptable"] }, { id: "extourne", l: "Extourner une écriture", def: ["admin", "comptable", "direction"] }, { id: "periode", l: "Clôturer une période", def: ["admin", "comptable", "direction"] }, { id: "visa", l: "Viser les écritures", def: ["admin", "comptable", "direction"] }] },
      { id: "caisse", nom: "Caisse", droits: [{ id: "caisse_op", l: "Opérations de caisse", def: ["admin", "caissier"] }, { id: "caisse_val", l: "Valider la caisse", def: ["admin", "direction"] }, { id: "caisse_cfg", l: "Régler la caisse", def: ["admin", "direction"] }] },
      { id: "perso", nom: "Personnel", droits: [V("rh", "Ressources humaines et paie", ["admin", "direction", "comptable"]), V("perso", "Personnel", ["admin", "direction", "chef"]), { id: "perso", l: "Fiches du personnel", def: ["admin", "direction", "chef"] }, { id: "rh", l: "Ressources humaines et paie", def: ["admin", "direction", "comptable"] }, { id: "rh_val", l: "Valider la paie et les congés", def: ["admin", "direction"] }] },
      { id: "admin", nom: "Administration", droits: [V("users", "Utilisateurs et audit", ["admin"]), V("params", "Paramétrage", ["admin", "direction"]), { id: "param", l: "Paramètres", def: ["admin", "direction"] }, { id: "users", l: "Utilisateurs et rôles", def: ["admin"], sensible: true }] }
    ]
  };
  var TRANSPORT = {
    nom: "Transport", externes: ["chauffeur"],
    roles: { admin: "Administrateur général", directeur: "Directeur / propriétaire", flotte: "Gestionnaire de flotte", caissier: "Caissier", comptable: "Comptable", controleur: "Contrôleur", chauffeur: "Chauffeur", transitaire: "Transitaire externe", importateur: "Responsable importation", stock_auto: "Gestionnaire de stock automobile", commercial_auto: "Commercial automobile" },
    actions: { v: "Consulter", c: "Créer", e: "Modifier", a: "Valider", x: "Annuler", p: "Exporter" },
    mods: { vehicules: "Véhicules", chauffeurs: "Chauffeurs", contrats: "Contrats", planning: "Planning", echeances: "Échéances", encaissements: "Encaissements", recus: "Reçus", caisse: "Caisse", depenses: "Dépenses", compta: "Comptabilité", plan: "Plan comptable", tiers: "Comptes tiers", etats: "États comptables", gps: "GPS", maintenance: "Maintenance", entretien: "Entretien préventif", pieces: "Pièces détachées", agenda: "Agenda atelier", sinistres: "Sinistres", documents: "Documents et alertes", rapports: "Rapports", users: "Utilisateurs et droits", audit: "Audit et paramètres", achats_veh: "Achats de véhicules", ventes_veh: "Ventes de véhicules", impexp: "Import-export", stock_veh: "Stock commercial", export_v2: "Export de produits", rh: "Ressources humaines et paie" },
    sensibles: ["users.c", "users.e", "users.x", "audit.e"]
  };
  TRANSPORT.modules = Object.keys(TRANSPORT.mods).map(function (m) { return { id: m, nom: TRANSPORT.mods[m], droits: Object.keys(TRANSPORT.actions).map(function (a) { return { id: m + "." + a, l: TRANSPORT.actions[a], court: true, sensible: TRANSPORT.sensibles.indexOf(m + "." + a) >= 0 }; }) }; });
  var CAT = { distribution: DIST, agro: AGRO, transport: TRANSPORT };

  /* ---------- Outils ---------- */
  function cat(app) { var c = CAT[app]; if (!c) throw new Error("Application inconnue"); return c; }
  function plat(app) { var o = []; cat(app).modules.forEach(function (m) { m.droits.forEach(function (d) { o.push(d); }); }); return o; }
  function externe(app, role) { return cat(app).externes.indexOf(role) >= 0; }
  function perso(S) { return Array.isArray(S.roles_perso) ? S.roles_perso : []; }
  function persoDe(S, id) { return perso(S).filter(function (r) { return r.id === id; })[0] || null; }
  function clef(roles, ext) { var s = {}; roles.forEach(function (r) { if (ext.indexOf(r) < 0) s[r] = 1; }); return Object.keys(s).sort().join("|"); }
  var memo = {};
  function table(app) {   /* ensemble de rôles → droit d'action (Distributions) */
    if (memo[app]) return memo[app]; var t = {}, ext = cat(app).externes;
    plat(app).forEach(function (d) { if (d.id.indexOf("v.") !== 0 && !d.hors) t[clef(d.def, ext)] = d.id; }); return (memo[app] = t);
  }
  function defSet(app, role) {
    var s = {}; plat(app).forEach(function (d) { if (role === "admin" || (d.def && d.def.indexOf(role) >= 0)) s[d.id] = 1; }); return s;
  }
  function transportSet(S, role) {
    var s = {}, p = (S.perms || {})[role] || {}; Object.keys(TRANSPORT.mods).forEach(function (m) { (p[m] || []).forEach(function (a) { s[m + "." + a] = 1; }); }); return s;
  }
  function toSet(o) { return o instanceof Set ? o : Array.isArray(o) ? new Set(o) : new Set(Object.keys(o)); }

  /* ---------- Lecture des droits ---------- */
  /* Droits modifiés ou personnalisés d'un rôle (Set), ou null si le rôle garde ses droits d'origine (Distributions, Agro). */
  function surcharge(app, S, role) {
    if (!S || !role || role === "admin") return null;
    var r = persoDe(S, role); if (r) return new Set(r.droits || []);
    var o = (S.droits_roles || {})[role]; return Array.isArray(o) ? new Set(o) : null;
  }
  function droits(app, S, role) {
    if (app === "transport") return toSet(transportSet(S, role));
    var s = surcharge(app, S, role); return s || toSet(defSet(app, role));
  }
  /* Un rôle a-t-il ce droit ? (admin : toujours ; rôle modifié ou personnalisé : sa liste ; sinon droits d'origine) */
  function a(app, S, role, atome) {
    if (role === "admin") return true;
    if (app === "transport") { var m = atome.split("."); return (((S.perms || {})[role] || {})[m[0]] || []).indexOf(m[1]) >= 0; }
    var s = surcharge(app, S, role); if (s) return s.has(atome);
    var d = plat(app).filter(function (x) { return x.id === atome; })[0]; return !!(d && d.def && d.def.indexOf(role) >= 0);
  }
  function atomeDe(app, roles) { return table(app)[clef(roles, cat(app).externes)] || null; }
  function listeRoles(app, S) {
    var c = cat(app), out = [];
    Object.keys(c.roles).forEach(function (id) { out.push({ id: id, nom: c.roles[id], perso: false, verrou: id === "admin" || externe(app, id), externe: externe(app, id), modifie: !!((S.droits_roles || {})[id]) }); });
    perso(S).forEach(function (r) { out.push({ id: r.id, nom: r.nom, desc: r.desc || "", perso: true, verrou: false }); });
    return out;
  }
  function libelle(app, S, id) { var r = persoDe(S, id); return r ? r.nom : (cat(app).roles[id] || id); }
  /* Ajoute / retire les rôles personnalisés dans l'objet ROLES de l'application (libellés). */
  function majRoles(app, S, ROLES) {
    Object.keys(ROLES).forEach(function (k) { if (k.indexOf("r_") === 0 && !persoDe(S, k)) delete ROLES[k]; });
    perso(S).forEach(function (r) { ROLES[r.id] = r.nom; });
  }

  /* ---------- Écriture ---------- */
  function nomValide(app, S, nom, sauf) {
    nom = String(nom || "").trim(); if (nom.length < 3) return "Le nom du rôle doit contenir au moins 3 caractères.";
    if (nom.length > 40) return "Le nom du rôle est trop long (40 caractères maximum).";
    var low = nom.toLowerCase(), pris = listeRoles(app, S).some(function (r) { return r.id !== sauf && String(r.nom).toLowerCase() === low; });
    return pris ? "Un rôle porte déjà ce nom." : null;
  }
  function aUneVue(app, set) {
    var ok = false; set.forEach(function (a) { if (app === "transport" ? /\.v$/.test(a) : a.indexOf("v.") === 0) ok = true; }); return ok;
  }
  function ecrireTransport(S, id, set) {
    S.perms = S.perms || {}; var p = S.perms[id] = S.perms[id] || {};
    Object.keys(TRANSPORT.mods).forEach(function (m) { p[m] = Object.keys(TRANSPORT.actions).filter(function (a) { return set.has(m + "." + a); }); });
  }
  function creer(app, S, o) {
    var e = nomValide(app, S, o.nom); if (e) throw new Error(e);
    var set = toSet(o.droits || []); if (!aUneVue(app, set)) throw new Error("Donnez au moins un droit de consultation : sans cela le rôle ne verrait rien.");
    S.roles_perso = perso(S).slice(); var a = new Uint8Array(4); G.crypto.getRandomValues(a);
    var r = { id: "r_" + Array.prototype.map.call(a, function (x) { return x.toString(16).padStart(2, "0"); }).join(""), nom: String(o.nom).trim(), desc: String(o.desc || "").trim().slice(0, 160), cree_le: new Date().toISOString() };
    if (app === "transport") ecrireTransport(S, r.id, set); else r.droits = Array.from(set).sort();
    S.roles_perso.push(r); return r;
  }
  function modifier(app, S, id, o) {
    var r = persoDe(S, id), set = toSet(o.droits || []);
    if (!aUneVue(app, set)) throw new Error("Donnez au moins un droit de consultation : sans cela le rôle ne verrait rien.");
    if (r) {
      var e = nomValide(app, S, o.nom, id); if (e) throw new Error(e);
      r.nom = String(o.nom).trim(); r.desc = String(o.desc || "").trim().slice(0, 160);
      if (app === "transport") ecrireTransport(S, id, set); else r.droits = Array.from(set).sort();
      S.roles_perso = perso(S).slice(); return r;
    }
    if (id === "admin" || externe(app, id) || !cat(app).roles[id]) throw new Error("Ce profil n'est pas modifiable.");
    if (app === "transport") ecrireTransport(S, id, set); else { S.droits_roles = Object.assign({}, S.droits_roles || {}); S.droits_roles[id] = Array.from(set).sort(); }
    return { id: id };
  }
  function utilisateursDe(S, id) { return (S.users || []).filter(function (u) { return u.role === id; }); }
  function supprimer(app, S, id) {
    var r = persoDe(S, id); if (!r) throw new Error("Seuls les rôles personnalisés se suppriment.");
    var u = utilisateursDe(S, id); if (u.length) throw new Error("Rôle utilisé par " + u.map(function (x) { return x.nom; }).slice(0, 5).join(", ") + (u.length > 5 ? "…" : "") + " : changez d'abord leur rôle.");
    S.roles_perso = perso(S).filter(function (x) { return x.id !== id; }); if (app === "transport" && S.perms) delete S.perms[id]; return r;
  }
  function retablir(app, S, id) {
    if (app === "transport") throw new Error("Transport : modifiez les cases pour revenir aux droits voulus.");
    if (!(S.droits_roles || {})[id]) return false; S.droits_roles = Object.assign({}, S.droits_roles); delete S.droits_roles[id]; return true;
  }

  /* ---------- Écran de gestion ---------- */
  var CSS = "#rl-ov{position:fixed;inset:0;z-index:100001;background:rgba(15,20,28,.74);display:flex;align-items:center;justify-content:center;padding:10px;font-family:Arial,sans-serif;color:#1c2430}" +
    "#rl-ov .bx{background:#fff;border-radius:14px;width:min(1040px,100%);max-height:96vh;display:flex;flex-direction:column;box-shadow:0 12px 44px rgba(0,0,0,.45);overflow:hidden}" +
    "#rl-ov header{padding:14px 18px;border-bottom:1px solid #dde3ea;display:flex;justify-content:space-between;align-items:center;gap:10px}#rl-ov h2{margin:0;font-size:18px}" +
    "#rl-ov .corps{display:flex;min-height:0;flex:1}#rl-ov .liste{width:250px;flex:none;border-right:1px solid #dde3ea;overflow:auto;padding:10px;background:#f6f8fa}" +
    "#rl-ov .ri{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;border-radius:9px;padding:9px 10px;margin:2px 0;cursor:pointer;font:600 14px Arial;color:#1c2430}#rl-ov .ri:hover{background:#e9eef3}#rl-ov .ri.on{background:#fff;border-color:#2563eb;color:#1d4ed8}#rl-ov .ri small{display:block;font:400 12px Arial;color:#64748b}" +
    "#rl-ov .det{flex:1;overflow:auto;padding:14px 18px}#rl-ov label{display:block;font-size:13px;font-weight:700;margin-top:10px}#rl-ov input[type=text],#rl-ov select{width:100%;font:15px Arial;padding:9px 10px;border:1.5px solid #b9c2cd;border-radius:8px;margin-top:4px;background:#fff;color:#1c2430;box-sizing:border-box}" +
    "#rl-ov .mod{border:1px solid #dde3ea;border-radius:10px;margin:12px 0;overflow:hidden}#rl-ov .mod>div:first-child{background:#eef2f6;padding:8px 12px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px}#rl-ov .mod .tt{font:600 12px Arial;color:#2563eb;cursor:pointer;background:none;border:0}" +
    "#rl-ov .dr{padding:6px 12px;display:flex;flex-wrap:wrap;gap:4px 18px}#rl-ov .dr label{display:flex;align-items:center;gap:7px;font-weight:400;font-size:14px;margin:3px 0;min-width:240px;flex:1 1 300px;cursor:pointer}#rl-ov .dr.c label{min-width:0;flex:0 0 auto;font-size:13px}#rl-ov .dr input{width:auto;margin:0}" +
    "#rl-ov .sens{color:#b3261e}#rl-ov footer{padding:12px 18px;border-top:1px solid #dde3ea;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center}" +
    "#rl-ov button.b{font:700 14px Arial;padding:10px 14px;border-radius:9px;border:1.5px solid #b9c2cd;background:#f3f5f8;color:#1c2430;cursor:pointer;min-height:42px}#rl-ov button.b.p{background:#1d4ed8;border-color:#1d4ed8;color:#fff}#rl-ov button.b.d{color:#b3261e;border-color:#b3261e;background:#fff}#rl-ov button.b:disabled{opacity:.5;cursor:default}" +
    "#rl-ov .msg{font-size:13px;font-weight:700;padding:8px 12px;border-radius:8px;margin:0 0 8px;background:#e3f5ea;color:#1b6e3d}#rl-ov .msg.er{background:#fde8e8;color:#b3261e}#rl-ov .note{font-size:12px;color:#64748b}" +
    "@media(max-width:700px){#rl-ov .corps{flex-direction:column}#rl-ov .liste{width:auto;border-right:0;border-bottom:1px solid #dde3ea;max-height:34vh}}";

  function ouvrir(o) {
    var app = o.app, c = cat(app), S0 = function () { return o.get(); };
    if (!document.getElementById("rl-css")) { var st = document.createElement("style"); st.id = "rl-css"; st.textContent = CSS; document.head.appendChild(st); }
    var old = document.getElementById("rl-ov"); if (old) old.remove();
    var ov = document.createElement("div"); ov.id = "rl-ov"; document.body.appendChild(ov);
    var sel = null, brouillon = null, dirty = false, msg = null;   /* sel : id du rôle affiché (null = nouveau) */
    function charger(id) {
      var S = S0();
      if (id === "+") { sel = null; brouillon = { nom: "", desc: "", droits: new Set(), copie: "" }; dirty = false; return; }
      sel = id; var r = persoDe(S, id), d = droits(app, S, id);
      brouillon = { nom: r ? r.nom : (c.roles[id] || id), desc: r ? (r.desc || "") : "", droits: new Set(d), copie: "" }; dirty = false;
    }
    function fin() { ov.remove(); document.removeEventListener("keydown", cle); }
    function cle(e) { if (e.key === "Escape") quitter(); }
    document.addEventListener("keydown", cle);
    function quitter() { if (dirty && !confirm("Des modifications ne sont pas enregistrées. Fermer quand même ?")) return; fin(); }
    function dessiner() {
      var S = S0(), L = listeRoles(app, S), role = sel ? L.filter(function (r) { return r.id === sel; })[0] : null, nouveau = sel === null, verrou = !!(role && role.verrou), perso_ = !!(role && role.perso);
      var nUt = sel ? utilisateursDe(S, sel).length : 0;
      var liste = L.filter(function (r) { return !r.externe; }).map(function (r) { return '<button type="button" class="ri' + (sel === r.id ? " on" : "") + '" data-r="' + E(r.id) + '">' + (r.verrou ? "🔒 " : r.perso ? "✎ " : "") + E(r.nom) + "<small>" + (r.perso ? "Rôle personnalisé" : r.verrou ? "Tous les droits (non modifiable)" : r.modifie ? "Droits d'origine modifiés" : "Rôle d'origine") + " · " + utilisateursDe(S, r.id).length + " utilisateur(s)</small></button>"; }).join("");
      var mods = c.modules.map(function (m) {
        var coches = m.droits.filter(function (d) { return brouillon.droits.has(d.id); }).length;
        return '<div class="mod"><div><span>' + E(m.nom) + ' <span class="note">(' + coches + "/" + m.droits.length + ")</span></span>" + (verrou ? "" : '<span><button type="button" class="tt" data-tout="' + E(m.id) + '">Tout cocher</button><button type="button" class="tt" data-rien="' + E(m.id) + '">Tout décocher</button></span>') + '</div><div class="dr' + (m.droits[0].court ? " c" : "") + '">' +
          m.droits.map(function (d) { return '<label><input type="checkbox" data-d="' + E(d.id) + '"' + (brouillon.droits.has(d.id) ? " checked" : "") + (verrou ? " disabled" : "") + "> " + (d.sensible ? '<span class="sens" title="Droit sensible">⚠ </span>' : "") + E(d.l) + "</label>"; }).join("") + "</div></div>";
      }).join("");
      var copie = nouveau ? '<label>Partir des droits de<select data-copie><option value="">— aucun droit au départ —</option>' + L.filter(function (r) { return !r.externe; }).map(function (r) { return '<option value="' + E(r.id) + '"' + (brouillon.copie === r.id ? " selected" : "") + ">" + E(r.nom) + "</option>"; }).join("") + "</select></label>" : "";
      ov.innerHTML = '<div class="bx" role="dialog" aria-modal="true" aria-label="Rôles et droits"><header><h2>🛡️ Rôles et droits — ' + E(o.nomApp || c.nom) + '</h2><button type="button" class="b" data-x>✕ Fermer</button></header><div class="corps"><div class="liste"><button type="button" class="b p" style="width:100%;margin-bottom:8px" data-r="+">➕ Nouveau rôle</button>' + liste + '<p class="note">Les profils rattachés à une fiche (livreur, vendeur, chauffeur) se gèrent dans leur application.</p></div><div class="det">' +
        (msg ? '<p class="msg' + (msg.er ? " er" : "") + '" role="status">' + E(msg.t) + "</p>" : "") +
        '<label>Nom du rôle<input type="text" data-nom value="' + E(brouillon.nom) + '" maxlength="40"' + (perso_ || nouveau ? "" : " disabled") + ' placeholder="Ex. Chef d\'équipe"></label>' + ((perso_ || nouveau) ? '<label>Description (facultative)<input type="text" data-desc value="' + E(brouillon.desc) + '" maxlength="160"></label>' : "") + copie +
        (verrou ? '<p class="note">Ce profil a tous les droits et ne peut pas être modifié.</p>' : '<p class="note">Cochez ce que ce rôle peut voir et faire. Le droit « ⚠ » est sensible. Les changements s\'appliquent à la prochaine connexion de chaque utilisateur concerné.</p>') + mods + "</div></div><footer>" +
        (nUt ? '<span class="note" style="margin-right:auto">' + nUt + " utilisateur(s) ont ce rôle.</span>" : "") +
        (perso_ ? '<button type="button" class="b d" data-del>🗑 Supprimer ce rôle</button>' : "") + (role && !role.perso && role.modifie && app !== "transport" ? '<button type="button" class="b" data-retab>↩ Rétablir les droits d\'origine</button>' : "") +
        (verrou ? "" : '<button type="button" class="b p" data-save' + (dirty || nouveau ? "" : " disabled") + ">💾 Enregistrer</button>") + "</footer></div>";
    }
    function lireChamps() { var n = ov.querySelector("[data-nom]"), d = ov.querySelector("[data-desc]"); if (n && !n.disabled) brouillon.nom = n.value; if (d) brouillon.desc = d.value; }
    function appliquerCopie(id) { if (!id) { brouillon.droits = new Set(); } else brouillon.droits = new Set(droits(app, S0(), id)); brouillon.copie = id; }
    ov.addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      if (t.hasAttribute("data-x")) return quitter();
      if (t.dataset.r !== undefined) { lireChamps(); if (dirty && !confirm("Abandonner les modifications non enregistrées ?")) return; msg = null; charger(t.dataset.r); return dessiner(); }
      if (t.dataset.tout !== undefined || t.dataset.rien !== undefined) { lireChamps(); var m = c.modules.filter(function (x) { return x.id === (t.dataset.tout || t.dataset.rien); })[0]; m.droits.forEach(function (d) { if (t.dataset.tout !== undefined) brouillon.droits.add(d.id); else brouillon.droits.delete(d.id); }); dirty = true; return dessiner(); }
      if (t.hasAttribute("data-save")) { lireChamps(); return enregistrer(); }
      if (t.hasAttribute("data-del")) { var S = S0(), r = persoDe(S, sel); if (!r || !confirm("Supprimer le rôle « " + r.nom + " » ?")) return; try { supprimer(app, S, sel); if (o.audit) o.audit("Rôle supprimé", r.nom); o.persister(); if (o.apres) o.apres(); msg = { t: "Rôle « " + r.nom + " » supprimé." }; var prem = listeRoles(app, S0())[0]; charger(prem.id); } catch (x) { msg = { t: x.message, er: 1 }; } return dessiner(); }
      if (t.hasAttribute("data-retab")) { if (!confirm("Rétablir les droits d'origine de « " + libelle(app, S0(), sel) + " » ?")) return; retablir(app, S0(), sel); if (o.audit) o.audit("Droits d'origine rétablis", libelle(app, S0(), sel)); o.persister(); if (o.apres) o.apres(); msg = { t: "Droits d'origine rétablis." }; charger(sel); dessiner(); }
    });
    ov.addEventListener("change", function (e) {
      var t = e.target; if (t.dataset.d !== undefined) { lireChamps(); if (t.checked) { var sens = plat(app).filter(function (d) { return d.id === t.dataset.d; })[0]; if (sens && sens.sensible && !confirm("Droit sensible : « " + sens.l + " ». L'accorder à ce rôle ?")) { t.checked = false; return; } brouillon.droits.add(t.dataset.d); } else brouillon.droits.delete(t.dataset.d); dirty = true; var b = ov.querySelector("[data-save]"); if (b) b.disabled = false; return; }
      if (t.hasAttribute("data-copie")) { lireChamps(); appliquerCopie(t.value); dirty = true; dessiner(); }
    });
    ov.addEventListener("input", function (e) { if (e.target.hasAttribute("data-nom") || e.target.hasAttribute("data-desc")) { dirty = true; var b = ov.querySelector("[data-save]"); if (b) b.disabled = false; } });
    function enregistrer() {
      var S = S0();
      try {
        if (sel === null) {
          var r = creer(app, S, { nom: brouillon.nom, desc: brouillon.desc, droits: brouillon.droits }); if (o.audit) o.audit("Rôle créé", r.nom + " (" + brouillon.droits.size + " droits)"); o.persister(); msg = { t: "Rôle « " + r.nom + " » créé." }; if (o.apres) o.apres(); charger(r.id);
        } else {
          var avant = libelle(app, S, sel); modifier(app, S, sel, { nom: brouillon.nom, desc: brouillon.desc, droits: brouillon.droits }); if (o.audit) o.audit("Droits du rôle modifiés", avant + " (" + brouillon.droits.size + " droits)"); o.persister(); msg = { t: "Rôle « " + libelle(app, S, sel) + " » enregistré." }; if (o.apres) o.apres(); charger(sel);
        }
      } catch (x) { msg = { t: x.message, er: 1 }; }
      dessiner();
    }
    var prem = listeRoles(app, S0()).filter(function (r) { return !r.externe; })[0]; charger(o.role || (prem ? prem.id : "+")); dessiner();
    setTimeout(function () { var b = ov.querySelector(".ri.on") || ov.querySelector("button"); if (b) b.focus(); }, 30);
    return { fermer: fin };
  }

  G.ANGELS_ROLES = { a: a, CAT: CAT, droits: droits, surcharge: surcharge, atomeDe: atomeDe, roles: listeRoles, libelle: libelle, majRoles: majRoles, creer: creer, modifier: modifier, supprimer: supprimer, retablir: retablir, utilisateursDe: utilisateursDe, nomValide: nomValide, ouvrir: ouvrir, atomes: plat, defSet: defSet };
})(window);
