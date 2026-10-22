# Backend Supabase — ANGEL'S & CO TRANSPORT

| Fichier | Rôle |
|---|---|
| `migrations/001_transport_schema.sql` | Tables, contraintes, clés étrangères, index, exclusions de chevauchement (affectations, contrats) |
| `migrations/002_transport_logic.sql` | Droits (RLS), fonctions transactionnelles, immutabilité, périodes, équilibre des écritures, GPS |
| `migrations/003_transport_reference.sql` | Plan comptable indicatif, journaux, paramètres, matrice des droits (générée par `tools/gen-reference.js`) |
| `functions/gps-ingest/` | Edge Function de réception des positions (clé secrète, lots de 500 max) |
| `../tests/recette-supabase.sh` | Recette SQL (49 contrôles) exécutée sur un Postgres de test |

## Mise en service
1. Créer le projet Supabase, puis `supabase db push` (ou coller 001 → 002 → 003 dans l'éditeur SQL).
2. Premier administrateur : créer l'utilisateur dans *Authentication*, puis  
   `insert into profiles(id,nom,role) values ('<uuid>','Administrateur','admin');`
3. Créer les autres comptes de la même façon (rôles : `directeur, flotte, caissier, comptable, controleur, chauffeur` ; pour un chauffeur, renseigner `driver_id`).
4. GPS : `supabase secrets set GPS_INGEST_KEY=<32+ caractères aléatoires>` puis `supabase functions deploy gps-ingest --no-verify-jwt`.
5. Planifier (pg_cron) : `select cron.schedule('gps-purge','0 3 * * *','select public.purge_gps()');` et `select cron.schedule('echeances','5 0 * * *','select public.generate_obligations(current_date)');`
6. Stockage des pièces jointes : bucket privé `pieces`, politiques par propriétaire (`owner = auth.uid()`), PNG/JPEG/WebP/PDF, 300 Ko maximum.
7. Sauvegardes : activer les sauvegardes quotidiennes (et PITR si le plan le permet) ; **tester une restauration** sur un projet vierge avant la mise en production.

## Principes de sécurité appliqués
- RLS activée sur toutes les tables ; chaque politique s'appuie sur `app.perm(module, action)` (matrice `role_permissions`) ou sur `app.my_driver()` pour le portail chauffeur.
- Aucune écriture directe sur les tables financières : tout passe par des fonctions `SECURITY DEFINER` (`register_payment`, `confirm_payment`, `cancel_receipt`, `post_manual_entry`, `validate_expense`, `close_cash`…), atomiques et idempotentes.
- Interdictions en base : suppression des paiements, imputations, reçus, caisses, écritures, lignes d'écriture, journal d'audit ; modification d'une écriture validée ; modification du montant d'un paiement.
- Écriture refusée dans une période clôturée ; écriture déséquilibrée refusée à la validation de la transaction.
- `ingest_gps_position` n'est exécutable que par `service_role` (Edge Function) ; positions invalides placées en quarantaine.
- La clé `service_role` et `GPS_INGEST_KEY` ne doivent **jamais** figurer dans le navigateur.

## Limites actuelles
- L'interface `transport.html` fonctionne encore sur le stockage local du navigateur (mêmes règles métier, mêmes tests). Son raccordement à ce backend (Supabase Auth + appels `rpc`) est l'étape suivante.
- Le plan comptable est indicatif : à faire valider par le comptable (SYSCOHADA révisé, fiscalité ivoirienne). Facturation normalisée / FNE, déclarations fiscales, immobilisations et amortissements : hors périmètre tant qu'ils ne sont pas spécifiés.

## Pont téléphonique (appel du client sans révéler son numéro)

| Fichier | Rôle |
|---|---|
| `migrations/004_appel_pont.sql` | Tables `appel_tickets` (numéros côté serveur uniquement, clé du livreur hachée) et `appel_journal` ; RLS sans politique ; purge des numéros 7 jours après expiration |
| `functions/appel-ticket/` | Le bureau enregistre ou ferme l'autorisation d'appel d'une mission (en-tête `x-admin-key`) |
| `functions/appel-pont/` | Le livreur demande l'appel (commande + clé d'appel) : l'opérateur sonne chez le livreur |
| `functions/appel-voix/` | Rappel vocal d'Africa's Talking : quand le livreur décroche, compose le client depuis le numéro de l'entreprise (sans enregistrement) |
| `functions/_shared/pont.js` | Logique pure, testée par `node tests/appel-pont.js` (9 contrôles) |

