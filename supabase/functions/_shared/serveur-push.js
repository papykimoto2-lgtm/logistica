/* Adaptateur Supabase des notifications push (clé « service role » : jamais exposée au navigateur) et émetteur Web Push (VAPID). */
import { client } from "./serveur-passerelle.js";

export { client };
export const cfgPush = () => ({ adminKey: Deno.env.get("ADMIN_KEY") });

export function dbPush(sb = client()) {
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  const t = () => sb.from("pg_push");
  return {
    compteParUtilisateur: async (uid) => ok(await sb.from("pg_livreurs").select("*").eq("user_id", uid).maybeSingle()),
    ecrireAbonnement: async (row) => ok(await t().upsert(row, { onConflict: "endpoint" })),
    abonnementsDe: async (ref) => ok(await t().select("endpoint,p256dh,auth,echecs,cree_le").eq("livreur_ref", ref).order("cree_le")) || [],
    supprimerAbonnement: async (endpoint) => ok(await t().delete().eq("endpoint", endpoint)),
    supprimerAbonnementDe: async (ref, endpoint) => ok(await t().delete().eq("livreur_ref", ref).eq("endpoint", endpoint)),
    marquerOk: async (endpoint, ts) => ok(await t().update({ derniere_ok: ts, echecs: 0 }).eq("endpoint", endpoint)),
    marquerEchec: async (endpoint) => { const r = ok(await t().select("echecs").eq("endpoint", endpoint).maybeSingle()); return ok(await t().update({ echecs: ((r && r.echecs) || 0) + 1 }).eq("endpoint", endpoint)); },
  };
}

/* Secrets à définir : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (voir tools/gen-vapid.js), VAPID_SUBJECT (mailto:… ou https://…). */
export async function emetteurWebPush() {
  const { default: webpush } = await import("npm:web-push@3.6.7");
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY"), sujet = Deno.env.get("VAPID_SUBJECT") || "mailto:contact@logistica-group.app";
  if (!pub || !priv) throw new Error("Clés VAPID absentes");
  webpush.setVapidDetails(sujet, pub, priv);
  return async (sub, payload) => {
    try { const r = await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: "high" }); return { status: r.statusCode }; }
    catch (e) { return { status: e && e.statusCode || 0 }; }
  };
}
