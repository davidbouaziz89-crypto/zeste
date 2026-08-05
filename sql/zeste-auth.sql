-- ============================================================
--  Zeste 🍋 — données par utilisateur connecté (login unique)
--  Chaque utilisateur a UNE ligne (data jsonb) identifiée par auth.uid().
--  Accès uniquement via RPC security definer → sécurisé par le login.
-- ============================================================

create table if not exists zeste.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table zeste.user_data enable row level security;

-- Charge les données de l'utilisateur connecté
create or replace function public.zeste_load_mine()
returns jsonb language plpgsql security definer set search_path = zeste, public as $$
declare d jsonb;
begin
  if auth.uid() is null then return null; end if;
  select data into d from zeste.user_data where user_id = auth.uid();
  return d;
end;
$$;

-- Enregistre les données de l'utilisateur connecté (upsert)
create or replace function public.zeste_save_mine(p_data jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into zeste.user_data(user_id, data, updated_at)
  values (auth.uid(), p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.zeste_load_mine()      from public;
revoke all on function public.zeste_save_mine(jsonb) from public;
grant execute on function public.zeste_load_mine()      to authenticated;
grant execute on function public.zeste_save_mine(jsonb) to authenticated;

-- le push doit aussi être appelable une fois connecté (rôle authenticated)
grant execute on function public.zeste_save_sub(uuid, jsonb)       to authenticated;
grant execute on function public.zeste_sync_reminders(uuid, jsonb) to authenticated;
