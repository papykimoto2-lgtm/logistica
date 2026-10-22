#!/usr/bin/env node
/* Génère les secrets d'une instance dans un fichier local « .env.<client> » (jamais commité, jamais collé dans une page ni un dépôt).
   Usage : node tools/gen-secrets.js logistica
   Secrets : SYNC_KEY (synchronisation des postes), ADMIN_KEY (bureau : portail, signatures, pont, push), PORTAIL_SEL (signature des liens vendeur),
   CRON_KEY (rapport quotidien), paire VAPID (notifications push). Les clés optionnelles (Africa's Talking, Resend) se complètent à la main. */
const c = require("crypto"), fs = require("fs"), client = process.argv[2];
if (!client || !/^[a-z0-9-]+$/.test(client)) { console.error("Usage : node tools/gen-secrets.js <client>"); process.exit(1); }
const f = ".env." + client;
if (fs.existsSync(f)) { console.error(f + " existe déjà : supprimez-le d'abord pour en régénérer (les anciens secrets deviendraient invalides)."); process.exit(1); }
const rnd = n => c.randomBytes(n).toString("base64url");
const e = c.createECDH("prime256v1"); e.generateKeys();
const b64u = b => b.toString("base64url");
const contact = (() => { try { return JSON.parse(fs.readFileSync("clients/" + client + "/instance.json", "utf8")).contact.email; } catch (x) { return ""; } })();
const L = [
  "SYNC_KEY=" + rnd(32), "ADMIN_KEY=" + rnd(32), "PORTAIL_SEL=" + rnd(32), "CRON_KEY=" + rnd(24),
  "VAPID_PUBLIC_KEY=" + b64u(e.getPublicKey()), "VAPID_PRIVATE_KEY=" + b64u(e.getPrivateKey()), "VAPID_SUBJECT=mailto:" + (contact || "contact@exemple.com"),
  "TEL_INDICATIF=225"
];
fs.writeFileSync(f, L.join("\n") + "\n", { mode: 0o600 });
console.log(f + " créé (droits 600). NE PAS le commiter ni l'envoyer.\nÀ faire ensuite :\n - noter SYNC_KEY : à saisir dans Paramètres → Cloud / Supabase de chaque poste ;\n - copier VAPID_PUBLIC_KEY dans clients/" + client + "/fichiers/passerelle-config.js (champ vapid) ;\n - optionnel : ajouter AT_USERNAME, AT_API_KEY, AT_NUMERO, VOIX_SECRET (appel masqué) et RESEND_API_KEY, RAPPORT_DE (rapport e-mail).");
