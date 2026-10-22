/* Passerelle livreur LOGISTICA : logique pure, testée hors Supabase (voir tests/passerelle.js).

   Principe : le bureau (application Distributions) reste la source de vérité. Il publie sur le serveur, pour chaque mission, une
   projection SANS numéro de téléphone et SANS code de confirmation (seule l'empreinte du code est conservée). Le livreur se connecte avec un
   compte Supabase Auth (mot de passe vérifié par le serveur), lit uniquement ses missions et envoie ses actions au serveur, qui les valide
   (droits, transitions, code de livraison) avant de les mettre en file pour le bureau. Le bureau applique ensuite chaque événement. */

import { egal, sha256hex } from "./pont.js";

export { CORS } from "./pont.js";

const rep = (status, body) => ({ status, body });
const err = (status, message) => rep(status, { ok: false, erreur: message });
export const emailDe = (ident) => { ident = String(ident || "").trim(); return ident.includes("@") ? ident.toLowerCase() : ident.toLowerCase().replace(/[^a-z0-9._-]/g, "") + "@users.logistica-erp.app"; };

/* Mot de passe temporaire (14 caractères : 4 majuscules, 4 minuscules, 4 chiffres, 2 symboles, mélangés) */
export function genererMdp() {
  const A = ["ABCDEFGHJKMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "-_@#%+"], plan = [4, 4, 4, 2], out = [];
  const alea = (n) => { const lim = 256 - (256 % n), b = new Uint8Array(1); do { crypto.getRandomValues(b); } while (b[0] >= lim); return b[0] % n; };
  plan.forEach((n, i) => { for (let j = 0; j < n; j++) out.push(A[i][alea(A[i].length)]); });
  for (let i = out.length - 1; i > 0; i--) { const j = alea(i + 1), t = out[i]; out[i] = out[j]; out[j] = t; }
  return out.join("");
}

/* Colis : l'étiquette de chaque colis porte un jeton de 5 caractères (dans le QR et imprimé dessous). Le serveur n'en garde que l'empreinte : le livreur ne peut valider un colis que s'il l'a vraiment sous les yeux. */
export const empreinteColis = (livraison_ref, n, tok) => sha256hex("colis|" + livraison_ref + "|" + n + "|" + String(tok).trim().toUpperCase());
export const empreinteJeton = (jeton) => sha256hex("sign|" + String(jeton).trim().toUpperCase());
const ALPHA_J = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PNG = /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/, JPG = /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/, SIG_MAX = 80000, PHOTO_MAX = 80000;
const QR_COLIS = /^AGE1\|([^|]+)\|(\d+)\/(\d+)\|([A-Z0-9]{5})$/;
/* Contrôle des colis scannés (QR ou code de 5 caractères) : chaque colis de la mission doit être reconnu. Retourne { ok, scans:[{n,mode}] } ou { ok:false, msg }. */
async function verifierScans(db, m, scans) {
  const ref = m.livraison_ref, K = await db.colis(ref), L = Array.isArray(scans) ? scans.slice(0, 120) : [], vus = new Map();
  for (const x of L) {
    const t = txt(x && x.txt, 80).toUpperCase(); let n = 0, tok = "", mode = "saisi";
    const q = QR_COLIS.exec(t);
    if (q) { if (q[1] !== String(m.commande_ref).toUpperCase()) return { ok: false, msg: "Ce colis appartient à la commande " + q[1] + ", pas à " + m.commande_ref }; n = +q[2]; tok = q[4]; mode = "scan"; }
    else if (/^[A-Z0-9]{5}$/.test(t)) tok = t; else continue;
    const h = (c) => empreinteColis(ref, c, tok);
    if (n) { const k = K.find((c) => c.n === n); if (k && egal(await h(n), k.hash)) vus.set(n, mode); }
    else for (const k of K) if (egal(await h(k.n), k.hash)) { vus.set(k.n, "saisi"); break; }
  }
  const manque = K.filter((k) => !vus.has(k.n)).map((k) => k.n);
  if (manque.length) return { ok: false, msg: "Colis non reconnus ou non scannés : n° " + manque.join(", ") };
  return { ok: true, scans: K.map((k) => ({ n: k.n, mode: vus.get(k.n) })) };
}

export const empreinteCode = (livraison_ref, code) => sha256hex("code|" + livraison_ref + "|" + String(code).trim());

const STATUTS_ACTIFS = ["affectee", "acceptee", "en_cours"];
const TYPES = ["accepter", "refuser", "prise_en_charge", "demarrer", "confirmer", "echec", "position", "incident", "arrive", "rappel_client", "demande_signature", "signature_etat"];
const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const nombre = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/* ================= Bureau (clé d'administration) ================= */
export async function traiterSync(db, cfg, req, adminKey, now = Date.now()) {
  if (!cfg.adminKey || !egal(adminKey, cfg.adminKey)) return err(401, "Clé d'administration invalide");
  const a = String(req.action || "");

  if (a === "publier") {
    const L = Array.isArray(req.missions) ? req.missions.slice(0, 300) : [], connus = new Set(await db.livreursConnus()), attente = new Set(await db.refsAvecEvenementsEnAttente());
    let ecrites = 0, ignorees = 0; const inconnus = [];
    for (const m of L) {
      const ref = txt(m.livraison_ref, 60), lv = txt(m.livreur_ref, 60);
      if (!ref || !lv || !m.payload || typeof m.payload !== "object") { ignorees++; continue; }
      if (!connus.has(lv)) { if (!inconnus.includes(lv)) inconnus.push(lv); continue; }
      if (attente.has(ref)) { ignorees++; continue; }   // un événement du livreur n'est pas encore appliqué par le bureau : on ne l'écrase pas
      const p = JSON.parse(JSON.stringify(m.payload)); delete p.tel; delete p.code; delete p.colis;
      const K = (Array.isArray(m.colis) ? m.colis : []).slice(0, 99).filter((k) => k && Number.isInteger(k.n) && k.n >= 1 && k.n <= 99 && /^[A-Za-z0-9]{5}$/.test(String(k.tok || "")));
      if (K.length) p.colis_total = K.length; else delete p.colis_total;
      await db.ecrireMission({ livraison_ref: ref, livreur_ref: lv, commande_ref: txt(m.commande_ref, 40), statut: txt(m.statut, 20), payload: p, maj_le: new Date(now).toISOString() });
      if (m.code != null && String(m.code).trim() !== "") await db.ecrireCode(ref, await empreinteCode(ref, m.code));
      if (K.length) await db.ecrireColis(ref, await Promise.all(K.map(async (k) => ({ n: k.n, hash: await empreinteColis(ref, k.n, k.tok) }))));
      ecrites++;
    }
    const R = Array.isArray(req.retirer) ? req.retirer.slice(0, 500).map((x) => txt(x, 60)).filter(Boolean) : [];
    if (R.length) await db.retirerMissions(R);
    return rep(200, { ok: true, ecrites, ignorees, retirees: R.length, livreurs_inconnus: inconnus });
  }
  if (a === "preuve") {   /* signature, photo et position d'une livraison confirmée : le bureau les range dans son dossier */
    const pr = await db.preuve(txt(req.livraison_ref, 60)); return rep(200, { ok: true, preuve: pr || null });
  }
  if (a === "evenements") return rep(200, { ok: true, evenements: await db.evenementsEnAttente(200) });
  if (a === "acquitter") {
    const ids = (Array.isArray(req.ids) ? req.ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 500);
    if (ids.length) await db.acquitter(ids); return rep(200, { ok: true, acquittes: ids.length });
  }
  if (a === "compte-creer") {
    const ref = txt(req.livreur_ref, 60), nom = txt(req.nom, 80), ident = txt(req.ident, 80);
    if (!ref || !nom || !ident) return err(400, "Livreur, nom et identifiant obligatoires");
    if (ident.includes("@") ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ident) : !/^[A-Za-z0-9._-]{3,}$/.test(ident)) return err(400, "Identifiant : 3 caractères minimum (lettres, chiffres, point, tiret)");
    if (await db.compteDe(ref)) return err(409, "Ce livreur a déjà un compte : réinitialisez son mot de passe");
    const mdp = genererMdp(); let uid;
    try { uid = await db.creerUtilisateur(emailDe(ident), mdp, { chg: true, role: "livreur" }); } catch (e) { return err(409, "Cet identifiant existe déjà ou est refusé : " + txt(e && e.message, 120)); }
    await db.ecrireCompte({ livreur_ref: ref, user_id: uid, nom, ident: ident.toLowerCase(), actif: true });
    return rep(200, { ok: true, ident: ident.toLowerCase(), mdp });
  }
  if (a === "compte-reset") {
    const c = await db.compteDe(txt(req.livreur_ref, 60)); if (!c) return err(404, "Compte livreur introuvable");
    const mdp = genererMdp(); await db.changerMdp(c.user_id, mdp, { chg: true, role: "livreur" }); return rep(200, { ok: true, mdp });
  }
  if (a === "compte-actif") {
    const c = await db.compteDe(txt(req.livreur_ref, 60)); if (!c) return err(404, "Compte livreur introuvable");
    const actif = !!req.actif; await db.bloquerUtilisateur(c.user_id, !actif); await db.majCompte(c.livreur_ref, { actif }); return rep(200, { ok: true, actif });
  }
  return err(400, "Action inconnue");
}

