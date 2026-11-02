-- ============================================================
--  Zeste 🍋 — Fermeture des accès non authentifiés (sécurité)
--
--  ⚠️ PRÉPARÉ, NON APPLIQUÉ. À exécuter après sql/zeste-sync-v2.sql,
--     seulement après le « go » de David (base partagée : verrou de déploiement).
--
--  État constaté en production le 02/11/2026 (lecture seule) :
--   - zeste_save_sub(p_household, …) et zeste_sync_reminders(p_household, …)
--     sont exécutables par anon et ne vérifient PAS l'appelant : avec le seul
--     identifiant d'un compte, n'importe qui pouvait effacer / remplacer ses
--     rappels, ou brancher son propre téléphone pour recevoir le texte de ses
--     rappels en notification ;
--   - zeste_new_space / zeste_load / zeste_save (ancien « code foyer », plus
--     utilisé par l'appli depuis le passage au compte) restent ouverts à anon :
--     le code suffit pour lire et écrire un foyer (2 foyers de juillet en base) ;
--   - la synchro diffuse tout l'état sur un canal temps réel PUBLIC
--     « zeste-user-<uid> » (et applique ce qu'elle y reçoit). La nouvelle appli
--     n'utilise plus ce canal ; côté serveur, sql/zeste-sync-v2.sql empêche les
--     anciennes versions d'enregistrer dès que le compte est passé en v2 — or
--     elles ne diffusent qu'APRÈS un enregistrement réussi : plus aucune donnée
--     ne transite alors sur ce canal, et une donnée injectée dessus ne peut plus
--     être enregistrée.
--
--  Ce script :
--   1. réécrit zeste_save_sub / zeste_sync_reminders : connexion obligatoire et
--      p_household doit être le compte connecté (les appareils encore en
--      ancienne version passent déjà leur propre identifiant : compatibles) ;
--      ajoute zeste_save_sub_mine / zeste_sync_reminders_mine (sans identifiant) ;
--   2. retire l'exécution des fonctions « code foyer » à anon et authenticated
--      (les données de zeste.spaces ne sont PAS supprimées) ;
--   3. retire à anon l'exécution de toutes les fonctions zeste_* de public ;
--   4. ajoute zeste_rev_mine() : numéro de version seul, pour que l'appli sache
--      sans tout télécharger s'il faut relire (remplace le canal public).
--  Idempotent, tout ou rien. Retour arrière : sql/zeste-securite-retour.sql.
-- ============================================================
begin;

-- 1. rappels push : réservés au compte connecté, pour lui-même
create or replace function public.zeste_save_sub(p_household uuid, p_sub jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_household is distinct from auth.uid() then raise exception 'Accès refusé'; end if;
  if p_sub is null or coalesce(p_sub->>'endpoint', '') = '' then raise exception 'Abonnement invalide'; end if;
  insert into zeste.push_subs(household_id, endpoint, sub)
  values (auth.uid(), p_sub->>'endpoint', p_sub)
  on conflict (endpoint) do update set household_id = excluded.household_id, sub = excluded.sub;
end;
$$;

create or replace function public.zeste_sync_reminders(p_household uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
declare ids text[]; u uuid := auth.uid();
begin
  if u is null then raise exception 'not authenticated'; end if;
  if p_household is distinct from u then raise exception 'Accès refusé'; end if;
  ids := coalesce((select array_agg(x->>'todo_id') from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x), array[]::text[]);
  delete from zeste.reminders r where r.household_id = u and not (r.todo_id = any(ids));
  insert into zeste.reminders(household_id, todo_id, due_ms, txt, emoji, pushed)
  select u, x->>'todo_id', (x->>'due_ms')::bigint, left(x->>'txt', 300), left(x->>'emoji', 16), false
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
  on conflict (household_id, todo_id) do update
    set txt = excluded.txt, emoji = excluded.emoji,
        pushed = case when zeste.reminders.due_ms = excluded.due_ms then zeste.reminders.pushed else false end,
        due_ms = excluded.due_ms;
end;
$$;

create or replace function public.zeste_save_sub_mine(p_sub jsonb)
returns void language sql security definer set search_path = zeste, public as $$
  select public.zeste_save_sub(auth.uid(), p_sub)
$$;
create or replace function public.zeste_sync_reminders_mine(p_items jsonb)
returns void language sql security definer set search_path = zeste, public as $$
  select public.zeste_sync_reminders(auth.uid(), p_items)
$$;

-- 4. numéro de version seul (nécessite sql/zeste-sync-v2.sql : colonne rev)
create or replace function public.zeste_rev_mine()
returns jsonb language plpgsql stable security definer set search_path = zeste, public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select rev, updated_at into r from zeste.user_data where user_id = auth.uid();
  if not found then return jsonb_build_object('rev', null); end if;
  return jsonb_build_object('rev', r.rev, 'maj', r.updated_at);
end;
$$;

-- même propriétaire que zeste_save_mine (sinon les appels internes sont refusés)
do $$
declare o text := (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.zeste_save_mine(jsonb)'::regprocedure);
begin
  execute format('alter function public.zeste_save_sub(uuid, jsonb) owner to %I', o);
  execute format('alter function public.zeste_sync_reminders(uuid, jsonb) owner to %I', o);
  execute format('alter function public.zeste_save_sub_mine(jsonb) owner to %I', o);
  execute format('alter function public.zeste_sync_reminders_mine(jsonb) owner to %I', o);
  execute format('alter function public.zeste_rev_mine() owner to %I', o);
end $$;

-- 2 + 3. droits : plus rien pour anon ; « code foyer » fermé à tous
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'zeste\_%' loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('zeste_new_space', 'zeste_load', 'zeste_save') loop
    execute format('revoke all on function %s from authenticated', f);
  end loop;
end $$;

grant execute on function public.zeste_save_sub(uuid, jsonb)          to authenticated;
grant execute on function public.zeste_sync_reminders(uuid, jsonb)    to authenticated;
grant execute on function public.zeste_save_sub_mine(jsonb)           to authenticated;
grant execute on function public.zeste_sync_reminders_mine(jsonb)     to authenticated;
grant execute on function public.zeste_rev_mine()                     to authenticated;
grant execute on function public.zeste_load_mine()                    to authenticated;
grant execute on function public.zeste_save_mine(jsonb)               to authenticated;

commit;

-- Vérification après application :
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_name like 'zeste%' and grantee in ('anon','PUBLIC') ;          → aucune ligne
--   select to_regprocedure('public.zeste_rev_mine()') is not null ;               → true
