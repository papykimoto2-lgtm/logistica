-- Notifications push (Web Push, RFC 8030 / VAPID) pour l'application Livreur : navigateur installé ou application Android (TWA).
-- Le livreur enregistre son abonnement par la fonction push-abonner (jeton vérifié) ; le bureau déclenche l'envoi par push-envoyer (clé d'administration).
-- Aucun accès direct aux données : les abonnements contiennent des clés de chiffrement et ne sont lisibles que par les fonctions (service role).

create table if not exists public.pg_push (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  livreur_ref  text not null references public.pg_livreurs(livreur_ref) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  agent        text,
  cree_le      timestamptz not null default now(),
  derniere_ok  timestamptz,
  echecs       int not null default 0
);
create index if not exists pg_push_livreur on public.pg_push (livreur_ref);

alter table public.pg_push enable row level security;
revoke all on public.pg_push from anon, authenticated;
revoke all on sequence public.pg_push_id_seq from anon, authenticated;
