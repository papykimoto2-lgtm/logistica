/* Demandes du portail public → bureau : logique pure, testée hors Supabase (voir tests/portail-demandes.js).

   Le portail envoie le même message que sur WhatsApp (avec son marqueur [BOUTIQUE:…], [LIVRAISON:…] ou [ABONNEMENT:…]). Le serveur le contrôle, limite le débit
   par visiteur, dédoublonne sur la référence et le met en file. Le bureau (clé d'administration) relève la file, importe chaque message dans Distributions
   — avec les mêmes contrôles que l'import manuel — puis acquitte. Rien n'est jamais renvoyé au visiteur, hors la référence de sa demande. */

import { egal, sha256hex } from "./pont.js";

export { CORS } from "./pont.js";

const rep = (status, body) => ({ status, body });
const err = (status, message) => rep(status, { ok: false, erreur: message });
const MARQ = /\[(BOUTIQUE|LIVRAISON|ABONNEMENT):([A-Za-z0-9_-]{8,5000})\]/g;
const TAILLE_MAX = 6000, PAR_MESSAGE_MAX = 3;
const CAPTURE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/, CAPTURES_MAX = 5, CAPTURE_TAILLE = 150000, CAPTURES_TOTAL = 600000;
/* Captures d'écran du client (JPEG compressés par le portail) : bornées en nombre, en taille unitaire et en volume total */
function lireCaptures(req) {
  if (req.photos == null) return [];
  if (!Array.isArray(req.photos)) return null;
  const L = req.photos;
  if (L.length > CAPTURES_MAX || L.some((x) => typeof x !== "string" || x.length > CAPTURE_TAILLE || !CAPTURE.test(x))) return null;
  return L;
}

function decoder(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("charge utile invalide");
  return o;
}
/* Marqueurs d'un message : [{type, ref}] — chaque charge utile doit se décoder et porter une référence « f » */
export function lireMarqueurs(message) {
  const out = [];
  for (const m of String(message).matchAll(MARQ)) {
    let o; try { o = decoder(m[2]); } catch { throw new Error("Demande illisible"); }
    const ref = String(o.f || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
    if (ref.length < 3) throw new Error("Référence de demande absente");
    out.push({ type: m[1], ref, vendeur: m[1] === "BOUTIQUE" ? String(o.v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) : "" });
  }
  return out;
}
const refDemande = (r) => String(r || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
export const empreinteVisiteur = (ip, sel) => sha256hex("portail|" + String(sel || "") + "|" + String(ip || "inconnu"));

/* ================= Visiteur du portail (public) ================= */
/* Visite du lien / QR d'un vendeur : comptée une fois par visiteur, par jour et par source ; seulement pour un vendeur qui a une clé de relève ; plafonnée par visiteur */
const SOURCES = ["qr", "lien", "live"], SCANS_JOUR_MAX = 20;
export async function enregistrerScan(db, cfg, scan, ip, now = Date.now()) {
  const v = idVendeur(scan && scan.v), src = scan && scan.s;
  if (!v || !SOURCES.includes(src)) return err(400, "Visite illisible");
  const h = await empreinteVisiteur(ip, cfg.sel), jour = new Date(now).toISOString().slice(0, 10);
  if (!(await db.empreinteVendeur(v))) return rep(200, { ok: true, compte: false });
  if ((await db.compterScans(h, jour)) >= SCANS_JOUR_MAX) return rep(200, { ok: true, compte: false });
  await db.ajouterScan({ vendeur: v, jour, src, visiteur: h });
  return rep(200, { ok: true, compte: true });
}
export async function recevoir(db, cfg, req, ip, now = Date.now()) {
  if (req && req.scan && typeof req.scan === "object") return enregistrerScan(db, cfg, req.scan, ip, now);
  if (req && req.live && typeof req.live === "object") return lireLive(db, req.live);
  if (req && req.verif && typeof req.verif === "object") return verifierLien(db, cfg, req.verif);
  const message = typeof req.message === "string" ? req.message.trim() : "";
  if (!message) return err(400, "Message absent");
  if (message.length > TAILLE_MAX) return err(413, "Message trop long");
  let M; try { M = lireMarqueurs(message); } catch (e) { return err(400, e.message); }
  if (!M.length) return err(400, "Aucune demande dans ce message");
  const photos = lireCaptures(req);
  if (!photos) return err(400, "Captures d'écran illisibles (5 images JPEG au plus)");
  if (photos.reduce((t, x) => t + x.length, 0) > CAPTURES_TOTAL) return err(413, "Captures trop volumineuses");
  if (photos.length && M.length !== 1) return err(400, "Captures : une seule demande par envoi");
  if (M.length > PAR_MESSAGE_MAX) return err(400, "Trop de demandes dans un même message");
  if (new Set(M.map((x) => x.ref)).size !== M.length) return err(400, "Références en double");
  const h = await empreinteVisiteur(ip, cfg.sel);
  if ((await db.compterRecentes(h, new Date(now - 3600000).toISOString())) + M.length > (cfg.limiteHeure || 20)) return err(429, "Trop de demandes depuis cet appareil : réessayez plus tard ou utilisez WhatsApp");
  if ((await db.enAttente()) >= (cfg.fileMax || 2000)) return err(503, "Service momentanément saturé : utilisez WhatsApp");
  const recues = [], doublons = [];
  for (const m of M) {
    if (await db.existe(m.ref)) { doublons.push(m.ref); continue; }
    await db.inserer({ ref: m.ref, type: m.type, message, ip_hash: h, vendeur: m.vendeur || null, nb_photos: photos.length });
    if (photos.length) await db.insererPhotos(m.ref, photos);
    recues.push(m.ref);
  }
  return rep(200, { ok: true, refs: recues.concat(doublons), doublons: doublons.length });
}

/* ================= Lien / QR signé du vendeur (anti-fraude) ================= */
/* Signature = HMAC-SHA256(secret serveur, « lien | vendeur | boutique | téléphone | version »), 16 premiers caractères hexadécimaux. Mêmes normalisations que le portail (nom : 80 caractères, téléphone : chiffres, 20 au plus). */
const normLien = (v, b, t, rev) => "lien|" + idVendeur(v) + "|" + String(b || "").trim().slice(0, 80).toLowerCase().replace(/\s+/g, " ") + "|" + String(t || "").replace(/\D/g, "").slice(0, 20) + "|" + (+rev || 0);
export async function signerLien(sel, v, b, t, rev) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("lien-signe|" + sel), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const m = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(normLien(v, b, t, rev))));
  return [...m].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
