/* Hache un mot de passe comme auth-engine.js (PBKDF2-SHA256, 150 000 itérations) pour l'administrateur initial d'une instance.
   Usage : node tools/admin-hash.js "<mot de passe>"  → JSON à coller dans clients/<client>/marque.js (admin.pwd). Ne jamais committer le mot de passe. */
const c = require("crypto"), mdp = process.argv[2];
if (!mdp || mdp.length < 10) { console.error("Mot de passe de 10 caractères minimum requis."); process.exit(1); }
const s = c.randomBytes(16), it = 150000, h = c.pbkdf2Sync(String(mdp), s, it, 32, "sha256");
console.log(JSON.stringify({ v: 2, it, s: s.toString("base64"), h: h.toString("base64") }));
