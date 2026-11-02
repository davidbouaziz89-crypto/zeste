#!/bin/bash
P="docker exec -i zt-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -At"
q(){ $P -c "$1" 2>&1; }
U=$(q "select id from auth.users where email='essai@zeste-test.fr'")
J="{\"sub\":\"$U\",\"role\":\"authenticated\"}"
R=$(q "select rev from zeste.user_data where user_id='$U'")
sess(){ # $1=marque $2=attente avant commit $3=fonction (v2|v1)
  if [ "$3" = v1 ]; then CALL="zeste_save_mine((:'d')::jsonb || '{\"marque\":\"$1\"}')::text"; else CALL="zeste_save_mine_v2((:'d')::jsonb || '{\"marque\":\"$1\"}', $R)::text"; fi
  printf "select data::text as d from zeste.user_data where user_id='%s' \\gset\nbegin;\nset local role authenticated;\nselect set_config('request.jwt.claims','%s',true) is not null as ok \\gset\nselect 'session %s → ' || coalesce(%s,'enregistré');\nselect pg_sleep(%s) \\gset\ncommit;\n" "$U" "$J" "$1" "$CALL" "$2" | docker exec -i zt-db psql -U supabase_admin -d postgres -At 2>&1 | grep -v "^$\|^BEGIN\|^SET\|^COMMIT\|^ROLLBACK" | sed 's/LINE.*//; s/^ERROR: */refus : /' | tr '\n' ' '; }
echo "version de base commune = $R"
sess A 3 v2 > /tmp/zt-a.txt & sleep 1; T0=$(date +%s.%N); sess B 0 v2 > /tmp/zt-b.txt; T1=$(date +%s.%N); wait
echo "A (v2) : $(cat /tmp/zt-a.txt)"; echo "B (v2) : $(cat /tmp/zt-b.txt)— B a attendu $(echo "$T1 - $T0" | bc | cut -c1-4) s que A termine"
q "select 'serveur : marque='||coalesce(data->>'marque','-')||' rev='||rev||' v2_only='||v2_only from zeste.user_data where user_id='$U'"
echo "-- ancienne fonction (ancienne appli) APRÈS une écriture v2 :"
echo "C (v1) : $(sess C 0 v1)"
q "select 'serveur : marque='||coalesce(data->>'marque','-')||' rev='||rev from zeste.user_data where user_id='$U'"
