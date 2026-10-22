-- Synchronisation des modules Placement et Assurance : valeurs acceptées de public.sync_enreg.app.
-- À appliquer sur chaque projet Supabase (instance) qui utilise ces modules.
alter table public.sync_enreg drop constraint if exists sync_enreg_app_check;
alter table public.sync_enreg add constraint sync_enreg_app_check check (app in ('distribution','transport','agro','crm','placement','assurance'));
