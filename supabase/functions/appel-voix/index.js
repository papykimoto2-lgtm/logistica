// Rappel vocal d'Africa's Talking (URL à saisir dans Voice → Callback URL, avec ?secret=VOIX_SECRET) : répond en XML.
import { traiterVoix } from "../_shared/pont.js";
import { cfg, db } from "../_shared/serveur.js";

Deno.serve(async (req) => {
  const u = new URL(req.url); let p = {};
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) p = Object.fromEntries(new URLSearchParams(await req.text())); else p = Object.fromEntries(u.searchParams);
  const r = await traiterVoix(db(), cfg(), p, u.searchParams.get("secret"));
  return new Response(r.xml || "", { status: r.status, headers: { "Content-Type": "application/xml" } });
});
