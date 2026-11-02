#!/bin/bash
# Refus d'accès sur la VRAIE pile de l'environnement de TEST (~/zeste-test : PostgREST + Postgres 17),
# jamais la production. Deux comptes fictifs : essai@zeste-test.fr et autre@zeste-test.fr.
# Les jetons sont fabriqués ici avec le secret de la base de TEST (jamais affiché).
# Usage (sur le serveur) : bash test-acces-reel.sh
cd ~/zeste-test || exit 1
. ./.env
API=https://zeste-test.srv.proformationplus.fr/rest/v1
ANON=$(cat anon.key)
P="docker exec -i zt-db psql -U supabase_admin -d postgres -At -v ON_ERROR_STOP=1"
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt(){ h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url); p=$(printf '{"sub":"%s","role":"authenticated","aud":"authenticated","iss":"supabase","iat":%s,"exp":%s}' "$1" "$(date +%s)" "$(( $(date +%s) + 600 ))" | b64url); s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url); printf '%s.%s.%s' "$h" "$p" "$s"; }
E=$($P -c "select id from auth.users where email='essai@zeste-test.fr'"); O=$($P -c "select id from auth.users where email='autre@zeste-test.fr'")
TE=$(jwt "$E"); TO=$(jwt "$O")
OK=0; KO=0
appel(){ # $1=jeton (vide = anon) $2=fonction $3=corps JSON → « code|réponse »
  local auth="$ANON"; [ -n "$1" ] && auth="$1"
  curl -s -o /tmp/zt-rep.txt -w '%{http_code}' -X POST "$API/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $auth" -H 'Content-Type: application/json' -d "$3"
  printf '|'; head -c 160 /tmp/zt-rep.txt; }
attendu(){ # $1=libellé $2=résultat $3=motif attendu (regex)
  if printf '%s' "$2" | grep -Eq "$3"; then OK=$((OK+1)); echo "OK   $1"; else KO=$((KO+1)); echo "ÉCHEC $1 → $2"; fi; }

# donnée de E à protéger : un achat d'or et un rappel
LOT=$(appel "$TE" zeste_or_lot_enregistrer '{"p":{"type":"napoleon20","quantite":1,"date_achat":"2025-01-02","prix_total":400}}' | sed 's/^200|//' | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
attendu "E crée un achat d'or" "$LOT" '^[0-9a-f-]{36}$'
attendu "E enregistre ses rappels" "$(appel "$TE" zeste_sync_reminders "{\"p_household\":\"$E\",\"p_items\":[{\"todo_id\":\"t\",\"due_ms\":1,\"txt\":\"secret\"}]}")" '^20[04]\|'

echo "-- sans connexion (clé publique seulement)"
for f in zeste_load_mine zeste_load_mine_v2 zeste_rev_mine zeste_or_lire zeste_or_cours_lire; do
  attendu "anon refusé : $f" "$(appel "" $f '{}')" '^(401|403)\|.*(permission denied|42501)'; done
attendu "anon refusé : rappels d'un compte" "$(appel "" zeste_sync_reminders "{\"p_household\":\"$E\",\"p_items\":[]}")" '^(401|403)\|'
attendu "anon refusé : abonnement push" "$(appel "" zeste_save_sub "{\"p_household\":\"$E\",\"p_sub\":{\"endpoint\":\"https://pirate\"}}")" '^(401|403)\|'
attendu "anon refusé : ancien code foyer" "$(appel "" zeste_load '{"p_id":"00000000-0000-4000-8000-000000000000"}')" '^(401|403)\|'

echo "-- compte O connecté qui vise les données de E"
attendu "O ne peut pas effacer les rappels de E" "$(appel "$TO" zeste_sync_reminders "{\"p_household\":\"$E\",\"p_items\":[]}")" 'Accès refusé'
attendu "O ne peut pas brancher son téléphone sur E" "$(appel "$TO" zeste_save_sub "{\"p_household\":\"$E\",\"p_sub\":{\"endpoint\":\"https://pirate\"}}")" 'Accès refusé'
attendu "O ne voit pas l'or de E" "$(appel "$TO" zeste_or_lire '{}')" '"lots" *: *\[\]'
attendu "O ne lit pas la photo de E" "$(appel "$TO" zeste_or_photo_lire "{\"p_lot\":\"$LOT\"}")" '^200\|null'
attendu "O ne supprime pas l'achat de E" "$(appel "$TO" zeste_or_lot_supprimer "{\"p_id\":\"$LOT\"}")" 'achat introuvable'
attendu "O ne modifie pas l'achat de E" "$(appel "$TO" zeste_or_lot_enregistrer "{\"p\":{\"id\":\"$LOT\",\"type\":\"napoleon20\",\"quantite\":9,\"date_achat\":\"2025-01-02\",\"prix_total\":1}}")" 'achat introuvable'
attendu "O ne vend pas les pièces de E" "$(appel "$TO" zeste_or_vente_enregistrer "{\"p\":{\"lot_id\":\"$LOT\",\"quantite\":1,\"date_vente\":\"2025-02-01\",\"prix_total\":1}}")" 'achat introuvable'
attendu "O ne reçoit que SES listes" "$(appel "$TO" zeste_load_mine_v2 '{}' | grep -c 'Personne A')" '^0$'
attendu "O : ancien code foyer fermé aussi aux connectés" "$(appel "$TO" zeste_load '{"p_id":"00000000-0000-4000-8000-000000000000"}')" '^(401|403)\|'
attendu "O : écriture du cours réservée au serveur" "$(appel "$TO" zeste_or_cours_maj '{"p":{}}')" '^(401|403)\|'

echo "-- accès direct aux tables (sans passer par les fonctions)"
attendu "table zeste.user_data inaccessible" "$(curl -s -w '|%{http_code}' "$API/user_data?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $TO" -H 'Accept-Profile: zeste')" '\|(4[0-9][0-9])$'
attendu "table zeste.or_lots inaccessible" "$(curl -s -w '|%{http_code}' "$API/or_lots?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $TO" -H 'Accept-Profile: zeste')" '\|(4[0-9][0-9])$'

echo "-- vérifications en base après les tentatives"
attendu "rappels de E intacts" "$($P -c "select count(*) from zeste.reminders where household_id='$E'")" '^1$'
attendu "aucun abonnement pirate" "$($P -c "select count(*) from zeste.push_subs where endpoint='https://pirate'")" '^0$'
attendu "achat de E intact" "$($P -c "select quantite from zeste.or_lots where id='$LOT'")" '^1$'

# nettoyage des traces du test
$P -c "delete from zeste.or_lots where id='$LOT'; delete from zeste.reminders where household_id='$E' and todo_id='t';" >/dev/null
echo "== $OK vérifications réussies, $KO échec(s)"