/* ================= Livreur (JWT vérifié : userId fourni par la fonction) ================= */
export async function traiterAction(db, cfg, req, userId, now = Date.now()) {
  if (!userId) return err(401, "Connexion requise");
  const c = await db.compteParUtilisateur(userId); if (!c || !c.actif) return err(403, "Compte livreur inactif");
  const ref = txt(req.livraison_ref, 60), type = String(req.type || ""), d = (req.donnees && typeof req.donnees === "object") ? req.donnees : {};
  if (!TYPES.includes(type)) return err(400, "Action inconnue");
  const m = ref ? await db.mission(ref) : null;
  if (!m || m.livreur_ref !== c.livreur_ref) return err(403, "Cette mission n'est pas la vôtre");   // même réponse si elle n'existe pas
  const p = m.payload || {}, st = m.statut;
  const maj = { statut: st, payload: p }, ev = {};
  const refuse = (s, msg) => err(s, msg);

  if (type === "demande_signature") {   /* le livreur affiche un QR : le client signe sur SON téléphone (lien à usage unique, 15 minutes) */
    if (st !== "en_cours") return refuse(409, "La signature se fait pendant la livraison");
    let jeton = ""; const o = crypto.getRandomValues(new Uint8Array(16)); for (const x of o) jeton += ALPHA_J[x % ALPHA_J.length];
    const expire = new Date(now + 15 * 60000).toISOString();
    await db.ecrireJeton({ token_hash: await empreinteJeton(jeton), livraison_ref: ref, expire, utilise: false });
    return rep(200, { ok: true, statut: st, jeton, expire });
  }
  if (type === "signature_etat") {
    const pr = await db.preuve(ref);
    return rep(200, { ok: true, statut: st, signee: !!(pr && pr.signature_client), nom: pr && pr.client_nom || "", le: pr && pr.client_signe_le || null });
  }

  if (type === "accepter") { if (st !== "affectee") return refuse(409, "Cette mission n'est plus à accepter"); maj.statut = "acceptee"; }
  else if (type === "refuser") {
    if (!["affectee", "acceptee"].includes(st)) return refuse(409, "Cette mission ne peut plus être refusée"); const motif = txt(d.motif, 200);
    if (motif.length < 3) return refuse(400, "Motif obligatoire (3 caractères minimum)"); maj.statut = "refusee"; ev.motif = motif;
  }
  else if (type === "prise_en_charge") {
    if (st !== "acceptee" || p.collecte_at) return refuse(409, "Prise en charge impossible dans l'état actuel"); const nb = Math.round(nombre(d.nb_colis));
    if (!(nb >= 1 && nb <= 99)) return refuse(400, "Nombre de colis : entre 1 et 99");
    if (p.exige_colis && p.colis_total > 0) {   /* chaque colis doit être scanné à la prise en charge : le nombre est celui de la commande */
      const v = await verifierScans(db, { livraison_ref: ref, commande_ref: m.commande_ref }, d.scans);
      if (!v.ok) return refuse(403, v.msg); p.colis_collecte = v.scans; ev.scans = v.scans; ev.nb_colis = p.colis_total;
    }
    p.collecte_at = new Date(now).toISOString(); p.nb_colis = ev.nb_colis || nb; ev.nb_colis = p.nb_colis; ev.etat = txt(d.etat, 60);
  }
  else if (type === "demarrer") { if (st !== "acceptee" || !p.collecte_at) return refuse(409, "Prenez d'abord les colis en charge"); maj.statut = "en_cours"; }
  else if (type === "echec") {
    if (!STATUTS_ACTIFS.includes(st)) return refuse(409, "Livraison déjà clôturée"); const motif = txt(d.motif, 200); if (motif.length < 3) return refuse(400, "Motif obligatoire");
    maj.statut = "echouee"; ev.motif = motif; ev.obs = txt(d.obs, 300);
  }
  else if (type === "confirmer") {
    if (st !== "en_cours") return refuse(409, "Cette livraison n'est plus en cours");
    const k = await db.code(ref); if (!k) return refuse(409, "Code de confirmation indisponible : contactez le bureau");
    if (k.verrou_jusqua && Date.parse(k.verrou_jusqua) > now) return refuse(429, "Trop d'essais : code verrouillé, patientez ou contactez le bureau");
    const ok = egal(await empreinteCode(ref, d.code == null ? "" : d.code), k.code_hash);
    if (!ok) {
      const essais = (k.essais || 0) + 1, max = cfg.essaisCodeMax || 5;
      await db.majCode(ref, essais >= max ? { essais: 0, verrou_jusqua: new Date(now + 15 * 60000).toISOString() } : { essais });
      return refuse(403, essais >= max ? "Code incorrect : verrouillé 15 minutes" : "Code de confirmation incorrect");
    }
    const montant = Math.round(nombre(d.montant)), att = Math.round(nombre(p.montant_attendu) || 0), recu = txt(d.recu_par, 80);
    if (!(montant >= 0) || montant > 1e9) return refuse(400, "Montant encaissé invalide");
    if (!recu) return refuse(400, "Nom de la personne ayant reçu obligatoire");
    if (montant !== att && txt(d.ecart_note, 300).length < 3) return refuse(400, "Écart de " + (montant - att) + " F : explication obligatoire");
    /* preuves : colis remis (scan), signature (client sur son téléphone, sinon livreur), photo, position */
    if (p.exige_colis && p.colis_total > 0) { const v = await verifierScans(db, { livraison_ref: ref, commande_ref: m.commande_ref }, d.scans); if (!v.ok) return refuse(403, v.msg); ev.scans = v.scans; }
    const pr = await db.preuve(ref) || {}, sigL = typeof d.signature === "string" && d.signature ? d.signature : "";
    if (sigL && (!PNG.test(sigL) || sigL.length > SIG_MAX)) return refuse(400, "Signature illisible : recommencez");
    const photo = typeof d.photo === "string" && d.photo ? d.photo : "";
    if (photo && (!JPG.test(photo) || photo.length > PHOTO_MAX)) return refuse(400, "Photo illisible : reprenez-la");
    if (p.exige_signature && !pr.signature_client && !sigL) return refuse(400, "Signature du destinataire obligatoire pour cette commande");
    const g = d.gps && typeof d.gps === "object" ? { lat: nombre(d.gps.lat), lng: nombre(d.gps.lng), precision: Math.round(nombre(d.gps.precision) || 0) } : null, gps = g && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180 ? g : null;
    const patch = {}; if (sigL) patch.signature = sigL; if (photo) patch.photo = photo; if (gps) patch.gps = gps;
    if (Object.keys(patch).length) await db.ecrirePreuve(ref, patch);
    ev.preuve = !!(sigL || photo || pr.signature_client); ev.signature_source = pr.signature_client ? "client" : sigL ? "livreur" : ""; ev.photo = !!photo; if (gps) ev.gps = gps;
    await db.majCode(ref, { essais: 0, verrou_jusqua: null });
    maj.statut = "livree"; Object.assign(ev, { montant, mode: txt(d.mode, 40), ref_paiement: txt(d.ref, 60), direct: !!d.direct, recu_par: recu, obs: txt(d.obs, 300), ecart_note: txt(d.ecart_note, 300) });
  }
  else if (type === "position") {
    if (!STATUTS_ACTIFS.includes(st)) return refuse(409, "Pas de suivi hors mission");
    const lat = nombre(d.lat), lng = nombre(d.lng); if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return refuse(400, "Position invalide");
    const dernier = m.position_le ? Date.parse(m.position_le) : 0; ev.lat = lat; ev.lng = lng; ev.precision = Math.round(nombre(d.precision) || 0);
    await db.majPosition(ref, { lat, lng, precision: ev.precision, ts: new Date(now).toISOString() });
    if (now - dernier < 20000) return rep(200, { ok: true, statut: st });   // le bureau est informé au plus une fois toutes les 20 s
  }
  else if (type === "arrive") {   // « Je suis arrivé » : horodate l'arrivée à destination (début de l'attente)
    if (st !== "en_cours") return refuse(409, "Vous n'êtes pas en course : démarrez d'abord la livraison");
    if (p.contact && p.contact.arrive_at) return rep(200, { ok: true, statut: st });   // déjà signalé : rien à refaire
    p.contact = Object.assign({}, p.contact, { arrive_at: new Date(now).toISOString() }); ev.at = p.contact.arrive_at;
  }
  else if (type === "rappel_client") {   // « Le client ne répond pas » : demande au centre de rappeler le client
    if (st !== "en_cours") return refuse(409, "Cette demande se fait pendant la livraison");
    const dem = p.contact && p.contact.demande_le ? Date.parse(p.contact.demande_le) : 0;
    if (p.contact && p.contact.statut === "attente" && now - dem < 120000) return rep(200, { ok: true, statut: st });   // déjà transmise
    p.contact = Object.assign({}, p.contact, { statut: "attente", demande_le: new Date(now).toISOString() }); if (!p.contact.arrive_at) p.contact.arrive_at = p.contact.demande_le;
    ev.motif = txt(d.motif, 120) || "Je suis arrivé : le client ne répond pas";
  }
  else if (type === "incident") { ev.nature = txt(d.nature, 60); ev.description = txt(d.description, 300); if (!ev.description) return refuse(400, "Décrivez l'incident"); }

  if (maj.statut !== st || type === "prise_en_charge" || type === "arrive" || type === "rappel_client") await db.majMission(ref, { statut: maj.statut, payload: p, maj_le: new Date(now).toISOString() });
  await db.ajouterEvenement({ livraison_ref: ref, livreur_ref: c.livreur_ref, type, donnees: ev });
  return rep(200, { ok: true, statut: maj.statut });
}
