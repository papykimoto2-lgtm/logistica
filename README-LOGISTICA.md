# LOGISTICA — ERP (Distribution, Placement de personnel, Assurance, CRM)

Ce dossier est **prêt à déployer** : la racine est le site (fichiers statiques, aucune compilation).

## Déployer sur Vercel
1. Déposer tout ce dossier à la racine d'un nouveau dépôt GitHub.
2. Vercel → *Add New Project* → importer le dépôt → Framework « Other » → laisser Build/Output vides → Deploy.
3. Ouvrir le site : le hub LOGISTICA s'affiche. Connexion : compte **ADMIN** + mot de passe temporaire remis séparément (à changer à la première connexion dans « Distribution »).

## Base Supabase (projet LOGISTICA déjà créé : hggfwxkmdylrgikokbaw)
- `supabase/migrations/` : à appliquer dans l'ordre (004 → 019). Déjà faites : 004, 009, 010.
- `supabase/functions/` : fonctions Edge (sync, portail, suivi livreur…) ; secrets propres à LOGISTICA à créer dans Supabase, **jamais** dans ce dépôt.
- Détails et vérifications avant ouverture : `docs/LOGISTICA.md`.

Le site fonctionne sans Supabase (données dans le navigateur) ; Supabase sert à synchroniser plusieurs postes et au suivi des livreurs. Les dossiers `supabase`, `docs` et `tools` ne sont pas publiés (`.vercelignore`).

Logiciel développé par Sanix Africa Division Technologies.
