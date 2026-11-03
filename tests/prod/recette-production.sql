-- Zeste 🍋 — RECETTE SUR LA VRAIE PRODUCTION, dans UNE transaction ANNULÉE à la fin (rien n'est conservé).
-- Chaque appel passe par les mêmes fonctions que l'appli, avec l'identité du compte Zeste (auth.uid()).
-- Les refus attendus sont isolés (ON_ERROR_ROLLBACK) : la transaction continue, puis tout est annulé.
-- N'affiche que des nombres et des oui/non, jamais le contenu des listes.
-- Lancement : psql -X -A -t -v ON_ERROR_STOP=0 < tests/prod/recette-production.sql
\set ON_ERROR_ROLLBACK on
select user_id as uid from zeste.user_data limit 1 \gset
select md5(string_agg(md5(data::text), '' order by user_id)) as empreinte_avant from zeste.user_data \gset
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', :'uid', true) \g /dev/null
set local role authenticated;

-- 1. lecture par la nouvelle appli (synchro v2)
select '1 LECTURE v2 : rev=' || (r->>'rev') || ' ; tâches ' || jsonb_array_length(coalesce(r->'data'->'todos','[]'))
  || ', courses ' || jsonb_array_length(coalesce(r->'data'->'shop','[]')) || ', films ' || jsonb_array_length(coalesce(r->'data'->'films','[]'))
  || ', prêts ' || jsonb_array_length(coalesce(r->'data'->'debts','[]'))
  || ', remboursements ' || (select count(*) from jsonb_array_elements(coalesce(r->'data'->'debts','[]')) e, jsonb_array_elements(coalesce(e->'repays','[]')) x)
from (select public.zeste_load_mine_v2() r) v;
-- 2. cohérence des prêts : aucun prêt d'argent remboursé au-delà de son montant ; chaque devise
select '2 PRÊTS : prêts d''argent ' || count(*) filter (where e->>'kind' = 'money')
  || ' ; remboursés au-delà du montant : ' || count(*) filter (where e->>'kind' = 'money' and (e->>'amount')::numeric
       < coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(coalesce(e->'repays','[]')) x), 0))
  || ' ; devises : ' || coalesce(string_agg(distinct coalesce(e->>'cur','EUR'), '/') filter (where e->>'kind' = 'money'), '—')
from (select public.zeste_load_mine_v2() r) v, jsonb_array_elements(coalesce(v.r->'data'->'debts','[]')) e;

-- 3. nouveau remboursement valide (1 unité) sur le 1er prêt d'argent qui le permet → accepté
with v as (select public.zeste_load_mine_v2() r),
i as (select (ord - 1) idx, e from v, jsonb_array_elements(v.r->'data'->'debts') with ordinality t(e, ord)
      where e->>'kind' = 'money' and jsonb_typeof(e->'amount') = 'number'
        and (e->>'amount')::numeric - coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(coalesce(e->'repays','[]')) x), 0) >= 1
      order by ord limit 1)
