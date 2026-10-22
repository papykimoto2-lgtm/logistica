/* Adaptateur Supabase (clé « service role », jamais exposée au navigateur) et réglages lus dans les secrets de la fonction. */
import { createClient } from "jsr:@supabase/supabase-js@2";

export const cfg = () => ({
  indicatif: Deno.env.get("TEL_INDICATIF") || "225",
  adminKey: Deno.env.get("ADMIN_KEY"), voixSecret: Deno.env.get("VOIX_SECRET"),
  atUser: Deno.env.get("AT_USERNAME"), atKey: Deno.env.get("AT_API_KEY"), atNumero: Deno.env.get("AT_NUMERO"), atUrl: Deno.env.get("AT_URL") || undefined,
  delaiMini: +(Deno.env.get("APPEL_DELAI_MINI_S") || 20), dureeMax: +(Deno.env.get("APPEL_DUREE_MAX_S") || 300),
});

export function db() {
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    upsertTicket: async (t) => ok(await sb.from("appel_tickets").upsert(t, { onConflict: "commande,livreur_id" })),
    getTicket: async (commande, livreur_id) => ok(await sb.from("appel_tickets").select("*").eq("commande", commande).eq("livreur_id", livreur_id).maybeSingle()),
    getTicketId: async (id) => ok(await sb.from("appel_tickets").select("*").eq("id", id).maybeSingle()),
    clore: async (commande, livreur_id) => ok(await sb.from("appel_tickets").update({ clos: true }).eq("commande", commande).eq("livreur_id", livreur_id)),
    journalDe: async (ticket_id) => ok(await sb.from("appel_journal").select("id,ts,statut").eq("ticket_id", ticket_id)) || [],
    addJournal: async (ticket_id, statut, erreur) => ok(await sb.from("appel_journal").insert({ ticket_id, statut, erreur }).select().single()),
    getAppel: async (id) => { const a = ok(await sb.from("appel_journal").select("*").eq("id", id).maybeSingle()); return a; },
    majJournal: async (id, statut, duree_s, erreur) => ok(await sb.from("appel_journal").update({ statut, duree_s, erreur }).eq("id", id)),
  };
}
