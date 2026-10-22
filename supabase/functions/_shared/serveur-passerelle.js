/* Adaptateur Supabase de la passerelle livreur (clé « service role » : jamais exposée au navigateur). */
import { createClient } from "jsr:@supabase/supabase-js@2";

export const cfgPasserelle = () => ({ adminKey: Deno.env.get("ADMIN_KEY"), essaisCodeMax: +(Deno.env.get("ESSAIS_CODE_MAX") || 5) });

export function client() { return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }

export function dbPasserelle(sb = client()) {
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  const t = (n) => sb.from(n);
  return {
    livreursConnus: async () => (ok(await t("pg_livreurs").select("livreur_ref").eq("actif", true)) || []).map((x) => x.livreur_ref),
    refsAvecEvenementsEnAttente: async () => (ok(await t("pg_evenements").select("livraison_ref").eq("traite", false)) || []).map((x) => x.livraison_ref),
    ecrireMission: async (m) => ok(await t("pg_missions").upsert(m, { onConflict: "livraison_ref" })),
    ecrireCode: async (ref, hash) => ok(await t("pg_codes").upsert({ livraison_ref: ref, code_hash: hash }, { onConflict: "livraison_ref" })),
    retirerMissions: async (refs) => { ok(await t("pg_codes").delete().in("livraison_ref", refs)); ok(await t("pg_missions").delete().in("livraison_ref", refs)); },
    evenementsEnAttente: async (n) => ok(await t("pg_evenements").select("id,livraison_ref,livreur_ref,type,donnees,cree_le").eq("traite", false).order("id").limit(n)) || [],
    acquitter: async (ids) => ok(await t("pg_evenements").update({ traite: true }).in("id", ids)),
    compteDe: async (ref) => ok(await t("pg_livreurs").select("*").eq("livreur_ref", ref).maybeSingle()),
    compteParUtilisateur: async (uid) => ok(await t("pg_livreurs").select("*").eq("user_id", uid).maybeSingle()),
    creerUtilisateur: async (email, mdp, meta) => { const r = await sb.auth.admin.createUser({ email, password: mdp, email_confirm: true, user_metadata: meta }); if (r.error) throw new Error(r.error.message); return r.data.user.id; },
    ecrireCompte: async (row) => ok(await t("pg_livreurs").insert(row)),
    changerMdp: async (uid, mdp, meta) => { const r = await sb.auth.admin.updateUserById(uid, { password: mdp, user_metadata: meta }); if (r.error) throw new Error(r.error.message); },
    bloquerUtilisateur: async (uid, bloque) => { const r = await sb.auth.admin.updateUserById(uid, { ban_duration: bloque ? "876000h" : "none" }); if (r.error) throw new Error(r.error.message); },
    majCompte: async (ref, patch) => ok(await t("pg_livreurs").update(patch).eq("livreur_ref", ref)),
    mission: async (ref) => ok(await t("pg_missions").select("*").eq("livraison_ref", ref).maybeSingle()),
    code: async (ref) => ok(await t("pg_codes").select("*").eq("livraison_ref", ref).maybeSingle()),
    majCode: async (ref, patch) => ok(await t("pg_codes").update(patch).eq("livraison_ref", ref)),
    majMission: async (ref, patch) => ok(await t("pg_missions").update(patch).eq("livraison_ref", ref)),
    majPosition: async (ref, pos) => ok(await t("pg_missions").update({ position: pos, position_le: pos.ts }).eq("livraison_ref", ref)),
    ecrireColis: async (ref, L) => { ok(await t("pg_colis").delete().eq("livraison_ref", ref)); if (L.length) ok(await t("pg_colis").insert(L.map((k) => ({ livraison_ref: ref, n: k.n, hash: k.hash })))); },
    colis: async (ref) => ok(await t("pg_colis").select("n,hash").eq("livraison_ref", ref).order("n")) || [],
    ecrirePreuve: async (ref, patch) => ok(await t("pg_preuves").upsert({ livraison_ref: ref, ...patch }, { onConflict: "livraison_ref" })),
    preuve: async (ref) => ok(await t("pg_preuves").select("signature,photo,gps,signature_client,client_nom,client_gps,client_signe_le").eq("livraison_ref", ref).maybeSingle()),
    ecrireJeton: async (j) => { ok(await t("pg_sign_jetons").delete().eq("livraison_ref", j.livraison_ref)); ok(await t("pg_sign_jetons").insert(j)); },
    jeton: async (hash) => ok(await t("pg_sign_jetons").select("livraison_ref,expire,utilise").eq("token_hash", hash).maybeSingle()),
    consommerJeton: async (hash) => ok(await t("pg_sign_jetons").update({ utilise: true }).eq("token_hash", hash)),
    ajouterEvenement: async (row) => ok(await t("pg_evenements").insert(row)),
  };
}
