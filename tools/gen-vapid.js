#!/usr/bin/env node
/* Génère une paire de clés VAPID (Web Push) : node tools/gen-vapid.js
   - la clé PUBLIQUE se met dans passerelle-config.js (champ vapid) ET dans le secret VAPID_PUBLIC_KEY ;
   - la clé PRIVÉE ne va que dans le secret Supabase VAPID_PRIVATE_KEY (jamais dans le dépôt ni dans une page). */
const c = require("crypto"), e = c.createECDH("prime256v1");
e.generateKeys();
const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log("VAPID_PUBLIC_KEY=" + b64u(e.getPublicKey()));
console.log("VAPID_PRIVATE_KEY=" + b64u(e.getPrivateKey()));
console.log("\nsupabase secrets set VAPID_PUBLIC_KEY=<publique> VAPID_PRIVATE_KEY=<privée> VAPID_SUBJECT=mailto:vous@exemple.com");
