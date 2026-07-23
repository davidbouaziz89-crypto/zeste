-- ============================================================
--  Zeste 🍋 — partage de foyer (schéma zeste)
--  Modèle simple : 1 foyer = 1 ligne = tout l'état dans une cellule JSON.
--  Accès UNIQUEMENT via 3 fonctions sécurisées (security definer).
--  La table elle-même est fermée (aucune policy anon) => impossible de
--  lister/aspirer les foyers des autres. Sécurité = connaître le code (uuid).
-- ============================================================

create schema if not exists zeste;

create table if not exists zeste.spaces (
  id         uuid primary key default gen_random_uuid(),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- RLS activé SANS policy pour anon => aucun accès direct à la table.
alter table zeste.spaces enable row level security;

-- ----- Fonctions RPC (exposées à /rest/v1/rpc/...) -----

-- Crée un nouveau foyer, renvoie son code (uuid)
create or replace function public.zeste_new_space()
returns uuid
language plpgsql
security definer
set search_path = zeste, public
as $$
declare nid uuid;
begin
  insert into zeste.spaces(data) values ('{}'::jsonb) returning id into nid;
  return nid;
end;
$$;

-- Charge l'état d'un foyer (null si le code n'existe pas)
create or replace function public.zeste_load(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = zeste, public
as $$
declare d jsonb;
begin
  select data into d from zeste.spaces where id = p_id;
  return d;
end;
$$;

-- Enregistre l'état d'un foyer (upsert)
create or replace function public.zeste_save(p_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = zeste, public
as $$
begin
  update zeste.spaces set data = p_data, updated_at = now() where id = p_id;
  if not found then
    insert into zeste.spaces(id, data) values (p_id, p_data);
  end if;
end;
$$;

-- ----- Permissions : seul anon peut appeler ces 3 fonctions -----
revoke all on function public.zeste_new_space()        from public;
revoke all on function public.zeste_load(uuid)         from public;
revoke all on function public.zeste_save(uuid, jsonb)  from public;

grant execute on function public.zeste_new_space()       to anon;
grant execute on function public.zeste_load(uuid)        to anon;
grant execute on function public.zeste_save(uuid, jsonb) to anon;
