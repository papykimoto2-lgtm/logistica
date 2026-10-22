-- Synchronisation du CRM central : l'application « crm » devient une valeur acceptée de public.sync_enreg.app (déjà appliqué en production).
alter table public.sync_enreg drop constraint if exists sync_enreg_app_check;
alter table public.sync_enreg add constraint sync_enreg_app_check check (app in ('distribution','transport','agro','crm'));
