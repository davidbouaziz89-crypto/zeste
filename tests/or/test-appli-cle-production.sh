#!/bin/bash
# Banc d'essai de l'appli « Zeste PRODUCTION – clé GoldAPI » SANS JAMAIS TOUCHER LA PRODUCTION :
# deux bases jetables sur le serveur (zeste-essai-prod = « production », zeste-essai-test = « test »),
# même image que la vraie base, coupées du réseau, détruites à la fin. Fausse clé uniquement.
# Lance la vraie logique de l'appli (appli.js --essai PRODUCTION … base-isolee), avec les vrais scripts serveur.
# Usage (depuis le Mac, à la racine du dépôt) : bash tests/or/test-appli-cle-production.sh
cd "$(dirname "$0")/../.." || exit 1
IMAGE=supabase/postgres:17.6.1.136
FAUSSE="goldapi-essaiprod$(openssl rand -hex 10)-io"
ok=0; ko=0
verdict(){ if [ "$1" = "$2" ]; then echo "   ✅ $3"; ok=$((ok+1)); else echo "   ❌ $3 (attendu « $2 », obtenu « $1 »)"; ko=$((ko+1)); fi; }
srv(){ ssh -o BatchMode=yes engco "$@"; }
sqlp(){ printf '%s\n' "$1" | srv 'docker exec -i zeste-essai-prod psql -U supabase_admin -d postgres -At -q'; }
sqlt(){ printf '%s\n' "$1" | srv 'docker exec -i zeste-essai-test psql -U supabase_admin -d postgres -At -q'; }
appli(){ printf '%s\n' "$FAUSSE" | osascript -l JavaScript outils/cle-goldapi/appli.js --essai PRODUCTION "$PWD/outils/cle-goldapi" base-isolee "$@" 2>&1; }
champ(){ printf '%s' "$1" | sed -n 's/^serveur : //p' | python3 -c "import json,sys; print(json.load(sys.stdin).get('$2',''))"; }
nettoyer(){ srv 'docker rm -f zeste-essai-prod zeste-essai-test >/dev/null 2>&1; rm -rf /tmp/zeste-essai-sql'; }
trap nettoyer EXIT

