#!/bin/sh
# Déploie les fonctions Edge d'une instance et charge ses secrets. Usage : sh tools/deploy-supabase.sh <project-ref> <fichier .env>
# Prérequis : CLI Supabase connectée (supabase login). Les secrets viennent du fichier local (jamais affichés ici).
set -e
REF="$1"; ENVF="$2"
[ -n "$REF" ] && [ -f "$ENVF" ] || { echo "Usage : sh tools/deploy-supabase.sh <project-ref> <fichier .env>"; exit 1; }
cd "$(dirname "$0")/.."
supabase link --project-ref "$REF"
supabase secrets set --env-file "$ENVF" --project-ref "$REF"
# fonctions publiques (vérification interne par clé) : sans JWT
for f in sync portail-demande portail-sync portail-catalogue portail-vendeur livraison-signer mission-sync appel-ticket appel-pont appel-voix push-envoyer rapport-connexions; do
  supabase functions deploy "$f" --project-ref "$REF" --no-verify-jwt
done
# fonctions appelées par le livreur connecté : JWT vérifié
for f in mission-action push-abonner; do
  supabase functions deploy "$f" --project-ref "$REF"
done
echo "Fonctions déployées. Vérifier : supabase functions list --project-ref $REF"
