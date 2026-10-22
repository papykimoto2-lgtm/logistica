/* Synchronisation entre postes LOGISTICA (Distributions, Transport, Agro).
   Chaque poste garde ses données dans son navigateur (rapide, utilisable hors ligne) et les synchronise avec Supabase, enregistrement par enregistrement :
   - toutes les 12 s et 1,5 s après chaque enregistrement local : on TIRE les changements des autres postes, puis on POUSSE les siens ;
   - un enregistrement modifié ailleurs entre-temps n'est PAS écrasé : la version du serveur est conservée et l'utilisateur est prévenu ;
   - les compteurs de numérotation gardent la plus grande valeur ; le journal d'audit s'additionne ; les suppressions sont transmises ;
   - garde-fous : suppression massive confirmée, première synchronisation confirmée, secrets (clé d'administration) jamais envoyés.
   Réglage : Paramètres du Hub → Cloud / Supabase (adresse du projet + clé de synchronisation SYNC_KEY), stocké sur l'appareil. */
(function (G) {
  "use strict";
  /* Profils : réglages propres à chaque application (clé de stockage, ce qui reste local, secrets jamais envoyés). */
  var PROFILS = {
    distribution: { nom: "Distributions", cle: "angels_erp_v1", exclude: ["pos", "gps_hist", "tries", "pass", "pass_err"], secrets: { config: ["appel_pont.cle_admin"] }, derives: ["angels_compta_distribution", "angels_portail_v1"] },
    transport: { nom: "Transport", cle: "angels_transport_v3", exclude: ["tries", "gps_pos", "gps_alerts", "alertes_etat"], derives: ["angels_compta_transport", "angels_transport_files"] },
    agro: { nom: "Agro", cle: "angels_agro_v1", exclude: ["tries"], derives: ["angels_compta_agro"] },
    crm: { nom: "CRM", cle: "angels_crm_v1", exclude: [], derives: [] },
    placement: { nom: "Placement", cle: "angels_placement_v1", exclude: [], derives: [] },
    assurance: { nom: "Assurance", cle: "angels_assurance_v1", exclude: [], derives: [] }
  };
  /* Une instance du moteur = une application. Dans une application elle tourne en continu ; le Hub en crée une « sans écran » pour lire l'état et agir. */
  function Moteur(P) {
  P = Object.assign({ exclude: [], ajout: ["audit"], seq: ["seq"], secrets: {}, derives: [] }, P); if (!P.nom) P.nom = P.app;
  var CFG_K = "angels_supabase", SYNC_K = "angels_sync", B = { cursor: 0, map: {}, boot: false };
  var st = { etat: "inactif", dernier: 0, err: "", busy: false, again: false, applying: false, deb: null, trop: [], doublons: [], attenteRefresh: false, erreurs: [] };

  function lire(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function conf() {
    if (lire("angels_demo_local")) return null;   /* démonstration locale (demo.html) : rien n'est jamais envoyé au serveur */
    var u = lire(CFG_K), s = lire(SYNC_K), def = G.ANGELS_PASSERELLE || {}, url = (u && u.off) ? "" : (u && u.url) || def.url || "";
    if (!s || !s.actif || !s.cle || !/^https:\/\//.test(url)) return null;
    return { fn: String(url).replace(/\/+$/, "") + "/functions/v1/sync", cle: s.cle };
  }
  function h(s) { var x = 5381, i = s.length; while (i) x = (x * 33) ^ s.charCodeAt(--i); return (x >>> 0).toString(36) + ":" + s.length; }
  var bk = function () { return "angels_sync_base_" + P.app; };
  function sauverBase() { try { localStorage.setItem(bk(), JSON.stringify(B)); } catch (e) { } }
  function chemin(o, p) { var a = p.split("."), c = o; for (var i = 0; i < a.length - 1; i++) { if (!c || typeof c !== "object") return null; c = c[a[i]]; } return c && typeof c === "object" ? [c, a[a.length - 1]] : null; }
  /* Secrets : jamais envoyés ; à la réception, la valeur locale est conservée. */
  function nettoyer(k, v) {
    var sec = P.secrets && P.secrets[k]; if (!sec || !v || typeof v !== "object") return v;
    var c = JSON.parse(JSON.stringify(v)); sec.forEach(function (p) { var r = chemin(c, p); if (r) delete r[0][r[1]]; }); return c;
  }
  function restaurer(k, local, distant) {
    var sec = P.secrets && P.secrets[k]; if (!sec || !local || !distant || typeof distant !== "object") return distant;
    sec.forEach(function (p) { var a = chemin(local, p), b = chemin(distant, p); if (a && a[0][a[1]] !== undefined) { if (!b) { var parts = p.split("."), c = distant; for (var i = 0; i < parts.length - 1; i++) { if (!c[parts[i]] || typeof c[parts[i]] !== "object") c[parts[i]] = {}; c = c[parts[i]]; } b = [c, parts[parts.length - 1]]; } b[0][b[1]] = a[0][a[1]]; } });
    return distant;
  }
  function max(a, b) {
    if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = k in a ? max(a[k], b[k]) : b[k]; return o; }
    return b === undefined ? a : b;
  }
  function canon(v) { if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}"; return JSON.stringify(v); }
  function estRecord(v) { return Array.isArray(v) && v.length > 0 && v.every(function (e) { return e && typeof e === "object" && !Array.isArray(e) && typeof e.id === "string" && e.id; }); }

  /* Photographie de l'état local : clé « coll|id » → {coll, id, kind, data, hash} */
  function photo(S) {
    var out = {};
    function add(coll, id, kind, data) { out[coll + "|" + id] = { coll: coll, id: id, kind: kind, data: data, hash: h(JSON.stringify(data)) }; }
    Object.keys(S).forEach(function (k) {
      if (P.exclude.indexOf(k) >= 0) return; var v = S[k];
      if (estRecord(v)) { v.forEach(function (e) { add(k, e.id, "enreg", e); }); return; }
      if (Array.isArray(v) && v.length === 0) return;
      if (Array.isArray(v) && P.ajout.indexOf(k) >= 0) { v.forEach(function (e) { add(k, h(JSON.stringify(e)), "ajout", e); }); return; }
      add("_doc", k, P.seq.indexOf(k) >= 0 ? "seq" : "doc", { v: nettoyer(k, v) });
    });
    return out;
  }

  async function appel(c, corps) {
    var r = await fetch(c.fn, { method: "POST", headers: { "content-type": "application/json", "x-sync-key": c.cle }, body: JSON.stringify(Object.assign({ app: P.app }, corps)) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || j.ok === false) throw new Error(j.erreur || ("Erreur serveur " + r.status));
    return j;
  }
  function remplacer(cible, neuf) { Object.keys(cible).forEach(function (k) { delete cible[k]; }); Object.keys(neuf).forEach(function (k) { cible[k] = neuf[k]; }); return cible; }

  /* Applique une ligne du serveur à l'état local. Renvoie true si l'état local a changé. */
  function appliquer(S, l, opts) {
    var key = l.coll + "|" + l.id, kind, hash, chg = false; opts = opts || {};
    if (l.coll === "_doc") {
      kind = P.seq.indexOf(l.id) >= 0 ? "seq" : "doc";
      if (l.supprime || !l.data) { return false; }
      var val = l.data.v;
      if (kind === "seq") val = max(S[l.id], val); else val = restaurer(l.id, S[l.id], val);
      var avant = JSON.stringify(nettoyer(l.id, S[l.id]));
      S[l.id] = val; hash = h(JSON.stringify({ v: nettoyer(l.id, val) })); chg = avant !== JSON.stringify(nettoyer(l.id, val));
      if (kind === "seq" && canon(val) !== canon(l.data.v)) hash = "a-envoyer";   /* notre compteur est plus grand que celui du serveur : il doit repartir */
      B.map[key] = [l.rev, hash, kind]; return chg;
    }
    if (!Array.isArray(S[l.coll])) { if (l.supprime) { delete B.map[key]; return false; } S[l.coll] = []; }
    var arr = S[l.coll], i = -1, n; for (n = 0; n < arr.length; n++) if (arr[n] && arr[n].id === l.id) { i = n; break; }
    if (l.supprime) { if (i >= 0) { arr.splice(i, 1); chg = true; } delete B.map[key]; return chg; }
    if (i >= 0) { chg = JSON.stringify(arr[i]) !== JSON.stringify(l.data); if (chg) remplacer(arr[i], l.data); } else { arr.push(l.data); chg = true; }
    B.map[key] = [l.rev, h(JSON.stringify(i >= 0 ? arr[i] : arr[arr.length - 1])), P.ajout.indexOf(l.coll) >= 0 ? "ajout" : "enreg"]; return chg;   /* un journal reçu reste un journal : jamais renvoyé comme enregistrement à supprimer */
  }
  function avis(m, t) {
    try { if (P.toast) return P.toast(m, t); var d = document.createElement("div"); d.setAttribute("role", "status"); d.textContent = m; d.style.cssText = "position:fixed;left:50%;bottom:54px;transform:translateX(-50%);z-index:9100;max-width:90vw;padding:10px 16px;border-radius:12px;font:600 13px Arial,sans-serif;color:#fff;background:" + (t === "err" ? "#c62828" : "#7a1d17") + ";box-shadow:0 4px 16px rgba(0,0,0,.3)"; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 9000); } catch (e) { }
  }
  function persister() { st.applying = true; try { P.persist(); } catch (e) { } finally { st.applying = false; } }
  function occupe() { try { if (P.occupe) return !!P.occupe(); var a = document.activeElement; return !!document.getElementById("aa-ov") || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox" && a.type !== "radio"); } catch (e) { return false; } }
  function rafraichir() { if (occupe()) { st.attenteRefresh = true; return; } st.attenteRefresh = false; try { P.refresh(); } catch (e) { } }

  /* Premier lancement d'un poste : on récupère d'abord l'état du serveur. */
  async function amorcer(c) {
    var S = P.get(), lignes = [], curseur = 0, suite = true;
    while (suite) { var r = await appel(c, { action: "tirer", depuis: curseur, limite: 300 }); lignes = lignes.concat(r.lignes); curseur = r.curseur; suite = r.suite; }
    var relogin = false;
    if (lignes.length) {
      var locNonVide = P.nonVide ? P.nonVide(S) : Object.keys(S).some(function (k) { return estRecord(S[k]) && k !== "users"; });
      if (locNonVide) {
        var ok = true; try { ok = confirm("SYNCHRONISATION — " + P.nom + "\n\nLe serveur contient déjà des données et ce poste en contient aussi.\n\n• Les enregistrements communs prennent la version du SERVEUR.\n• Les enregistrements propres à ce poste sont AJOUTÉS au serveur.\n\nOK = synchroniser ce poste\nAnnuler = ne pas synchroniser pour l'instant"); } catch (e) { }
        if (!ok) { st.etat = "inactif"; st.err = "Première synchronisation refusée"; return false; }
      }
      /* un même utilisateur créé séparément sur deux postes (même nom, identifiants différents) : celui du serveur est gardé */
      var noms = {}; lignes.forEach(function (l) { if (l.coll === "users" && l.data) noms[String(l.data.nom).toLowerCase()] = l.id; });
      if (Array.isArray(S.users)) S.users = S.users.filter(function (u) { var id = noms[String(u.nom).toLowerCase()]; if (id && id !== u.id) { relogin = true; return false; } return true; });
      lignes.forEach(function (l) { appliquer(S, l); });
      persister();
    }
    B.cursor = curseur; B.boot = true; sauverBase();
    if (relogin) { try { sessionStorage.clear(); } catch (e) { } if (P.relogin) P.relogin(); else location.reload(); return false; }
    if (lignes.length) rafraichir();
    return true;
  }

  async function tirer(c, tout) {
    var chg = false, suite = true, recus = 0;
    if (tout) B.cursor = 0;
    while (suite) {
      var r = await appel(c, { action: "tirer", depuis: B.cursor, limite: 300 }), S = P.get();
      r.lignes.forEach(function (l) { var b = B.map[l.coll + "|" + l.id]; if (!tout && b && b[0] === l.rev) return; recus++; if (appliquer(S, l)) chg = true; });
      B.cursor = r.curseur; suite = r.suite; if (recus) B.reception = Date.now(); sauverBase();
    }
    if (chg) { persister(); signalerDoublons(); rafraichir(); }
    return recus;
  }
  function signalerDoublons() {
    try {
      var S = P.get(), vus = {}, dup = [];
      Object.keys(S).forEach(function (k) { if (!estRecord(S[k])) return; S[k].forEach(function (e) { if (typeof e.numero === "string" && e.numero) { var c = k + "|" + e.numero; if (vus[c] && vus[c] !== e.id) dup.push(k + " " + e.numero); vus[c] = e.id; } }); });
      var nouv = dup.filter(function (d) { return st.doublons.indexOf(d) < 0; }); st.doublons = dup;
      if (nouv.length) avis("Numéro en double après synchronisation : " + nouv.slice(0, 3).join(", ") + ". Vérifiez avec les autres postes.", "err");
    } catch (e) { }
  }

  function lot(ops) {
    var out = [], cur = [], taille = 0;
    ops.forEach(function (o) { var t = o.del ? 80 : JSON.stringify(o.data).length + 120; if (cur.length && (cur.length >= 300 || taille + t > 900000)) { out.push(cur); cur = []; taille = 0; } cur.push(o); taille += t; });
    if (cur.length) out.push(cur); return out;
  }
  async function pousser(c, tout) {
    var S = P.get(), cur = photo(S), ops = [], dels = 0, total = Object.keys(B.map).length, key;
    for (key in cur) { var e = cur[key], b = B.map[key]; if (!b) ops.push({ coll: e.coll, id: e.id, kind: e.kind, base: 0, data: e.data, _h: e.hash }); else if (tout || b[1] !== e.hash) ops.push({ coll: e.coll, id: e.id, kind: e.kind, base: b[0], data: e.data, _h: e.hash }); }
    for (key in B.map) { if (!(key in cur)) { var m = B.map[key]; if (m[2] === "enreg") { var p = key.indexOf("|"); ops.push({ coll: key.slice(0, p), id: key.slice(p + 1), kind: "enreg", base: m[0], del: true }); dels++; } else if (m[2] === "trop" || m[2] === "doc" || m[2] === "ajout") delete B.map[key]; } }
    if (dels >= 20 && dels >= total * 0.5) {
      var go = false; try { go = confirm("SUPPRESSION MASSIVE — " + P.nom + "\n\nCe poste a supprimé " + dels + " enregistrements d'un coup (sur " + total + ").\n\nOK = supprimer aussi sur le serveur et les autres postes\nAnnuler = restaurer ces données depuis le serveur"); } catch (e2) { }
      if (!go) { B = { cursor: 0, map: {}, boot: false }; sauverBase(); st.err = "Suppression annulée : restauration depuis le serveur"; return "restaurer"; }
    }
    if (!ops.length) return "";
    var msgs = [], S2 = P.get();
    for (var lots = lot(ops), i = 0; i < lots.length; i++) {
      var envoi = lots[i].map(function (o) { var x = { coll: o.coll, id: o.id, kind: o.kind, base: o.base }; if (o.del) x.del = true; else x.data = o.data; return x; });
      var r = await appel(c, { action: "pousser", par: (P.qui && P.qui()) || "poste", ops: envoi });
      var hs = {}; lots[i].forEach(function (o) { hs[o.coll + "|" + o.id] = o; });
      r.appliques.forEach(function (a) {
        var k = a.coll + "|" + a.id, o = hs[k]; if (!o) return;
        if (o.del) { delete B.map[k]; return; }
        if (o.kind === "seq" && a.data !== undefined && a.data !== null) { var nv = a.data.v !== undefined ? a.data.v : a.data; S2[o.id] = max(S2[o.id], nv); B.map[k] = [a.rev, h(JSON.stringify({ v: nettoyer(o.id, S2[o.id]) })), "seq"]; return; }
        B.map[k] = [a.rev, o._h, o.kind];
      });
      r.rejets.forEach(function (j) {
        if (P.ajout.indexOf(j.coll) >= 0) { delete B.map[j.coll + "|" + j.id]; return; }   /* un journal ne se conteste pas : rien à signaler */
        var k = j.coll + "|" + j.id, o = hs[k], sv = j.serveur;
        appliquer(S2, { coll: j.coll, id: j.id, data: sv.data, rev: sv.rev, supprime: !!sv.supprime }); if (sv.supprime) delete B.map[k];
        msgs.push((j.coll === "_doc" ? "réglage « " + j.id + " »" : j.coll + " " + ((o && o.data && (o.data.numero || o.data.nom)) || j.id)) + (sv.par ? " (par " + sv.par + ")" : ""));
      });
      (r.trop || []).forEach(function (j) { var k = j.coll + "|" + j.id, o = hs[k]; if (o) B.map[k] = [0, o._h, "trop"]; st.trop.push(j.coll + " " + j.id); });
      if (r.appliques.length) B.envoi = Date.now();
      sauverBase();
    }
    if (msgs.length) { persister(); rafraichir(); avis("Modification simultanée : la version déjà enregistrée par un autre poste est conservée → " + msgs.slice(0, 3).join(" ; ") + ". Vérifiez puis recommencez si besoin.", "err"); }
    return "";
  }

  var badge = null;
  function majBadge() {
    if (!document.body || !P.badge) return; var c = conf();
    if (!c || !P) { if (badge) { badge.remove(); badge = null; } return; }
    if (!badge) {
      badge = document.createElement("button"); badge.type = "button"; badge.id = "aa-sync";
      badge.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:9000;border:1px solid #b9c2cd;border-radius:99px;padding:5px 11px;font:600 12px Arial,sans-serif;background:#fff;color:#1c2430;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);max-width:78vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      badge.onclick = function () { cycle(true); }; document.body.appendChild(badge);
    }
    var t, col = "#1c2430";
    if (st.busy) t = "☁ Synchronisation…";
    else if (st.etat === "ok") { t = "☁ Synchronisé " + new Date(st.dernier).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); col = "#118a4b"; }
    else if (st.etat === "hors ligne") { t = "☁ Hors ligne : les changements partiront au retour du réseau"; col = "#b86e00"; }
    else if (st.etat === "erreur") { t = "⚠ Non synchronisé : " + (st.err || "erreur"); col = "#c62828"; }
    else { t = "☁ " + (st.err || "Synchronisation en attente"); col = "#6b7390"; }
    badge.textContent = t; badge.style.color = col; badge.title = "Cliquer pour synchroniser maintenant" + (st.trop.length ? "\nTrop volumineux, non synchronisé : " + st.trop.join(", ") : "") + (st.doublons.length ? "\nNuméros en double : " + st.doublons.join(", ") : "");
  }

  function cycle() {
    if (!P) return Promise.resolve();
    var c = conf(); if (!c) { st.etat = "inactif"; majBadge(); return Promise.resolve(); }
    if (st.run) return st.run.then(function () { return cycle(); });
    st.busy = true; majBadge();
    st.run = (async function () {
      try {
        if (!B.boot) { var ok = await amorcer(c); if (!ok) return; }
        await tirer(c);
        var res = await pousser(c);
        if (res === "restaurer") { await amorcer(c); }
        st.etat = "ok"; st.dernier = Date.now(); st.err = "";
      } catch (e) { st.etat = (typeof navigator !== "undefined" && navigator.onLine === false) ? "hors ligne" : "erreur"; st.err = String(e && e.message || e).slice(0, 90); st.erreurs.unshift({ t: Date.now(), m: st.err }); st.erreurs.length = Math.min(st.erreurs.length, 5); }
    })().then(function () { st.busy = false; st.run = null; majBadge(); }, function () { st.busy = false; st.run = null; majBadge(); });
    return st.run;
  }
  function signal() { if (!P || st.applying || !conf()) return; clearTimeout(st.deb); st.deb = setTimeout(cycle, 1500); }

  function demarrer() {
    var b = lire("angels_sync_base_" + P.app); if (b && b.map) B = b;
    setInterval(function () { if (!document.hidden) cycle(); if (st.attenteRefresh) rafraichir(); }, 12000);
    setInterval(function () { if (st.attenteRefresh && !occupe()) rafraichir(); }, 2500);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) cycle(); });
    G.addEventListener("online", function () { cycle(); });
    setTimeout(function () { persister(); majBadge(); cycle(); }, 900);   /* le stockage de l'appareil reflète l'état en mémoire (migrations de démarrage comprises) */
    try { canal = new BroadcastChannel("angels_sync_cmd"); canal.onmessage = function (ev) { var m = ev.data || {}; if (m.app !== P.app || !m.id || m.rep) return; if (m.action === "ping") return canal.postMessage({ rep: m.id, app: P.app, ok: true }); lancer(m.action).then(function (d) { canal.postMessage({ rep: m.id, app: P.app, ok: true, data: d }); }, function (e) { canal.postMessage({ rep: m.id, app: P.app, ok: false, err: String(e && e.message || e) }); }); }; } catch (e) { }
  }
  var canal = null;
  function charger() { var b = lire("angels_sync_base_" + P.app); if (b && b.map) B = b; }
  function libelle(app, coll, id) { try { var S = P.get(), a = S[coll]; if (Array.isArray(a)) { for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i].numero || a[i].nom || a[i].immat || a[i].libelle || id; } } catch (e) { } return id; }

  /* ----- Lecture de l'état (sans rien modifier) ----- */
  async function lignesServeur(c, depuis) {
    var out = [], suite = true, curseur = depuis || 0;
    while (suite) { var r = await appel(c, { action: "tirer", depuis: curseur, limite: 500 }); out = out.concat(r.lignes); curseur = r.curseur; suite = r.suite; }
    return out;
  }
  async function diagnostic() {
    var c = conf(), S = P.get(), cur = photo(S), n = 0, aJour = 0, env = 0, supp = 0, key;
    for (key in cur) { n++; var b = B.map[key]; if (b && b[1] === cur[key].hash) aJour++; else env++; }
    for (key in B.map) if (!(key in cur) && B.map[key][2] === "enreg") supp++;
    var rec = 0, serveur = null;
    if (c) {
      var L = await lignesServeur(c, B.boot ? B.cursor : 0);
      L.forEach(function (l) { var b = B.map[l.coll + "|" + l.id]; if (!b || b[0] !== l.rev) rec++; });
      serveur = (await appel(c, { action: "etat" })).enregistrements[P.app];
    }
    return { app: P.app, nom: P.nom, actif: !!c, amorce: !!B.boot, elements: n, aJour: aJour, aEnvoyer: env, suppressions: supp, enFile: env + supp, aRecuperer: rec, serveur: serveur, envoi: B.envoi || 0, reception: B.reception || 0, etat: st.etat, err: st.err };
  }
  function file() {
    var S = P.get(), cur = photo(S), out = [], key;
    for (key in cur) { var b = B.map[key]; if (!b) out.push({ type: "nouveau", coll: cur[key].coll, id: cur[key].id, nom: cur[key].coll === "_doc" ? "réglage " + cur[key].id : libelle(P.app, cur[key].coll, cur[key].id) }); else if (b[1] !== cur[key].hash) out.push({ type: "modifié", coll: cur[key].coll, id: cur[key].id, nom: cur[key].coll === "_doc" ? "réglage " + cur[key].id : libelle(P.app, cur[key].coll, cur[key].id) }); }
    for (key in B.map) if (!(key in cur) && B.map[key][2] === "enreg") { var p = key.indexOf("|"); out.push({ type: "supprimé", coll: key.slice(0, p), id: key.slice(p + 1), nom: key.slice(p + 1) }); }
    return out;
  }
  async function ecart() {
    var c = conf(); if (!c) throw new Error("Synchronisation non configurée");
    var S = P.get(), cur = photo(S), srv = {}, L = await lignesServeur(c, 0), par = {};
    L.forEach(function (l) { if (!l.supprime) srv[l.coll + "|" + l.id] = l; });
    function ligne(coll) { return par[coll] || (par[coll] = { coll: coll, local: 0, serveur: 0, seulLocal: 0, seulServeur: 0, different: 0 }); }
    Object.keys(cur).forEach(function (k) { var e = cur[k], x = ligne(e.coll); x.local++; var s2 = srv[k]; if (!s2) x.seulLocal++; else { x.serveur++; if (canon(s2.data) !== canon(e.data)) x.different++; } });
    Object.keys(srv).forEach(function (k) { if (!(k in cur)) { var x = ligne(srv[k].coll); x.serveur++; x.seulServeur++; } });
    var rows = Object.keys(par).map(function (k) { return par[k]; }).sort(function (a, b) { return (b.seulLocal + b.seulServeur + b.different) - (a.seulLocal + a.seulServeur + a.different) || a.coll.localeCompare(b.coll); });
    return { app: P.app, nom: P.nom, lignes: rows, ecarts: rows.reduce(function (n, x) { return n + x.seulLocal + x.seulServeur + x.different; }, 0) };
  }
  async function infoCloud() {
    var c = conf(); if (!c) throw new Error("Synchronisation non configurée sur cet appareil");
    var t0 = Date.now(), r = await appel(c, { action: "etat" }); return { app: P.app, nom: P.nom, url: c.fn, ms: Date.now() - t0, serveur: r.enregistrements, heure: r.heure, curseur: B.cursor, amorce: !!B.boot, erreurs: st.erreurs.slice() };
  }

  /* ----- Actions ----- */
  async function envoyerTout() { var c = conf(); if (!c) throw new Error("Synchronisation non configurée"); if (!B.boot) { if (!(await amorcer(c))) throw new Error(st.err || "Première synchronisation refusée"); } var res = await pousser(c, true); if (res === "restaurer") await amorcer(c); st.etat = "ok"; st.dernier = Date.now(); majBadge(); return diagnostic(); }
  async function recupererTout() { var c = conf(); if (!c) throw new Error("Synchronisation non configurée"); if (!B.boot) { if (!(await amorcer(c))) throw new Error(st.err || "Première synchronisation refusée"); } await tirer(c, true); st.etat = "ok"; st.dernier = Date.now(); majBadge(); return diagnostic(); }
  async function resynchro() { await recupererTout(); return envoyerTout(); }
  async function reessayer() { await cycle(); return diagnostic(); }
  async function purgerCache() {
    var nb = file().length;
    [P.cle, "angels_sync_base_" + P.app].concat(P.derives || []).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { } });
    B = { cursor: 0, map: {}, boot: false }; try { sessionStorage.clear(); } catch (e) { }
    if (P.badge) setTimeout(function () { location.reload(); }, 300);
    return { purge: true, perdues: nb };
  }
  function lancer(action) {
    switch (action) {
      case "diagnostic": charger(); return diagnostic();
      case "file": charger(); return Promise.resolve(file());
      case "ecart": charger(); return ecart();
      case "cloud": charger(); return infoCloud();
      case "envoyerTout": return envoyerTout();
      case "recupererTout": return recupererTout();
      case "resynchro": return resynchro();
      case "reessayer": return reessayer();
      case "purgerCache": return purgerCache();
    }
    return Promise.reject(new Error("Action inconnue"));
  }
  return { cycle: cycle, signal: signal, demarrer: demarrer, lancer: lancer, charger: charger, etat: function () { return { busy: st.busy, etat: st.etat, dernier: st.dernier, err: st.err, actif: !!conf(), base: B, trop: st.trop.slice(), doublons: st.doublons.slice() }; } };
  }

  var M = null;
  var LECTURE = { diagnostic: 1, file: 1, ecart: 1, cloud: 1 };
  /* Commande depuis le Hub : une application ouverte dans un onglet exécute elle-même l'action (elle détient l'état en mémoire) ; sinon le Hub l'exécute sur les données de l'appareil. */
  function commande(app, action) {
    var prof = PROFILS[app]; if (!prof) return Promise.reject(new Error("Application inconnue"));
    function sansEcran() {
      var S = null, pm = Object.assign({ app: app }, prof);
      var m2 = Moteur(Object.assign(pm, { get: function () { return S || (S = (function () { try { return JSON.parse(localStorage.getItem(prof.cle) || "null") || {}; } catch (e) { return {}; } })()); }, persist: function () { try { localStorage.setItem(prof.cle, JSON.stringify(S)); } catch (e) { } } }));
      m2.charger(); return m2.lancer(action).then(function (r) { return r; });
    }
    if (LECTURE[action] || typeof BroadcastChannel === "undefined") return sansEcran();
    return new Promise(function (res, rej) {
      var id = "c" + Date.now() + Math.random().toString(36).slice(2, 6), ch = new BroadcastChannel("angels_sync_cmd"), present = false, fini = false;
      function fin(f, v) { if (fini) return; fini = true; try { ch.close(); } catch (e) { } f(v); }
      ch.onmessage = function (ev) { var m = ev.data || {}; if (m.rep !== id) return; if (!present) { present = true; clearTimeout(t); ch.postMessage({ id: id + "x", app: app, action: action }); id = id + "x"; return; } if (m.ok) fin(res, m.data); else fin(rej, new Error(m.err || "Échec")); };
      ch.postMessage({ id: id, app: app, action: "ping" });
      var t = setTimeout(function () { if (present) return; sansEcran().then(function (v) { fin(res, v); }, function (e) { fin(rej, e); }); }, 700);
    });
  }
  G.ANGELS_SYNC = {
    PROFILS: PROFILS, commande: commande,
    init: function (o) { M = Moteur(Object.assign({}, PROFILS[o.app] || {}, o, { badge: true })); M.demarrer(); },
    signal: function () { if (M) M.signal(); }, cycle: function () { return M ? M.cycle() : Promise.resolve(); },
    etat: function () { return M ? M.etat() : { etat: "inactif", actif: false, base: { cursor: 0, map: {}, boot: false } }; },
    actif: function () { var u = null, s = null; try { u = JSON.parse(localStorage.getItem("angels_supabase") || "null"); s = JSON.parse(localStorage.getItem("angels_sync") || "null"); } catch (e) { } var def = G.ANGELS_PASSERELLE || {}, url = (u && u.off) ? "" : (u && u.url) || def.url || ""; return !!(s && s.actif && s.cle && /^https:\/\//.test(url)); }
  };
})(window);
