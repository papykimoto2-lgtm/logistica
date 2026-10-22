/* Socle d'écran commun des modules métier (Placement, Assurance) : accès protégé, onglets, notifications, rendu, formulaires.
   Accès : comptes actifs d'une application de l'instance (administrateur, direction, commercial) ; mot de passe vérifié par auth-engine (PBKDF2),
   5 essais puis blocage 60 s, session de 30 min d'inactivité, mémorisée seulement dans l'onglet. Tout texte affiché est échappé. */
(function (G) {
  "use strict";
  var D = G.document;
  var E = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fc = function (n) { return Math.round(n || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ") + " F"; };
  var APPS = [["distribution", "logistica_erp_v1", "Distribution"], ["transport", "logistica_transport_v3", "Transport"], ["agro", "logistica_agro_v1", "Agro"]];
  var DUREE = 30 * 60 * 1000;
  function lire(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function hue(s) { var h = 0; String(s).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function ini(n) { return String(n).replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).slice(0, 2).map(function (w) { return (w[0] || "").toUpperCase(); }).join("") || "?"; }
  function av(n, s) { return '<span class="av" style="--h:' + hue(n) + ';--s:' + (s || 40) + 'px" aria-hidden="true">' + E(ini(n)) + "</span>"; }
  function kpi(ic, v, f, l, x) { x = x || {}; return '<div class="kpi"><div class="ic" aria-hidden="true">' + ic + '</div><b class="n ' + (x.er ? "er" : "") + '"' + (v != null && isFinite(v) ? ' data-n="' + v + '" data-f="' + f + '"' : "") + ">" + fmt(v, f) + '</b><span class="l">' + l + "</span></div>"; }
  function fmt(v, f) { return v == null || !isFinite(v) ? "—" : f === "fc" ? fc(v) : Math.round(v).toLocaleString("fr-FR").replace(/[  ]/g, " "); }
  function calme() { return G.matchMedia && G.matchMedia("(prefers-reduced-motion:reduce)").matches; }
  function ilya(d) { if (!d) return "—"; var j = Math.floor((Date.now() - Date.parse(String(d).slice(0, 10) + "T00:00:00Z")) / 864e5); if (!isFinite(j)) return "—"; if (j <= 0) return "aujourd'hui"; if (j === 1) return "hier"; if (j < 31) return "il y a " + j + " j"; if (j < 365) return "il y a " + Math.round(j / 30) + " mois"; return "il y a " + Math.round(j / 365) + " an(s)"; }

  function init(o) {
    var $ = function (s) { return D.getElementById(s); }, SK = o.id + "_sess", ROLES = o.roles || ["admin", "direction", "commercial"];
    var SESS = null, TRY = { n: 0, until: 0 }, ST = { tab: o.vues[0].id, msg: null, er: false, q: {}, sel: null }, LASTV = "";
    try { var s0 = JSON.parse(sessionStorage.getItem(SK) || "null"); if (s0 && s0.exp > Date.now()) SESS = s0; } catch (e) { }
    function comptes() { var L = []; APPS.forEach(function (a) { var g = lire(a[1]); if (!g) return; (g.users || []).filter(function (u) { return u.actif !== false && ROLES.indexOf(u.role) >= 0; }).forEach(function (u) { L.push({ app: a[0], appNom: a[2], key: a[1], id: u.id, nom: u.nom, role: u.role }); }); }); return L; }
    function garde() { if (SESS && SESS.exp < Date.now()) { SESS = null; try { sessionStorage.removeItem(SK); } catch (e) { } } if (SESS) { SESS.exp = Date.now() + DUREE; try { sessionStorage.setItem(SK, JSON.stringify(SESS)); } catch (e) { } } return !!SESS; }
    var msg = function (t, er) { ST.msg = t; ST.er = !!er; };
    var par = function () { return SESS ? SESS.nom + " (" + SESS.appNom + ")" : "?"; };
    function toast(t, er) { var x = $("toast"); if (!x) return; x.textContent = t; x.className = "on" + (er ? " er" : ""); clearTimeout(toast.t); toast.t = setTimeout(function () { x.className = ""; }, er ? 4200 : 2600); }
    function gate() {
      var cs = comptes();
      if (!cs.length) return '<div class="pan gate"><h2 style="margin-top:0">🔒 ' + E(o.titre) + ' verrouillé</h2><p class="note">Aucun compte autorisé sur cet appareil (administrateur, direction ou responsable commercial). Ouvrez d\'abord l\'application Distribution et connectez-vous une fois.</p></div>';
      return '<form id="gate" class="pan gate"><h2 style="margin-top:0">🔒 Accès ' + E(o.titre) + '</h2><p class="note">Réservé à l\'administrateur, à la direction et aux responsables commerciaux. Saisissez votre mot de passe habituel.</p>' +
        (ST.msg ? '<div class="msg ' + (ST.er ? "er" : "") + '" role="alert">' + E(ST.msg) + "</div>" : "") +
        '<div class="f"><label>Compte<select name="u">' + cs.map(function (c, i) { return '<option value="' + i + '">' + E(c.nom) + " — " + E(c.appNom) + " (" + E(c.role) + ")</option>"; }).join("") + '</select></label><label>Mot de passe<input type="password" name="pwd" autocomplete="current-password" required></label></div><button class="btn" type="submit">Déverrouiller</button></form>';
    }
    function tabs() { return '<nav class="tabs" role="tablist">' + o.vues.map(function (v) { var n = v.badge ? v.badge() : 0; return '<button class="tab' + (v.id === ST.tab ? " on" : "") + '" role="tab" data-a="tab" data-v="' + v.id + '"><span class="ti">' + v.ic + "</span> " + E(v.nom) + (n ? '<i class="pill">' + n + "</i>" : "") + "</button>"; }).join("") + "</nav>"; }
    function anim() { if (calme()) return; D.querySelectorAll("[data-n]").forEach(function (el) { var to = +el.dataset.n, f = el.dataset.f, t0 = performance.now(); (function step(t) { if (!el.isConnected) return; var k = Math.min(1, (t - t0) / 450); el.textContent = fmt(k < 1 ? to * (1 - Math.pow(1 - k, 3)) : to, f); if (k < 1) requestAnimationFrame(step); })(t0); }); }
    function render() {
      var ok = garde(); $("lock").hidden = !ok; $("who").textContent = ok ? SESS.nom : "";
      if (!ok) { $("app").innerHTML = gate(); return; }
      var foc = D.activeElement && D.activeElement.dataset && D.activeElement.dataset.q ? [D.activeElement.dataset.q, D.activeElement.selectionStart] : null, cle = ST.tab + ":" + (ST.sel || ""), v = o.vues.filter(function (x) { return x.id === ST.tab; })[0] || o.vues[0];
      if (o.avant) o.avant();
      $("app").innerHTML = tabs() + '<section class="' + (cle !== LASTV ? "vue" : "") + '">' + v.fn(ST) + "</section>"; LASTV = cle;
      if (ST.msg) { toast(ST.msg, ST.er); ST.msg = null; }
      if (foc) { var q = D.querySelector('[data-q="' + foc[0] + '"]'); if (q) { q.focus(); try { q.setSelectionRange(foc[1], foc[1]); } catch (e) { } } }
      anim();
    }
    function agir(fn, ok) { try { var r = fn(); if (ok) msg(typeof ok === "function" ? ok(r) : ok); } catch (e) { msg(e.message, 1); } render(); }
    D.addEventListener("click", function (e) {
      var lk = e.target.closest("a[href]"); if (lk && !lk.dataset.a) return;
      var b = e.target.closest("[data-a]"); if (!b) return; var a = b.dataset.a, v = b.dataset.v; if (b.tagName === "A") e.preventDefault();
      if (a === "lock") { SESS = null; try { sessionStorage.removeItem(SK); } catch (x) { } return render(); }
      if (!garde()) return render();
      if (a === "tab") { ST.tab = v; ST.sel = null; return render(); }
      if (a === "retour") { ST.sel = null; return render(); }
      if (a === "ouvrir") { ST.sel = v; return render(); }
      if (o.action) o.action(a, v, b, ST, agir, par);
    });
    D.addEventListener("input", function (e) { var q = e.target.dataset && e.target.dataset.q; if (!q || !garde()) return; ST.q[q] = e.target.value; render(); });
    D.addEventListener("change", function (e) { var s = e.target.closest("select[data-a]"); if (!s || !garde()) return; if (o.changer) o.changer(s.dataset.a, s.value, ST); render(); });
    D.addEventListener("submit", function (e) {
      var f = e.target; e.preventDefault();
      if (f.id === "gate") {
        var d = new FormData(f), c = comptes()[+d.get("u")];
        if (TRY.until > Date.now()) { msg("Trop d'essais : patientez " + Math.ceil((TRY.until - Date.now()) / 1000) + " s.", 1); return render(); }
        var g = c && lire(c.key), u = g && (g.users || []).filter(function (x) { return x.id === c.id && x.actif !== false && ROLES.indexOf(x.role) >= 0; })[0];
        (async function () {
          var r = { ok: false }; try { if (u) r = await G.LOGISTICA_AUTH.connecter(u, String(d.get("pwd"))); } catch (x) { }
          if (r.ok && r.legacy) msg("Les codes PIN ne sont plus acceptés : connectez-vous une fois à l'application pour créer votre mot de passe.", 1);
          else if (r.ok && u.chg) msg("Votre mot de passe est temporaire : ouvrez l'application et connectez-vous une fois pour le remplacer.", 1);
          else if (r.ok) { TRY = { n: 0, until: 0 }; SESS = { app: c.app, appNom: c.appNom, id: c.id, nom: c.nom, exp: Date.now() + DUREE }; try { sessionStorage.setItem(SK, JSON.stringify(SESS)); } catch (x) { } ST.msg = null; }
          else { TRY.n++; if (TRY.n >= 5) { TRY.n = 0; TRY.until = Date.now() + 60000; } msg("Compte ou mot de passe incorrect.", 1); }
          render();
        })();
        return;
      }
      if (!garde()) return render();
      if (o.formulaire) o.formulaire(f.dataset.f, new FormData(f), f, ST, agir, par);
    });
    G["LOGISTICA_" + o.id.toUpperCase() + "_RAFRAICHIR"] = function () { if (garde()) render(); };
    render();
    return { render: render, agir: agir, ST: ST, par: par, garde: garde, toast: toast, session: function () { return SESS; } };
  }
  G.LOGISTICA_SHELL = { init: init, E: E, fc: fc, fmt: fmt, av: av, kpi: kpi, ilya: ilya, hue: hue };
})(window);
