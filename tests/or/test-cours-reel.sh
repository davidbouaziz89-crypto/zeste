#!/bin/bash
# Cours de l'or sur l'environnement de TEST (~/zeste-test, jamais la production) : appel RÉEL de la
# fonction zeste-or-cours avec le compte fictif essai@zeste-test.fr, puis contrôles de fuite de la clé.
# La clé n'est jamais affichée : elle est lue dans le coffre de la base de TEST et comparée en mémoire
# (motif passé par un descripteur de fichier, jamais en argument de commande).
# Usage (sur le serveur) : bash test-cours-reel.sh ['{"forcer":true}']
cd ~/zeste-test || exit 1
. ./.env
API=https://zeste-test.srv.proformationplus.fr
ANON=$(cat anon.key)
P="docker exec -i zt-db psql -U supabase_admin -d postgres -At"
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt(){ h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url); p=$(printf '{"sub":"%s","role":"authenticated","aud":"authenticated","iss":"supabase","iat":%s,"exp":%s}' "$1" "$(date +%s)" "$(( $(date +%s) + 600 ))" | b64url); s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url); printf '%s.%s.%s' "$h" "$p" "$s"; }
E=$($P -c "select id from auth.users where email='essai@zeste-test.fr'")
T=$(jwt "$E")
R=$(curl -s -X POST "$API/functions/v1/zeste-or-cours" -H "apikey: $ANON" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "${1:-{\}}")
printf '%s' "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin); a=d.get('actuel')
print('cours renvoyé :', ('%.4f €/g — %s — coté le %s' % (float(a['eur_g']), a['source'], a['cote_le'])) if a else 'COURS INDISPONIBLE')
print('alertes :', d.get('alertes')); print('quota :', d.get('budget')); print('historique renvoyé :', len(d.get('historique') or []), 'jours')"
$P -c "select 'journal (5 derniers) : '||coalesce(string_agg(to_char(le at time zone 'Europe/Paris','HH24:MI:SS')||' '||nature||' '||case when ok then 'ok' else 'échec' end||coalesce(' ('||detail||')',''), ' | ' order by le),'vide') from (select * from zeste.or_appels_api order by le desc limit 5) x"
K=$($P -c "select coalesce((select decrypted_secret from vault.decrypted_secrets where name='zeste_goldapi' limit 1),'')")
if [ -n "$K" ]; then
  cherche(){ grep -c -F -f <(printf '%s\n' "$K"); }
  echo "clé présente dans le coffre de TEST : oui (non affichée)"
  echo "clé dans la réponse envoyée au navigateur : $(printf '%s' "$R" | cherche)"
  echo "clé dans le journal des fonctions serveur : $(docker logs zt-functions 2>&1 | cherche)"
  echo "clé dans le journal de la base : $(docker logs zt-db 2>&1 | cherche)"
  echo "clé dans les statistiques de requêtes : $($P -c "select count(*) from pg_stat_statements where strpos(query, (select decrypted_secret from vault.decrypted_secrets where name='zeste_goldapi' limit 1)) > 0")"
  echo "clé lisible par un compte connecté : $(curl -s -X POST "$API/rest/v1/rpc/zeste_or_cle_fournisseur" -H "apikey: $ANON" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}' | cherche) (réponse : $(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/zeste_or_cle_fournisseur" -H "apikey: $ANON" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}'))"
  echo "clé lisible sans connexion : $(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/zeste_or_cle_fournisseur" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{}')"
else
  echo "aucune clé dans le coffre de TEST"
fi
unset K
