#!/bin/bash
# Zeste 🍋 — BASCULE DU QUOTA GoldAPI : l'environnement de TEST cesse d'utiliser la clé, AVANT son
# activation en production (même clé, 300 requêtes par mois en tout chez GoldAPI).
# Lancé par Claude le jour de la mise en ligne, APRÈS la validation iPhone de David, AVANT que David lance
# « Zeste PRODUCTION – clé GoldAPI ». Ne touche pas la production.
#   ssh engco 'bash -s' < outils/cle-goldapi/bascule-quota.sh               → bascule réelle
#   ssh engco 'ESSAI=1 bash -s' < outils/cle-goldapi/bascule-quota.sh       → à blanc : constate, ne change rien
# Effets (réels) :
#   1. repère ~/zeste-test/GOLDAPI-DESACTIVE : l'appli « Zeste TEST – clé GoldAPI » refuse désormais d'y
#      remettre une clé (serveur-test.sh) ;
#   2. clé retirée du coffre de la base de TEST (la fonction de test ne lit la clé que là : functions.env
#      n'en contient pas, vérifié) ;
#   3. preuve : appel réel de la fonction de test avec un cache vieilli et ⟳ forcé → AUCUNE requête GoldAPI,
#      alerte « clé non configurée » ; l'âge du cache est remis comme avant ;
#   4. affiche le nombre de requêtes consommées ce mois-ci par le test (l'appli de production le reporte).
cd ~/zeste-test || exit 1
. ./.env
API=https://zeste-test.srv.proformationplus.fr
ANON=$(cat anon.key)
P="docker exec -i zt-db psql -U supabase_admin -d postgres -At -q"
q(){ printf '%s\n' "$1" | $P; }
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt(){ h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url); p=$(printf '{"sub":"%s","role":"authenticated","aud":"authenticated","iss":"supabase","iat":%s,"exp":%s}' "$1" "$(date +%s)" "$(( $(date +%s) + 600 ))" | b64url); s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url); printf '%s.%s.%s' "$h" "$p" "$s"; }
reels(){ q "select count(*) from zeste.or_appels_api where fournisseur='goldapi'"; }
MOIS=$(q "select count(*) from zeste.or_appels_api where fournisseur='goldapi' and le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'")
echo "requêtes GoldAPI consommées ce mois-ci par l'environnement de test : $MOIS"
echo "clé GoldAPI dans les réglages des fonctions de test : $(grep -c '^GOLDAPI_KEY=' functions.env) (doit être 0)"
if [ "${ESSAI:-}" = 1 ]; then
  echo "À BLANC : clé dans le coffre de test : $(q "select count(*) from vault.secrets where name='zeste_goldapi'") ; repère : $([ -e GOLDAPI-DESACTIVE ] && echo posé || echo absent) — rien n'a été changé"
  exit 0
fi
touch GOLDAPI-DESACTIVE
q "delete from vault.secrets where name = 'zeste_goldapi';"
echo "clé dans le coffre de test après bascule : $(q "select count(*) from vault.secrets where name='zeste_goldapi'") (doit être 0)"
AVANT=$(q "select releve_le from zeste.or_cours_actuel where id=1")
n=$(reels)
q "update zeste.or_cours_actuel set releve_le = now() - interval '5 hours' where id=1"
T=$(jwt "$(q "select id from auth.users where email='essai@zeste-test.fr'")")
curl -s -m 30 -X POST "$API/functions/v1/zeste-or-cours" -H "apikey: $ANON" -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"forcer":true}' | python3 -c "
import json,sys; d=json.load(sys.stdin); print('réponse de la fonction de test : alertes =', d.get('alertes'))"
[ -n "$AVANT" ] && q "update zeste.or_cours_actuel set releve_le = '$AVANT' where id=1"
echo "requêtes GoldAPI faites par le test pendant la preuve : $(( $(reels) - n )) (doit être 0)"
echo "repère GOLDAPI-DESACTIVE : $([ -e GOLDAPI-DESACTIVE ] && echo posé || echo ABSENT)"
