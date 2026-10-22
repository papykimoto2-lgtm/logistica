// Edge Function — réception sécurisée des positions GPS (cahier des charges §4.7).
// Les boîtiers (ou la plateforme du fournisseur) appellent : POST /functions/v1/gps-ingest
//   en-tête  x-gps-key: <GPS_INGEST_KEY>     corps  {"ident":"...","lat":5.34,"lng":-4.08,"t":"2026-01-01T10:00:00Z","speed":32}
//   ou un tableau de positions (500 maximum). Les contrôles de cohérence sont faits en base (ingest_gps_position).
// Déploiement : supabase functions deploy gps-ingest --no-verify-jwt
//               supabase secrets set GPS_INGEST_KEY=<secret long et aléatoire>
// Adaptateur fournisseur : si le fournisseur envoie un autre format, convertir ici vers {ident,lat,lng,t,speed}.
import { createClient } from "jsr:@supabase/supabase-js@2";

const KEY = Deno.env.get("GPS_INGEST_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!KEY || KEY.length < 24 || !safeEqual(req.headers.get("x-gps-key") ?? "", KEY)) return json({ error: "unauthorized" }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0 || items.length > 500) return json({ error: "invalid_batch_size" }, 413);
  const results: string[] = [];
  for (const i of items as Record<string, unknown>[]) {
    const { data, error } = await sb.rpc("ingest_gps_position", {
      p_ident: String(i?.ident ?? "").slice(0, 64),
      p_lat: Number(i?.lat), p_lng: Number(i?.lng),
      p_t: typeof i?.t === "string" ? i.t : null,
      p_vit: Number(i?.speed ?? 0),
    });
    results.push(error ? "error" : String(data));   // détail des erreurs : journaux Supabase, jamais renvoyé au client
  }
  return json({ received: items.length, results });
});
