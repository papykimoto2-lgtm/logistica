/* Pagination commune des tableaux (Distribution, Agro, Transport) : une page à la fois, taille réglable, retour page 1 quand un filtre change.
   Le DOM reste léger même avec des milliers de lignes ; l'impression et les exports reprennent TOUTES les lignes (registre en mémoire). */
(function (G) {
  "use strict";
  var KS = "logistica_pg_size", reg = {}, page = {}, size = lireTaille(), onChange = null;
  function lireTaille() { try { var n = +localStorage.getItem(KS); if ([25, 50, 100, 200].indexOf(n) >= 0) return n; } catch (e) { } return 50; }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nb(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  /* key : identifiant stable du tableau ; rows : toutes les lignes (HTML) ; renvoie les lignes de la page et le bandeau de navigation */
  function decouper(key, rows) {
    var n = rows.length;
    if (n <= size) { delete reg[key]; delete page[key]; return { rows: rows, pager: "" }; }
    reg[key] = rows;
    var pages = Math.ceil(n / size), p = Math.min(Math.max(page[key] || 1, 1), pages), k = encodeURIComponent(key);
    page[key] = p;
    var b = function (lab, to, off) { return '<button type="button" class="btn sm ghost" data-pg="' + k + '|' + to + '"' + (off ? " disabled" : "") + ">" + lab + "</button>"; };
    var sel = [25, 50, 100, 200].map(function (s) { return '<option value="' + s + '"' + (s === size ? " selected" : "") + ">" + s + " / page</option>"; }).join("");
    return {
      rows: rows.slice((p - 1) * size, p * size),
      pager: '<div class="pgr noprint" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between;margin:-8px 0 14px;font-size:13px"><span class="mu">' + nb((p - 1) * size + 1) + "–" + nb(Math.min(p * size, n)) + " sur <b>" + nb(n) + "</b> lignes</span><span style=\"display:flex;gap:4px;align-items:center\">" +
        b("«", 1, p === 1) + b("‹", p - 1, p === 1) + '<span style="padding:0 6px">Page ' + p + " / " + pages + "</span>" + b("›", p + 1, p === pages) + b("»", pages, p === pages) +
        '<select data-pgs="1" style="width:auto" aria-label="Lignes par page">' + sel + "</select></span></div>"
    };
  }
  function reset() { page = {}; }
  function changer() { if (onChange) onChange(); else if (typeof G.render === "function") G.render(); }
  /* Impression : remet toutes les lignes dans une copie du DOM (les boutons de pagination sont retirés) */
  function depagine(racine) {
    racine.querySelectorAll("[data-pgk]").forEach(function (w) {
      var k = w.getAttribute("data-pgk"), all = reg[k], tb = w.querySelector("tbody");
      if (all && tb) tb.innerHTML = all.join("");
    });
    racine.querySelectorAll(".pgr").forEach(function (n) { n.remove(); });
    return racine;
  }
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-pg]") : null;
    if (t) {
      e.preventDefault(); e.stopPropagation();
      var a = t.getAttribute("data-pg").split("|"), k = decodeURIComponent(a[0]);
      page[k] = +a[1] || 1; changer(); return;
    }
    /* changement d'onglet ou de page de menu : retour à la première page */
    if (e.target && e.target.closest && e.target.closest(".tabs button,aside a,nav a,.navp a")) reset();
  }, true);
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute("data-pgs")) {
      e.stopPropagation(); size = +t.value || 50; try { localStorage.setItem(KS, String(size)); } catch (x) { } reset(); changer(); return;
    }
    if (t && t.closest && !t.closest(".pgr")) reset();   /* filtre, recherche, sélecteur : on repart de la page 1 */
  }, true);
  G.LOGISTICA_PAGER = { decouper: decouper, reset: reset, depagine: depagine, taille: function () { return size; }, surChangement: function (f) { onChange = f; }, registre: function () { return reg; } };
})(window);
