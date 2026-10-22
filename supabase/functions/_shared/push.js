/* Notifications push livreur : abonnement (jeton du livreur) et envoi (clé d'administration du bureau).
   Logique pure : la base et l'émetteur Web Push sont injectés (testés en mémoire, voir tests/push.js). */
import { CORS, egal } from "./pont.js";

const rep = (status, body) => ({ status, body });
const err = (status, erreur) => rep(status, { ok: false, erreur });
const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const MAX_ABONNEMENTS = 5;
/* Anti-SSRF : le serveur n'appelle que les services push connus des navigateurs (HTTPS, nom d'hôte reconnu) */
const HOTES = ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"];
export function endpointValide(e) {
  let u; try { u = new URL(String(e)); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || String(e).length > 600) return false;
  const h = u.hostname.toLowerCase();
  return HOTES.some((s) => h === s || h.endsWith("." + s));
}
const b64u = (v, min, max) => typeof v === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(v) && v.length >= min && v.length <= max;

/* ---- Livreur : abonner / desabonner / etat ---- */
export async function traiterAbonnement(db, req, userId, agent = "") {
  if (!userId) return err(401, "Connexion requise");
  const c = await db.compteParUtilisateur(userId); if (!c || !c.actif) return err(403, "Compte livreur inactif");
  const a = String(req.action || "");
  if (a === "abonner") {
    const s = req.subscription || {}, k = s.keys || {};
    if (!endpointValide(s.endpoint)) return err(400, "Service de notification non reconnu");
    if (!b64u(k.p256dh, 60, 120) || !b64u(k.auth, 16, 40)) return err(400, "Clés d'abonnement invalides");
    await db.ecrireAbonnement({ user_id: userId, livreur_ref: c.livreur_ref, endpoint: s.endpoint, p256dh: k.p256dh, auth: k.auth, agent: txt(agent, 160), echecs: 0 });
    const L = await db.abonnementsDe(c.livreur_ref);
    if (L.length > MAX_ABONNEMENTS) for (const x of L.slice(0, L.length - MAX_ABONNEMENTS)) await db.supprimerAbonnement(x.endpoint);
    return rep(200, { ok: true });
  }
  if (a === "desabonner") { await db.supprimerAbonnementDe(c.livreur_ref, txt(req.endpoint, 600)); return rep(200, { ok: true }); }
  if (a === "etat") return rep(200, { ok: true, abonnements: (await db.abonnementsDe(c.livreur_ref)).length });
  return err(400, "Action inconnue");
}

/* ---- Bureau : envoi (clé d'administration) ---- */
export async function traiterEnvoi(db, cfg, req, adminKey, envoyer, now = Date.now()) {
  if (!cfg.adminKey || !egal(adminKey, cfg.adminKey)) return err(401, "Clé d'administration invalide");
  const ref = txt(req.livreur_ref, 60), titre = txt(req.titre, 80), corps = txt(req.corps, 160);
  if (!ref || !titre) return err(400, "Livreur et titre obligatoires");
  let url = txt(req.url, 120) || "livreur.html"; if (/^[a-z]+:/i.test(url) || url.startsWith("//")) url = "livreur.html";   // lien relatif uniquement
  const payload = JSON.stringify({ t: titre, b: corps, tag: txt(req.tag, 60) || "angels", u: url });
  const L = await db.abonnementsDe(ref); let envoyes = 0, supprimes = 0, echecs = 0;
  for (const s of L) {
    let r; try { r = await envoyer({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); } catch { r = { status: 0 }; }
    const st = r && r.status || 0;
    if (st >= 200 && st < 300) { envoyes++; await db.marquerOk(s.endpoint, new Date(now).toISOString()); }
    else if (st === 404 || st === 410) { supprimes++; await db.supprimerAbonnement(s.endpoint); }
    else { echecs++; if ((s.echecs || 0) + 1 >= 5) { supprimes++; await db.supprimerAbonnement(s.endpoint) } else await db.marquerEchec(s.endpoint); }
  }
  return rep(200, { ok: true, envoyes, supprimes, echecs, abonnes: L.length });
}
export { CORS };
