#!/bin/bash
# Zeste 🍋 — CONTRÔLE DE LA PRODUCTION, en LECTURE SEULE (transaction en lecture seule imposée).
# Le jour de la mise en ligne : « avant » (rien ne doit avoir bougé depuis le correctif du 02/11) puis
# « apres » (migrations, verrou et fonctions bien en place). Ne modifie rien, n'affiche aucun secret.
# Lancement (depuis le Mac, à la racine du dépôt) :
#   ssh engco 'MODE=avant bash -s' < outils/controle-production.sh
#   ssh engco "MODE=apres DONNEES=<empreinte relevée avant> DEMARRAGE=<heure relevée avant> \
#     F_OR=$(md5 -q supabase/functions/zeste-or-cours/index.ts) F_SUGGEST=$(md5 -q supabase/functions/zeste-suggest/index.ts) bash -s" < outils/controle-production.sh
# Banc d'essai (Claude) : CIBLE=isolee CONTENEUR=<conteneur jetable> — même contrôle sur une copie.
MODE=${MODE:-avant}; CIBLE=${CIBLE:-production}
RO='-c default_transaction_read_only=on -c statement_timeout=15000'
if [ "$CIBLE" = isolee ]; then
  q(){ printf '%s\n' "$1" | docker exec -i -e PGOPTIONS="$RO" "$CONTENEUR" psql -U supabase_admin -d postgres -At -q 2>&1; }
else
  q(){ printf '%s\n' "$1" | (cd /opt/supabase && sudo -n docker compose exec -T -e PGOPTIONS="$RO" db psql -U supabase_admin -d postgres -At -q) 2>&1; }
fi
ok=0; ko=0
v(){ if [ "$1" = "$2" ]; then echo "OK   $3"; ok=$((ok+1)); else echo "KO   $3 — attendu « $2 », trouvé « $1 »"; ko=$((ko+1)); fi; }
info(){ echo "     $1"; }

echo "== Zeste — contrôle $MODE ($CIBLE), lecture seule — $(TZ=Europe/Paris date '+%d/%m/%Y %H:%M:%S') =="
v "$(q "show transaction_read_only")" "on" "session en lecture seule"
v "$(q "select current_setting('server_version_num')::int / 10000")" "17" "Postgres 17"
v "$(q "show log_statement")" "none" "requêtes non journalisées (clé jamais écrite dans les journaux)"
v "$(q "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'zeste%' and has_function_privilege('anon', p.oid, 'execute')")" "0" "aucune fonction Zeste ouverte aux visiteurs anonymes"
DONNEES_ICI=$(q "select md5(string_agg(md5(data::text), '' order by user_id)) from zeste.user_data")
info "empreinte des données de Zeste : $DONNEES_ICI ($(q "select count(*) from zeste.user_data") compte(s))"
info "sessions actives longues (> 1 min) sur la base : $(q "select count(*) from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid() and now() - xact_start > interval '1 minute'")"

if [ "$MODE" = avant ]; then
  # empreintes relevées en production APRÈS le correctif (02/11/2026 20 h 13) — tests/sync/serveur.test.mjs
  ATTENDU='verif_remboursements=27e0c28975c76606aff24c925d9e6aad
zeste_load=3762658e0a099c062a937147e8337255
zeste_load_mine=cf53677b95a3b23ed95fffac834de162
zeste_new_space=1c2622b80da5269855bbfdb32057ff5a
zeste_save=80d3ab076f930fe59963d4e56f956ac5
zeste_save_mine=4dae0c3f6776457ec931093b7dc0ffeb
zeste_save_sub=a9ad1482d1ae67c53db14cd3aeb1d96d
zeste_save_sub_mine=4c35c849413f22a1fdbd60415c5876b4
zeste_sync_reminders=096bb726c0207f7f122027fe78b77ce3
zeste_sync_reminders_mine=ddb40589315b3f38b6af2cb5fc3835d4'
  ICI=$(q "select p.proname || '=' || md5(pg_get_functiondef(p.oid)) from pg_proc p where (p.pronamespace='public'::regnamespace and p.proname like 'zeste%') or p.pronamespace='zeste'::regnamespace order by 1")
  v "$ICI" "$ATTENDU" "fonctions Zeste identiques à la production d'après le correctif (10 empreintes)"
  v "$(q "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='zeste' and table_name='user_data'")" "user_id,data,updated_at" "table des données : colonnes d'origine (migrations pas encore passées)"
  v "$(q "select count(*) from pg_tables where schemaname='zeste' and tablename like 'or\_%'")" "0" "aucune table de l'onglet Or (pas de collision)"
  v "$(q "select count(*) from vault.secrets where name='zeste_goldapi'")" "0" "aucune clé GoldAPI en production"
  if [ "$CIBLE" = production ]; then
    v "$(ls /opt/supabase/volumes/functions/zeste-or-cours 2>/dev/null | wc -l | tr -d ' ')" "0" "fonction zeste-or-cours pas encore installée"
    info "démarrage du conteneur des fonctions (à comparer après) : $(sudo -n docker inspect -f '{{.State.StartedAt}}' supabase-edge-functions 2>/dev/null)"
    info "page publiée : $(curl -s https://davidbouaziz89-crypto.github.io/zeste/ | grep -c "zeste_save_mine_v2") mention de la synchro v2 (0 attendu avant publication)"
  fi
