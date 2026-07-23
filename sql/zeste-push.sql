-- ============================================================
--  Zeste 🍋 — Notifications push (brique 2)
--  push_subs : abonnements push des appareils d'un foyer
--  reminders : rappels à venir (le cron les envoie à l'heure dite)
-- ============================================================

-- Abonnements push (un par appareil)
create table if not exists zeste.push_subs (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  endpoint     text not null unique,
  sub          jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists push_subs_household_idx on zeste.push_subs(household_id);
alter table zeste.push_subs enable row level security; -- fermé (accès via RPC / service role)

-- Rappels à venir, alimentés par l'appli à chaque changement
create table if not exists zeste.reminders (
  household_id uuid not null,
  todo_id      text not null,
  due_ms       bigint not null,
  txt          text,
  emoji        text,
  pushed       boolean not null default false,
  primary key (household_id, todo_id)
);
create index if not exists reminders_due_idx on zeste.reminders(due_ms) where pushed = false;
alter table zeste.reminders enable row level security; -- fermé (accès via RPC / service role)

-- ----- RPC : enregistrer l'abonnement push d'un appareil -----
create or replace function public.zeste_save_sub(p_household uuid, p_sub jsonb)
returns void
language plpgsql security definer set search_path = zeste, public as $$
begin
  insert into zeste.push_subs(household_id, endpoint, sub)
  values (p_household, p_sub->>'endpoint', p_sub)
  on conflict (endpoint) do update
    set household_id = excluded.household_id, sub = excluded.sub;
end;
$$;

-- ----- RPC : synchroniser la liste des rappels à venir d'un foyer -----
-- p_items = [{todo_id, due_ms, txt, emoji}, ...]
create or replace function public.zeste_sync_reminders(p_household uuid, p_items jsonb)
returns void
language plpgsql security definer set search_path = zeste, public as $$
declare ids text[];
begin
  ids := coalesce((select array_agg(x->>'todo_id') from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x), array[]::text[]);
  -- retire les rappels disparus / faits
  delete from zeste.reminders r where r.household_id = p_household and not (r.todo_id = any(ids));
  -- ajoute / met à jour ; ré-arme (pushed=false) si l'heure a changé
  insert into zeste.reminders(household_id, todo_id, due_ms, txt, emoji, pushed)
  select p_household, x->>'todo_id', (x->>'due_ms')::bigint, x->>'txt', x->>'emoji', false
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
  on conflict (household_id, todo_id) do update
    set txt = excluded.txt,
        emoji = excluded.emoji,
        pushed = case when zeste.reminders.due_ms = excluded.due_ms then zeste.reminders.pushed else false end,
        due_ms = excluded.due_ms;
end;
$$;

revoke all on function public.zeste_save_sub(uuid, jsonb)        from public;
revoke all on function public.zeste_sync_reminders(uuid, jsonb)  from public;
grant execute on function public.zeste_save_sub(uuid, jsonb)       to anon;
grant execute on function public.zeste_sync_reminders(uuid, jsonb) to anon;
