# LOGISTICA — déploiement du serveur (Supabase, projet `hggfwxkmdylrgikokbaw`)

État : 18 tables posées et sécurisées (RLS). **À faire : purges SQL (`purges-logistica.sql`), fonctions Edge, secrets.**

## Fonctions Edge (14)
| Fonction | Rôle | JWT | Secrets utilisés |
|---|---|---|---|
| `sync` | Synchronisation des postes (Distribution, Placement, Assurance, CRM) | non | `SYNC_KEY` |
| `portail-demande` | Commandes / demandes du portail public | non | `ADMIN_KEY`, `PORTAIL_SEL` |
| `portail-sync` | Le bureau relève les demandes, publie le catalogue | non | `ADMIN_KEY` |
| `portail-catalogue` | Lecture publique du catalogue | non | — |
| `portail-vendeur` | Vendeurs partenaires : relève, QR, live, anti-fraude | non | `ADMIN_KEY`, `PORTAIL_SEL` |
| `mission-sync` | Le bureau publie les missions aux livreurs | non | `ADMIN_KEY` |
| `mission-action` | Le livreur agit (accepte, livre, preuve) | **oui** | `ADMIN_KEY` |
| `livraison-signer` | Signature du client sur son téléphone (QR) | non | `ADMIN_KEY`, `PORTAIL_SEL` |
| `push-abonner` | Abonnement aux notifications du livreur | **oui** | — |
| `push-envoyer` | Envoi des notifications | non | `ADMIN_KEY`, `VAPID_*` |
| `appel-ticket`, `appel-pont`, `appel-voix` | Appel masqué livreur → client (optionnel) | non | `ADMIN_KEY`, `AT_*`, `VOIX_SECRET` |
| `rapport-connexions` | Rapport quotidien des connexions par e-mail (optionnel) | non | `SYNC_KEY`, `CRON_KEY`, `RESEND_API_KEY` |

## Secrets (jamais dans le dépôt)
Obligatoires : `SYNC_KEY`, `ADMIN_KEY`, `PORTAIL_SEL`. Notifications push : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Optionnels : `CRON_KEY`, `RESEND_API_KEY`, `RAPPORT_DE`, `AT_USERNAME`, `AT_API_KEY`, `AT_NUMERO`, `VOIX_SECRET`, `TEL_INDICATIF` (225). Les secrets propres à ANGEL'S GROUP ne doivent **jamais** être réutilisés.

## Option A — par vous, en ligne de commande
```
node tools/gen-secrets.js logistica          # crée .env.logistica (local, non commité)
sh tools/deploy-supabase.sh hggfwxkmdylrgikokbaw .env.logistica
```
Puis : `SYNC_KEY` à saisir dans *Paramètres → Cloud / Supabase* de chaque poste ; `VAPID_PUBLIC_KEY` dans `passerelle-config.js` (champ `vapid`) puis redéployer le site.

## Option B — par l'assistant (avec votre accord)
Déploiement des 14 fonctions par l'outil Supabase, secrets créés puis `SYNC_KEY` et `ADMIN_KEY` remis une seule fois, hors dépôt.

## Après déploiement
1. Activer *Leaked password protection* (Supabase → Authentication).
2. Planifier les purges (pg_cron) : `select cron.schedule('pg-purge','23 3 * * *','select public.pg_purger()');` et `purge_pd_demandes()`, `purge_pd_photos()`, `purge_pd_scans()`.
3. Activer les sauvegardes quotidiennes et tester une restauration.
4. Vérifier : `https://hggfwxkmdylrgikokbaw.supabase.co/functions/v1/portail-catalogue` répond.
