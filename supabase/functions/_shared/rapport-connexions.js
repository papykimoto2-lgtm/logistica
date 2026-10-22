/* Rapport quotidien des connexions pour le DG : logique pure, testée hors Supabase (voir tests/rapport-serveur.js).

   Le journal de connexion de chaque application (Distributions, Transport, Agro) est synchronisé avec le serveur (collection « connexions » de sync_enreg). À l'heure choisie,
   la fonction planifiée construit le rapport des dernières 24 heures et l'envoie par e-mail au DG. Les mêmes calculs existent côté navigateur (rapport-engine.js) : le test
   tests/rapport-serveur.js vérifie qu'ils donnent exactement le même rapport. Aucun mot de passe ni donnée secrète n'est lu ni envoyé. */

import { egal } from "./pont.js";

export { CORS } from "./pont.js";

const rep = (status, body) => ({ status, body });
const err = (status, message) => rep(status, { ok: false, erreur: message });
export const APPS = ["distribution", "transport", "agro"];
export const LBL = { distribution: "Distributions", transport: "Transport", agro: "Agro" };
export const ROLES = { admin: "Administrateur", direction: "Direction générale", directeur: "Directeur", superviseur: "Superviseur", commercial: "Commercial", preparateur: "Préparateur", caissier: "Caissier", livreur: "Livreur", vendeur: "Vendeur partenaire", flotte: "Gestionnaire de flotte", comptable: "Comptable", controleur: "Contrôleur", chauffeur: "Chauffeur", chef: "Chef d'exploitation", soigneur: "Soigneur", magasinier: "Magasinier" };
const TZ = "Africa/Abidjan";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dh = (t) => new Date(t).toLocaleString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hh = (t) => new Date(t).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const OK = (e) => e === "ok" || e === "demo", KO = (e) => e === "ko" || e === "bloque" || e === "inactif" || e === "param_ko";

/* sources : [{ app, users:[{id,nom,role,actif}], connexions:[{t,uid,nom,role,ev,app_}] }] */
export function construire(sources, debut, fin) {
  const D = Date.parse(debut), F = Date.parse(fin), apps = []; let ok = 0, ko = 0; const pers = new Set();
  for (const s of sources || []) {
    const tout = Array.isArray(s.connexions) ? s.connexions.filter((x) => x && x.t) : [], par = {};
    for (const x of tout) {
      const t = Date.parse(x.t); if (!(t >= D && t <= F)) continue;
      const k = x.uid || "n:" + x.nom, p = par[k] || (par[k] = { nom: x.nom || "?", role: x.role || "", ok: 0, ko: 0, out: 0, premiere: "", derniere: "", appareils: {} });
      if (OK(x.ev)) { p.ok++; if (!p.premiere || x.t < p.premiere) p.premiere = x.t; if (!p.derniere || x.t > p.derniere) p.derniere = x.t; if (x.app_) p.appareils[x.app_] = 1; }
      else if (KO(x.ev)) p.ko++; else if (x.ev === "out") p.out++;
    }
    const users = Object.values(par).map((p) => ({ ...p, appareils: Object.keys(p.appareils) })).sort((a, b) => b.ok - a.ok || a.nom.localeCompare(b.nom, "fr"));
    const vus = new Set(tout.filter((x) => OK(x.ev)).map((x) => x.uid || "n:" + x.nom));
    const jamais = (s.users || []).filter((u) => u.actif !== false && !vus.has(u.id)).map((u) => ({ nom: u.nom, role: u.role }));
    const aok = users.reduce((t, u) => t + u.ok, 0), ako = users.reduce((t, u) => t + u.ko, 0);
    users.forEach((u) => { if (u.ok) pers.add(s.app + "|" + u.nom); });
    ok += aok; ko += ako;
    apps.push({ app: s.app, nom: LBL[s.app] || s.app, ok: aok, ko: ako, users, jamais, alertes: users.filter((u) => u.ko >= 3).map((u) => u.nom) });
  }
  return { debut, fin, ok, ko, personnes: pers.size, apps, jamais: apps.reduce((t, a) => t + a.jamais.length, 0) };
}

export function texte(r) {
  const L = ["*LOGISTICA — Rapport de connexion*", "Du " + dh(r.debut) + " au " + dh(r.fin), "Connexions réussies : " + r.ok + " · Échecs : " + r.ko + " · Personnes connectées : " + r.personnes];
  for (const a of r.apps) {
    L.push("", "*" + a.nom + "* : " + a.ok + " connexion(s)" + (a.ko ? " · " + a.ko + " échec(s)" : ""));
    a.users.filter((u) => u.ok).slice(0, 6).forEach((u) => L.push(" • " + u.nom + " : " + u.ok + " (dernière " + hh(u.derniere) + ")"));
    if (a.users.filter((u) => u.ok).length > 6) L.push(" • … et " + (a.users.filter((u) => u.ok).length - 6) + " autre(s)");
  }
  const al = r.apps.flatMap((a) => a.alertes.map((n) => n + " (" + a.nom + ")"));
  if (al.length) L.push("", "⚠ Échecs répétés (3 ou plus) : " + al.join(", "));
  if (r.jamais) L.push("", "Comptes actifs jamais connectés : " + r.jamais);
  L.push("", "Détail : Paramètres du hub → Connexions.");
  return L.join("\n");
}