Mise en service :
1. Compte Africa's Talking (Voice) avec un numéro sortant ; noter `AT_USERNAME`, `AT_API_KEY`, le numéro (`AT_NUMERO`, format +225…).
2. Appliquer `004_appel_pont.sql` ; optionnel : `select cron.schedule('appel-purge','17 3 * * *','select public.appel_purger()');`.
3. Secrets : `supabase secrets set ADMIN_KEY=<32+ caractères aléatoires> VOIX_SECRET=<32+ caractères aléatoires> AT_USERNAME=… AT_API_KEY=… AT_NUMERO=+225…`.
4. Déployer : `supabase functions deploy appel-ticket appel-pont appel-voix --no-verify-jwt` (l'accès est protégé par `ADMIN_KEY`, la clé d'appel hachée du livreur et `VOIX_SECRET`).
5. Dans le tableau de bord Africa's Talking → Voice → *Callback URL* : `https://<projet>.supabase.co/functions/v1/appel-voix?secret=<VOIX_SECRET>` (vérifier en bac à sable que `clientRequestId` est bien renvoyé dans le rappel).
6. Distributions → Paramètres → « Appel du client par la plateforme » : adresse `https://<projet>.supabase.co/functions/v1`, clé d'administration = `ADMIN_KEY`, cocher « Activer ».

