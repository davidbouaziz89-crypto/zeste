#!/bin/bash
# Zeste 🍋 — sauvegarde du schéma zeste de la PRODUCTION (lecture seule), à lancer SUR LE SERVEUR.
# Produit dans ~/sauvegardes/zeste-<date>/ :
#   zeste.dump      format personnalisé (restauration : pg_restore), structure + données
#   zeste.sql       mêmes données en INSERT (vérifiable hors serveur, cf. outils/verifier-sauvegarde.mjs)
#   fonctions.sql   définitions exactes de toutes les fonctions zeste* (retour arrière à l'identique)
#   droits.txt      droits d'exécution actuels
#   empreintes.txt  nombre de lignes par table + md5 des données de chaque compte (contrôle après coup)
# Rien n'est modifié en base (transaction en lecture seule).
set -euo pipefail
D=~/sauvegardes/zeste-$(date +%Y%m%d-%H%M%S); mkdir -p "$D"; chmod 700 "$D"; umask 077
cd /opt/supabase
DC="sudo docker compose exec -T db"
$DC pg_dump -U supabase_admin -d postgres -n zeste -Fc > "$D/zeste.dump"
$DC pg_dump -U supabase_admin -d postgres -n zeste --inserts --no-owner --no-privileges > "$D/zeste.sql"
Q(){ sudo docker compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' db psql -U supabase_admin -d postgres -At "$@"; }
Q -c "select pg_get_functiondef(p.oid)||';' from pg_proc p where (p.pronamespace='public'::regnamespace and p.proname like 'zeste%') or p.pronamespace='zeste'::regnamespace order by p.proname" > "$D/fonctions.sql"
Q -F ' ' -c "select p.oid::regprocedure, coalesce(array_to_string(p.proacl,','),'(défaut)') from pg_proc p where (p.pronamespace='public'::regnamespace and p.proname like 'zeste%') or p.pronamespace='zeste'::regnamespace order by 1" > "$D/droits.txt"
Q -F ' ' -c "select 'table', c.relname, (xpath('//n/text()', query_to_xml('select count(*) n from zeste.'||quote_ident(c.relname), false, false, '')))[1]::text from pg_class c where c.relnamespace='zeste'::regnamespace and c.relkind='r' union all select 'compte', user_id::text, md5(data::text) from zeste.user_data order by 1,2" > "$D/empreintes.txt"
$DC pg_restore -l < "$D/zeste.dump" | grep -c "TABLE DATA" | sed 's/^/tables avec données dans le dump : /'
ls -la "$D" | tail -n +2
echo "$D"