echo "== préparation : 2 bases jetables (réseau coupé), migrations du dépôt =="
nettoyer
COPYFILE_DISABLE=1 tar -C sql -cf - . | srv 'mkdir -p /tmp/zeste-essai-sql && tar -C /tmp/zeste-essai-sql -xf -'
srv "for c in zeste-essai-prod zeste-essai-test; do docker run -d --name \$c --network none -e POSTGRES_PASSWORD=\$(openssl rand -hex 16) $IMAGE >/dev/null; done
for i in \$(seq 1 90); do docker exec zeste-essai-prod pg_isready -U postgres -q 2>/dev/null && docker exec zeste-essai-test pg_isready -U postgres -q 2>/dev/null && break; sleep 2; done; sleep 8
applique(){ for f in \"\$@\"; do docker exec -i \$C psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 < /tmp/zeste-essai-sql/\$f >/dev/null 2>/tmp/zeste-essai-sql/err-\$C-\$f || echo \"   (\$C : \$f → \$(head -c 160 /tmp/zeste-essai-sql/err-\$C-\$f))\"; done; }
BASE='zeste-setup.sql zeste-push.sql zeste-auth.sql zeste-remboursements.sql zeste-correctif-securite.sql'
C=zeste-essai-prod applique \$BASE
C=zeste-essai-test applique \$BASE zeste-sync-v2.sql zeste-securite.sql zeste-or.sql"
echo "   coffre « production » : $(sqlp "select count(*) from vault.secrets") secret(s) ; « test » : $(sqlt "select count(*) from vault.secrets") secret(s)"

echo "1) onglet Or pas encore en ligne en « production » : rien n'est envoyé à GoldAPI ni enregistré"
R=$(appli); verdict "$(champ "$R" ETAPE)" "or-pas-en-ligne" "refus avant tout appel ($(champ "$R" ETAPE))"
verdict "$(champ "$R" VERIF)" "" "aucune requête GoldAPI"
srv 'for f in zeste-sync-v2.sql zeste-securite.sql zeste-or.sql; do docker exec -i zeste-essai-prod psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 < /tmp/zeste-essai-sql/$f >/dev/null || echo "   (prod : $f en échec)"; done'

echo "2) clé encore présente dans le coffre de « test » (quota partagé) : refus"
sqlt "select vault.create_secret('cle-de-test-fictive-0123456789', 'zeste_goldapi', 'essai');" >/dev/null
R=$(appli sans-goldapi); verdict "$(champ "$R" ETAPE)" "cle-test-active" "refus tant que le test a une clé"
verdict "$(sqlp "select count(*) from vault.secrets where name='zeste_goldapi'")" "0" "coffre « production » inchangé"

echo "3) clé de test retirée ; fausse clé envoyée à la VRAIE vérification GoldAPI : refusée, rien enregistré"
sqlt "delete from vault.secrets where name='zeste_goldapi';" >/dev/null
R=$(appli); verdict "$(champ "$R" VERIF)/$(champ "$R" STOCKAGE)" "refusee/non" "GoldAPI refuse la fausse clé"
verdict "$(sqlp "select count(*) from vault.secrets where name='zeste_goldapi'")" "0" "coffre « production » toujours vide"

echo "4) enregistrement (vérification GoldAPI sautée) + report du quota consommé par le test (4 requêtes ce mois-ci)"
sqlt "insert into zeste.or_appels_api (fournisseur, nature, ok, detail) select 'goldapi','actuel',true,'requête de test' from generate_series(1,4);" >/dev/null
R=$(appli sans-goldapi)
verdict "$(champ "$R" STOCKAGE)/$(champ "$R" VERIFIE)" "ok/oui" "enregistrée puis relue par le chemin de la fonction (sans l'afficher)"
verdict "$(champ "$R" REPORT_TEST)" "4" "quota du test reporté dans le journal de « production »"
verdict "$(sqlp "select count(*) from zeste.or_appels_api where nature='report' and le >= date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris' and extract(day from now() at time zone 'Europe/Paris') > 1")" "0" "report daté du 1er du mois (ne compte pas dans le plafond du jour)"
FPROD=$(printf '%s' "$FAUSSE" | ssh engco 'IFS= read -r K; printf "%s\n" "set pg_stat_statements.track = none;" "select count(*) from vault.decrypted_secrets where name = \$\$zeste_goldapi\$\$ and decrypted_secret = \$\$$K\$\$;" | docker exec -i zeste-essai-prod psql -U supabase_admin -d postgres -At -q')
verdict "$FPROD" "1" "le coffre contient exactement la clé envoyée"

echo "5) relance (changement de clé) : mise à jour, report non doublé"
R=$(appli sans-goldapi)
verdict "$(champ "$R" STOCKAGE)/$(champ "$R" VERIFIE)/$(champ "$R" REPORT_TEST)" "ok/oui/0" "mise à jour sans doublon"
verdict "$(sqlp "select count(*) from vault.secrets where name='zeste_goldapi'")/$(sqlp "select count(*) from zeste.or_appels_api where nature='report'")" "1/4" "un seul secret, report compté une fois"

echo "6) confidentialité (fausse clé)"
FUITE=$(printf '%s' "$FAUSSE" | ssh engco 'IFS= read -r K; c(){ grep -c -F -f <(printf "%s\n" "$K"); }
echo "$(docker logs zeste-essai-prod 2>&1 | c)/$(docker logs zeste-essai-test 2>&1 | c)/$(printf "%s\n" "select query from pg_stat_statements;" | docker exec -i zeste-essai-prod psql -U supabase_admin -d postgres -At -q 2>/dev/null | c)/$(sudo -n journalctl --since "-15 min" 2>/dev/null | c)/$(ps -eo args | c)"')
verdict "$FUITE" "0/0/0/0/0" "clé absente : journaux des 2 bases / statistiques de requêtes / journal système / processus"
verdict "$(cat ~/Library/Logs/zeste-goldapi.log 2>/dev/null | grep -c -F "$FAUSSE")" "0" "clé absente du journal de l'appli sur le Mac"
verdict "$(grep -r -l -F "$FAUSSE" "$HOME/Applications/Zeste PRODUCTION – clé GoldAPI.app" outils sql tests 2>/dev/null | wc -l | tr -d ' ')" "0" "clé absente de l'appli et du dépôt"

echo "— bilan : $ok vérification(s) réussie(s), $ko en échec (bases jetables détruites à la sortie)"
[ "$ko" = 0 ]
