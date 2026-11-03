#!/bin/bash
# Cache et limites de requêtes du cours de l'or, sur l'environnement de TEST (~/zeste-test, jamais la
# production), avec la VRAIE clé GoldAPI du coffre de test. Coûte 2 vraies requêtes GoldAPI (étapes c, d).
# Les étapes e/f ajoutent des lignes de journal FICTIVES marquées « ESSAI-… », supprimées aussitôt ;
# l'âge du cache est remis à sa vraie valeur après chaque vieillissement artificiel.
# Usage (depuis le Mac) : ssh engco 'bash -s' < tests/or/test-cache-quota-reel.sh
cd ~/zeste-test || exit 1
. ./.env
API=https://zeste-test.srv.proformationplus.fr
ANON=$(cat anon.key)
P="docker exec -i zt-db psql -U supabase_admin -d postgres -At -q"
q(){ printf '%s\n' "$1" | $P; }
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt(){ h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url); p=$(printf '{"sub":"%s","role":"authenticated","aud":"authenticated","iss":"supabase","iat":%s,"exp":%s}' "$1" "$(date +%s)" "$(( $(date +%s) + 900 ))" | b64url); s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url); printf '%s.%s.%s' "$h" "$p" "$s"; }
T=$(jwt "$(q "select id from auth.users where email='essai@zeste-test.fr'")")
appel(){ local corps=${1:-'{}'}; curl -s -m 30 -X POST "$API/functions/v1/zeste-or-cours" -H "apikey: $ANON" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "$corps"; }
resume(){ python3 -c "
import json,sys
d=json.load(sys.stdin); a=d.get('actuel') or {}
print('   → cours', a.get('eur_g','INDISPONIBLE'), '€/g, coté', a.get('cote_le','—'), '| alertes :', d.get('alertes') or 'aucune')"; }
reels(){ q "select count(*) from zeste.or_appels_api where fournisseur='goldapi' and coalesce(detail,'') not like 'ESSAI-%'"; }
releve(){ q "select releve_le from zeste.or_cours_actuel where id=1"; }
vieillir(){ q "update zeste.or_cours_actuel set releve_le = releve_le - interval '$1 hours' where id=1"; }
remettre(){ q "update zeste.or_cours_actuel set releve_le = '$1' where id=1"; }
verdict(){ [ "$1" = "$2" ] && echo "   ✅ $3" || echo "   ❌ $3 (attendu $2, obtenu $1)"; }

echo "a) cours en cache récent (< 3 h), appel normal : aucune requête à GoldAPI attendue"
n=$(reels); appel | resume; verdict $(( $(reels) - n )) 0 "requêtes GoldAPI : $(( $(reels) - n ))"
echo "b) actualisation forcée (⟳) moins d'1 h après le dernier relevé : aucune requête attendue"
n=$(reels); appel '{"forcer":true}' | resume; verdict $(( $(reels) - n )) 0 "requêtes GoldAPI : $(( $(reels) - n ))"
echo "c) cache vieilli de 4 h : 1 vraie requête attendue, cours rafraîchi"
n=$(reels); vieillir 4; appel | resume; verdict $(( $(reels) - n )) 1 "requêtes GoldAPI : $(( $(reels) - n ))"
echo "d) cache vieilli + 3 appareils au même instant : 1 seule requête attendue (verrou)"
n=$(reels); vieillir 4
for i in 1 2 3; do appel > /tmp/zeste-simul-$i.json & done; wait
for i in 1 2 3; do resume < /tmp/zeste-simul-$i.json; rm -f /tmp/zeste-simul-$i.json; done
verdict $(( $(reels) - n )) 1 "requêtes GoldAPI : $(( $(reels) - n ))"
VRAI=$(releve)

echo "e) plafond du jour (9 requêtes) atteint : aucune requête, dernier cours affiché"
J=$(q "select count(*) from zeste.or_appels_api where fournisseur='goldapi' and le >= date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'")
q "insert into zeste.or_appels_api (fournisseur, nature, ok, detail) select 'goldapi','actuel',true,'ESSAI-PLAFOND-JOUR' from generate_series(1, greatest(0, 9 - $J))"
n=$(reels); vieillir 4; appel | resume; verdict $(( $(reels) - n )) 0 "requêtes GoldAPI : $(( $(reels) - n )) (journal du jour porté de $J à 9 par des lignes fictives)"
q "delete from zeste.or_appels_api where detail='ESSAI-PLAFOND-JOUR'"; remettre "$VRAI"

echo "f) quota du mois (280 requêtes) atteint : aucune requête, dernier cours affiché"
M=$(q "select count(*) from zeste.or_appels_api where fournisseur='goldapi' and le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'")
q "insert into zeste.or_appels_api (le, fournisseur, nature, ok, detail) select date_trunc('month', now()) + interval '1 hour', 'goldapi','actuel',true,'ESSAI-BUDGET-MOIS' from generate_series(1, greatest(0, 280 - $M))"
n=$(reels); vieillir 4; appel | resume; verdict $(( $(reels) - n )) 0 "requêtes GoldAPI : $(( $(reels) - n )) (journal du mois porté de $M à 280 par des lignes fictives)"
q "delete from zeste.or_appels_api where detail='ESSAI-BUDGET-MOIS'"; remettre "$VRAI"

echo "— remis en état : lignes fictives restantes = $(q "select count(*) from zeste.or_appels_api where detail like 'ESSAI-%'"), cache relevé le $(q "select to_char(releve_le at time zone 'Europe/Paris','DD/MM HH24:MI:SS') from zeste.or_cours_actuel")"
echo "— requêtes GoldAPI réelles : aujourd'hui $(q "select count(*) from zeste.or_appels_api where fournisseur='goldapi' and coalesce(detail,'') not like 'ESSAI-%' and le >= date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'") / 9, ce mois $(q "select count(*) from zeste.or_appels_api where fournisseur='goldapi' and coalesce(detail,'') not like 'ESSAI-%' and le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'") / 280 (forfait GoldAPI : 300)"
