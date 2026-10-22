# LOGISTICA — déploiement du serveur (Supabase)

Tables et fonctions Edge : `supabase/migrations` (004 → 019) et `supabase/functions`.

## Fonctions (14)
`sync` · `portail-demande` · `portail-sync` · `portail-catalogue` · `portail-vendeur` · `mission-sync` · `mission-action` (JWT) · `livraison-signer` · `push-abonner` (JWT) · `push-envoyer` · `appel-ticket` · `appel-pont` · `appel-voix` · `rapport-connexions`.

## Secrets (jamais dans le dépôt)
Obligatoires : `SYNC_KEY`, `ADMIN_KEY`, `PORTAIL_SEL`. Notifications : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Optionnels : `CRON_KEY`, `RESEND_API_KEY`, `RAPPORT_DE`, `AT_USERNAME`, `AT_API_KEY`, `AT_NUMERO`, `VOIX_SECRET`, `TEL_INDICATIF`.

## Commandes
```
node tools/gen-secrets.js logistica
sh tools/deploy-supabase.sh <project-ref> .env.logistica
```
Après déploiement : activer la protection contre les mots de passe compromis (Authentication) et les sauvegardes quotidiennes.