export function html(r) {
  const th = "text-align:left;padding:6px 10px;background:#e8f1f4;font-size:12px", td = "padding:6px 10px;border-bottom:1px solid #e3ecef;font-size:13px";
  const blocs = r.apps.map((a) => `<h3 style="margin:18px 0 6px;font-size:15px">${esc(a.nom)} — ${a.ok} connexion(s)${a.ko ? ` · <span style="color:#c62828">${a.ko} échec(s)</span>` : ""}</h3>` +
    (a.users.length ? `<table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Utilisateur</th><th style="${th}">Profil</th><th style="${th}">Connexions</th><th style="${th}">Échecs</th><th style="${th}">Dernière</th><th style="${th}">Appareil</th></tr>` +
      a.users.map((u) => `<tr><td style="${td}"><b>${esc(u.nom)}</b></td><td style="${td}">${esc(ROLES[u.role] || u.role)}</td><td style="${td}">${u.ok}</td><td style="${td}${u.ko ? ";color:#c62828;font-weight:700" : ""}">${u.ko}</td><td style="${td}">${u.derniere ? esc(dh(u.derniere)) : "—"}</td><td style="${td}">${esc(u.appareils.join(" ; ") || "—")}</td></tr>`).join("") + "</table>" : '<p style="color:#6b7390;font-size:13px">Aucune activité sur la période.</p>') +
    (a.jamais.length ? `<p style="font-size:13px;color:#b86e00">Comptes actifs jamais connectés : ${a.jamais.map((j) => esc(j.nom)).join(", ")}</p>` : "")).join("");
  const al = r.apps.flatMap((a) => a.alertes.map((n) => n + " (" + a.nom + ")"));
  return `<div style="font-family:system-ui,Arial,sans-serif;color:#1b2240;max-width:720px"><h2 style="margin:0 0 4px">LOGISTICA — Rapport de connexion</h2><p style="margin:0 0 12px;color:#6b7390">Du ${esc(dh(r.debut))} au ${esc(dh(r.fin))}</p>` +
    `<p style="font-size:15px"><b>${r.ok}</b> connexion(s) réussie(s) · <b style="color:${r.ko ? "#c62828" : "inherit"}">${r.ko}</b> échec(s) · <b>${r.personnes}</b> personne(s) connectée(s)</p>` +
    (al.length ? `<p style="background:#fde5e5;border-radius:8px;padding:8px 12px;color:#c62828"><b>⚠ Échecs répétés (3 ou plus) :</b> ${esc(al.join(", "))}</p>` : "") + blocs +
    `<p style="margin-top:20px;color:#6b7390;font-size:12px">Rapport automatique. Détail et historique complet : Paramètres du hub → Connexions.</p></div>`;
}

const hhmm = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "")); return m ? { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) } : { h: 11, m: 0 }; };
const jourDe = (t) => new Date(t).toLocaleDateString("fr-CA", { timeZone: TZ });
/* Vrai si l'heure choisie est passée aujourd'hui (heure d'Abidjan) et qu'aucun envoi n'a encore eu lieu aujourd'hui. */
export function doitEnvoyer(cfg, now = Date.now()) {
  if (!cfg || !cfg.actif || !Array.isArray(cfg.emails) || !cfg.emails.length) return false;
  const { h, m } = hhmm(cfg.heure), p = new Date(now).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  if (p[0] * 60 + p[1] < h * 60 + m) return false;
  return cfg.derniere_date !== jourDe(now);
}

export const validerEmails = (L) => (Array.isArray(L) ? L : String(L || "").split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(x)).slice(0, 5);

/* db : lireCfg, ecrireCfg(patch), sources(depuis) → [{app, users, connexions}] ; envoyer({a, sujet, html, texte}) */
export async function traiter(db, cfgSrv, req, cles, envoyer, now = Date.now()) {
  const a = String(req.action || ""), sync = cles && cles.sync, cron = cles && cles.cron;
  const sNok = !cfgSrv.syncKey || !egal(sync, cfgSrv.syncKey), cNok = !cfgSrv.cronKey || !egal(cron, cfgSrv.cronKey);
  if (a === "cron") { if (cNok) return err(401, "Clé de planification invalide"); }
  else if (sNok) return err(401, "Clé de synchronisation invalide");
  const cfg = (await db.lireCfg()) || { actif: false, heure: "11:00", emails: [], derniere_date: "" };
  if (a === "lire") return rep(200, { ok: true, cfg: { actif: !!cfg.actif, heure: cfg.heure, emails: cfg.emails || [], derniere_date: cfg.derniere_date || "" } });
  if (a === "regler") {
    const emails = validerEmails(req.emails), heure = /^\d{1,2}:\d{2}$/.test(String(req.heure || "")) ? String(req.heure) : "11:00";
    if (req.actif && !emails.length) return err(400, "Indiquez au moins une adresse e-mail valide pour le DG");
    await db.ecrireCfg({ actif: !!req.actif, heure, emails }); return rep(200, { ok: true, emails, heure, actif: !!req.actif });
  }
  if (a !== "cron" && a !== "tester") return err(400, "Action inconnue");
  if (a === "cron" && !doitEnvoyer(cfg, now)) return rep(200, { ok: true, envoye: false });
  const fin = new Date(now).toISOString(), debut = new Date(now - 864e5).toISOString(), emails = a === "tester" ? validerEmails(req.emails && req.emails.length ? req.emails : cfg.emails) : cfg.emails;
  if (!emails.length) return err(400, "Aucune adresse e-mail pour le DG");
  const r = construire(await db.sources(new Date(now - 90 * 864e5).toISOString()), debut, fin);
  await envoyer({ a: emails, sujet: (a === "tester" ? "[TEST] " : "") + "LOGISTICA — Rapport de connexion du " + new Date(now).toLocaleDateString("fr-FR", { timeZone: TZ }), html: html(r), texte: texte(r) });
  if (a === "cron") await db.ecrireCfg({ derniere_date: jourDe(now), derniere_le: fin });
  return rep(200, { ok: true, envoye: true, a: emails.length, connexions: r.ok, echecs: r.ko });
}