else
  v "$(q "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='zeste' and table_name='user_data'")" "user_id,data,updated_at,rev,v2_only" "colonnes de la synchro v2 ajoutées"
  [ -n "$DONNEES" ] && v "$DONNEES_ICI" "$DONNEES" "données de Zeste identiques à celles d'avant (aucune perte)"
  v "$(q "select count(*) from zeste.user_data where not v2_only")" "0" "verrou : chaque compte refuse les anciennes versions"
  v "$(q "select column_default from information_schema.columns where table_schema='zeste' and table_name='user_data' and column_name='v2_only'")" "true" "verrou : tout nouveau compte aussi"
  v "$(q "select (prosrc like '%version de Zeste périmée%' and prosrc not like '%insert%')::text from pg_proc where oid='public.zeste_save_mine(jsonb)'::regprocedure")" "true" "verrou : l'ancien enregistrement refuse tout (plus aucune diffusion possible)"
  v "$(q "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('zeste_load_mine_v2','zeste_save_mine_v2','zeste_rev_mine','zeste_or_cle_fournisseur','zeste_or_cours_maj','zeste_or_cours_etat')")" "6" "fonctions de la nouvelle version présentes"
  v "$(q "select count(*) from pg_tables where schemaname='zeste' and tablename like 'or\_%' and rowsecurity")" "8" "8 tables de l'onglet Or, sécurité par ligne activée"
  v "$(q "select has_function_privilege('authenticated','public.zeste_or_cle_fournisseur()','execute')::text || '/' || has_function_privilege('anon','public.zeste_or_cle_fournisseur()','execute')::text")" "false/false" "clé GoldAPI illisible par un compte connecté ou anonyme"
  info "clé GoldAPI en production : $(q "select count(*) from vault.secrets where name='zeste_goldapi'") (0 avant l'activation, 1 après)"
  info "journal GoldAPI ce mois-ci : $(q "select count(*) || ' requête(s), dont ' || count(*) filter (where nature='report') || ' reportée(s) du test' from zeste.or_appels_api where le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'")"
  if [ "$CIBLE" = production ]; then
    [ -n "$F_OR" ] && v "$(md5sum /opt/supabase/volumes/functions/zeste-or-cours/index.ts 2>/dev/null | cut -c1-32)" "$F_OR" "fonction zeste-or-cours installée (identique au dépôt)"
    [ -n "$F_SUGGEST" ] && v "$(md5sum /opt/supabase/volumes/functions/zeste-suggest/index.ts 2>/dev/null | cut -c1-32)" "$F_SUGGEST" "fonction zeste-suggest à jour (identique au dépôt)"
    [ -n "$DEMARRAGE" ] && v "$(sudo -n docker inspect -f '{{.State.StartedAt}}' supabase-edge-functions 2>/dev/null)" "$DEMARRAGE" "conteneur des fonctions NON redémarré (autres applis non touchées)"
    v "$(curl -s https://davidbouaziz89-crypto.github.io/zeste/ | grep -c "zeste_save_mine_v2")" "1" "page publiée = nouvelle version"
    ANON=$(grep -E '^ANON_KEY=' /opt/supabase/.env | cut -d= -f2-)
    for f in zeste_load_mine_v2 zeste_save_mine_v2 zeste_or_lire zeste_or_cle_fournisseur zeste_save_mine; do
      v "$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://api.srv.proformationplus.fr/rest/v1/rpc/$f" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{}')" "401" "visiteur anonyme refusé : $f"
    done
    unset ANON
  fi
fi
echo "== $ok contrôle(s) conforme(s), $ko écart(s) =="
[ "$ko" = 0 ]
