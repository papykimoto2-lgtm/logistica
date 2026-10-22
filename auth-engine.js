/* Moteur d'authentification partagé (Transport, Agro, Distributions, Paramètres) : mots de passe à la place des codes PIN.
   - Hachage PBKDF2-SHA256 salé (WebCrypto), 150 000 itérations : le mot de passe n'est jamais stocké ni comparé en clair.
   - Politique : 10 caractères minimum, 3 types de caractères sur 4, pas le nom de l'utilisateur, pas de mot de passe courant.
   - L'administrateur ne choisit jamais le mot de passe d'un autre : il reçoit un mot de passe temporaire à transmettre ; l'utilisateur doit le changer à sa première connexion.
   - Migration : un compte qui n'a encore qu'un ancien PIN se connecte une dernière fois avec ce PIN, puis DOIT créer un mot de passe (le PIN est alors effacé). */
(function (G) {
  "use strict";
  var IT = 150000, MIN_DEF = 10, MAX = 128, te = new TextEncoder();
  var COURANTS = ["motdepasse", "password", "azerty", "qwerty", "123456", "000000", "111111", "logistica", "logisticagroup", "bienvenue", "admin", "abc123", "iloveyou", "welcome"];
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function subtle() { return G.crypto && G.crypto.subtle ? G.crypto.subtle : null; }
  async function deriver(mdp, sel, it) {
    var s = subtle(); if (!s) throw new Error("Cet appareil ne permet pas la connexion sécurisée (ouvrez l'application en https).");
    var k = await s.importKey("raw", te.encode(String(mdp)), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await s.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sel, iterations: it }, k, 256));
  }
  function egal(a, b) { if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }
  async function creer(mdp) { var sel = G.crypto.getRandomValues(new Uint8Array(16)); return { v: 2, it: IT, s: b64(sel), h: b64(await deriver(mdp, sel, IT)) }; }
  async function verifier(mdp, rec) {
    if (!rec || !rec.s || !rec.h) return false;
    try { return egal(await deriver(mdp, unb64(rec.s), +rec.it || IT), unb64(rec.h)); } catch (e) { return false; }
  }
  function legacy(id, p) { var x = 5381, t = id + ":" + p; for (var i = 0; i < t.length; i++) x = ((x << 5) + x + t.charCodeAt(i)) | 0; return x; }
  function plat(x) { return String(x == null ? "" : x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  var CLS = [/[a-zà-ÿ]/, /[A-ZÀ-Ý]/, /\d/, /[^A-Za-zÀ-ÿ\d]/];
  function classes(m) { return CLS.filter(function (r) { return r.test(m); }).length; }
  function valider(mdp, o) {
    o = o || {}; mdp = String(mdp == null ? "" : mdp); var min = Math.max(8, +o.min || MIN_DEF);
    if (mdp.length < min) return "Le mot de passe doit contenir au moins " + min + " caractères.";
    if (mdp.length > MAX) return "Le mot de passe est trop long (" + MAX + " caractères maximum).";
    if (classes(mdp) < 3) return "Mélangez au moins 3 types de caractères : minuscules, majuscules, chiffres, symboles.";
    var l = plat(mdp);
    if (COURANTS.some(function (c) { return l.indexOf(c) >= 0 && l.length <= c.length + 6; })) return "Ce mot de passe est trop courant : choisissez-en un autre.";
    if (/(.)\1{3,}/.test(mdp)) return "Évitez de répéter le même caractère plus de 3 fois de suite.";
    var noms = String(o.nom || "").split(/\s+/).map(plat).filter(function (x) { return x.length >= 4; }), tout = plat(o.nom);
    if (tout.length >= 4) noms.push(tout);
    if (noms.some(function (n) { return l.indexOf(n) >= 0; })) return "Le mot de passe ne doit pas contenir votre nom.";
    return null;
  }
  function force(mdp) { var m = String(mdp || ""), s = 0; if (m.length >= 10) s++; if (m.length >= 14) s++; if (classes(m) >= 3) s++; if (classes(m) === 4 && m.length >= 12) s++; return valider(m) ? Math.min(s, 1) : Math.max(s, 2); }
  function alea(n) { var lim = 256 - (256 % n), b = new Uint8Array(1); do { G.crypto.getRandomValues(b); } while (b[0] >= lim); return b[0] % n; }
  function generer() {
    var A = ["ABCDEFGHJKMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "-_@#%+"], plan = [4, 4, 4, 2], out = [];
    plan.forEach(function (n, i) { for (var j = 0; j < n; j++) out.push(A[i][alea(A[i].length)]); });
    for (var i = out.length - 1; i > 0; i--) { var j = alea(i + 1), t = out[i]; out[i] = out[j]; out[j] = t; }
    return out.join("");
  }
  /* Vérifie le mot de passe d'un compte. Renvoie {ok, legacy}. legacy=true : ancien PIN accepté une dernière fois (création de mot de passe obligatoire). */
  async function connecter(u, mdp) {
    if (!u) return { ok: false };
    if (u.pwd) return { ok: await verifier(mdp, u.pwd), legacy: false };
    var f = ["h", "pin_h"].filter(function (k) { return typeof u[k] === "number"; })[0];
    if (f && u[f] === legacy(u.id, String(mdp))) return { ok: true, legacy: true };
    return { ok: false };
  }
  /* ---------- Journal de connexion ----------
     Une ligne par ouverture de session, échec, blocage, déconnexion ou accès à la gestion des comptes (Paramètres du hub), rangée dans l'état de l'application
     (G.connexions), donc enregistrée et synchronisée avec elle. Jamais de mot de passe ni de donnée secrète : la personne, l'application, l'événement, l'appareil.
     ev : ok (connexion), ko (mot de passe incorrect), bloque (tentative pendant un blocage), inactif (compte désactivé), out (déconnexion), demo (accès démo), param_ok / param_ko (gestion des comptes via le hub). */
  var CAP_CX = 3000;
  function appareil(ua) {
    ua = String(ua || (G.navigator && G.navigator.userAgent) || "");
    var nav = /SamsungBrowser/i.test(ua) ? "Samsung Internet" : /Edg\//i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera" : /Firefox/i.test(ua) ? "Firefox" : /Chrome|CriOS/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : "Navigateur";
    var sys = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Système inconnu";
    var typ = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? "tablette" : /Mobi|iPhone|Android/i.test(ua) ? "téléphone" : "ordinateur";
    return typ + " · " + sys + " · " + nav;
  }
  function trace(St, e) {
    if (!St || !e || !e.ev) return null;
    var L = St.connexions = Array.isArray(St.connexions) ? St.connexions : [];
    var x = { id: "cx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: new Date().toISOString(), app: String(e.app || ""), uid: String(e.uid || ""), nom: String(e.nom || "").slice(0, 80), role: String(e.role || ""), ev: String(e.ev), motif: String(e.motif || "").slice(0, 120), app_: e.appareil || appareil() };
    if (e.via) x.via = String(e.via);
    L.push(x); if (L.length > CAP_CX) L.splice(0, L.length - CAP_CX);
    return x;
  }
  async function appliquer(u, mdp, temporaire) { u.pwd = await creer(mdp); delete u.h; delete u.pin_h; if (temporaire) u.chg = true; else delete u.chg; u.pwd_le = new Date().toISOString(); }
  var DEMO_MDP = "Demo@Logistica2026", DEMO = {"v":2,"it":150000,"s":"Gmt2PN55CpESfdtywoJVcw==","h":"FrwZ4H7BtBV/u2FMxhPhQKy0D5WfFAhqqHgAlpkM0zc="};   /* comptes de démonstration (mot de passe « Demo@Logistica2026 », haché) : à remplacer en production */

  /* ---------- Mise en production ----------
     Une installation neuve ne contient AUCUNE donnée de démonstration : un seul administrateur (KESSIE), à qui le logiciel impose de changer son mot de passe à la première connexion.
     Le mode démonstration (données d'exemple, profils prêts à l'emploi) n'existe que si « logistica_demo » vaut 1 sur l'appareil (ouvrir l'application avec ?demo=1) : réservé aux tests et aux présentations. */
  var ADMIN_PROD = (G.ERP_MARQUE && G.ERP_MARQUE.admin) || { nom: "KESSIE", role: "admin", pwd: {"v":2,"it":150000,"s":"yDBjFkfuh6JJdWfOCZvWVA==","h":"k3sCfLXaCoI3AncQjn1I66xZf6c6znrNsxg7p8iF154="} };   /* instance cliente : administrateur défini dans marque.js (empreinte seulement) */
  try { if (/[?&]demo=1(&|$)/.test(location.search)) localStorage.setItem("logistica_demo", "1"); else if (/[?&]demo=0(&|$)/.test(location.search)) localStorage.removeItem("logistica_demo"); } catch (e) { }
  function demoOn() { try { return localStorage.getItem("logistica_demo") === "1"; } catch (e) { return false; } }
  function adminProd(id) { return { id: id, nom: ADMIN_PROD.nom, role: ADMIN_PROD.role, actif: true, pwd: JSON.parse(JSON.stringify(ADMIN_PROD.pwd)), chg: true }; }
  /* Reconnaît les comptes d'une démonstration (mot de passe de démonstration, ou anciens PIN de démonstration jamais changés). */
  function demoUsers(users) {
    return (users || []).some(function (u) {
      if (u && u.pwd && u.pwd.h === DEMO.h) return true;
      var h = u && (typeof u.h === "number" ? u.h : typeof u.pin_h === "number" ? u.pin_h : null); if (h == null) return false;
      return ["1234", "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999"].some(function (p) { return legacy(u.id, p) === h; });
    });
  }
  /* Données de démonstration trouvées sur un appareil en production : l'utilisateur confirme leur effacement (refus mémorisé). */
  function purgerDemo(users, cles, nomApp) {
    if (demoOn() || !demoUsers(users)) return false;
    try { if (localStorage.getItem("logistica_demo_garde_" + nomApp) === "1") return false; } catch (e) { }
    var ok = true; try { ok = confirm("MISE EN PRODUCTION — " + nomApp + "\n\nDes données de démonstration ont été trouvées sur cet appareil (comptes et exemples).\nElles vont être EFFACÉES pour repartir d'une base vide avec l'administrateur " + ADMIN_PROD.nom + ".\n\nOK = effacer et passer en production\nAnnuler = conserver ces données de démonstration"); } catch (e) { }
    if (!ok) { try { localStorage.setItem("logistica_demo_garde_" + nomApp, "1"); } catch (e) { } return false; }
    (cles || []).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { } });
    try { sessionStorage.clear(); } catch (e) { }
    return true;
  }

  /* ---------- Bouton « afficher / masquer » sur tous les champs de mot de passe ---------- */
  (function oeil() {
    if (!G.document) return;
    var d = G.document, css = ".aa-w{position:relative;display:block;width:100%}.aa-w>input{width:100%;padding-right:46px!important;box-sizing:border-box}.aa-e{position:absolute;right:4px;top:50%;transform:translateY(-50%);border:0;background:transparent;font-size:19px;line-height:1;cursor:pointer;padding:8px;border-radius:8px;color:#516070}.aa-e:focus-visible{outline:3px solid #7ab0ff}";
    function habiller(i) {
      if (i.dataset.aa || i.closest("#aa-ov")) return; i.dataset.aa = "1";
      var w = d.createElement("span"), b = d.createElement("button"), foc = d.activeElement === i, st = foc ? [i.selectionStart, i.selectionEnd] : null; w.className = "aa-w";
      b.type = "button"; b.className = "aa-e"; b.textContent = "👁"; b.title = "Afficher le mot de passe"; b.setAttribute("aria-label", "Afficher le mot de passe"); b.setAttribute("aria-pressed", "false"); b.tabIndex = 0;
      b.onclick = function (e) { e.preventDefault(); var v = i.type === "password"; i.type = v ? "text" : "password"; b.textContent = v ? "🙈" : "👁"; var lib = v ? "Masquer le mot de passe" : "Afficher le mot de passe"; b.title = lib; b.setAttribute("aria-label", lib); b.setAttribute("aria-pressed", v ? "true" : "false"); };
      i.parentNode.insertBefore(w, i); w.appendChild(i); w.appendChild(b);
      if (foc) { try { i.focus(); i.setSelectionRange(st[0], st[1]); } catch (e) { } }
    }
    var t = 0;
    function balayer() { t = 0; Array.prototype.forEach.call(d.querySelectorAll("input[type=password]:not([data-aa])"), habiller); }
    function demarrer() {
      if (!d.getElementById("aa-eye-css")) { var st = d.createElement("style"); st.id = "aa-eye-css"; st.textContent = css; d.head.appendChild(st); }
      balayer(); new MutationObserver(function () { if (!t) t = setTimeout(balayer, 0); }).observe(d.documentElement, { childList: true, subtree: true });
    }
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", demarrer); else demarrer();
  })();

  /* ---------- Écrans (indépendants de l'application hôte) ---------- */
  var CSS = "#aa-ov{position:fixed;inset:0;z-index:100000;background:rgba(15,20,28,.74);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Arial,sans-serif}" +
    "#aa-ov .bx{background:#fff;color:#1c2430;border-radius:14px;width:min(440px,100%);max-height:94vh;overflow:auto;padding:20px;box-shadow:0 12px 44px rgba(0,0,0,.45)}#aa-ov h2{margin:0 0 6px;font-size:19px}#aa-ov p{margin:6px 0;font-size:14px;line-height:1.45;color:#46505e}" +
    "#aa-ov label{display:block;font-size:13px;font-weight:700;margin-top:12px}#aa-ov .fl{display:flex;gap:6px;margin-top:4px}#aa-ov input{flex:1;min-width:0;font:16px Arial;padding:11px 12px;border:1.5px solid #b9c2cd;border-radius:9px;background:#fff;color:#1c2430}" +
    "#aa-ov input:focus{outline:3px solid #7ab0ff;border-color:#2563eb}#aa-ov button{font:700 14px Arial;padding:11px 14px;border-radius:9px;border:1.5px solid #b9c2cd;background:#f3f5f8;color:#1c2430;cursor:pointer;min-height:44px}#aa-ov button.p{background:#1f3a5f;color:#fff;border-color:#1f3a5f}" +
    "#aa-ov .ft{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}#aa-ov .er{color:#b3261e;font-weight:700;font-size:13px;margin-top:8px;min-height:18px}#aa-ov .fo{display:flex;gap:4px;margin-top:6px}#aa-ov .fo i{flex:1;height:5px;border-radius:3px;background:#dde2e8}" +
    "#aa-ov .mdp{font:700 22px 'Courier New',monospace;letter-spacing:1px;background:#f3f5f8;border:1.5px dashed #8896a6;border-radius:10px;padding:14px;text-align:center;margin:12px 0;word-break:break-all;user-select:all}";
  function ov(html, annuler) {
    var e = document.getElementById("aa-ov"); if (e) e.remove();
    if (!document.getElementById("aa-css")) { var st = document.createElement("style"); st.id = "aa-css"; st.textContent = CSS; document.head.appendChild(st); }
    e = document.createElement("div"); e.id = "aa-ov"; e.innerHTML = '<div class="bx" role="dialog" aria-modal="true" aria-labelledby="aa-t">' + html + "</div>"; document.body.appendChild(e);
    var prev = document.activeElement;
    e.addEventListener("keydown", function (k) {
      if (k.key === "Escape" && annuler) { k.preventDefault(); annuler(); return; }
      if (k.key === "Tab") { var L = Array.prototype.filter.call(e.querySelectorAll("input,button"), function (x) { return !x.disabled; }), i = L.indexOf(document.activeElement);
        if (k.shiftKey && i <= 0) { k.preventDefault(); L[L.length - 1].focus(); } else if (!k.shiftKey && (i === L.length - 1 || i < 0)) { k.preventDefault(); L[0].focus(); } }
    });
    e._fermer = function () { e.remove(); try { if (prev && prev.focus) prev.focus(); } catch (x) { } };
    return e;
  }
  function fermer() { var e = document.getElementById("aa-ov"); if (e && e._fermer) e._fermer(); }

  /* Changement / création de mot de passe.
     o = { titre, nom, intro, ancien: async (mdp)=>bool (si fourni : champ « mot de passe actuel »), obligatoire, min, enregistrer: async (mdp)=>void } → Promise<boolean> */
  function ouvrirChangement(o) {
    return new Promise(function (res) {
      var annuler = o.obligatoire ? null : function () { fermer(); res(false); };
      var h = '<h2 id="aa-t">' + esc(o.titre || "Mot de passe") + "</h2>" + (o.intro ? "<p>" + esc(o.intro) + "</p>" : "") +
        (o.ancien ? '<label>Mot de passe actuel<div class="fl"><input type="password" id="aa-o" autocomplete="current-password"></div></label>' : "") +
        '<label>Nouveau mot de passe<div class="fl"><input type="password" id="aa-n" autocomplete="new-password"><button type="button" id="aa-v" aria-pressed="false" aria-label="Afficher le mot de passe">Voir</button></div></label>' +
        '<div class="fo" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p id="aa-r" style="font-size:12px">' + (+o.min || MIN_DEF) + " caractères minimum, avec au moins 3 types : minuscules, majuscules, chiffres, symboles.</p>" +
        '<label>Confirmer le nouveau mot de passe<div class="fl"><input type="password" id="aa-c" autocomplete="new-password"></div></label><div class="er" id="aa-e" role="alert"></div>' +
        '<div class="ft">' + (annuler ? '<button type="button" id="aa-x">Annuler</button>' : "") + '<button type="button" class="p" id="aa-ok">Enregistrer</button></div>';
      var e = ov(h, annuler), $ = function (id) { return e.querySelector("#" + id); };
      var CO = ["#c0392b", "#d9822b", "#2e8b57", "#1b6e3d"];
      $("aa-n").addEventListener("input", function () { var s = force($("aa-n").value), bars = e.querySelectorAll(".fo i"); for (var i = 0; i < 4; i++) bars[i].style.background = i < s && $("aa-n").value ? CO[Math.max(0, s - 1)] : "#dde2e8"; });
      $("aa-v").onclick = function () { var t = $("aa-n").type === "password"; ["aa-n", "aa-c", "aa-o"].forEach(function (i) { if ($(i)) $(i).type = t ? "text" : "password"; }); $("aa-v").textContent = t ? "Masquer" : "Voir"; $("aa-v").setAttribute("aria-pressed", t ? "true" : "false"); };
      if ($("aa-x")) $("aa-x").onclick = annuler;
      var ok = $("aa-ok");
      async function valide() {
        var er = $("aa-e"); er.textContent = ""; ok.disabled = true;
        try {
          if (o.ancien && !(await o.ancien($("aa-o").value))) throw new Error("Mot de passe actuel incorrect.");
          var n = $("aa-n").value, m = valider(n, { nom: o.nom, min: o.min }); if (m) throw new Error(m);
          if (n !== $("aa-c").value) throw new Error("La confirmation ne correspond pas.");
          if (o.ancien && n === $("aa-o").value) throw new Error("Choisissez un mot de passe différent de l'actuel.");
          await o.enregistrer(n); fermer(); res(true);
        } catch (x) { er.textContent = x.message || String(x); ok.disabled = false; }
      }
      ok.onclick = valide; e.addEventListener("keydown", function (k) { if (k.key === "Enter" && k.target.tagName === "INPUT") { k.preventDefault(); valide(); } });
      setTimeout(function () { try { ($("aa-o") || $("aa-n")).focus(); } catch (x) { } }, 30);
    });
  }

  /* Affiche UNE FOIS le mot de passe temporaire d'un compte créé ou réinitialisé. */
  function afficherTemp(o) {
    return new Promise(function (res) {
      var h = '<h2 id="aa-t">' + esc(o.titre || "Mot de passe temporaire") + "</h2><p><b>" + esc(o.nom) + "</b> : communiquez ce mot de passe de vive voix ou par message privé. Il ne sera plus affiché ; " + esc(o.nom) + " devra le remplacer à la première connexion.</p>" +
        (o.ident ? '<p style="margin:6px 0 2px">Identifiant : <b id="aa-id">' + esc(o.ident) + "</b></p>" : "") +
        '<div class="mdp" id="aa-m">' + esc(o.mdp) + '</div><div class="er" id="aa-e" style="color:#1b6e3d" role="status"></div><div class="ft"><button type="button" id="aa-cp">Copier</button>' +
        (o.msg ? '<button type="button" id="aa-cm">Copier le message</button><button type="button" id="aa-wa">💬 Envoyer par WhatsApp</button>' : "") + '<button type="button" class="p" id="aa-ok">J\'ai noté le mot de passe</button></div>';
      var e = ov(h, null);
      e.querySelector("#aa-cp").onclick = function () { var er = e.querySelector("#aa-e"); try { navigator.clipboard.writeText(o.mdp).then(function () { er.textContent = "Copié."; }, function () { er.textContent = "Copie impossible : recopiez-le à la main."; }); } catch (x) { er.textContent = "Copie impossible : recopiez-le à la main."; } };
      if (o.msg) {
        e.querySelector("#aa-cm").onclick = function () { var er = e.querySelector("#aa-e"); try { navigator.clipboard.writeText(o.msg).then(function () { er.textContent = "Message copié."; }, function () { er.textContent = "Copie impossible : recopiez-le à la main."; }); } catch (x) { er.textContent = "Copie impossible : recopiez-le à la main."; } };
        e.querySelector("#aa-wa").onclick = function () { var n = String(o.tel || "").replace(/\D/g, ""); try { window.open("https://wa.me/" + n + "?text=" + encodeURIComponent(o.msg), "_blank", "noopener"); } catch (x) { } };
      }
      e.querySelector("#aa-ok").onclick = function () { fermer(); res(true); };
      setTimeout(function () { try { e.querySelector("#aa-ok").focus(); } catch (x) { } }, 30);
    });
  }

  G.LOGISTICA_AUTH = { IT: IT, MIN_DEF: MIN_DEF, creer: creer, verifier: verifier, valider: valider, force: force, generer: generer, connecter: connecter, trace: trace, appareil: appareil, appliquer: appliquer, legacy: legacy, ouvrirChangement: ouvrirChangement, afficherTemp: afficherTemp, fermer: fermer, DEMO_MDP: DEMO_MDP, DEMO: DEMO, demoOn: demoOn, adminProd: adminProd, demoUsers: demoUsers, purgerDemo: purgerDemo };
})(typeof window !== "undefined" ? window : globalThis);