Limites à connaître : l'application Distributions fonctionne encore sur le stockage local ; la clé d'administration réside dans les réglages de l'appareil du bureau (à remplacer par une session Supabase Auth lors du passage en mode serveur) ; tant que les données des clients sont présentes sur l'appareil du livreur, le masquage de l'écran n'est pas une barrière technique — il faudra ne plus envoyer les numéros aux appareils livreurs (règles d'accès par rôle côté base).

### État du déploiement (projet `ANGELS-GROUP`, `gfzqxoolorbejxnxrlji`, eu-west-3)
- Migration `004_appel_pont.sql` appliquée (tables `appel_tickets` et `appel_journal`, RLS sans politique : seules les fonctions serveur y accèdent ; la fonction de purge fixe son `search_path`).
- Fonctions déployées sans vérification JWT : `appel-ticket`, `appel-pont`, `appel-voix` (adresse : `https://gfzqxoolorbejxnxrlji.supabase.co/functions/v1`).
- **Secrets à saisir dans le tableau de bord** (Edge Functions → Secrets) : `ADMIN_KEY`, `VOIX_SECRET`, `AT_USERNAME`, `AT_API_KEY`, `AT_NUMERO`. Tant que `ADMIN_KEY` et `VOIX_SECRET` ne sont pas définis, toutes les fonctions refusent les appels.
- Les fonctions déployées sont des copies autonomes (`index.js`, `pont.js`, `serveur.js` dans le même dossier) ; le dépôt garde `_shared/` pour le déploiement par la CLI.

## Passerelle livreur

Migration `migrations/005_passerelle_livreur.sql`, fonctions `mission-sync` (déployée **sans** vérification JWT : protégée par `ADMIN_KEY`) et `mission-action` (déployée **avec** vérification JWT). Secret requis : `ADMIN_KEY` (le même que le pont). Dans Authentication → Providers → Email, désactiver « Confirm email » est inutile (les comptes sont créés confirmés par le serveur) ; relever la longueur minimale du mot de passe à 10.


## Demandes du portail → bureau (envoi direct, sans WhatsApp)

| Fichier | Rôle |
|---|---|
| `migrations/008_portail_demandes.sql` | Table `pd_demandes` (RLS sans politique, aucun droit pour `anon` / `authenticated`), référence unique, message borné à 6 000 caractères, empreinte salée du visiteur, purge à 30 jours |
| `functions/portail-demande/` | **Public** : le portail y envoie le même message que sur WhatsApp (avec son marqueur `[BOUTIQUE:…]`, `[LIVRAISON:…]` ou `[ABONNEMENT:…]`). Contrôle de format et de taille, **20 demandes par heure et par visiteur**, dédoublonnage sur la référence, file limitée à 2 000 demandes |
| `functions/portail-sync/` | Bureau (en-tête `x-admin-key`) : `lister` les demandes en attente, `acquitter` celles qui sont importées |

Mise en service (rien n'est déployé automatiquement) :
1. Appliquer `008_portail_demandes.sql`.
2. `supabase functions deploy portail-demande --no-verify-jwt` (le visiteur n'a pas de compte) et `supabase functions deploy portail-sync` ; le secret `ADMIN_KEY` est celui de la passerelle livreur. Facultatif : `PORTAIL_SEL` (sel de l'empreinte), `PORTAIL_LIMITE_HEURE`, `PORTAIL_FILE_MAX`.
3. Planifier la purge : `select cron.schedule('pd-purge','30 3 * * *','select public.purge_pd_demandes()');`
4. Distributions : *Paramètres → Passerelle livreur* (adresse des fonctions et clé d'administration), puis *Vente en ligne → Réception directe des demandes du portail → Activer*.

Le portail utilise `passerelle-config.js` (adresse publique) : sans fonction déployée, l'envoi direct échoue proprement et WhatsApp reste proposé. Tests : `node tests/portail-demandes.js`.


## Demandes de clients relevées par le vendeur partenaire (clé de relève)

Les demandes envoyées depuis le lien de commande d'un vendeur portent son identifiant. Le bureau remet au vendeur une **clé de relève** (*Vendeurs partenaires → 🔑 Clé de relève*, affichée une seule fois, seule son empreinte est stockée). Avec cette clé, l'appareil du vendeur relève **uniquement ses demandes** toutes les 30 s et les importe dans « Demandes clients ». Une demande destinée à un vendeur qui a une clé n'est plus relevée par le bureau.

| Élément | Rôle |
|---|---|
| `migrations/012_portail_vendeurs.sql` | Colonne `vendeur` sur `pd_demandes`, table `pd_vendeurs` (RLS sans politique, aucun droit pour `anon` / `authenticated`) |
| `functions/portail-sync/` (action `cle_vendeur`) | Le bureau crée ou renouvelle la clé d'un vendeur (clé d'administration) |
| `functions/portail-vendeur/` | **Public** (`--no-verify-jwt`) : le vendeur relève (`lister`) et acquitte (`acquitter`) ses demandes avec identifiant + clé |

Mise en service : appliquer la migration 012, redéployer `portail-sync` et déployer `portail-vendeur` avec `--no-verify-jwt`. **Non déployée automatiquement.** Test : `node tests/portail-vendeur.js` (14 contrôles).

## Catalogue public du portail (mise à jour automatique pour les visiteurs)

| Fichier | Rôle |
|---|---|
| `migrations/009_portail_catalogue.sql` | Table `portail_catalogue` (une ligne : jeton de boutique + photos JPEG), RLS sans politique, aucun droit pour `anon` / `authenticated` |
| `functions/portail-sync/` (action `publier`) | Le bureau publie le catalogue (clé d'administration) : jeton contrôlé, une ou plusieurs photos JPEG par article (5 au plus, 70 Ko chacune), 300 articles au plus, 6 Mo au total ; chaque publication remplace la précédente |
| `functions/portail-catalogue/` | **Public**, GET seulement : le portail lit le catalogue publié (`--no-verify-jwt`, cache 30 s) |

Mise en service : appliquer la migration 009, redéployer `portail-sync` (nouvelle action) et déployer `portail-catalogue` avec `--no-verify-jwt`. Tests : `node tests/portail-demandes.js`.

## Rapport quotidien des connexions au DG (e-mail à 11 h)

Fonction `rapport-connexions` (`verify_jwt: false`, clés propres) : construit le rapport des dernières 24 h à partir des collections « connexions » et « users » de `sync_enreg` et l'envoie par e-mail (Resend).

1. Migration `010_rapport_connexions.sql` (table `rapport_dg`, fonction `rapport_dg_planifier`).
2. Secrets de la fonction : `SYNC_KEY` (la même que la synchronisation), `CRON_KEY` (16 caractères au moins, propre à la planification), `RESEND_API_KEY`, `RAPPORT_DE` (expéditeur vérifié chez Resend, ex. `Angel's Group <rapports@votre-domaine>`).
3. Déployer `rapport-connexions`, activer les extensions `pg_cron` et `pg_net`, puis exécuter une fois : `select public.rapport_dg_planifier('https://<projet>.supabase.co/functions/v1/rapport-connexions', '<CRON_KEY>');` (passage chaque heure pleine ; l'envoi n'a lieu qu'une fois par jour, après l'heure choisie, heure d'Abidjan).
4. Dans Paramètres du hub → Connexions : adresses du DG, heure, **Enregistrer**, puis **E-mail de test**.

## Notifications push du livreur (Web Push / VAPID) et application Android

Migration `011_push.sql` (table `pg_push`, sans accès direct), fonctions `push-abonner` (jeton du livreur vérifié dans la fonction) et `push-envoyer` (`--no-verify-jwt`, protégée par `ADMIN_KEY`).
Secrets : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (clés générées par `node tools/gen-vapid.js` ; la clé publique va aussi dans `passerelle-config.js`). Procédure complète, test et application Android (TWA) : `android/README.md`. Tests : `node tests/push.js`.

## Portail vendeur, preuves de livraison : migrations 013 à 017 et fonctions

| Élément | Rôle |
|---|---|
| `migrations/013_portail_photos.sql` | Table `pd_photos` (captures d'écran du client, JPEG ≤ 150 Ko, RLS sans politique) ; supprimées à l'acquittement, `purge_pd_photos()` à 30 jours |
| `migrations/014_portail_scans.sql` | Table `pd_scans` (une ligne par visiteur, jour et source) ; `purge_pd_scans()` à 90 jours |
| `migrations/015_preuves_livraison.sql` | Tables `pg_colis` (empreintes des jetons d'étiquettes), `pg_preuves` (signature, photo, position, signature du client), `pg_sign_jetons` (liens de signature à usage unique, 15 min) — aucun droit pour `anon` / `authenticated` |
| `migrations/016_portail_live.sql` | Table `pd_lives` (un live par vendeur, 60 produits au plus) ; source `live` pour les visites |
| `migrations/017_portail_lien_signe.sql` | Colonne `pd_vendeurs.lien_rev` (renouvellement du QR signé) |
| `functions/portail-demande/` | **Public** : commandes (avec captures), visites (`scan`), lecture du live (`live`), vérification d'un lien signé (`verif`) |
| `functions/portail-vendeur/` | Vendeur (clé de relève) : `lister`, `photos`, `acquitter`, `stats`, `live_publier`, `lien_signer`, `lien_renouveler` |
| `functions/portail-sync/` | Bureau (`x-admin-key`) : en plus, `photos` d'une demande |
| `functions/mission-action/` | Livreur (JWT) : en plus, scans des colis, signature, photo, GPS, `demande_signature`, `signature_etat` |
| `functions/mission-sync/` | Bureau : en plus, `preuve` (signature, photo, position d'une livraison confirmée) |
| `functions/livraison-signer/` | **Public** (`--no-verify-jwt`) : le client voit sa commande et signe avec le jeton à usage unique |

- **Secret** : la signature des liens utilise `PORTAIL_SEL`, à défaut `ADMIN_KEY` ; sans secret, la signature est « indisponible » (503) et les liens restent non signés.
- **Déploiement** : les fonctions sont déployées « à plat » (fichiers `index` + modules partagés au même niveau, imports `./…`) ; `portail-demande`, `portail-vendeur` et `portail-sync` sont publiées en un seul fichier `index.ts`. **Redéployer après toute modification de `functions/_shared/`**, puis lancer les recettes (`node tests/portail-*.js`, `node tests/livraison-preuve.js`, `node tests/anti-fraude-qr.js`).
- **À planifier** si `pg_cron` est activé : `select public.purge_pd_photos();`, `select public.purge_pd_scans();`.
