-- ============================================================
--  Zeste 🍋 — Prêts : contrôle serveur des remboursements reçus
--  Chaque prêt d'argent (data->'debts'[i]) peut porter une liste
--  "repays" = [{id, amount, date:'AAAA-MM-JJ', note, ts}].
--  Le montant initial (amount) n'est jamais modifié : le reste dû
--  est calculé (amount − somme des remboursements).
--
--  Ce script fait refuser par le serveur tout enregistrement où :
--   - un remboursement est nul, négatif, non numérique ou a plus de 2 décimales ;
--   - la date est absente ou invalide ;
--   - deux remboursements portent le même identifiant (doublon) ;
--   - le total remboursé dépasse le montant du prêt ;
--   - un prêt "objet" porte des remboursements.
--  Les données sans remboursement passent sans changement.
--  Idempotent : peut être rejoué sans risque.
-- ============================================================

create or replace function zeste.verif_remboursements(p_data jsonb)
returns void language plpgsql immutable set search_path = zeste, public as $$
declare
  d jsonb; r jsonb; a numeric; init numeric; tot numeric; n int; nd int;
begin
  if p_data is null or jsonb_typeof(p_data->'debts') is distinct from 'array' then return; end if;
  for d in select value from jsonb_array_elements(p_data->'debts') loop
    if jsonb_typeof(d) <> 'object' or coalesce(jsonb_typeof(d->'repays'),'null') = 'null' then continue; end if;
    if jsonb_typeof(d->'repays') <> 'array' then
      raise exception 'Remboursement refusé : liste de remboursements invalide';
    end if;
    n := jsonb_array_length(d->'repays');
    if n = 0 then continue; end if;
    if d->>'kind' is distinct from 'money' then
      raise exception 'Remboursement refusé : seul un prêt d''argent peut avoir des remboursements';
    end if;
    if jsonb_typeof(d->'amount') is distinct from 'number' then
      raise exception 'Remboursement refusé : montant du prêt invalide';
    end if;
    init := round((d->>'amount')::numeric, 2);
    tot := 0;
    for r in select value from jsonb_array_elements(d->'repays') loop
      if jsonb_typeof(r->'amount') is distinct from 'number' then
        raise exception 'Remboursement refusé : montant manquant ou non numérique';
      end if;
      a := (r->>'amount')::numeric;
      if a <= 0 then raise exception 'Remboursement refusé : le montant doit être supérieur à 0'; end if;
      if a <> round(a, 2) then raise exception 'Remboursement refusé : 2 décimales au maximum'; end if;
      if coalesce(r->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Remboursement refusé : date manquante ou invalide';
      end if;
      begin
        perform (r->>'date')::date;
      exception when others then
        raise exception 'Remboursement refusé : date invalide (%)', r->>'date';
      end;
      tot := tot + a;
    end loop;
    select count(distinct value->>'id') into nd from jsonb_array_elements(d->'repays');
    if nd <> n then raise exception 'Remboursement refusé : remboursement en double'; end if;
    if tot > init then
      raise exception 'Remboursement refusé : % remboursés pour un prêt de %', tot, init;
    end if;
  end loop;
end;
$$;
revoke all on function zeste.verif_remboursements(jsonb) from public;
-- même propriétaire que zeste_save_mine (security definer), sinon l'appel
-- interne est refusé (« permission denied ») et TOUTE la synchro est bloquée
do $$ begin
  execute format('alter function zeste.verif_remboursements(jsonb) owner to %I',
    (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.zeste_save_mine(jsonb)'::regprocedure));
end $$;

-- Enregistrement des données de l'utilisateur connecté : même fonction qu'avant
-- (sql/zeste-auth.sql), avec le contrôle des remboursements en premier.
create or replace function public.zeste_save_mine(p_data jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform zeste.verif_remboursements(p_data);
  insert into zeste.user_data(user_id, data, updated_at)
  values (auth.uid(), p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
end;
$$;