select '3 REMBOURSEMENT VALIDE : accepté, version ' || public.zeste_save_mine_v2(
  jsonb_set(v.r->'data', array['debts', i.idx::text, 'repays'], coalesce(i.e->'repays', '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('id', 'essai-recette', 'ts', 1, 'date', current_date::text, 'note', 'essai annulé', 'amount', 1))),
  (v.r->>'rev')::bigint) from v, i;
select '3b relu : remboursements ' || (select count(*) from jsonb_array_elements(coalesce(r->'data'->'debts','[]')) e, jsonb_array_elements(coalesce(e->'repays','[]')) x)
from (select public.zeste_load_mine_v2() r) v;
-- 4. remboursement excessif (montant du prêt + 1000) → doit être REFUSÉ par le serveur
\echo '4 REMBOURSEMENT EXCESSIF (refus attendu) :'
with v as (select public.zeste_load_mine_v2() r),
i as (select (ord - 1) idx, e from v, jsonb_array_elements(v.r->'data'->'debts') with ordinality t(e, ord)
      where e->>'kind' = 'money' and jsonb_typeof(e->'amount') = 'number' order by ord limit 1)
select public.zeste_save_mine_v2(
  jsonb_set(v.r->'data', array['debts', i.idx::text, 'repays'], coalesce(i.e->'repays', '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('id', 'essai-excessif', 'ts', 2, 'date', current_date::text, 'amount', (i.e->>'amount')::numeric + 1000))),
  (v.r->>'rev')::bigint) from v, i;

-- 5. films : ajout, modification du 1er, suppression de l'ajout → enregistrés et relus
with v as (select public.zeste_load_mine_v2() r)
select '5 FILM AJOUTÉ : version ' || public.zeste_save_mine_v2(jsonb_set(v.r->'data', '{films}',
  coalesce(v.r->'data'->'films', '[]'::jsonb) || '[{"id":"essai-recette-film","title":"Film d''essai (annulé)","prov":"netflix","done":false}]'::jsonb), (v.r->>'rev')::bigint) from v;
with v as (select public.zeste_load_mine_v2() r)
select '5b FILM MODIFIÉ : version ' || public.zeste_save_mine_v2(jsonb_set(v.r->'data', '{films,0,note_essai}', '"modifié"'::jsonb), (v.r->>'rev')::bigint) from v;
with v as (select public.zeste_load_mine_v2() r)
select '5c FILM SUPPRIMÉ : version ' || public.zeste_save_mine_v2(jsonb_set(v.r->'data', '{films}',
  coalesce((select jsonb_agg(f) from jsonb_array_elements(v.r->'data'->'films') f where f->>'id' <> 'essai-recette-film'), '[]'::jsonb)), (v.r->>'rev')::bigint) from v;
select '5d relu : films ' || jsonb_array_length(r->'data'->'films') || ' ; ajout présent : ' || (r::text like '%essai-recette-film%')
  || ' ; modification présente : ' || coalesce(r->'data'->'films'->0->>'note_essai', 'non') from (select public.zeste_load_mine_v2() r) v;

-- 6. synchro : les autres appareils voient le nouveau numéro de version
select '6 SYNCHRO : numéro vu par les autres appareils = ' || public.zeste_rev_mine()::text;
-- 7. ancienne version de l'appli → doit être REFUSÉE (plus d'enregistrement, donc plus de diffusion)
\echo '7 ANCIENNE VERSION (refus attendu) :'
select public.zeste_save_mine((select r->'data' from (select public.zeste_load_mine_v2() r) v));

-- 8. onglet Or : achat de 2 Napoléon (1 300 € + 20 € de frais), vente d'1 pièce (700 € − 10 €), vente impossible refusée
select '8 OR ACHAT : ' || (l->>'quantite') || ' pièces, prix ' || (l->>'prix_total') || ', frais ' || (l->>'frais') || ', or fin ' || (l->>'poids_fin_g') || ' g/pièce'
from (select public.zeste_or_lot_enregistrer(jsonb_build_object('id', '00000000-0000-4000-8000-0000000e5541', 'type', 'napoleon20', 'quantite', 2,
  'prix_total', 1300, 'frais', 20, 'date_achat', current_date::text)) l) x;
select '8b OR VENTE : ' || (s->>'quantite') || ' pièce vendue, prix ' || (s->>'prix_total') || ', frais ' || (s->>'frais')
from (select public.zeste_or_vente_enregistrer(jsonb_build_object('lot_id', '00000000-0000-4000-8000-0000000e5541', 'quantite', 1,
  'prix_total', 700, 'frais', 10, 'date_vente', current_date::text)) s) x;
\echo '8c OR VENTE DE 5 PIÈCES SUR 1 RESTANTE (refus attendu) :'
select public.zeste_or_vente_enregistrer(jsonb_build_object('lot_id', '00000000-0000-4000-8000-0000000e5541', 'quantite', 5, 'prix_total', 3000, 'date_vente', current_date::text));
select '8d OR RELU : achats ' || jsonb_array_length(o->'lots') || ', ventes ' || jsonb_array_length(o->'ventes') || ', types ' || jsonb_array_length(o->'types')
from (select public.zeste_or_lire() o) x;

-- 9. un AUTRE compte connecté ne voit ni ne touche rien
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000a07e', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a07e', true) \g /dev/null
select '9 AUTRE COMPTE : listes lues = ' || coalesce(public.zeste_load_mine_v2()->>'data', 'aucune') || ' ; achats d''or vus = ' || jsonb_array_length(public.zeste_or_lire()->'lots');
\echo '9b AUTRE COMPTE → rappels du compte Zeste (refus attendu) :'
select public.zeste_sync_reminders(:'uid'::uuid, '[]'::jsonb);
\echo '9c AUTRE COMPTE → ancien code foyer (refus attendu) :'
select public.zeste_load('00000000-0000-0000-0000-000000000000'::uuid);

rollback;
select 'APRÈS ANNULATION : données identiques = ' || (md5(string_agg(md5(data::text), '' order by user_id)) = :'empreinte_avant')
  || ' ; achats d''or = ' || (select count(*) from zeste.or_lots) from zeste.user_data;