/* Visiteur du portail : ce lien est-il authentique ? (aucune information sur le vendeur n'est renvoyée, seulement oui / non) */
export async function verifierLien(db, cfg, q) {
  const v = idVendeur(q && q.v), sig = String(q && q.s || "").toLowerCase();
  if (!v || !/^[a-f0-9]{16}$/.test(sig) || !cfg.sel) return rep(200, { ok: true, valide: false });
  const rev = await db.lienRev(v); if (rev == null) return rep(200, { ok: true, valide: false });
  return rep(200, { ok: true, valide: egal(await signerLien(cfg.sel, v, q.b, q.t, rev), sig) });
}

/* ================= Mode Live ================= */
/* Visiteur du portail : produits du live en cours du vendeur (rien si le live est terminé ou inexistant) */
export async function lireLive(db, q) {
  const v = idVendeur(q && q.v); if (!v) return err(400, "Vendeur absent");
  const L = await db.lireLive(v);
  if (!L || !L.actif) return rep(200, { ok: true, actif: false });
  return rep(200, { ok: true, actif: true, titre: L.titre, produits: L.produits, maj_le: L.maj_le });
}
/* Vendeur (clé de relève) : publie ou met à jour son live — produits (nom, prix facultatif, épuisé) bornés et nettoyés */
async function publierLive(db, v, req) {
  const titre = String(req.titre || "").trim().slice(0, 80); if (titre.length < 2) return err(400, "Donnez un titre au live");
  if (!Array.isArray(req.produits)) return err(400, "Liste de produits illisible");
  const produits = [];
  for (const x of req.produits.slice(0, 60)) {
    const n = String(x && x.n || "").trim().replace(/\s+/g, " ").slice(0, 120); if (!n) continue;
    const p = x.p == null || x.p === "" ? null : Math.round(Number(x.p)); if (p != null && !(p >= 0 && p <= 1e8)) return err(400, "Prix invalide pour « " + n + " »");
    produits.push({ n, p, ok: x.ok !== false });
  }
  const actif = req.actif !== false; if (actif && !produits.length) return err(400, "Ajoutez au moins un produit");
  await db.ecrireLive({ vendeur: v, titre, produits, actif, maj_le: new Date().toISOString() });
  return rep(200, { ok: true, produits: produits.length, actif });
}

/* ================= Bureau (clé d'administration) ================= */
export async function traiterBureau(db, cfg, req, adminKey) {
  if (!cfg.adminKey || !egal(adminKey, cfg.adminKey)) return err(401, "Clé d'administration invalide");
  const a = String(req.action || "");
  if (a === "lister") return rep(200, { ok: true, demandes: await db.enAttenteListe(100) });
  if (a === "photos") return rep(200, { ok: true, photos: await db.photosDe(refDemande(req.ref), null) });
  if (a === "publier") return publierCatalogue(db, req);
  if (a === "cle_vendeur") return cleVendeur(db, req);
  if (a === "acquitter") {
    const ids = (Array.isArray(req.ids) ? req.ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 500);
    if (ids.length) await db.acquitter(ids); return rep(200, { ok: true, acquittes: ids.length });
  }
  return err(400, "Action inconnue");
}

