/* Moteur d'impression LOGISTICA — partagé par Transport, Distribution, Agro et le hub.
   - En-tête de l'entreprise avec le logo et l'identité légale de la DIVISION émettrice (repli sur le groupe, puis sur l'application).
   - Pied de page sur chaque page (mentions de la division, référence, numéro de page).
   - QR code de sécurité : signature numérique ECDSA P-256 (WebCrypto) de la référence, de la date, du montant et de l'empreinte du contenu.
     La clé privée reste sur l'appareil émetteur ; la clé publique est publiée avec le portail (portail-data.js) : la page verifier.html
     confirme l'authenticité d'un document sans serveur. Sans WebCrypto (page non sécurisée), repli sur un contrôle simple, signalé comme tel.
   - Registre local des documents émis (angels_docs_v1).
   - Aperçu A4 (portrait / paysage) avec Imprimer, PDF (boîte d'impression) et téléchargement HTML.
   - hook() : remplace window.print() pour que tous les imprimés existants de l'application passent par le moteur.
   Dépend de qrcode.js (qrcode-generator, MIT). */
(function (G) {
  "use strict";
  var KEY = "angels_print_v1", KEYS = "angels_print_key_v1", REG = "angels_docs_v1";
  var DIVS = [["groupe", "Groupe"], ["transport", "Transport"], ["distribution", "Distribution"], ["agro", "Agro"]];
  var CHAMPS = ["raison", "forme", "capital", "rccm", "ncc", "siege", "tel", "email", "pied", "couleur", "logo"];
  var enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  var lire = function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  var ecrire = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var okImg = function (u) { u = String(u || ""); return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(u) || /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ""; };
  var okCol = function (c) { return /^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : ""; };
  var today = function () { return new Date().toISOString().slice(0, 10); };

  /* ---------- Réglages ---------- */
  function cfg() {
    var c = lire(KEY) || {}, o = { v: 1, qr: c.qr !== false, site: String(c.site || ""), mentions: String(c.mentions || ""), pied: String(c.pied || ""), div: {} };
    DIVS.forEach(function (d) { var x = (c.div || {})[d[0]] || {}, r = {}; CHAMPS.forEach(function (k) { r[k] = String(x[k] || ""); }); o.div[d[0]] = r; });
    return o;
  }
  function sauver(c) { return ecrire(KEY, c); }
  function ident(div, fb) {
    var c = cfg(), g = c.div.groupe, v = c.div[div] || {}, f = fb || {}, p = function (k) { return v[k] || g[k] || ""; };
    var lab = (DIVS.filter(function (d) { return d[0] === div; })[0] || [0, "Groupe"])[1];
    return { division: div, divNom: lab, nom: p("raison") || f.nom || "LOGISTICA", logo: okImg(v.logo) || okImg(g.logo), forme: p("forme"), capital: p("capital"), rccm: p("rccm") || f.rccm || "", ncc: p("ncc") || f.ncc || "",
      siege: p("siege") || f.siege || "", tel: p("tel") || f.tel || "", email: p("email") || f.email || "", pied: v.pied || c.pied || g.pied || "", mention: "", couleur: okCol(v.couleur) || okCol(g.couleur) || "#1f3a5f", mentions: c.mentions };
  }

  /* ---------- Empreintes et signature ---------- */
  function cyrb(str) {
    str = String(str); var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch, i;
    for (i = 0; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  }
  var subtle = function () { return G.crypto && G.crypto.subtle && enc ? G.crypto.subtle : null; };
  function b64u(buf) { var a = new Uint8Array(buf), s = "", i; for (i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var b = atob(s), a = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  async function sha(txt, n) {
    var s = subtle(); if (!s) return cyrb(txt).slice(0, n || 14);
    var h = await s.digest("SHA-256", enc.encode(String(txt))), a = Array.from(new Uint8Array(h)).map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    return a.slice(0, n || 64);
  }
  var ALGO = { name: "ECDSA", namedCurve: "P-256" }, SIGN = { name: "ECDSA", hash: "SHA-256" };
  async function kidDe(pub) { return sha(pub.x + "." + pub.y, 8); }
  var PEND = null;
  function cleAssurer() { return PEND || (PEND = cleAssurer1().then(function (r) { PEND = null; return r; }, function (e) { PEND = null; throw e; })); }
  async function cleAssurer1() {
    var k = lire(KEYS); if (k && k.priv && k.pub && k.kid) return k;
    var s = subtle(); if (!s) return null;
    var p = await s.generateKey(ALGO, true, ["sign", "verify"]), priv = await s.exportKey("jwk", p.privateKey), pub = await s.exportKey("jwk", p.publicKey);
    pub = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }; k = { priv: priv, pub: pub, kid: await kidDe(pub), t: new Date().toISOString() };
    if (!ecrire(KEYS, k)) return null;   /* stockage plein ou bloqué : pas de signature plutôt qu'une clé jamais conservée */
    return k;
  }
  function cleInfo() { var k = lire(KEYS); return k && k.kid ? { existe: true, kid: k.kid, t: k.t } : { existe: false, kid: "", t: "" }; }
  function cleExporter() { var k = lire(KEYS); return k ? JSON.stringify({ angels_cle: 1, priv: k.priv, pub: k.pub, kid: k.kid, t: k.t }) : ""; }
  async function cleImporter(txt) {
    var o; try { o = JSON.parse(txt); } catch (e) { throw new Error("Fichier de clé illisible."); }
    if (!o || o.angels_cle !== 1 || !o.priv || !o.pub) throw new Error("Ce n'est pas une clé de signature LOGISTICA.");
    var s = subtle(); if (!s) throw new Error("Cet appareil ne permet pas la signature (ouvrez l'application en https).");
    try {
      var ks = await s.importKey("jwk", o.priv, ALGO, false, ["sign"]), kv = await s.importKey("jwk", o.pub, ALGO, false, ["verify"]), essai = new TextEncoder().encode("essai"), sg = await s.sign(SIGN, ks, essai);
      if (!(await s.verify(SIGN, kv, sg, essai))) throw 0;
    } catch (e) { throw new Error("Clé invalide : la clé privée et la clé publique ne correspondent pas."); }
    var pub = { kty: o.pub.kty, crv: o.pub.crv, x: o.pub.x, y: o.pub.y }; ecrire(KEYS, { priv: o.priv, pub: pub, kid: await kidDe(pub), t: o.t || new Date().toISOString() }); return cleInfo();
  }
  async function cleRegenerer() { try { localStorage.removeItem(KEYS); } catch (e) {} await cleAssurer(); return cleInfo(); }
  function pubs() { var k = lire(KEYS); return k && k.pub ? [{ kid: k.kid, pub: k.pub }] : []; }
  async function signer(canon) {
    var k = await cleAssurer(); if (!k) return null;
    var key = await subtle().importKey("jwk", k.priv, ALGO, false, ["sign"]);
    return { kid: k.kid, sig: b64u(await subtle().sign(SIGN, key, enc.encode(canon))) };
  }
  async function verifierSig(canon, sig, pub) {
    try { var key = await subtle().importKey("jwk", pub, ALGO, false, ["verify"]); return await subtle().verify(SIGN, key, unb64u(sig), enc.encode(canon)); } catch (e) { return false; }
  }
  var nette = function (s, n) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .,:\/_\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 40); };
  function canonDe(div, ref, date, montant, h, kid) { return ["A1", nette(div, 12), nette(ref, 40), date, String(Math.round(+montant || 0)), h, kid].join("|"); }
  function baseSite(c) { var s = String(c.site || "").trim().replace(/\/+$/, ""); if (/^https:\/\/[^\s]+$/.test(s)) return s; return /^https?:$/.test(G.location.protocol) ? G.location.origin : ""; }
  function lienDe(c, canon, sig) { var b = baseSite(c); return (b ? b + "/verifier.html#" : "ANGELS-VERIF:") + b64u(enc.encode(canon)) + "." + sig; }

  /* ---------- Registre des documents émis (sur cet appareil) ---------- */
  function registre() { var r = lire(REG); return Array.isArray(r) ? r : []; }
  function registrer(e) {
    var r = registre(); if (r.some(function (x) { return x.r === e.r && x.h === e.h; })) return;
    r.unshift(e); ecrire(REG, r.slice(0, 3000));
  }

  /* ---------- Document ---------- */
  var CSS = "*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;font:10.5pt/1.45 Arial,Helvetica,sans-serif;color:#1c2430;background:#fff}" +
    ".pg{padding:0 4px}.eh{display:flex;gap:14px;align-items:center;border-bottom:3px solid var(--ac);padding-bottom:10px;margin-bottom:12px}.eh .lg{flex:0 0 auto;width:74px;height:74px;display:flex;align-items:center;justify-content:center}" +
    ".eh .lg img{max-width:74px;max-height:74px;object-fit:contain}.eh .mono{width:62px;height:62px;border-radius:12px;background:var(--ac);color:#fff;font:700 24pt Arial;display:flex;align-items:center;justify-content:center}" +
    ".eh .id{flex:1;min-width:0}.eh .id b{display:block;font-size:14pt;color:var(--ac);line-height:1.15}.eh .id span{display:block;font-size:8.5pt;color:#46505e}.eh .dv{text-align:right;font-size:8.5pt;color:#46505e}" +
    ".eh .dv i{display:inline-block;font-style:normal;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:var(--ac);color:#fff;padding:3px 9px;border-radius:99px;font-size:8pt;margin-bottom:4px}" +
    ".tt{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin:6px 0 12px}.tt h1{margin:0;font-size:17pt;letter-spacing:.02em;text-transform:uppercase;color:#111}.tt .mt{font-size:9pt;text-align:right;color:#46505e}.tt .mt b{color:#111}" +
    "h1,h2,h3{page-break-after:avoid}h1{font-size:15pt}h2{font-size:12.5pt;margin:16px 0 6px;color:var(--ac);border-bottom:1px solid #d8dde4;padding-bottom:3px}h3{font-size:11pt;margin:12px 0 4px}p{margin:6px 0}" +
    "table{width:100%;border-collapse:collapse;margin:8px 0;font-size:9.5pt}th,td{border:1px solid #c9d0d9;padding:5px 7px;text-align:left;vertical-align:top}th{background:#eef1f5;font-weight:700}tr{page-break-inside:avoid}" +
    ".tw{overflow:visible}.mu,.sm{color:#5b6572}.sm{font-size:8.5pt}.badge{display:inline-block;border:1px solid #9aa4b1;border-radius:99px;padding:0 7px;font-size:8.5pt}.badge.ok{border-color:#1f8a4c;color:#1f8a4c}.badge.er{border-color:#b3261e;color:#b3261e}.badge.wa{border-color:#b26a00;color:#b26a00}" +
    ".grid{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.kpi{flex:1 1 130px;border:1px solid #c9d0d9;border-radius:6px;padding:6px 9px}.kpi .v{font-weight:700;font-size:12pt}.kpi .l{font-size:8.5pt;color:#5b6572}" +
    ".art{margin:10px 0;page-break-inside:avoid}.art b{color:#111}.sg{display:flex;gap:30px;margin-top:34px;page-break-inside:avoid}.sg div{flex:1;border-top:1px solid #6b7480;padding-top:6px;font-size:9pt;min-height:70px}" +
    ".sec{margin-top:18px;border-top:1px solid #c9d0d9;padding-top:8px;display:flex;gap:12px;align-items:center;page-break-inside:avoid}.sec .qr{flex:0 0 auto;border:1px solid #d8dde4;padding:4px;background:#fff;width:112px;height:112px}.sec .qr svg{width:100%;height:100%;display:block}" +
    ".sec .tx{font-size:8pt;line-height:1.5;color:#46505e;font-family:Arial}.sec .tx b{color:#111}.sec .cd{font:700 10pt 'Courier New',monospace;letter-spacing:.06em;color:#111}.noprint{display:none!important}" +
    ".ft{margin-top:14px;border-top:1px solid #c9d0d9;padding-top:5px;font-size:7.5pt;color:#5b6572;text-align:center;line-height:1.4;page-break-inside:avoid}" +
    "td.n,th.n{text-align:right;white-space:nowrap}.nw{white-space:nowrap}tr.tot td{font-weight:700;background:#f3f3f3}.sub{color:#46505e;font-size:9pt;margin:0 0 8px}thead{display:table-header-group}tfoot{display:table-row-group}h2+table{page-break-before:avoid}table.cp{font-size:8.5pt}table.cp th,table.cp td{padding:4px 5px}";
  function enteteHtml(id, meta) {
    var lg = id.logo ? '<img src="' + esc(id.logo) + '" alt="Logo ' + esc(id.nom) + '">' : '<div class="mono">' + esc((id.nom.match(/[A-Za-zÀ-ÿ0-9]/g) || ["A"]).slice(0, 2).join("").toUpperCase()) + "</div>";
    var l1 = [id.forme, id.capital ? "capital " + id.capital : ""].filter(Boolean).join(" · "), l2 = [id.siege, id.tel ? "Tél. " + id.tel : "", id.email].filter(Boolean).join(" · "), l3 = [id.rccm ? "RCCM " + id.rccm : "", id.ncc ? "NCC " + id.ncc : ""].filter(Boolean).join(" · ");
    return '<div class="eh"><div class="lg">' + lg + '</div><div class="id"><b>' + esc(id.nom) + "</b>" + (l1 ? "<span>" + esc(l1) + "</span>" : "") + (l2 ? "<span>" + esc(l2) + "</span>" : "") + (l3 ? "<span>" + esc(l3) + "</span>" : "") +
      '</div><div class="dv"><i>' + esc(id.divNom) + "</i><br>" + esc(meta) + "</div></div>";
  }
  function piedHtml(id, ref, q, mention) {
    var l = [id.nom, id.rccm ? "RCCM " + id.rccm : "", id.ncc ? "NCC " + id.ncc : "", id.siege].filter(Boolean).join(" — ");
    return '<div class="ft">' + (mention ? esc(mention) + "<br>" : "") + (id.pied ? esc(id.pied) + "<br>" : "") + esc(l) + (id.mentions ? "<br>" + esc(id.mentions) : "") + "<br>Logiciel développé par Sanix Africa Division Technologies · WhatsApp : +225 0779181075 / 0140017751<br>" + esc(ref) + (q ? " — document authentifiable (QR de sécurité en dernière page)" : "") + "</div>";
  }
  function qrSvg(texte) {
    if (typeof G.qrcode !== "function") return "";
    try { var q = G.qrcode(0, "M"); q.addData(String(texte)); q.make(); return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); }
    catch (e) { try { var q2 = G.qrcode(0, "L"); q2.addData(String(texte)); q2.make(); return q2.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); } catch (e2) { return ""; } }
  }
  function fd(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : (d || ""); }
  function texteDe(html) { var d = document.createElement("div"); d.innerHTML = html; return (d.textContent || "").replace(/\s+/g, " ").trim(); }
  function signaturesHtml(L) { return L && L.length ? '<div class="sg">' + L.map(function (s) { return "<div><b>" + esc(s[0]) + "</b>" + (s[1] ? "<br><span class=\"mu\">" + esc(s[1]) + "</span>" : "") + "</div>"; }).join("") + "</div>" : ""; }

  /* Construit le document complet. ctl = { canon, kid, sig, h, lien, simple, ref } (calculé une fois, réutilisé au changement d'orientation). */
  function construire(o, id, ctl, paysage) {
    var c = cfg(), page = paysage ? "A4 landscape" : "A4 portrait", date = o.date || today(), qr = ctl && c.qr !== false ? qrSvg(ctl.lien) : "";
    var sec = ctl && c.qr !== false ? '<div class="sec"><div class="qr">' + qr + '</div><div class="tx"><b>Document authentifiable — ' + esc(id.nom) + "</b><br>Réf. " + esc(ctl.ref) + " · émis le " + esc(fd(date)) + (o.emetteur ? " par " + esc(o.emetteur) : "") +
      '<br>Code de contrôle : <span class="cd">' + esc(ctl.code) + "</span> · clé " + esc(ctl.kid || "—") + " · empreinte " + esc(ctl.h) + "<br>" +
      (ctl.simple ? "Contrôle simple (signature numérique indisponible sur cet appareil)." : "Signature numérique ECDSA P-256 : scannez le QR (ou ouvrez verifier.html) pour confirmer l'origine et l'intégrité de ce document.") + "</div></div>" : "";
    var refD = ctl ? ctl.ref : o.ref || "", l1 = [id.nom, id.rccm ? "RCCM " + id.rccm : "", id.ncc ? "NCC " + id.ncc : "", id.siege].filter(Boolean).join(" — ");
    var cs = function (t) { return String(t || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " "); };
    var boite = '@bottom-center{content:"' + cs(l1) + '\\A ' + cs(refD) + ' — page " counter(page) " / " counter(pages);white-space:pre-line;text-align:center;vertical-align:top;padding-top:3mm;font:7pt Arial,Helvetica,sans-serif;color:#5b6572}';
    return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>' + esc(o.titre) + " — " + esc(refD) + '</title><style>@page{size:' + page + ";margin:12mm 12mm 18mm;" + boite + "}:root{--ac:" + id.couleur + "}" + CSS + '</style></head><body><div class="pg">' +
      enteteHtml(id, "Édité le " + fd(today())) + '<div class="tt"><h1>' + esc(o.titre) + '</h1><div class="mt">Réf. <b>' + esc(ctl ? ctl.ref : o.ref || "") + "</b><br>Date : <b>" + esc(fd(date)) + "</b>" + (o.montant ? "<br>Montant : <b>" + esc(Math.round(o.montant).toLocaleString("fr-FR").replace(/[  ]/g, " ")) + " F</b>" : "") + "</div></div>" +
      '<div class="corps">' + o.corps + "</div>" + signaturesHtml(o.signatures) + sec + piedHtml(id, ctl ? ctl.ref : o.ref || "", !!qr, o.mention) + "</div></body></html>";
  }

  /* ---------- Aperçu ---------- */
  var ST = { o: null, id: null, ctl: null };
  var UICSS = "#ap-ov{position:fixed;inset:0;z-index:99999;background:rgba(15,20,28,.72);display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif}#ap-ov .bx{background:#e5e8ed;border-radius:12px;width:96vw;max-width:980px;height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.5)}" +
    "#ap-ov .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#fff;border-bottom:1px solid #cfd5dd}#ap-ov .bar button,#ap-ov .bar select{width:auto;min-width:0;margin:0;display:inline-block;height:auto}#ap-ov .bar b{flex:1;min-width:140px;font-size:14px;color:#1c2430}#ap-ov button,#ap-ov select{font:600 13px Arial;padding:8px 13px;border-radius:8px;border:1px solid #9aa4b1;background:#fff;color:#1c2430;cursor:pointer}" +
    "#ap-ov button.p{background:#1f3a5f;color:#fff;border-color:#1f3a5f}#ap-ov .zn{flex:1;overflow:auto;padding:18px}#ap-ov .sh{width:794px;margin:0 auto;transform-origin:top center}#ap-ov iframe{display:block;width:794px;border:0;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.3);min-height:1000px}" +
    "#ap-ov .ft2{padding:7px 14px;background:#fff;border-top:1px solid #cfd5dd;font-size:11px;color:#46505e}";
  function ov() {
    var e = document.getElementById("ap-ov"); if (e) return e;
    var st = document.createElement("style"); st.textContent = UICSS; document.head.appendChild(st);
    e = document.createElement("div"); e.id = "ap-ov"; e.hidden = true;
    e.innerHTML = '<div class="bx" role="dialog" aria-modal="true" aria-label="Aperçu avant impression"><div class="bar"><b id="ap-t">Aperçu</b><select id="ap-o" aria-label="Orientation"><option value="p">Portrait</option><option value="l">Paysage</option></select><select id="ap-z" aria-label="Zoom"><option value=".7">70 %</option><option value=".85" selected>85 %</option><option value="1">100 %</option></select>' +
      '<button class="p" id="ap-p" type="button">Imprimer / PDF</button><button id="ap-d" type="button">Télécharger HTML</button><button id="ap-x" type="button">Fermer</button></div><div class="zn"><div class="sh" id="ap-s"><iframe id="ap-f" title="Document" sandbox="allow-same-origin allow-modals"></iframe></div></div><div class="ft2" id="ap-i"></div></div>';
    document.body.appendChild(e);
    e.onclick = function (ev) { if (ev.target === e) fermer(); };
    document.getElementById("ap-x").onclick = fermer;
    document.getElementById("ap-o").onchange = charger; document.getElementById("ap-z").onchange = zoomer;
    document.getElementById("ap-p").onclick = function () { var f = document.getElementById("ap-f"); try { f.contentWindow.focus(); f.contentWindow.print(); } catch (x) { (G.__printNatif || G.print).call(G); } };
    document.getElementById("ap-d").onclick = function () { var f = document.getElementById("ap-f"), b = new Blob(["﻿" + f.srcdoc], { type: "text/html" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = String((ST.ctl && ST.ctl.ref) || "document").replace(/[^A-Za-z0-9_-]/g, "_") + ".html"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); };
    document.addEventListener("keydown", function (k) {
      if (e.hidden) return; if (k.key === "Escape") return fermer();
      if (k.key === "Tab") { var L = Array.prototype.filter.call(e.querySelectorAll("button,select"), function (x) { return !x.disabled; }); if (!L.length) return; var a = document.activeElement, i = L.indexOf(a);
        if (k.shiftKey && i <= 0) { k.preventDefault(); L[L.length - 1].focus(); } else if (!k.shiftKey && (i === L.length - 1 || i < 0)) { k.preventDefault(); L[0].focus(); } }
    });
    return e;
  }
  function fermer() { var e = document.getElementById("ap-ov"); if (e) { e.hidden = true; document.body.style.overflow = ""; document.getElementById("ap-f").srcdoc = ""; try { if (ST.opener && ST.opener.focus) ST.opener.focus(); } catch (x) { } ST.opener = null; } }
  function zoomer() { var z = +document.getElementById("ap-z").value || 1, s = document.getElementById("ap-s"); s.style.transform = "scale(" + z + ")"; s.style.marginBottom = "-" + Math.round((1 - z) * (document.getElementById("ap-f").offsetHeight || 1000)) + "px"; }
  function charger() {
    var f = document.getElementById("ap-f"), pay = document.getElementById("ap-o").value === "l", W = pay ? 1123 : 794;
    f.style.width = W + "px"; document.getElementById("ap-s").style.width = W + "px";
    f.onload = function () { try { var h = f.contentDocument.documentElement.scrollHeight; f.style.height = Math.max(1000, h + 10) + "px"; document.getElementById("ap-i").textContent = "Format A4 · " + Math.max(1, Math.ceil(h / (pay ? 794 : 1123))) + " page(s) · " + (ST.ctl && ST.ctl.simple ? "contrôle simple (non signé)" : ST.ctl ? "signé, clé " + ST.ctl.kid : "sans QR de sécurité") + (pay ? " · Paysage : choisissez aussi « Paysage » dans la fenêtre d'impression si le PDF sort en portrait" : ""); zoomer(); } catch (x) {} };
    f.srcdoc = construire(ST.o, ST.id, ST.ctl, pay);
  }

  /* Ouvre l'aperçu d'un document : o = { division, titre, ref, date, montant, corps, signatures, emetteur, paysage, fallback } */
  async function ouvrir(o) {
    o = Object.assign({ division: "groupe", titre: "Document", corps: "", date: today() }, o || {});
    var id = ident(o.division, o.fallback), c = cfg(), ref = String(o.ref || "").trim(), texte = texteDe(o.corps), h = await sha(o.titre + "|" + texte, 12);
    if (!ref) ref = (o.division || "DOC").slice(0, 3).toUpperCase() + "-" + String(o.date).replace(/-/g, "") + "-" + h.slice(0, 6).toUpperCase();
    var ctl = null;
    if (c.qr !== false) {
      var kid = "", sig = "", simple = false, canon;
      try { var k = await cleAssurer(); if (k) kid = k.kid; } catch (e) { kid = ""; }
      canon = canonDe(o.division, ref, o.date, o.montant, h, kid || "0");
      if (kid) { var s = null; try { s = await signer(canon); } catch (e) { s = null; } if (s) sig = s.sig; }
      if (!sig) { simple = true; canon = canon.replace(/^A1/, "A0"); sig = "c" + cyrb(canon).slice(0, 10); kid = ""; }
      ctl = { canon: canon, kid: kid, sig: sig, h: h, ref: ref, simple: simple, code: (simple ? sig.slice(1) : await sha(canon + "|" + sig, 10)).toUpperCase(), lien: lienDe(c, canon, sig) };
      registrer({ r: ref, d: o.division, t: o.titre, x: o.date, m: Math.round(+o.montant || 0), h: h, k: kid, p: o.emetteur || "", u: new Date().toISOString(), s: simple ? "simple" : "signe" });
    } else ctl = { ref: ref, kid: "", h: h };
    ST = { o: Object.assign({}, o, { ref: ref }), id: id, ctl: ctl.canon ? ctl : null };
    var e = ov(); ST.opener = e.hidden ? document.activeElement : ST.opener; e.hidden = false; document.body.style.overflow = "hidden"; try { document.getElementById("ap-p").focus(); } catch (x) { } document.getElementById("ap-t").textContent = o.titre + " — " + ref;
    document.getElementById("ap-o").value = o.paysage ? "l" : "p"; charger();
    return { ref: ref, h: h, signe: !!(ctl.canon && !ctl.simple) };
  }

  /* ---------- Branchement sur window.print() ---------- */
  /* Tous les imprimés existants (fenêtres modales, états) passent par le moteur : en-tête de la division, pied de page, QR. */
  function hook(opt) {
    opt = opt || {};
    if (!G.__printNatif) G.__printNatif = G.print.bind(G);
    G.print = function () {
      try {
        var mds = document.querySelectorAll(".md"), md = mds.length ? mds[mds.length - 1] : null, src = md ? md : (opt.racine ? opt.racine() : (document.querySelector("main") || document.getElementById("app")));
        if (!src) return G.__printNatif();
        var cl = src.cloneNode(true);
        if (G.ANGELS_PAGER) G.ANGELS_PAGER.depagine(cl);
        cl.querySelectorAll(".noprint,button,select,input,textarea,nav,script,style,.x,[data-x],[hidden]").forEach(function (n) { n.remove(); });
        var h1 = cl.querySelector("h1,h2"), titre = h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "Document";
        if (h1 && h1.tagName === "H1") h1.remove();
        var txt = cl.textContent || "", code = /\b([A-Z]{2,6}-\d{4}-\d{3,8})\b/, mref = code.exec(titre) || /(?:R[ée]f\.?|N°)\s*:?\s*([A-Z]{2,6}-[A-Za-z0-9\-\/]{3,30})/.exec(titre + " " + txt) || code.exec(txt), mm = /(?:Montant[^:]{0,30}|Total[^:]{0,20}):?\s*([\d\s  ]{3,15})\s*F/.exec(txt);
        ouvrir({ division: opt.division || "groupe", titre: titre.slice(0, 90), ref: mref ? mref[1] : "", montant: mm ? +mm[1].replace(/\D/g, "") : 0, corps: cl.innerHTML, emetteur: opt.emetteur ? opt.emetteur() : "", fallback: opt.fallback ? opt.fallback() : null });
      } catch (e) { G.__printNatif(); }
    };
  }

  /* Imprime le contenu d'un <iframe> déjà composé par une application (documents, rapports) avec l'en-tête, le pied et le QR du moteur.
     Les blocs .top (ancien en-tête), .f (ancien pied) et les éléments .noprint sont retirés. */
  function depuisFrame(fr, o) {
    var d = fr && (fr.contentDocument || (fr.contentWindow && fr.contentWindow.document)); if (!d || !d.body) return false;
    var b = d.body.cloneNode(true); b.querySelectorAll(".top,.f,.noprint,script,style,button").forEach(function (n) { n.remove(); });
    var h1 = b.querySelector("h1"), titre = o.titre || (h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "Document"); if (h1 && (!o.titre || h1.textContent.replace(/\s+/g, " ").toLowerCase().indexOf(String(o.titre).replace(/\s+/g, " ").toLowerCase()) >= 0)) h1.remove();
    var ml = d.querySelector(".f"); ouvrir(Object.assign({}, o, { titre: titre.slice(0, 90), corps: b.innerHTML, mention: o.mention || (ml ? ml.textContent.replace(/\s+/g, " ").trim() : "") })); return true;
  }
  /* Jeton signé pour un lien public (suivi de livraison, etc.) : b64url(json) . signature . identifiant de clé.
     Le portail le vérifie avec la clé publique publiée (portail-data.js). Sans WebCrypto : signature « - » (non certifié). */
  async function jeton(obj) {
    var body = b64u(enc.encode(JSON.stringify(obj))), k = null;
    try { k = await cleAssurer(); } catch (e) { k = null; }
    if (!k) return body + ".-.0";
    var s = await signer("T1|" + body); return body + "." + s.sig + "." + s.kid;
  }
  G.ANGELS_PRINT = { DIVS: DIVS, cfg: cfg, sauver: sauver, ident: ident, ouvrir: ouvrir, jeton: jeton, dernier: function () { return ST.ctl; }, depuisFrame: depuisFrame, hook: hook, fermer: fermer, registre: registre, cleInfo: cleInfo, cleExporter: cleExporter, cleImporter: cleImporter, cleRegenerer: cleRegenerer, cleAssurer: cleAssurer, pubs: pubs,
    verifierSig: verifierSig, unb64u: unb64u, sha: sha, canonDe: canonDe, construire: construire, esc: esc, okImg: okImg };
})(window);
