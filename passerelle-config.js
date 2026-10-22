/* Configuration publique de la passerelle livreur (projet Supabase LOGISTICA).
   L'adresse et la clé « anon » sont publiques par conception : l'accès aux données est protégé par la connexion et les règles RLS.
   Ne jamais mettre ici la clé « service_role » ni la clé d'administration. */
window.ANGELS_PASSERELLE = {
  url: "https://hggfwxkmdylrgikokbaw.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnZ2Z3eGttZHlscmdpa29rYmF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NTI5MDAsImV4cCI6MjEwODIyODkwMH0.mYsUtZR4Zc3eVFvAPJcHkWo3xxPj0nwT6_Kiekz_DN4",
  /* Notifications push non activées (clé publique VAPID propre à LOGISTICA à générer : node tools/gen-vapid.js). */
  vapid: ""
};