/* ================= Catalogue public du portail ================= */
const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;
/* Le bureau publie le catalogue (jeton de boutique + photos) : contrôlé, borné, puis remplace la version précédente. */
async function publierCatalogue(db, req) {
  const boutique = typeof req.boutique === "string" ? req.boutique : "";
  if (boutique && !/^[A-Za-z0-9_-]{20,300000}$/.test(boutique)) return err(400, "Catalogue illisible");
  const ph = req.photos && typeof req.photos === "object" && !Array.isArray(req.photos) ? req.photos : {}, photos = {}; let total = 0, ignorees = 0;
  for (const [k, v] of Object.entries(ph).slice(0, 300)) {
    const code = String(k).slice(0, 30);
    /* un article porte une ou plusieurs photos (5 au plus, la première est la principale) ; une chaîne seule reste acceptée */
    const L = (Array.isArray(v) ? v : [v]).slice(0, 5).filter((x) => typeof x === "string" && x.length <= 70000 && PHOTO.test(x));
    if (!code || !L.length) { ignorees++; continue; }
    total += L.reduce((t, x) => t + x.length, 0); if (total > 6000000) return err(413, "Photos trop volumineuses (6 Mo au plus)");
    photos[code] = L;
  }
  await db.ecrireCatalogue({ boutique, photos });
  return rep(200, { ok: true, photos: Object.keys(photos).length, ignorees });
}
/* Visiteur du portail : lecture seule du catalogue publié */
export async function lireCatalogue(db) {
  const c = await db.lireCatalogue(); if (!c || !c.boutique) return rep(200, { ok: true, boutique: "", photos: {}, maj_le: null });
  return rep(200, { ok: true, boutique: c.boutique, photos: c.photos || {}, maj_le: c.maj_le });
}

/* ================= Vendeur partenaire (clé de relève) ================= */
const idVendeur = (v) => String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/* Le bureau crée (ou renouvelle) la clé de relève d'un vendeur : montrée une seule fois, seule l'empreinte est gardée. L'ancienne clé cesse de fonctionner. */
async function cleVendeur(db, req) {
  const v = idVendeur(req.vendeur); if (!v) return err(400, "Vendeur absent");
  const octets = crypto.getRandomValues(new Uint8Array(20)); let cle = "";
  for (const o of octets) cle += ALPHA[o % ALPHA.length];
  cle = cle.match(/.{1,5}/g).join("-");
  await db.ecrireCleVendeur(v, await sha256hex("vendeur|" + cle));
  return rep(200, { ok: true, cle });
}
/* Le vendeur relève SEULEMENT ses demandes (identifiant + clé) puis les acquitte : jamais celles d'un autre vendeur, jamais celles du bureau. */
export async function traiterVendeur(db, req, cfg = {}) {
  const v = idVendeur(req.vendeur), cle = String(req.cle || "").trim().toUpperCase();
  const h = v && cle ? await db.empreinteVendeur(v) : null;
  if (!h || !egal(h, await sha256hex("vendeur|" + cle))) return err(401, "Clé de relève invalide");
  const a = String(req.action || "");
  if (a === "lister") return rep(200, { ok: true, demandes: await db.enAttenteVendeur(v, 100) });
  if (a === "photos") return rep(200, { ok: true, photos: await db.photosDe(refDemande(req.ref), v) });
  if (a === "live_publier") return publierLive(db, v, req);
  if (a === "lien_signer" || a === "lien_renouveler") {   /* signature du lien / QR du vendeur ; « renouveler » invalide tous les anciens liens signés */
    if (!cfg.sel) return err(503, "Signature indisponible : secret du serveur non configuré");
    const rev = a === "lien_renouveler" ? await db.renouvelerLien(v) : await db.lienRev(v);
    return rep(200, { ok: true, sig: await signerLien(cfg.sel, v, req.boutique, req.tel, rev), rev });
  }
  if (a === "stats") return rep(200, { ok: true, scans: await db.statsScans(v, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) });
  if (a === "acquitter") {
    const ids = (Array.isArray(req.ids) ? req.ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 500);
    if (ids.length) await db.acquitterVendeur(v, ids); return rep(200, { ok: true, acquittes: ids.length });
  }
  return err(400, "Action inconnue");
}
