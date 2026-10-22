/* LOGISTICA — rapport quotidien des connexions pour le DG (Paramètres du hub, Distributions, Transport, Agro).

   À l'heure choisie (11 h par défaut), le premier poste du groupe ouvert sur cet appareil construit le rapport des dernières 24 heures à partir du journal de connexion de chaque application
   (collection « connexions » de leur état) et l'affiche au DG : bandeau « Rapport de connexion prêt » avec « Voir » et « Envoyer par WhatsApp » (message déjà rédigé, vers le numéro du DG).
   L'envoi par e-mail est fait par le serveur (fonction « rapport-connexions », supabase/README.md) : il ne dépend d'aucun poste ouvert. Réglages dans Paramètres du hub → Connexions.
   Aucun mot de passe ni donnée secrète dans le rapport. Les calculs sont identiques à ceux du serveur (supabase/functions/_shared/rapport-connexions.js) : voir tests/rapport-serveur.js. */
(function (G) {
  "use strict";
  var CFG = "logistica_rapport_dg", LISTE = "logistica_rapports_dg", ETATS = { distribution: "logistica_erp_v1", transport: "logistica_transport_v3", agro: "logistica_agro_v1" };
  var LBL = { distribution: "Distributions", transport: "Transport", agro: "Agro" };
  var ROLES = { admin: "Administrateur", direction: "Direction générale", directeur: "Directeur", superviseur: "Superviseur", commercial: "Commercial", preparateur: "Préparateur", caissier: "Caissier", livreur: "Livreur", vendeur: "Vendeur partenaire", flotte: "Gestionnaire de flotte", comptable: "Comptable", controleur: "Contrôleur", chauffeur: "Chauffeur", chef: "Chef d'exploitation", soigneur: "Soigneur", magasinier: "Magasinier" };
  var TZ = "Africa/Abidjan", opts = { peut: function () { return true; } }, tim = null;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var dh = function (t) { return new Date(t).toLocaleString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
  var hh = function (t) { return new Date(t).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }); };
  var jourLocal = function (t) { return new Date(t).toLocaleDateString("fr-CA", { timeZone: TZ }); };
  var OK = function (e) { return e === "ok" || e === "demo"; }, KO = function (e) { return e === "ko" || e === "bloque" || e === "inactif" || e === "param_ko"; };
  function lire(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? def : v; } catch (e) { return def; } }
  function ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* ---------- Réglages (sur cet appareil) ---------- */
  function cfg() { var c = lire(CFG, {}) || {}; return { actif: c.actif !== false, heure: /^\d{1,2}:\d{2}$/.test(c.heure || "") ? c.heure : "11:00", nom: String(c.nom || ""), tel: String(c.tel || ""), emails: String(c.emails || ""), derniere: String(c.derniere || ""), fin: String(c.fin || "") }; }
  function setCfg(p) { var c = Object.assign(cfg(), p || {}); ecrire(CFG, c); return c; }

  /* ---------- Rapport (mêmes calculs que le serveur) ---------- */
  function sources() {
    return Object.keys(ETATS).map(function (app) {
      var g = lire(ETATS[app], null); if (!g || !Array.isArray(g.users)) return null;
      var cx = (Array.isArray(g.connexions) ? g.connexions : []).slice(), prem = cx.length ? cx.map(function (x) { return x.t; }).sort()[0] : "9999";
      (g.audit || []).forEach(function (a) {   /* connexions d'avant le journal : reprises du journal d'audit */
        var t = a.ts || a.t, nom = a.user || a.u, ac = a.action || a.a;
        if (ac === "Connexion" && t && t < prem) { var u = g.users.filter(function (x) { return x.nom === nom; })[0]; cx.push({ t: t, uid: u ? u.id : "", nom: nom, role: u ? u.role : (a.role || a.r || ""), ev: "ok", app_: "" }); }
      });
      return { app: app, connexions: cx, users: g.users.map(function (u) { return { id: u.id, nom: u.nom, role: u.role, actif: u.actif }; }) };
    }).filter(Boolean);
  }
  function construire(src, debut, fin) {
    var D = Date.parse(debut), F = Date.parse(fin), apps = [], ok = 0, ko = 0, pers = {};
    (src || []).forEach(function (s) {
      var tout = (Array.isArray(s.connexions) ? s.connexions : []).filter(function (x) { return x && x.t; }), par = {};
      tout.forEach(function (x) {
        var t = Date.parse(x.t); if (!(t >= D && t <= F)) return;
        var k = x.uid || "n:" + x.nom, p = par[k] || (par[k] = { nom: x.nom || "?", role: x.role || "", ok: 0, ko: 0, out: 0, premiere: "", derniere: "", appareils: {} });
        if (OK(x.ev)) { p.ok++; if (!p.premiere || x.t < p.premiere) p.premiere = x.t; if (!p.derniere || x.t > p.derniere) p.derniere = x.t; if (x.app_) p.appareils[x.app_] = 1; }
        else if (KO(x.ev)) p.ko++; else if (x.ev === "out") p.out++;
      });
      var users = Object.keys(par).map(function (k) { var p = par[k]; return { nom: p.nom, role: p.role, ok: p.ok, ko: p.ko, out: p.out, premiere: p.premiere, derniere: p.derniere, appareils: Object.keys(p.appareils) }; })
        .sort(function (a, b) { return b.ok - a.ok || a.nom.localeCompare(b.nom, "fr"); });
      var vus = {}; tout.forEach(function (x) { if (OK(x.ev)) vus[x.uid || "n:" + x.nom] = 1; });
      var jamais = (s.users || []).filter(function (u) { return u.actif !== false && !vus[u.id]; }).map(function (u) { return { nom: u.nom, role: u.role }; });
      var aok = users.reduce(function (t, u) { return t + u.ok; }, 0), ako = users.reduce(function (t, u) { return t + u.ko; }, 0);
      users.forEach(function (u) { if (u.ok) pers[s.app + "|" + u.nom] = 1; });
      ok += aok; ko += ako;
      apps.push({ app: s.app, nom: LBL[s.app] || s.app, ok: aok, ko: ako, users: users, jamais: jamais, alertes: users.filter(function (u) { return u.ko >= 3; }).map(function (u) { return u.nom; }) });
    });
    return { debut: debut, fin: fin, ok: ok, ko: ko, personnes: Object.keys(pers).length, apps: apps, jamais: apps.reduce(function (t, a) { return t + a.jamais.length; }, 0) };
  }
  function texte(r) {
    var L = ["*LOGISTICA — Rapport de connexion*", "Du " + dh(r.debut) + " au " + dh(r.fin), "Connexions réussies : " + r.ok + " · Échecs : " + r.ko + " · Personnes connectées : " + r.personnes];
    r.apps.forEach(function (a) {
      L.push("", "*" + a.nom + "* : " + a.ok + " connexion(s)" + (a.ko ? " · " + a.ko + " échec(s)" : ""));
      var ou = a.users.filter(function (u) { return u.ok; });
      ou.slice(0, 6).forEach(function (u) { L.push(" • " + u.nom + " : " + u.ok + " (dernière " + hh(u.derniere) + ")"); });
      if (ou.length > 6) L.push(" • … et " + (ou.length - 6) + " autre(s)");
    });
    var al = []; r.apps.forEach(function (a) { a.alertes.forEach(function (n) { al.push(n + " (" + a.nom + ")"); }); });
    if (al.length) L.push("", "⚠ Échecs répétés (3 ou plus) : " + al.join(", "));
    if (r.jamais) L.push("", "Comptes actifs jamais connectés : " + r.jamais);
    L.push("", "Détail : Paramètres du hub → Connexions.");
    return L.join("\n");
  }
  function html(r) {
    var th = "text-align:left;padding:6px 10px;background:#e8f1f4;font-size:12px", td = "padding:6px 10px;border-bottom:1px solid #e3ecef;font-size:13px", al = [];
    r.apps.forEach(function (a) { a.alertes.forEach(function (n) { al.push(n + " (" + a.nom + ")"); }); });
    var blocs = r.apps.map(function (a) {
      return '<h3 style="margin:18px 0 6px;font-size:15px">' + esc(a.nom) + " — " + a.ok + " connexion(s)" + (a.ko ? ' · <span style="color:#c62828">' + a.ko + " échec(s)</span>" : "") + "</h3>" +
        (a.users.length ? '<table style="border-collapse:collapse;width:100%"><tr><th style="' + th + '">Utilisateur</th><th style="' + th + '">Profil</th><th style="' + th + '">Connexions</th><th style="' + th + '">Échecs</th><th style="' + th + '">Dernière</th><th style="' + th + '">Appareil</th></tr>' +
          a.users.map(function (u) { return '<tr><td style="' + td + '"><b>' + esc(u.nom) + '</b></td><td style="' + td + '">' + esc(ROLES[u.role] || u.role) + '</td><td style="' + td + '">' + u.ok + '</td><td style="' + td + (u.ko ? ";color:#c62828;font-weight:700" : "") + '">' + u.ko + '</td><td style="' + td + '">' + (u.derniere ? esc(dh(u.derniere)) : "—") + '</td><td style="' + td + '">' + esc(u.appareils.join(" ; ") || "—") + "</td></tr>"; }).join("") + "</table>"
          : '<p style="color:#6b7390;font-size:13px">Aucune activité sur la période.</p>') +
        (a.jamais.length ? '<p style="font-size:13px;color:#b86e00">Comptes actifs jamais connectés : ' + a.jamais.map(function (j) { return esc(j.nom); }).join(", ") + "</p>" : "");
    }).join("");
    return '<div style="font-family:system-ui,Arial,sans-serif;color:#1b2240;max-width:720px"><h2 style="margin:0 0 4px">LOGISTICA — Rapport de connexion</h2><p style="margin:0 0 12px;color:#6b7390">Du ' + esc(dh(r.debut)) + " au " + esc(dh(r.fin)) + "</p>" +
      '<p style="font-size:15px"><b>' + r.ok + "</b> connexion(s) réussie(s) · <b" + (r.ko ? ' style="color:#c62828"' : "") + ">" + r.ko + "</b> échec(s) · <b>" + r.personnes + "</b> personne(s) connectée(s)</p>" +
      (al.length ? '<p style="background:#fde5e5;border-radius:8px;padding:8px 12px;color:#c62828"><b>⚠ Échecs répétés (3 ou plus) :</b> ' + esc(al.join(", ")) + "</p>" : "") + blocs +
      '<p style="margin-top:20px;color:#6b7390;font-size:12px">Rapport automatique. Détail et historique complet : Paramètres du hub → Connexions.</p></div>';
  }

  /* ---------- Rapports conservés sur l'appareil, envoi ---------- */
  function liste() { var L = lire(LISTE, []); return Array.isArray(L) ? L : []; }
  function enregistrer(L) { ecrire(LISTE, L.slice(0, 40)); }
  function generer(now, force) {
    now = now || Date.now(); var c = cfg(), fin = new Date(now).toISOString(), prec = c.fin && Date.parse(c.fin) > now - 48 * 36e5 && Date.parse(c.fin) < now ? c.fin : "";
    var debut = prec || new Date(now - 864e5).toISOString(), r = construire(sources(), debut, fin);
    var x = { id: "rp" + now.toString(36) + Math.random().toString(36).slice(2, 5), t: fin, jour: jourLocal(now), rapport: r, vu: false, wa: false, test: !!force };
    var L = liste(); L.unshift(x); enregistrer(L); if (!force) setCfg({ derniere: jourLocal(now), fin: fin });
    return x;
  }
  function telWA(t) { t = String(t || "").replace(/\D/g, ""); return t.length === 10 ? "225" + t : t; }
  function lienWA(r, tel) { var n = telWA(tel || cfg().tel); return "https://wa.me/" + n + "?text=" + encodeURIComponent(texte(r)); }
  function envoyerWA(id) {
    var x = liste().filter(function (e) { return e.id === id; })[0]; if (!x) return false;
    var c = cfg(); if (!telWA(c.tel)) { alert("Renseignez le numéro WhatsApp du DG dans Paramètres du hub → Connexions."); return false; }
    var L = liste(); L.forEach(function (e) { if (e.id === id) { e.wa = true; e.vu = true; } }); enregistrer(L);
    try { G.open(lienWA(x.rapport, c.tel), "_blank", "noopener"); } catch (e) { }
    barre(); return true;
  }
  function marquerVu(id) { var L = liste(); L.forEach(function (e) { if (!id || e.id === id) e.vu = true; }); enregistrer(L); barre(); }

  /* ---------- Planification (côté poste) ---------- */
  function verifier(now) {
    now = now || Date.now(); var c = cfg(); if (!c.actif) return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(c.heure), h = m ? +m[1] : 11, mi = m ? +m[2] : 0, p = new Date(now).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
    if (p[0] * 60 + p[1] < h * 60 + mi) return null;
    if (lire(CFG, {}).derniere === jourLocal(now)) return null;
    setCfg({ derniere: jourLocal(now) });   /* réservé tout de suite : un seul poste génère, même si plusieurs onglets sont ouverts */
    var x = generer(now, false); barre(); return x;
  }

  /* ---------- Bandeau et lecture ---------- */
  function resume(r) { return r.ok + " connexion(s), " + r.ko + " échec(s)"; }
  function barre() {
    var vieux = document.getElementById("rp-bar"); if (vieux) vieux.remove();
    var L = liste().filter(function (e) { return !e.vu; }); if (!L.length || !opts.peut()) return;
    var x = L[0], el = document.createElement("div"); el.id = "rp-bar"; el.setAttribute("role", "status");
    el.setAttribute("style", "position:fixed;right:12px;bottom:12px;z-index:9200;max-width:340px;background:#7a1d17;color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 8px 26px rgba(0,0,0,.35);font:14px/1.4 system-ui,Arial,sans-serif");
    el.innerHTML = '<div style="font-weight:800">📨 Rapport de connexion du ' + esc(new Date(x.t).toLocaleDateString("fr-FR", { timeZone: TZ })) + ' prêt</div><div style="opacity:.85;margin:2px 0 8px">' + esc(resume(x.rapport)) + (x.rapport.apps.some(function (a) { return a.alertes.length; }) ? " · ⚠ échecs répétés" : "") + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-rp="voir" style="font:inherit;padding:7px 12px;border-radius:9px;border:0;background:#fff;color:#7a1d17;font-weight:700;cursor:pointer">Voir</button><button type="button" data-rp="wa" style="font:inherit;padding:7px 12px;border-radius:9px;border:0;background:#25D366;color:#063;font-weight:700;cursor:pointer">Envoyer par WhatsApp</button><button type="button" data-rp="vu" aria-label="Fermer" style="font:inherit;padding:7px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.4);background:none;color:#fff;cursor:pointer">✕</button></div>';
    el.addEventListener("click", function (e) { var b = e.target.closest("[data-rp]"); if (!b) return; if (b.dataset.rp === "voir") voir(x.id); else if (b.dataset.rp === "wa") envoyerWA(x.id); else marquerVu(x.id); });
    document.body.appendChild(el);
  }
  function voir(id) {
    var x = liste().filter(function (e) { return e.id === id; })[0]; if (!x) return;
    var ov = document.getElementById("rp-ov"); if (ov) ov.remove();
    ov = document.createElement("div"); ov.id = "rp-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Rapport de connexion");
    ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,20,28,.6);z-index:9300;display:flex;align-items:center;justify-content:center;padding:10px");
    ov.innerHTML = '<div style="background:#fff;color:#1b2240;border-radius:14px;width:100%;max-width:780px;max-height:92vh;overflow:auto;padding:16px"><div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px"><button type="button" data-rp="wa" style="font:inherit;padding:8px 14px;border-radius:9px;border:0;background:#25D366;color:#063;font-weight:700;cursor:pointer">Envoyer par WhatsApp</button><button type="button" data-rp="x" style="font:inherit;padding:8px 14px;border-radius:9px;border:1px solid #c9d1db;background:#fff;cursor:pointer">Fermer</button></div>' + html(x.rapport) + "</div>";
    ov.addEventListener("click", function (e) { var b = e.target.closest("[data-rp]"); if (e.target === ov || (b && b.dataset.rp === "x")) { ov.remove(); marquerVu(id); } else if (b && b.dataset.rp === "wa") envoyerWA(id); });
    document.body.appendChild(ov); marquerVu(id);
  }

  /* ---------- Serveur (e-mail) ---------- */
  function serveur() {
    var u = lire("logistica_supabase", null), s = lire("logistica_sync", null), def = G.LOGISTICA_PASSERELLE || {}, url = (u && u.off) ? "" : (u && u.url) || def.url || "";
    if (!s || !s.actif || !s.cle || !/^https:\/\//.test(url)) return null;
    return { fn: String(url).replace(/\/+$/, "") + "/functions/v1/rapport-connexions", cle: s.cle };
  }
  async function appeler(corps) {
    var c = serveur(); if (!c) throw new Error("Synchronisation non activée sur cet appareil (Paramètres → Cloud / Supabase) : l'e-mail automatique en a besoin.");
    var r = await fetch(c.fn, { method: "POST", headers: { "content-type": "application/json", "x-sync-key": c.cle }, body: JSON.stringify(corps) }), j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.ok) throw new Error(j.erreur || "Le serveur a refusé la demande (" + r.status + ")");
    return j;
  }
  function emailsListe(s) { return String(s || "").split(/[,;\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(function (x) { return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(x); }).slice(0, 5); }
  function regler() { var c = cfg(); return appeler({ action: "regler", actif: c.actif, heure: c.heure, emails: emailsListe(c.emails) }); }
  function tester() { var c = cfg(); return appeler({ action: "tester", emails: emailsListe(c.emails) }); }

  function init(o) {
    opts = Object.assign({ peut: function () { return true; } }, o || {});
    clearInterval(tim); tim = setInterval(function () { try { verifier(); if (!document.getElementById("rp-bar")) barre(); } catch (e) { } }, 30000);
    setTimeout(function () { try { verifier(); barre(); } catch (e) { } }, 2500);
  }
  G.LOGISTICA_RAPPORT = { cfg: cfg, setCfg: setCfg, sources: sources, construire: construire, texte: texte, html: html, liste: liste, generer: generer, verifier: verifier, envoyerWA: envoyerWA, lienWA: lienWA, marquerVu: marquerVu, voir: voir, barre: barre, init: init, serveur: serveur, regler: regler, tester: tester, emailsListe: emailsListe, telWA: telWA };
})(window);
