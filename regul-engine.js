/* LOGISTICA — moteur commun des régularisations de fin de période (cut-off) : charges constatées d'avance (CCA), produits constatés d'avance (PCA),
   factures non parvenues (FNP) et factures à établir (FAE). Modèle : arrêtés mensuels / annuels de Menko immo, avec écriture d'arrêté ET extourne au lendemain.
   Le moteur calcule la quote-part à reporter (prorata temporis), propose les écritures en BROUILLARD (jamais comptabilisées seules : elles passent par le visa de la division)
   et suit ce qui reste à faire (génération, visa de l'arrêté, visa de l'extourne). Les montants s'entendent hors taxes.

   Contrat de l'hôte (host) :
     division : "distribution" | "transport" | "agro" ; can(a) : "v" consulter, "c" saisir / générer, "p" imprimer ; user() ; identite() ; render() ; util.fcfa ; audit(a, d) ; run(fn) : exécute fn avec sauvegarde / annulation
     store.get() / store.set(obj) : registre des régularisations stocké par l'hôte ({items:[…]})
     brouillard({date, journal, piece, libelle, lignes:[{compte, debit, credit}]}) ; brouillardEnAttente(prefixePiece) : bool ; soldeCompte(compte) : crédit − débit
     compteOk(compte) : "" si le compte est imputable au plan de la division, sinon le message d'erreur ; clos() : dernière date clôturée ("" si aucune)
   Facultatif : charges(from, to) : [{date, compte, piece, libelle, montant}] charges (classe 6) comptabilisées, pour proposer les charges payées d'avance */
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
  var finMois = function (d) { var y = +d.slice(0, 4), m = +d.slice(5, 7); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  var UIS = { arret: "" };

  /* Types : compte de gestion attendu (classe), compte de régularisation par défaut, sens des écritures */
  var TYPES = {
    cca: { lib: "Charge constatée d'avance", court: "CCA", classe: "6", reg: "476", prorata: true, aide: "Charge déjà comptabilisée dont une partie concerne la période suivante (assurance, loyer, abonnement…)." },
    pca: { lib: "Produit constaté d'avance", court: "PCA", classe: "7", reg: "477", prorata: true, aide: "Produit déjà comptabilisé dont une partie concerne la période suivante (abonnement, loyer perçu d'avance…)." },
    fnp: { lib: "Facture non parvenue", court: "FNP", classe: "6", reg: "4081", prorata: false, aide: "Service reçu ou livraison faite avant l'arrêté, facture du fournisseur pas encore reçue." },
    fae: { lib: "Facture à établir", court: "FAE", classe: "7", reg: "4181", prorata: false, aide: "Prestation rendue ou livraison faite avant l'arrêté, facture client pas encore émise." }
  };
  /* Lignes de l'écriture d'arrêté : [compte, sens] ; l'extourne est l'inverse */
  var SENS = { cca: [["reg", "D"], ["cpt", "C"]], pca: [["cpt", "D"], ["reg", "C"]], fnp: [["cpt", "D"], ["reg", "C"]], fae: [["reg", "D"], ["cpt", "C"]] };
  /* Effet sur le résultat de l'arrêté (avant extourne) : + produit, − charge */
  var EFFET = { cca: 1, pca: -1, fnp: -1, fae: 1 };

  /* ---------- Registre ---------- */
  function lireStore() { var s = {}; try { s = (H.store && H.store.get()) || {}; } catch (e) { s = {}; } return { items: Array.isArray(s.items) ? s.items : [] }; }
  function ecrireStore(st) { if (!H.store) throw new Error("Cette division ne permet pas d'enregistrer les régularisations."); H.store.set(JSON.parse(JSON.stringify(st))); }
  function items() { return lireStore().items; }
  function uid() { return "rg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clos() { try { return (H.clos && H.clos()) || ""; } catch (e) { return ""; } }

  /* Quote-part à reporter après l'arrêté : prorata temporis des jours (bornes comprises) */
  function part(it, arret) {
    arret = arret || it.arret;
    if (!TYPES[it.type].prorata) return { part: R(it.montant), jours: 0, total: 0 };
    var total = diffJ(it.fin, it.debut) + 1, apres = arret < it.debut ? total : Math.max(0, Math.min(total, diffJ(it.fin, arret)));
    return { part: total > 0 ? R(it.montant * apres / total) : 0, jours: apres, total: total };
  }

  function valider(f, ancien) {
    var t = TYPES[f.type]; if (!t) throw new Error("Type de régularisation inconnu.");
    f.libelle = String(f.libelle || "").trim(); if (!f.libelle) throw new Error("Libellé obligatoire.");
    f.compte = String(f.compte || "").trim(); f.reg = String(f.reg || t.reg).trim();
    if (!/^\d{3,8}$/.test(f.compte)) throw new Error("Compte de " + (t.classe === "6" ? "charge" : "produit") + " invalide.");
    if (f.compte[0] !== t.classe) throw new Error("Le compte " + f.compte + " n'est pas un compte de " + (t.classe === "6" ? "charges (classe 6)" : "produits (classe 7)") + ".");
    if (!/^4\d{2,7}$/.test(f.reg)) throw new Error("Le compte de régularisation doit être un compte de tiers (classe 4) : " + f.reg + ".");
    [f.compte, f.reg].forEach(function (c) { var er = H.compteOk ? H.compteOk(c) : ""; if (er) throw new Error(er); });
    f.montant = R(+f.montant || 0); if (!(f.montant > 0)) throw new Error("Montant invalide : il doit être supérieur à zéro.");
    if (!validDate(f.arret)) throw new Error("Date d'arrêté invalide.");
    if (f.arret > today()) throw new Error("La date d'arrêté ne peut pas être dans le futur.");
    var c = clos(); if (c && f.arret <= c) throw new Error("Période clôturée jusqu'au " + fd(c) + " : choisissez un arrêté postérieur.");
    if (t.prorata) {
      if (!validDate(f.debut) || !validDate(f.fin)) throw new Error("Période couverte : dates de début et de fin obligatoires.");
      if (f.fin < f.debut) throw new Error("La fin de période couverte est antérieure à son début.");
      if (part(f, f.arret).part <= 0) throw new Error("Rien à reporter : la période couverte se termine au plus tard à la date d'arrêté.");
    }
    return f;
  }
  function champs(f) { return { type: f.type, libelle: f.libelle, compte: f.compte, reg: f.reg, montant: f.montant, debut: TYPES[f.type].prorata ? f.debut : "", fin: TYPES[f.type].prorata ? f.fin : "", arret: f.arret, tiers: String(f.tiers || "").trim(), src: String(f.src || "") }; }
  function ajouter(f) {
    if (!H.can("c")) throw new Error("Droits insuffisants pour saisir une régularisation.");
    f = valider(Object.assign({}, f)); var st = lireStore(), it = Object.assign({ id: uid(), statut: "a_generer", cree_par: H.user(), cree_le: new Date().toISOString() }, champs(f));
    st.items.push(it); ecrireStore(st); if (H.audit) H.audit("Régularisation ajoutée", TYPES[it.type].court + " — " + it.libelle + " — " + fcfa(it.montant)); return it;
  }
  function modifier(id, f) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var st = lireStore(), i = st.items.findIndex(function (x) { return x.id === id; }); if (i < 0) throw new Error("Régularisation introuvable.");
    if (st.items[i].statut !== "a_generer") throw new Error("Cette régularisation est déjà générée : supprimez le brouillard puis remettez-la à générer avant de la modifier.");
    f = valider(Object.assign({}, f)); st.items[i] = Object.assign(st.items[i], champs(f)); ecrireStore(st); if (H.audit) H.audit("Régularisation modifiée", st.items[i].libelle); return st.items[i];
  }
  function supprimer(id) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var st = lireStore(), it = st.items.find(function (x) { return x.id === id; }); if (!it) throw new Error("Régularisation introuvable.");
    if (it.statut === "genere") throw new Error("Cette régularisation est déjà générée en brouillard : supprimez d'abord le brouillard (Comptabilité → Saisie & visa), puis remettez-la à générer.");
    st.items = st.items.filter(function (x) { return x.id !== id; }); ecrireStore(st); if (H.audit) H.audit("Régularisation supprimée", it.libelle);
  }
  function remettre(id) {
    if (!H.can("c")) throw new Error("Droits insuffisants."); var st = lireStore(), it = st.items.find(function (x) { return x.id === id; }); if (!it || it.statut !== "genere") throw new Error("Régularisation introuvable ou non générée.");
    if (H.brouillardEnAttente && (H.brouillardEnAttente(it.pieces.arret) || H.brouillardEnAttente(it.pieces.ext))) throw new Error("Les brouillards " + it.pieces.arret + " / " + it.pieces.ext + " sont encore en attente : supprimez-les d'abord (Comptabilité → Saisie & visa).");
    it.statut = "a_generer"; delete it.pieces; delete it.genere_le; delete it.part_gen; ecrireStore(st); if (H.audit) H.audit("Régularisation remise à générer", it.libelle);
  }

  /* ---------- Génération des écritures (brouillard) ---------- */
  function pieceDe(arret) { return "REG-" + arret.replace(/-/g, ""); }
  function pieceExt(arret) { return "REGX-" + arret.replace(/-/g, ""); }
  function lignesDe(its, inverse) {
    var M = {}, ordre = [];
    its.forEach(function (x) {
      SENS[x.it.type].forEach(function (s) {
        var c = s[0] === "reg" ? x.it.reg : x.it.compte, d = (s[1] === "D") !== !!inverse; if (!M[c]) { M[c] = { compte: c, debit: 0, credit: 0 }; ordre.push(c); }
        if (d) M[c].debit += x.part; else M[c].credit += x.part;
      });
    });
    return ordre.map(function (c) { var l = M[c], n = l.debit - l.credit; return { compte: c, debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0 }; }).filter(function (l) { return l.debit || l.credit; });
  }
  function generer(arret) {
    if (!H.brouillard) throw new Error("Cette division ne permet pas de générer les écritures depuis cet écran.");
    if (!H.can("c")) throw new Error("Droits insuffisants pour créer des écritures en brouillard.");
    if (!validDate(arret)) throw new Error("Date d'arrêté invalide."); if (arret > today()) throw new Error("La date d'arrêté ne peut pas être dans le futur.");
    var c = clos(); if (c && arret <= c) throw new Error("Période clôturée jusqu'au " + fd(c) + ".");
    var st = lireStore(), cand = st.items.filter(function (x) { return x.statut === "a_generer" && x.arret === arret; });
    if (!cand.length) throw new Error("Aucune régularisation à générer pour l'arrêté du " + fd(arret) + ".");
    if (H.brouillardEnAttente && (H.brouillardEnAttente(pieceDe(arret)) || H.brouillardEnAttente(pieceExt(arret)))) throw new Error("Des écritures de régularisation du " + fd(arret) + " sont déjà en attente de visa : visez-les ou supprimez-les avant d'en créer d'autres.");
    var ok = [], neant = [];
    cand.forEach(function (it) { var p = part(it, arret); if (p.part > 0) ok.push({ it: it, part: p.part }); else neant.push(it); });
    if (!ok.length) throw new Error("Aucune quote-part à reporter pour l'arrêté du " + fd(arret) + " (période couverte échue).");
    var A = lignesDe(ok, false), X = lignesDe(ok, true), nb = ok.length + " régularisation(s)";
    var oA = { date: arret, journal: "OD", piece: pieceDe(arret), libelle: "Régularisations de fin de période au " + fd(arret) + " (" + nb + ")", lignes: A };
    var oX = { date: addJ(arret, 1), journal: "OD", piece: pieceExt(arret), libelle: "Extourne des régularisations du " + fd(arret) + " (" + nb + ")", lignes: X };
    H.brouillard(oA); H.brouillard(oX);
    ok.forEach(function (x) { x.it.statut = "genere"; x.it.genere_le = new Date().toISOString(); x.it.part_gen = x.part; x.it.pieces = { arret: oA.piece, ext: oX.piece }; });
    neant.forEach(function (it) { it.statut = "neant"; });
    ecrireStore(st); if (H.audit) H.audit("Régularisations : écritures en brouillard", fd(arret) + " — " + nb + " — " + fcfa(ok.reduce(function (s, x) { return s + x.part; }, 0)));
    return { arret: oA, extourne: oX, nb: ok.length, neant: neant.length };
  }

  /* ---------- Synthèse, contrôles, publication ---------- */
  function effet(its) { return its.reduce(function (s, it) { return s + EFFET[it.type] * part(it).part; }, 0); }
  function synthese() {
    var its = items(), t = today(), actifs = its.filter(function (x) { return x.statut !== "neant"; });
    var par = {}; Object.keys(TYPES).forEach(function (k) { par[k] = { nb: 0, montant: 0 }; });
    actifs.forEach(function (x) { par[x.type].nb++; par[x.type].montant += part(x).part; });
    var arrets = {}; actifs.forEach(function (x) { (arrets[x.arret] = arrets[x.arret] || []).push(x); });
    var alertes = [];
    Object.keys(arrets).sort().forEach(function (a) {
      var L = arrets[a], pend = L.filter(function (x) { return x.statut === "a_generer"; }), gen = L.filter(function (x) { return x.statut === "genere"; });
      if (pend.length) alertes.push({ niveau: "wa", arret: a, txt: pend.length + " régularisation(s) de l'arrêté du " + fd(a) + " à générer en brouillard." });
      if (gen.length) {
        if (H.brouillardEnAttente && H.brouillardEnAttente(pieceDe(a))) alertes.push({ niveau: "wa", arret: a, txt: "Écriture d'arrêté du " + fd(a) + " en attente de visa (pièce " + pieceDe(a) + ")." });
        if (H.brouillardEnAttente && H.brouillardEnAttente(pieceExt(a))) alertes.push({ niveau: addJ(a, 1) <= t ? "er" : "mu", arret: a, txt: "Extourne du " + fd(addJ(a, 1)) + " en attente de visa (pièce " + pieceExt(a) + ")" + (addJ(a, 1) <= t ? " : sa date est atteinte, visez-la pour restituer le solde des comptes de régularisation." : " : à viser à partir du " + fd(addJ(a, 1)) + ".") });
      }
    });
    var cb = {}; actifs.forEach(function (x) { cb[x.reg] = 1; });
    var comptes = Object.keys(cb).sort().map(function (c) { var s = 0; try { s = R(H.soldeCompte ? H.soldeCompte(c) : 0); } catch (e) { s = 0; } return { compte: c, solde: s }; });
    return { nb: actifs.length, par: par, effet: effet(actifs.filter(function (x) { return x.statut === "a_generer"; })), effetGenere: effet(actifs.filter(function (x) { return x.statut === "genere"; })), alertes: alertes, arrets: Object.keys(arrets).sort(), comptes: comptes,
      aGenerer: actifs.filter(function (x) { return x.statut === "a_generer"; }).length };
  }
  function publier(host) {
    if (host) H = host; try {
      if (!H.can("v")) return null; var s = synthese(), r = { t: new Date().toISOString(), division: H.division, nb: s.nb, a_generer: s.aGenerer, alertes: s.alertes.filter(function (a) { return a.niveau !== "mu"; }).length, retard: s.alertes.filter(function (a) { return a.niveau === "er"; }).length, cca: s.par.cca.montant, pca: s.par.pca.montant, fnp: s.par.fnp.montant, fae: s.par.fae.montant, effet: s.effet + s.effetGenere };
      localStorage.setItem("logistica_regul_" + H.division, JSON.stringify(r)); return r;
    } catch (e) { return null; }
  }

  /* ---------- Charges susceptibles d'être payées d'avance ---------- */
  var MOTS = /assurance|loyer|abonnement|licence|vignette|visite technique|maintenance|location|redevance|cotisation|souscription|garantie|hebergement|hébergement|domaine/i;
  function candidats() {
    if (!H.charges) return []; var t = today(), L = []; try { L = H.charges(addJ(t, -400), t) || []; } catch (e) { L = []; }
    var vus = {}; items().forEach(function (x) { if (x.src) vus[x.src] = 1; });
    return L.filter(function (x) { return MOTS.test(x.libelle || "") && x.montant >= 10000 && !vus[x.piece || x.libelle]; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 12);
  }

  /* ---------- Affichage ---------- */
  var CSS = ".rg-w{overflow:auto}.rg-w table{width:100%;border-collapse:collapse;font-size:13px}.rg-w th,.rg-w td{border-bottom:1px solid var(--bd,#d5dbe3);padding:6px 8px;text-align:left;vertical-align:top}.rg-w th{font-size:12px;color:var(--mu,#5b6572);white-space:nowrap}.rg-w td.n,.rg-w th.n{text-align:right;white-space:nowrap}" +
    ".rg-b{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd,#d5dbe3);background:var(--card,#fff);color:var(--tx,#1c2430);cursor:pointer}.rg-b.p{background:var(--b2,#1f3a5f);color:#fff;border-color:var(--b2,#1f3a5f)}.rg-b.sm{padding:3px 8px;font-size:12px}" +
    ".rg-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0}.rg-k div{border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:9px 11px;background:var(--card,#fff)}.rg-k b{display:block;font-size:17px}.rg-k span{font-size:12px;color:var(--mu,#5b6572)}" +
    ".rg-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:8px 0}.rg-bar label{font-size:12px;color:var(--mu,#5b6572);display:block}.rg-bar input,.rg-bar select{font:inherit;padding:7px;border:1px solid var(--bd,#d5dbe3);border-radius:8px;background:var(--bg,#fff);color:var(--tx,#1c2430)}" +
    ".rg-n{background:var(--card,#fff);border:1px solid var(--bd,#d5dbe3);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:13px;color:var(--mu,#5b6572)}.rg-n.wa{border-left:4px solid #b26a00;color:#b26a00}.rg-n.er{border-left:4px solid #b3261e;color:#b3261e}.rg-n.ok{border-left:4px solid #1f8a4c;color:#1f8a4c}.rg-bd{display:inline-block;border-radius:99px;padding:1px 8px;font-size:12px;border:1px solid var(--bd,#d5dbe3)}.rg-bd.ok{border-color:#1f8a4c;color:#1f8a4c}.rg-bd.wa{border-color:#b26a00;color:#b26a00}";
  function css() { if (document.getElementById("rg-css")) return; var s = document.createElement("style"); s.id = "rg-css"; s.textContent = CSS; document.head.appendChild(s); }
  var kpi = function (v, l) { return "<div><b>" + v + "</b><span>" + esc(l) + "</span></div>"; };
  var btn = function (a, id, l, c) { return '<button type="button" class="rg-b ' + (c || "") + '" data-rg="' + a + '" data-id="' + esc(id == null ? "" : id) + '">' + l + "</button>"; };
  var num = function (v) { return v < 0 ? "(" + fcfa(-v) + ")" : fcfa(v); };
  function arretDefaut() { var t = today(), d = finMois(addJ(t.slice(0, 8) + "01", -1)); var c = clos(); return c && d <= c ? finMois(addJ(c, 1)) <= t ? finMois(addJ(c, 1)) : t : d; }
  function vue() {
    var S = synthese(), its = items().filter(function (x) { return x.statut !== "neant"; }), w = H.can("c");
    if (!UIS.arret) UIS.arret = arretDefaut();
    var h = '<div class="rg-root"><div class="rg-n">Régularisations de fin de période : les charges et produits sont rattachés à la bonne période (<b>cut-off</b>). Chaque arrêté produit deux écritures en <b>brouillard</b> : l\'écriture d\'arrêté (à la date d\'arrêté) et son <b>extourne</b> (au lendemain). Elles n\'affectent la comptabilité qu\'après visa.</div>';
    h += '<div class="rg-k">' + kpi(S.nb, "Régularisations suivies") + kpi(fcfa(S.par.cca.montant), "Charges constatées d'avance") + kpi(fcfa(S.par.pca.montant), "Produits constatés d'avance") + kpi(fcfa(S.par.fnp.montant), "Factures non parvenues") + kpi(fcfa(S.par.fae.montant), "Factures à établir") + kpi(num(S.effet + S.effetGenere), "Incidence sur le résultat des arrêtés") + "</div>";
    S.alertes.forEach(function (a) { h += '<div class="rg-n ' + (a.niveau === "mu" ? "" : a.niveau) + '">' + esc(a.txt) + "</div>"; });
    if (!S.alertes.length && S.nb) h += '<div class="rg-n ok">Aucune action en attente : les arrêtés sont générés et visés.</div>';
    h += '<div class="rg-bar">' + (w ? '<div><label>Date d\'arrêté</label><input type="date" data-rgf="arret" value="' + esc(UIS.arret) + '" max="' + today() + '"></div>' + btn("add", "", "➕ Nouvelle régularisation", "p") + btn("gen", "", "📝 Générer les écritures de l'arrêté") : "") + (H.can("p") ? btn("print", "", "🖨 Imprimer l'état") : "") + "</div>";
    var rows = its.sort(function (a, b) { return a.arret < b.arret ? 1 : a.arret > b.arret ? -1 : a.libelle.localeCompare(b.libelle); }).map(function (x) {
      var p = part(x), t = TYPES[x.type], st = x.statut === "genere" ? '<span class="rg-bd ok">Généré</span>' : '<span class="rg-bd wa">À générer</span>';
      return "<tr><td>" + fd(x.arret) + "</td><td>" + t.court + "</td><td>" + esc(x.libelle) + (x.tiers ? "<br><small>" + esc(x.tiers) + "</small>" : "") + "</td><td>" + esc(x.compte) + " → " + esc(x.reg) + "</td><td>" + (t.prorata ? fd(x.debut) + " → " + fd(x.fin) + "<br><small>" + p.jours + " j sur " + p.total + "</small>" : "—") + '</td><td class="n">' + fcfa(x.montant) + '</td><td class="n"><b>' + fcfa(p.part) + "</b></td><td>" + st + (x.pieces ? "<br><small>" + esc(x.pieces.arret) + " / " + esc(x.pieces.ext) + "</small>" : "") + "</td><td>" +
        (w ? (x.statut === "a_generer" ? btn("edit", x.id, "✎", "sm") + " " + btn("del", x.id, "🗑", "sm") : btn("reset", x.id, "↺ Remettre à générer", "sm")) : "") + "</td></tr>";
    });
    h += '<div class="rg-w"><table><thead><tr><th>Arrêté</th><th>Type</th><th>Libellé</th><th>Comptes</th><th>Période couverte</th><th class="n">Montant</th><th class="n">À reporter</th><th>État</th><th></th></tr></thead><tbody>' + (rows.length ? rows.join("") : '<tr><td colspan="9" style="color:var(--mu,#5b6572)">Aucune régularisation. Ajoutez-en une, ou partez des charges proposées ci-dessous.</td></tr>') + "</tbody></table></div>";
    var C = candidats();
    if (w && C.length) h += '<h3 style="margin:16px 0 4px;font-size:15px">Charges peut-être payées d\'avance</h3><div class="rg-n">Charges des 13 derniers mois dont le libellé évoque une assurance, un loyer ou un abonnement. Vérifiez la période couverte avant de régulariser.</div><div class="rg-w"><table><thead><tr><th>Date</th><th>Pièce</th><th>Libellé</th><th>Compte</th><th class="n">Montant</th><th></th></tr></thead><tbody>' +
      C.map(function (x, i) { return "<tr><td>" + fd(x.date) + "</td><td>" + esc(x.piece || "") + "</td><td>" + esc(x.libelle) + "</td><td>" + esc(x.compte) + '</td><td class="n">' + fcfa(x.montant) + "</td><td>" + btn("cand", i, "Régulariser", "sm") + "</td></tr>"; }).join("") + "</tbody></table></div>";
    if (S.comptes.length) h += '<h3 style="margin:16px 0 4px;font-size:15px">Soldes des comptes de régularisation</h3><div class="rg-w"><table><thead><tr><th>Compte</th><th class="n">Solde comptable (crédit − débit)</th></tr></thead><tbody>' + S.comptes.map(function (c) { return "<tr><td>" + esc(c.compte) + '</td><td class="n">' + num(c.solde) + "</td></tr>"; }).join("") + '</tbody></table></div><div class="rg-n">Après visa de l\'extourne, ces comptes retrouvent un solde nul jusqu\'au prochain arrêté. Un solde qui persiste signale une extourne non visée.</div>';
    h += '<div class="rg-n">Montants hors taxes. Une charge à payer (congés, intérêts courus…) se traite comme une facture non parvenue en choisissant le compte de régularisation adapté (4281, 4486…). À valider par votre expert-comptable.</div></div>';
    return h;
  }
  function view(host) { H = host; css(); G.LOGISTICA_REGUL.host = host; if (!H.can("v")) return '<div class="rg-n">Accès aux régularisations non autorisé pour votre profil.</div>'; return vue(); }

  /* ---------- Impression ---------- */
  function imprimer() {
    if (!G.LOGISTICA_PRINT) { alert("Moteur d'impression indisponible."); return; } if (!H.can("p")) { alert("Droits insuffisants pour imprimer."); return; }
    var S = synthese(), its = items().filter(function (x) { return x.statut !== "neant"; }).sort(function (a, b) { return a.arret < b.arret ? -1 : 1; }), ref = "REG-" + today().replace(/-/g, "");
    var rows = its.map(function (x) { var t = TYPES[x.type], p = part(x); return "<tr><td>" + fd(x.arret) + "</td><td>" + t.court + "</td><td>" + esc(x.libelle) + "</td><td>" + esc(x.compte + " → " + x.reg) + "</td><td>" + (t.prorata ? fd(x.debut) + " → " + fd(x.fin) : "—") + '</td><td class="n">' + fcfa(x.montant) + '</td><td class="n">' + fcfa(p.part) + "</td><td>" + (x.statut === "genere" ? "Généré" : "À générer") + "</td></tr>"; });
    G.LOGISTICA_PRINT.ouvrir({ division: H.division, emetteur: H.user(), fallback: H.identite ? H.identite() : null, titre: "État des régularisations de fin de période", ref: ref, date: today(), montant: S.effet + S.effetGenere, paysage: true,
      corps: '<p class="sub">Charges constatées d\'avance ' + fcfa(S.par.cca.montant) + " · Produits constatés d'avance " + fcfa(S.par.pca.montant) + " · Factures non parvenues " + fcfa(S.par.fnp.montant) + " · Factures à établir " + fcfa(S.par.fae.montant) + " · Incidence sur le résultat " + num(S.effet + S.effetGenere) + '.</p><table><thead><tr><th>Arrêté</th><th>Type</th><th>Libellé</th><th>Comptes</th><th>Période couverte</th><th class="n">Montant</th><th class="n">À reporter</th><th>État</th></tr></thead><tbody>' + rows.join("") + '</tbody></table><p class="sub" style="margin-top:8px">Montants hors taxes. Écritures en brouillard, comptabilisées après visa ; chaque arrêté est extourné au lendemain. À valider par l\'expert-comptable.</p>' }).catch(function (e) { alert("Impression impossible : " + e.message); });
    if (H.audit) H.audit("État des régularisations imprimé", String(S.nb));
  }

  /* ---------- Formulaires ---------- */
  function form(titre, champs, init, onSave, ok, aide) {
    var ov = document.createElement("div"); ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,20,28,.6);z-index:9990;display:flex;align-items:center;justify-content:center;padding:12px");
    var f = champs.map(function (x) { var v = init && init[x.k] != null ? init[x.k] : "", inp = x.t === "select" ? '<select name="' + x.k + '">' + x.o.map(function (y) { return '<option value="' + esc(y[0]) + '" ' + (String(y[0]) === String(v) ? "selected" : "") + ">" + esc(y[1]) + "</option>"; }).join("") + "</select>" : '<input name="' + x.k + '" type="' + (x.t || "text") + '" ' + (x.t === "number" ? 'step="1" min="0"' : "") + ' value="' + esc(v) + '" autocomplete="off">';
      return '<label style="display:block;font-size:13px;margin:8px 0;color:var(--mu,#5b6572)" data-rgrow="' + x.k + '">' + esc(x.l) + inp + "</label>"; }).join("");
    ov.innerHTML = '<div style="background:var(--card,#fff);color:var(--tx,#1c2430);border-radius:14px;width:100%;max-width:520px;max-height:92vh;overflow:auto;padding:18px"><h3 style="margin:0 0 6px">' + esc(titre) + '</h3><div class="rg-aide" style="font-size:12px;color:var(--mu,#5b6572)">' + esc(aide || "") + '</div><form novalidate>' + f + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="rg-b" data-x="1">Annuler</button><button class="rg-b p">' + esc(ok || "Valider") + "</button></div></form></div>";
    ov.querySelectorAll("input,select").forEach(function (i) { i.style.cssText = "width:100%;font:inherit;padding:8px;border:1px solid var(--bd,#d5dbe3);border-radius:8px;background:var(--bg,#fff);color:var(--tx,#1c2430);margin-top:3px"; });
    document.body.appendChild(ov); var fm = ov.querySelector("form");
    ov.querySelectorAll("[data-x]").forEach(function (b) { b.onclick = function () { ov.remove(); }; });
    var sync = function () { var t = TYPES[fm.elements.type ? fm.elements.type.value : ""]; if (!t) return; ov.querySelector(".rg-aide").textContent = t.aide; ["debut", "fin"].forEach(function (k) { var r = ov.querySelector('[data-rgrow="' + k + '"]'); if (r) r.style.display = t.prorata ? "" : "none"; });
      var cr = ov.querySelector('[data-rgrow="compte"]'); if (cr) cr.firstChild.textContent = t.classe === "6" ? "Compte de charge (classe 6)" : "Compte de produit (classe 7)"; if (fm.elements.reg && fm.elements.reg.dataset.auto !== "0") fm.elements.reg.value = t.reg; };
    if (fm.elements.type) { fm.elements.type.onchange = sync; if (fm.elements.reg) fm.elements.reg.oninput = function () { fm.elements.reg.dataset.auto = "0"; }; if (!(init && init.reg)) sync(); else { fm.elements.reg.dataset.auto = "0"; var t0 = TYPES[init.type]; if (t0) { ov.querySelector(".rg-aide").textContent = t0.aide; ["debut", "fin"].forEach(function (k) { var r = ov.querySelector('[data-rgrow="' + k + '"]'); if (r) r.style.display = t0.prorata ? "" : "none"; }); } } }
    fm.onsubmit = function (e) { e.preventDefault(); var o = {}; champs.forEach(function (x) { var v = fm.elements[x.k].value.trim(); o[x.k] = x.t === "number" ? (v === "" ? 0 : +v) : v; }); var r = H.run ? H.run(function () { return onSave(o); }) : (onSave(o), true); if (r !== false) { ov.remove(); H.render(); } };
    var f0 = fm.querySelector("input,select"); if (f0) f0.focus(); return ov;
  }
  var CH = [{ k: "type", l: "Type", t: "select", o: Object.keys(TYPES).map(function (k) { return [k, TYPES[k].court + " — " + TYPES[k].lib]; }) }, { k: "libelle", l: "Libellé" }, { k: "compte", l: "Compte de charge (classe 6)" }, { k: "montant", l: "Montant total (hors taxes)", t: "number" },
    { k: "debut", l: "Période couverte — début", t: "date" }, { k: "fin", l: "Période couverte — fin", t: "date" }, { k: "reg", l: "Compte de régularisation" }, { k: "tiers", l: "Tiers (facultatif)" }, { k: "arret", l: "Date d'arrêté", t: "date" }];

  var ACT = {
    add: function () { var a = UIS.arret || arretDefaut(); form("Nouvelle régularisation", CH, { type: "cca", arret: a, debut: a.slice(0, 8) + "01", fin: addJ(a.slice(0, 8) + "01", 364) }, function (o) { ajouter(o); }, "Enregistrer"); },
    edit: function (id) { var it = items().find(function (x) { return x.id === id; }); if (!it) return; form("Modifier la régularisation", CH, it, function (o) { modifier(id, o); }, "Enregistrer"); },
    del: function (id) { if (!confirm("Supprimer cette régularisation ?")) return; var r = H.run ? H.run(function () { supprimer(id); }) : (supprimer(id), true); if (r !== false) H.render(); },
    reset: function (id) { if (!confirm("Remettre cette régularisation à générer ? À faire seulement si les brouillards ont été supprimés (sinon l'écriture serait en double).")) return; var r = H.run ? H.run(function () { remettre(id); }) : (remettre(id), true); if (r !== false) H.render(); },
    gen: function () { var a = UIS.arret || arretDefaut(), res; var r = H.run ? H.run(function () { res = generer(a); }) : (res = generer(a), true); if (r !== false) { alert("Écritures générées en brouillard : arrêté du " + fd(a) + " et extourne du " + fd(addJ(a, 1)) + ". Elles seront comptabilisées après visa (Comptabilité → Saisie & visa)."); H.render(); } },
    print: imprimer,
    cand: function (i) { var c = candidats()[+i]; if (!c) return; var a = UIS.arret || arretDefaut(); form("Régulariser une charge payée d'avance", CH, { type: "cca", libelle: c.libelle, compte: c.compte, montant: c.montant, debut: c.date, fin: addJ(c.date, 364), arret: a, src: c.piece || c.libelle }, function (o) { o.src = c.piece || c.libelle; ajouter(o); }, "Enregistrer"); }
  };
  document.addEventListener("click", function (e) { var t = e.target.closest && e.target.closest("[data-rg]"); if (!t || !G.LOGISTICA_REGUL.host) return; var f = ACT[t.dataset.rg]; if (!f) return; e.preventDefault(); H = G.LOGISTICA_REGUL.host; try { f(t.dataset.id, t); } catch (x) { alert(x.message); } });
  document.addEventListener("change", function (e) { var t = e.target; if (!H || !t.dataset || t.dataset.rgf !== "arret") return; UIS.arret = t.value; H.render(); });

  G.LOGISTICA_REGUL = { host: null, view: view, TYPES: TYPES, UI: UIS, part: part, items: function (h) { if (h) H = h; return items(); }, ajouter: function (f, h) { if (h) H = h; return ajouter(f); }, modifier: function (i, f, h) { if (h) H = h; return modifier(i, f); }, supprimer: function (i, h) { if (h) H = h; return supprimer(i); }, remettre: function (i, h) { if (h) H = h; return remettre(i); },
    generer: function (a, h) { if (h) H = h; return generer(a); }, synthese: function (h) { if (h) H = h; return synthese(); }, candidats: function (h) { if (h) H = h; return candidats(); }, publier: publier, imprimer: function (h) { if (h) H = h; return imprimer(); }, use: function (h) { H = h; this.host = h; } };
})(window);
