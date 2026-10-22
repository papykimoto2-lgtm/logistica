/* Pont téléphonique LOGISTICA : logique pure, testable hors Supabase (voir tests/appel-pont.js).
   Principe : le bureau enregistre un « ticket » (numéro du client, côté serveur seulement) ; le livreur présente
   uniquement sa clé d'appel ; le serveur appelle d'abord le livreur, puis le relie au client. Aucun numéro ne quitte le serveur. */

export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-admin-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };

export function normTel(t, indicatif = "225") {
  const s = String(t || "").trim(); let d = s.replace(/\D/g, "");
  if (!s.startsWith("+")) { if (d.startsWith("00")) d = d.slice(2); else if (!(d.startsWith(indicatif) && d.length >= indicatif.length + 8)) d = indicatif + d; }
  return /^\d{11,15}$/.test(d) ? "+" + d : "";
}

export async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const egal = (a, b) => { // comparaison à durée constante
  a = String(a || ""); b = String(b || ""); if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
};
const rep = (status, body) => ({ status, body });
const err = (status, message) => rep(status, { ok: false, erreur: message });

/* 1. Bureau : enregistre ou renouvelle le ticket d'une mission. Protégé par la clé d'administration. */
export async function traiterTicket(db, cfg, req, adminKey, now = Date.now()) {
  if (!cfg.adminKey || !egal(adminKey, cfg.adminKey)) return err(401, "Clé d'administration invalide");
  const commande = String(req.commande || "").trim().slice(0, 40), livreur_id = String(req.livreur_id || "").trim().slice(0, 60);
  const cle = String(req.cle || ""), lt = normTel(req.livreur_tel, cfg.indicatif), ct = normTel(req.client_tel, cfg.indicatif);
  if (!commande || !livreur_id) return err(400, "Commande et livreur obligatoires");
  if (cle.length < 16) return err(400, "Clé d'appel trop courte");
  if (!lt) return err(400, "Numéro du livreur invalide");
  if (!ct) return err(400, "Numéro du client invalide");
  const h = Math.min(48, Math.max(1, Math.round(+req.expire_h || 12)));
  await db.upsertTicket({ commande, livreur_id, cle_hash: await sha256hex(cle), livreur_tel: lt, client_tel: ct, client_nom: String(req.client_nom || "").slice(0, 80), expire_at: new Date(now + h * 36e5).toISOString(), clos: false, max_appels: Math.min(10, Math.max(1, Math.round(+req.max_appels || 4))) });
  return rep(200, { ok: true });
}

/* 1 bis. Bureau : ferme le ticket (livraison terminée, échec, annulation). */
export async function traiterCloture(db, cfg, req, adminKey) {
  if (!cfg.adminKey || !egal(adminKey, cfg.adminKey)) return err(401, "Clé d'administration invalide");
  await db.clore(String(req.commande || ""), String(req.livreur_id || "")); return rep(200, { ok: true });
}

/* 2. Livreur : demande l'appel. Le serveur sonne d'abord chez le livreur. */
export async function traiterAppel(db, cfg, req, fetchFn, now = Date.now()) {
  const commande = String(req.commande || "").trim(), livreur_id = String(req.livreur_id || "").trim(), cle = String(req.cle || "");
  const t = commande && livreur_id ? await db.getTicket(commande, livreur_id) : null;
  if (!t || !egal(await sha256hex(cle), t.cle_hash)) return err(403, "Appel non autorisé");   // même réponse : on ne révèle pas si la commande existe
  if (t.clos) return err(410, "Mission terminée : l'appel n'est plus possible");
  if (Date.parse(t.expire_at) < now) return err(410, "Autorisation expirée : demandez au bureau");
  const j = await db.journalDe(t.id), nb = j.filter((x) => x.statut === "demande").length;
  if (nb >= t.max_appels) return err(429, "Nombre d'appels autorisés atteint pour cette mission : demandez au bureau");
  const dernier = j.map((x) => Date.parse(x.ts)).sort((a, b) => b - a)[0];
  if (dernier && now - dernier < (cfg.delaiMini || 20) * 1000) return err(429, "Patientez quelques secondes avant de relancer");
  const appel = await db.addJournal(t.id, "demande", null);
  const corps = new URLSearchParams({ username: cfg.atUser, from: cfg.atNumero, to: t.livreur_tel, clientRequestId: appel.id });
  let r;
  try { r = await fetchFn(cfg.atUrl || "https://voice.africastalking.com/call", { method: "POST", headers: { apiKey: cfg.atKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: corps }); }
  catch (e) { await db.majJournal(appel.id, "echec", null, "réseau"); return err(502, "Service d'appel injoignable"); }
  const rj = await r.json().catch(() => ({}));
  const e0 = rj && rj.entries && rj.entries[0];
  if (!r.ok || !e0 || !/queued/i.test(String(e0.status || ""))) { await db.majJournal(appel.id, "echec", null, String((e0 && e0.status) || r.status).slice(0, 80)); return err(502, "L'appel n'a pas pu être lancé"); }
  return rep(200, { ok: true, message: "Votre téléphone va sonner : répondez pour être mis en relation avec le client." });
}

/* 3. Opérateur : rappel vocal quand le livreur décroche → on compose le client. Réponse XML. */
export async function traiterVoix(db, cfg, params, secret, now = Date.now()) {
  const xml = (corps) => ({ status: 200, xml: `<?xml version="1.0" encoding="UTF-8"?><Response>${corps}</Response>` });
  if (!cfg.voixSecret || !egal(secret, cfg.voixSecret)) return { status: 403, xml: "" };
  const id = String(params.clientRequestId || ""); const appel = id ? await db.getAppel(id) : null;
  if (params.isActive === "0" || params.callSessionState === "Completed") {   // événement de fin d'appel
    if (appel) await db.majJournal(appel.id, appel.statut === "relie" ? "relie" : "echec", Math.max(0, Math.round(+params.durationInSeconds || 0)), appel.statut === "relie" ? null : "non relié");
    return { status: 200, xml: "" };
  }
  const t = appel ? await db.getTicketId(appel.ticket_id) : null;
  if (!t || t.clos || Date.parse(t.expire_at) < now) return xml("<Say>Cet appel n'est plus autorisé.</Say><Reject/>");
  await db.majJournal(appel.id, "relie", null, null);
  const maxD = Math.min(600, Math.max(30, Math.round(cfg.dureeMax || 300)));
  return xml(`<Say voice="woman">Mise en relation avec le client, veuillez patienter.</Say><Dial phoneNumbers="${t.client_tel}" callerId="${cfg.atNumero}" record="false" sequential="true" maxDuration="${maxD}"/>`);
}
