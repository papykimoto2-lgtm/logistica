# LOGISTICA — mise en service de l'instance

Instance séparée d'ANGEL'S GROUP : **même code, projets Vercel et Supabase propres**. Modules : Distribution (courrier express, e-commerce), Placement de personnel, Assurance (courtage), CRM.

## 1. Vercel (site)
1. Nouveau projet depuis le dépôt `papykimoto2-lgtm/ANGELS-GROUP`, branche de production `main`.
2. *Build & Output Settings* : Framework « Other » · **Build Command** `node tools/instance.js logistica` · **Output Directory** `dist/logistica` · Install Command vide.
3. Domaine au choix (ex. `erp.logistica.ci`). Le fichier `vercel.json` produit conserve les en-têtes de sécurité.
4. Vérifier : `/` (hub LOGISTICA, 3 modules + CRM), `/sw.js` (cache `logistica-vNN`), `/placement.html`, `/assurance.html`.

## 2. Premier accès
- Compte administrateur initial : **ADMIN**. Le mot de passe temporaire est remis **hors du dépôt** (message sécurisé) ; il est stocké haché et le changement est **imposé à la première connexion** dans Distribution. Pour en générer un autre : `node tools/admin-hash.js "<mot de passe>"` puis coller l'empreinte dans `clients/logistica/marque.js`.
- Créer ensuite les comptes du personnel dans *Paramètres → Utilisateurs*. Placement, Assurance et CRM s'ouvrent avec les comptes **administrateur, direction ou commercial** de Distribution.
- Coordonnées de l'entreprise (documents, en-têtes) à saisir dans *Paramètres* (aucun numéro n'est pré-enregistré) — d'après le panneau : 00225 27 20 32 10 08 · 00225 27 23 48 50 41 · 00225 01 03 30 02 00 · courrier@logistica.ci · www.logistica.ci · Cité CIE, Niangon, Yopougon · Rue du commerce, Immeuble EL NASR, Plateau · 29 BP 173 Abidjan 29.

## 3. Supabase (synchronisation entre postes, portail, suivi livreur)
Sans Supabase, chaque poste fonctionne seul (stockage local). Pour synchroniser plusieurs postes :
1. Créer un **projet Supabase dédié à LOGISTICA** (jamais celui d'ANGEL'S GROUP).
2. Appliquer les migrations `supabase/migrations/001` → `019` dans l'ordre (la `019` ajoute `placement` et `assurance` à la synchronisation).
3. Déployer les fonctions Edge (`sync` au minimum ; `portail-*`, `mission-*`, `livraison-signer`… pour le suivi client et les livreurs) — voir `supabase/README.md`.
4. Secrets propres à l'instance (`supabase secrets set …`) : clés de signature, clé d'administration, clé de synchronisation. **Jamais dans le dépôt ni dans le navigateur.**
5. Dans *Paramètres → Cloud / Supabase* : adresse du projet + clé de synchronisation (SYNC_KEY) sur chaque poste.
6. Activer *Leaked password protection* (Auth) et les sauvegardes quotidiennes ; **tester une restauration** avant la mise en production.

## 4. Avant l'ouverture
- Comptabilité : plan SYSCOHADA indicatif ; **faire valider par l'expert-comptable** les comptes utilisés (Placement : 4111 / 7061 / 4431 / 6611 / 422 / 553 / 571 / 5211 ; Assurance : 4712 / 7061 / 4431 / 4111). Aucune retenue sociale n'est calculée pour les journaliers ; aucune taxe d'assurance n'est calculée (elle figure dans la prime de la compagnie).
- Assurance : renseigner le **numéro d'agrément CIMA** (Réglages), la TVA applicable aux commissions (0 par défaut) et les taux de commission par compagnie / branche.
- Placement : TVA des factures (18 % par défaut, modifiable), délai de paiement.
- Données personnelles (loi n° 2013-450) : le CRM gère l'opposition à la prospection ; informer les travailleurs, assurés et clients de l'usage de leurs données.
- Tests : `node tests/instance.js` (build + isolation), `tests/placement.js`, `tests/assurance.js`, `tests/crm-modules.js`.
