-- ============================================================
--  Zeste 🍋 — RETOUR ARRIÈRE de sql/zeste-securite.sql
--  Remet les fonctions push et les droits tels qu'ils étaient en production
--  le 02/11/2026 (y compris les accès anon, donc la faille). À n'utiliser
--  qu'en cas de blocage grave. Aucune donnée n'est touchée. Tout ou rien.
-- ============================================================
begin;

drop function if exists public.zeste_save_sub_mine(jsonb);
drop function if exists public.zeste_sync_reminders_mine(jsonb);
drop function if exists public.zeste_rev_mine();

-- définitions EXACTES de la production, relevées le 02/11/2026 (pg_get_functiondef ;
-- empreintes md5 vérifiées par tests/sync/serveur.test.mjs)
CREATE OR REPLACE FUNCTION public.zeste_save_sub(p_household uuid, p_sub jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'zeste', 'public'
AS $function$
begin
  insert into zeste.push_subs(household_id, endpoint, sub)
  values (p_household, p_sub->>'endpoint', p_sub)
  on conflict (endpoint) do update
    set household_id = excluded.household_id, sub = excluded.sub;
end;
$function$;

CREATE OR REPLACE FUNCTION public.zeste_sync_reminders(p_household uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'zeste', 'public'
AS $function$
declare ids text[];
begin
  ids := coalesce((select array_agg(x->>'todo_id') from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x), array[]::text[]);
  delete from zeste.reminders r where r.household_id = p_household and not (r.todo_id = any(ids));
  insert into zeste.reminders(household_id, todo_id, due_ms, txt, emoji, pushed)
  select p_household, x->>'todo_id', (x->>'due_ms')::bigint, x->>'txt', x->>'emoji', false
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
  on conflict (household_id, todo_id) do update
    set txt = excluded.txt, emoji = excluded.emoji,
        pushed = case when zeste.reminders.due_ms = excluded.due_ms then zeste.reminders.pushed else false end,
        due_ms = excluded.due_ms;
end;
$function$;

-- droits constatés en production le 02/11/2026
do $$
declare f text;
begin
  foreach f in array array['public.zeste_new_space()', 'public.zeste_load(uuid)', 'public.zeste_save(uuid, jsonb)',
    'public.zeste_load_mine()', 'public.zeste_save_mine(jsonb)', 'public.zeste_save_sub(uuid, jsonb)',
    'public.zeste_sync_reminders(uuid, jsonb)'] loop
    if to_regprocedure(f) is not null then execute format('grant execute on function %s to anon, authenticated', f); end if;
  end loop;
end $$;

commit;
