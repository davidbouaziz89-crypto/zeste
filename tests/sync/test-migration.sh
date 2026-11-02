#!/bin/bash
# Banc de la migration zeste-sync-v2 sur la base ISOLÉE zt-db (jamais la production)
cd ~/zeste-test/sql
P="docker exec -i zt-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -At"
q(){ $P -c "$1" 2>&1; }
U=$(q "select id from auth.users where email='essai@zeste-test.fr'")
echo "== 0. état de départ (schéma de prod sans migration)"
q "select count(*) as lignes, (select count(*) from information_schema.columns where table_schema='zeste' and table_name='user_data' and column_name in ('rev','v2_only')) as col_v2, to_regprocedure('public.zeste_save_mine_v2(jsonb,bigint)') is not null as v2 from zeste.user_data"
H0=$(q "select md5(data::text) from zeste.user_data where user_id='$U'")
echo "== 1. répétition BEGIN/ROLLBACK (le script contient son propre commit : on le neutralise)"
( echo "begin;"; sed 's/^begin;$//; s/^commit;$//' zeste-sync-v2.sql; echo "select 'dans la transaction : v2=' || (to_regprocedure('public.zeste_save_mine_v2(jsonb,bigint)') is not null);"; echo "rollback;" ) | $P 2>&1 | grep -v "^$" | tail -2
q "select 'après rollback : v2=' || (to_regprocedure('public.zeste_save_mine_v2(jsonb,bigint)') is not null) || ' colonnes=' || (select count(*) from information_schema.columns where table_schema='zeste' and table_name='user_data' and column_name in ('rev','v2_only'))"
echo "== 1b. erreur au milieu → rien d'appliqué (script modifié pour échouer après la 1re fonction)"
sed 's/^-- ancienne fonction : même comportement.*/select 1\/0;/' zeste-sync-v2.sql | $P 2>&1 | grep -i "error" | head -1
q "select 'après échec : v2=' || (to_regprocedure('public.zeste_save_mine_v2(jsonb,bigint)') is not null) || ' colonnes=' || (select count(*) from information_schema.columns where table_schema='zeste' and table_name='user_data' and column_name in ('rev','v2_only'))"
echo "== 2. application réelle (base de test), en supabase_admin comme en production"
$P < zeste-sync-v2.sql 2>&1 | tr '\n' ' '; echo
echo "== 3. rejouée (idempotence)"
$P < zeste-sync-v2.sql 2>&1 | tr '\n' ' '; echo
q "select p.proname||' propriétaire='||pg_get_userbyid(p.proowner)||' definer='||p.prosecdef from pg_proc p where p.proname in ('zeste_load_mine_v2','zeste_save_mine_v2','zeste_save_mine','verif_remboursements') order by 1"
q "select 'droits v2 : '||string_agg(distinct grantee, ',' order by grantee) from information_schema.routine_privileges where routine_name like 'zeste_%_v2'"
q "select 'données intactes : '||(md5(data::text)='$H0')||' rev='||rev||' v2_only='||v2_only from zeste.user_data where user_id='$U'"
echo "== 4. concurrence RÉELLE : deux transactions avec la même version de base"
R=$(q "select rev from zeste.user_data where user_id='$U'")
J="{\"sub\":\"$U\",\"role\":\"authenticated\"}"
sess(){ printf "begin;\nset local role authenticated;\nselect set_config('request.jwt.claims','%s',true);\nselect 'session %s → rev ' || zeste_save_mine_v2((select data from zeste.user_data where user_id='%s') || '{\"marque\":\"%s\"}', %s);\nselect pg_sleep(%s);\ncommit;\n" "$J" "$1" "$U" "$1" "$R" "$2" | docker exec -i zt-db psql -U supabase_admin -d postgres -At 2>&1 | grep -v "^$\|^BEGIN\|^SET\|^COMMIT\|^ROLLBACK\|^{" ; }
sess A 3 > /tmp/zt-a.txt & sleep 1; T0=$(date +%s.%N); sess B 0 > /tmp/zt-b.txt; T1=$(date +%s.%N); wait
echo "A : $(cat /tmp/zt-a.txt | tr '\n' ' ')"; echo "B : $(cat /tmp/zt-b.txt | tr '\n' ' ') (B a attendu $(echo "$T1 - $T0" | bc | cut -c1-4) s le verrou de A)"
q "select 'résultat : marque='||coalesce(data->>'marque','-')||' rev='||rev||' (attendu A, '||($R+1)||')' from zeste.user_data where user_id='$U'"
