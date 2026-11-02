-- ============================================================
--  Zeste 🍋 — CORRECTIF DE SÉCURITÉ URGENT, AUTONOME
--
--  ⚠️ PRÉPARÉ, NON APPLIQUÉ. Seulement avec l'accord de David, sous le verrou
--     de déploiement de la base partagée.
--
--  Applicable SEUL, sans la synchro v2 ni l'onglet Or, et sans publier l'appli :
--  l'appli actuellement en ligne (main) continue de fonctionner (elle appelle
--  zeste_save_sub / zeste_sync_reminders avec SON propre identifiant, en étant
--  connectée ; elle n'utilise plus les fonctions « code foyer »).
--
--  Failles fermées (constatées en production le 02/11/2026, lecture seule) :
--   - zeste_save_sub(p_household, p_sub) : exécutable SANS connexion, aucun contrôle →
--     n'importe qui connaissant l'identifiant d'un compte pouvait brancher son
--     téléphone pour recevoir le texte de ses rappels ;
--   - zeste_sync_reminders(p_household, p_items) : idem → effacer / remplacer les
--     rappels d'un compte (et lui envoyer des notifications au texte choisi) ;
--   - zeste_load / zeste_save / zeste_new_space (ancien « code foyer ») : lecture et
--     écriture d'un foyer avec son seul code, sans connexion (2 foyers de juillet).
--  Ne règle PAS le canal temps réel public : il faut pour cela que l'appli cesse
--  de l'utiliser (correctif d'appli séparé, ou publication de la version consolidée).
--
--  Identique aux sections 1 à 3 de sql/zeste-securite.sql : appliquer ensuite la
--  version complète est sans effet de bord (rejouable). Données : aucune modifiée.
--  Retour arrière : sql/zeste-securite-retour.sql (remet exactement l'état du 02/11).
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

-- même propriétaire que zeste_save_mine (sinon les appels internes sont refusés)
do $$
declare o text := (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.zeste_save_mine(jsonb)'::regprocedure);
begin
  execute format('alter function public.zeste_save_sub(uuid, jsonb) owner to %I', o);
  execute format('alter function public.zeste_sync_reminders(uuid, jsonb) owner to %I', o);
  execute format('alter function public.zeste_save_sub_mine(jsonb) owner to %I', o);
  execute format('alter function public.zeste_sync_reminders_mine(jsonb) owner to %I', o);
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
grant execute on function public.zeste_load_mine()                    to authenticated;
grant execute on function public.zeste_save_mine(jsonb)               to authenticated;

commit;

-- Vérification après application :
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_name like 'zeste%' and grantee in ('anon','PUBLIC') ;          → aucune ligne
