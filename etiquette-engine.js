/* LOGISTICA — moteur commun d'impression d'étiquettes à QR code pour imprimante thermique d'étiquettes (Xprinter XP-365B : 203 dpi, papier de 20 à 82 mm, USB).
   Impression par la boîte d'impression du navigateur avec le pilote de l'imprimante : la taille de l'étiquette est portée par la règle CSS @page, une étiquette par page.
   Aucune donnée n'est enregistrée sur le serveur ; seuls les réglages de l'étiquette (taille, copies) sont mémorisés sur le poste.

   ANGELS_ETIQ.ouvrir({ titre, items:[{ qr, titre, l1, l2, l3, code }], apres:fn })   ouvre l'aperçu et l'impression
   ANGELS_ETIQ.html(items, { w, h, copies, cadre })                                  document HTML complet (testable)
   Contenu d'un QR code : « AGE1<type>|<identifiant> » — P produit, M moto, L livreur, V véhicule, T lot ; les QR de colis gardent leur format propre (AGE1|commande|n/N|code). */
(function (G) {
  "use strict";
  var KEY = "angels_etiq", W_MIN = 20, W_MAX = 82, H_MIN = 15, H_MAX = 200, COPIES_MAX = 50;
  var PRE = [["80x80", "80 × 80 mm (autocollant maximal, par défaut)", 80, 80], ["50x30", "50 × 30 mm", 50, 30], ["40x30", "40 × 30 mm", 40, 30], ["60x40", "60 × 40 mm", 60, 40], ["80x50", "80 × 50 mm", 80, 50], ["perso", "Autre taille…", 0, 0]];
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var cut = function (s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  /* ---------- Réglages du poste ---------- */
  function cfg() {
    var c = {}; try { c = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { c = {}; }
    var t = PRE.some(function (p) { return p[0] === c.t; }) ? c.t : "80x80", p = PRE.filter(function (x) { return x[0] === t; })[0];
    return { t: t, w: clamp(Math.round(+(t === "perso" ? c.w : p[2]) || 80), W_MIN, W_MAX), h: clamp(Math.round(+(t === "perso" ? c.h : p[3]) || 80), H_MIN, H_MAX), copies: clamp(Math.round(+c.copies || 1), 1, COPIES_MAX) };
  }
  function enregistrer(c) { try { localStorage.setItem(KEY, JSON.stringify({ t: c.t, w: c.w, h: c.h, copies: c.copies })); } catch (e) { } }

  /* ---------- QR code ---------- */
  function qrSvg(txt) {
    if (typeof G.qrcode !== "function") return "";
    var q = G.qrcode(0, "M"); q.addData(String(txt)); q.make();
    return q.createSvgTag({ scalable: true, margin: 0 }).replace("<svg ", '<svg shape-rendering="crispEdges" ');
  }

  /* ---------- Étiquette ---------- */
  function etiquette(it, w, h) {
    var k = clamp(Math.min(w / 50, h / 30), 0.8, 2.2), horiz = w / h >= 1.15, pad = w / h >= 1.15 ? 1.2 : 2.2;
    var qs = horiz ? Math.min(h - 2 * pad, w * 0.52) : Math.min(w - 2 * pad, h * 0.62);
    var qr = it.qr ? '<div class="q" style="width:' + qs.toFixed(1) + "mm;height:" + qs.toFixed(1) + 'mm">' + qrSvg(it.qr) + "</div>" : "";
    var t = it.titre ? '<div class="t" style="font-size:' + (9.5 * k).toFixed(1) + 'pt">' + esc(cut(it.titre, 22)) + "</div>" : "";
    var l = [it.l1, it.l2, it.l3].filter(Boolean).map(function (x, i) { return '<div class="l' + (i ? " s" : "") + '" style="font-size:' + ((i ? 6.5 : 7.5) * k).toFixed(1) + 'pt">' + esc(cut(x, 40)) + "</div>"; }).join("");
    var c = it.code ? '<div class="c" style="font-size:' + (8.5 * k).toFixed(1) + 'pt">' + esc(cut(it.code, 14)) + "</div>" : "";
    return '<div class="et ' + (horiz ? "h" : "v") + '" style="width:' + w + "mm;height:" + (h - 0.4).toFixed(1) + "mm;padding:" + pad + 'mm">' + qr + '<div class="tx">' + t + l + c + "</div></div>";
  }
  function html(items, o) {
    o = o || {}; var w = clamp(Math.round(+o.w || 80), W_MIN, W_MAX), h = clamp(Math.round(+o.h || 80), H_MIN, H_MAX), n = clamp(Math.round(+o.copies || 1), 1, COPIES_MAX), L = [];
    (items || []).slice(0, 500).forEach(function (it) { for (var i = 0; i < n; i++) L.push(etiquette(it, w, h)); });
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title> </title><style>@page{size:" + w + "mm " + h + "mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#e8e8e8}" +
      ".et{background:#fff;overflow:hidden;display:flex;gap:1.2mm;page-break-after:always;break-after:page;margin:0 auto 3mm;" + (o.cadre === false ? "" : "outline:1px dashed #999;") + "}.et.v{flex-direction:column;align-items:center;text-align:center}.et.h{flex-direction:row;align-items:center}" +
      ".q{flex:none;background:#fff}.q svg{width:100%;height:100%;display:block}.tx{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.3mm;overflow:hidden}.et.v .tx{align-items:center;width:100%}" +
      ".t{font-weight:800;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.l{line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.l.s{color:#222}.c{font-family:'Courier New',monospace;font-weight:700;letter-spacing:.4mm;white-space:nowrap}" +
      "@media print{body{background:#fff}.et{margin:0;outline:0}.et:last-child{page-break-after:auto;break-after:auto}}</style></head><body>" + L.join("") + "</body></html>";
  }

  /* Impression : fenêtre dédiée. Imprimée depuis un cadre intégré, la page reprend les marges par défaut de la page principale et le navigateur ajoute en-tête (date, titre) et pied de page (adresse, n°) sur l'autocollant ;
     dans sa propre fenêtre, la règle @page (taille exacte, marges nulles) s'applique et rien d'autre n'est imprimé. Repli sur le cadre si la fenêtre est bloquée. */
  function imprimer(doc, cadre) {
    var auto = "<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},250)};window.onafterprint=function(){window.close()}<\/script>";
    var w = null; try { w = window.open("", "_blank", "width=520,height=520"); } catch (e) { w = null; }
    if (w) { w.document.open(); w.document.write(doc.replace("</body>", auto + "</body>")); w.document.close(); return true; }
    try { cadre.contentWindow.focus(); cadre.contentWindow.print(); } catch (x) { alert("Impression impossible : autorisez les fenêtres surgissantes pour ce site. " + x.message); }
    return false;
  }

  /* ---------- PDF à la taille exacte (aucun en-tête ni pied de page) ----------
     Chaque étiquette est rasterisée (SVG + foreignObject, environ 305 dpi) puis placée sur une page PDF de la taille exacte de l'étiquette. Le lecteur PDF du navigateur
     n'ajoute ni date, ni titre, ni adresse, ni numéro de page : Ctrl+P imprime l'étiquette seule. */
  var PPM = 12, PX = 96 / 25.4;   /* points par mm (environ 305 dpi) ; pixels CSS par mm */
  function rasteriser(docHtml, sel, w, h) {
    var d = new DOMParser().parseFromString(docHtml, "text/html"),
      css = Array.prototype.map.call(d.querySelectorAll("style"), function (x) { return x.textContent; }).join("\n") + "\n" + sel + "{margin:0!important;border:0!important;outline:0!important}",
      els = Array.prototype.slice.call(d.querySelectorAll(sel)), W = Math.round(w * PX), H = Math.round(h * PX), cw = Math.round(w * PPM), ch = Math.round(h * PPM);
    return els.reduce(function (p, el) {
      return p.then(function (L) {
        var wrap = d.createElement("div"), st = d.createElement("style"); st.textContent = css; wrap.appendChild(st); wrap.appendChild(el.cloneNode(true));
        var xml = new XMLSerializer().serializeToString(wrap).replace("<div", '<div style="width:' + w + "mm;height:" + h + 'mm;background:#fff;color:#000;font:11px Arial,Helvetica,sans-serif"');
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' + xml + "</foreignObject></svg>";
        return new Promise(function (ok, ko) {
          var u = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), im = new Image();   /* data: et non blob: : sinon le navigateur marque le canevas comme « contaminé » */
          im.onload = function () { var c = document.createElement("canvas"); c.width = cw; c.height = ch; var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch); g.drawImage(im, 0, 0, cw, ch); L.push(c); ok(L); };
          im.onerror = function () { ko(new Error("Rendu de l'étiquette impossible")); }; im.src = u;
        });
      });
    }, Promise.resolve([]));
  }
  function pdf(canvases, w, h) {
    var enc = new TextEncoder(), parts = [], off = [], len = 0, mm = 72 / 25.4, pw = (w * mm).toFixed(2), ph = (h * mm).toFixed(2);
    function add(x) { var b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; }
    function obj(n, body) { off[n] = len; add(n + " 0 obj\n"); add(body); add("\nendobj\n"); }
    var N = canvases.length, kids = canvases.map(function (_, i) { return 3 + i * 3 + " 0 R"; }).join(" ");
    add("%PDF-1.4\n"); obj(1, "<< /Type /Catalog /Pages 2 0 R >>"); obj(2, "<< /Type /Pages /Kids [" + kids + "] /Count " + N + " >>");
    canvases.forEach(function (c, i) {
      var n = 3 + i * 3, bin = atob(c.toDataURL("image/jpeg", 0.95).split(",")[1]), jpg = new Uint8Array(bin.length), k;
      for (k = 0; k < bin.length; k++) jpg[k] = bin.charCodeAt(k);
      var cs = "q " + pw + " 0 0 " + ph + " 0 0 cm /Im0 Do Q";
      obj(n, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] /Resources << /XObject << /Im0 " + (n + 2) + " 0 R >> >> /Contents " + (n + 1) + " 0 R >>");
      obj(n + 1, "<< /Length " + cs.length + " >>\nstream\n" + cs + "\nendstream");
      off[n + 2] = len; add((n + 2) + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + c.width + " /Height " + c.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpg.length + " >>\nstream\n"); add(jpg); add("\nendstream\nendobj\n");
    });
    var total = 3 + N * 3, xr = len; add("xref\n0 " + total + "\n0000000000 65535 f \n");
    for (var n = 1; n < total; n++) add(("0000000000" + off[n]).slice(-10) + " 00000 n \n");
    add("trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xr + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }
  /* Ouvre le PDF dans un nouvel onglet (fenêtre ouverte pendant le clic pour ne pas être bloquée) ; à défaut, le télécharge. */
  function ouvrirPdf(docHtml, sel, w, h, nom) {
    var win = null; try { win = window.open("", "_blank"); if (win) win.document.write('<p style="font:14px system-ui;padding:20px">Préparation du PDF…</p>'); } catch (e) { win = null; }
    return rasteriser(docHtml, sel, w, h).then(function (c) {
      if (!c.length) throw new Error("Aucune étiquette");
      var u = URL.createObjectURL(pdf(c, w, h));
      if (win) win.location.href = u; else { var a = document.createElement("a"); a.href = u; a.download = (nom || "etiquettes") + ".pdf"; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(function () { URL.revokeObjectURL(u); }, 120000); return u;
    }).catch(function (e) { if (win) win.close(); alert("PDF impossible : " + e.message); });
  }

  /* ---------- Aperçu et impression ---------- */
  function ouvrir(o) {
    o = o || {}; var items = Array.isArray(o.items) ? o.items.filter(function (x) { return x && (x.qr || x.titre); }) : [];
    if (!items.length) { alert("Aucune étiquette à imprimer."); return null; }
    var c = cfg(), ov = document.getElementById("et-ov"); if (ov) ov.remove();
    ov = document.createElement("div"); ov.id = "et-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Impression d'étiquettes");
    ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,20,28,.65);z-index:9995;display:flex;align-items:center;justify-content:center;padding:10px");
    var fld = "font:inherit;padding:7px;border:1px solid #c9d1db;border-radius:8px;background:#fff;color:#1c2430";
    ov.innerHTML = '<div style="background:#fff;color:#1c2430;border-radius:14px;width:100%;max-width:640px;max-height:94vh;overflow:auto;padding:16px;font:14px system-ui,Arial,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:16px">' + esc(o.titre || "Étiquettes") + '</b><button type="button" data-et="x" aria-label="Fermer" style="border:0;background:none;font-size:22px;cursor:pointer;line-height:1">×</button></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:10px 0"><label style="font-size:12px;color:#5b6572">Taille<br><select id="et-t" style="' + fld + '">' + PRE.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === c.t ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select></label>" +
      '<span id="et-p" style="display:' + (c.t === "perso" ? "flex" : "none") + ';gap:6px;align-items:flex-end"><label style="font-size:12px;color:#5b6572">Largeur (mm)<br><input id="et-w" type="number" min="' + W_MIN + '" max="' + W_MAX + '" value="' + c.w + '" style="width:80px;' + fld + '"></label><label style="font-size:12px;color:#5b6572">Hauteur (mm)<br><input id="et-h" type="number" min="' + H_MIN + '" max="' + H_MAX + '" value="' + c.h + '" style="width:80px;' + fld + '"></label></span>' +
      '<label style="font-size:12px;color:#5b6572">Copies par étiquette<br><input id="et-c" type="number" min="1" max="' + COPIES_MAX + '" value="' + c.copies + '" style="width:80px;' + fld + '"></label><span id="et-n" style="font-size:13px;color:#5b6572"></span></div>' +
      '<iframe id="et-f" title="Aperçu des étiquettes" style="width:100%;height:300px;border:1px solid #c9d1db;border-radius:8px;background:#e8e8e8"></iframe>' +
      '<p style="font-size:12px;color:#5b6572;margin:8px 0"><b>Pour supprimer l\'en-tête et le pied de page :</b> bouton « PDF sans en-tête », puis Ctrl+P dans le PDF. Sinon, dans la boîte d\'impression : imprimante <b>Xprinter XP-365B</b>, format de papier <b>identique à la taille ci-dessus</b>, marges <b>Aucune</b>, échelle <b>100 %</b>, et <b>décochez « En-têtes et pieds de page »</b> (sinon la date, le titre et l\'adresse du site s\'impriment sur l\'autocollant).</p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-et="x" style="font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #c9d1db;background:#fff;cursor:pointer">Fermer</button><button type="button" data-et="pdf" title="PDF à la taille exacte : aucun en-tête ni pied de page" style="font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #1f3a5f;background:#fff;color:#1f3a5f;cursor:pointer;font-weight:700">📄 PDF sans en-tête</button><button type="button" data-et="p" style="font:inherit;padding:8px 14px;border-radius:8px;border:0;background:#1f3a5f;color:#fff;cursor:pointer;font-weight:700">🖨 Imprimer</button></div></div>';
    document.body.appendChild(ov);
    var q = function (id) { return ov.querySelector("#" + id); };
    function lire() {
      var t = q("et-t").value, p = PRE.filter(function (x) { return x[0] === t; })[0], w = t === "perso" ? +q("et-w").value : p[2], h = t === "perso" ? +q("et-h").value : p[3];
      return { t: t, w: clamp(Math.round(w || 80), W_MIN, W_MAX), h: clamp(Math.round(h || 80), H_MIN, H_MAX), copies: clamp(Math.round(+q("et-c").value || 1), 1, COPIES_MAX) };
    }
    function maj() { var r = lire(); q("et-p").style.display = r.t === "perso" ? "flex" : "none"; q("et-f").srcdoc = html(items, r); q("et-n").textContent = items.length * r.copies + " étiquette(s) de " + r.w + " × " + r.h + " mm"; return r; }
    ["et-t", "et-w", "et-h", "et-c"].forEach(function (id) { var e = q(id); if (e) e.onchange = e.oninput = maj; });
    ov.addEventListener("click", function (e) {
      var b = e.target.closest("[data-et]"), fond = e.target === ov; if (!b && !fond) return;
      if (fond || b.dataset.et === "x") { ov.remove(); return; }
      if (b.dataset.et === "pdf") { var rp = maj(); enregistrer(rp); ouvrirPdf(html(items, { w: rp.w, h: rp.h, copies: rp.copies, cadre: false }), ".et", rp.w, rp.h, "etiquettes"); if (typeof o.apres === "function") try { o.apres(rp, items.length * rp.copies); } catch (x) { } return; }
      if (b.dataset.et === "p") { var r = maj(); enregistrer(r); imprimer(html(items, { w: r.w, h: r.h, copies: r.copies, cadre: false }), q("et-f")); if (typeof o.apres === "function") try { o.apres(r, items.length * r.copies); } catch (x) { } }
    });
    maj(); return ov;
  }

  G.ANGELS_ETIQ = { ouvrir: ouvrir, imprimer: imprimer, ouvrirPdf: ouvrirPdf, rasteriser: rasteriser, pdf: pdf, html: html, etiquette: etiquette, cfg: cfg, PRESETS: PRE, LIMITES: { wMin: W_MIN, wMax: W_MAX, hMin: H_MIN, hMax: H_MAX, copies: COPIES_MAX } };
})(window);
