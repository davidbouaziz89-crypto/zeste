# Zeste 🍋 — partie SERVEUR de l'appli Mac « Zeste TEST – clé GoldAPI » (outils/cle-goldapi/appli.js).
# Environnement de TEST UNIQUEMENT : conteneur zt-db de ~/zeste-test. La production (/opt/supabase)
# n'est jamais visée par ce fichier.
#
# Lancé par l'appli : ssh engco 'IFS= read -r K; export K; bash -s'
#   1re ligne du flux d'entrée = la clé, puis ce script. La clé n'est donc jamais en argument de
#   commande (invisible dans la liste des processus), jamais affichée, jamais écrite sur un disque.
#   Les seules sorties sont des lignes NOM=VALEUR lues par l'appli ; aucune ne contient la clé.
#
# Étapes :
#   1. format de la clé (lettres, chiffres, - et _) ;
#   2. GoldAPI accepte-t-elle la clé ? 1 requête « cours actuel », l'en-tête x-access-token est passé
#      par l'entrée standard de curl (jamais en argument) ;
#   3. clé refusée par GoldAPI → RIEN n'est enregistré ;
#      sinon → coffre-fort chiffré de la base de TEST (Vault, secret « zeste_goldapi »), et le cours
#      obtenu est mis en cache comme le ferait la fonction zeste-or-cours (appel compté dans le quota).
# ESSAI_SANS_GOLDAPI=1 : réservé aux bancs d'essai de Claude (fausse clé), saute l'étape 2.
principal() {
  printf '%s' "$K" | grep -Eq '^[A-Za-z0-9_-]{16,128}$' || { echo "ETAPE=format-refuse"; return 2; }
  docker inspect -f '{{.State.Running}}' zt-db 2>/dev/null | grep -qx true || { echo "ETAPE=base-test-arretee"; return 4; }
  P() { docker exec -i zt-db psql -U supabase_admin -d postgres -At -q -v ON_ERROR_STOP=1 2>/dev/null; }
  MAJ=""
  if [ "${ESSAI_SANS_GOLDAPI:-}" = 1 ]; then
    VERIF=essai; echo "VERIF=essai"
  else
    R=$(printf 'x-access-token: %s\n' "$K" | curl -s -m 20 -H @- -w '\n%{http_code}' \
          https://www.goldapi.io/api/price/XAU/EUR 2>/dev/null)
    SORTIE=$(printf '%s' "${R%$'\n'*}" | CODE="${R##*$'\n'}" python3 -c '
import json, os, re, sys
from datetime import datetime, timezone
code = os.environ.get("CODE", "000")
try:
    d = json.loads(sys.stdin.read())
except Exception:
    d = None
msg = ""
if isinstance(d, dict):
    msg = str(d.get("error") or d.get("message") or "")
msg = re.sub(r"[^\w .,:;()/-]", "", msg)[:100]
if code == "200" and isinstance(d, dict):
    ppu = d.get("price_per_unit") if isinstance(d.get("price_per_unit"), dict) else {}
    g, champ = ppu.get("gram"), "price_per_unit.gram"
    if not g and d.get("price"):
        g, champ = float(d["price"]) / 31.1034768, "price/31.1034768"
    ts = d.get("timestamp")
    if d.get("currency") == "EUR" and g and float(g) > 0 and ts:
        g, ts = float(g), int(ts)
        print("VERIF=ok"); print("COURS_G=%.4f" % g); print("COTE_LE=%d" % ts)
        print("CHAMP=" + champ); print("DEVISE=EUR"); print("METAL=" + str(d.get("metal", "")))
        print("MAJ=" + json.dumps({"fournisseur": "goldapi", "nature": "actuel", "ok": True,
              "detail": "vérification de la clé (appli Mac)",
              "actuel": {"eur_g": round(g, 4), "source": "GoldAPI.io — cours spot XAU/EUR",
                         "cote_le": datetime.fromtimestamp(ts, timezone.utc).isoformat()}}, ensure_ascii=False))
    else:
        print("VERIF=reponse-inattendue"); print("DETAIL=devise " + str(d.get("currency")))
elif code == "429" or re.search("quota|limit", msg, re.I):
    print("VERIF=quota"); print("DETAIL=" + msg)
elif code in ("401", "403"):
    print("VERIF=refusee"); print("DETAIL=" + msg)
elif code == "000":
    print("VERIF=injoignable")
else:
    print("VERIF=erreur"); print("DETAIL=HTTP " + code + (" " + msg if msg else ""))
' 2>/dev/null)
    printf '%s\n' "$SORTIE" | grep -v '^MAJ='
    VERIF=$(printf '%s\n' "$SORTIE" | sed -n 's/^VERIF=//p')
    MAJ=$(printf '%s\n' "$SORTIE" | sed -n 's/^MAJ=//p')
    [ -n "$VERIF" ] || { VERIF=erreur; echo "VERIF=erreur"; }
  fi
  # clé refusée par GoldAPI : on n'enregistre rien
  [ "$VERIF" = refusee ] && { echo "STOCKAGE=non"; return 3; }
  printf '%s\n' \
    "set log_min_error_statement = 'panic';" \
    "set pg_stat_statements.track = 'none';" \
    "select vault.update_secret(id, '$K') from vault.secrets where name = 'zeste_goldapi';" \
    "select vault.create_secret('$K', 'zeste_goldapi', 'Clé GoldAPI — onglet Or de Zeste') where not exists (select 1 from vault.secrets where name = 'zeste_goldapi');" \
    "select 'SECRETS=' || count(*) from vault.secrets where name = 'zeste_goldapi';" \
    | P | grep '^SECRETS=' || { echo "STOCKAGE=echec"; return 5; }
  echo "STOCKAGE=ok"
  # cours obtenu pendant la vérification : mis en cache et compté dans le quota, comme zeste-or-cours
  if [ -n "$MAJ" ]; then
    printf '%s\n' "select public.zeste_or_cours_maj(\$zeste\$$MAJ\$zeste\$::jsonb);" | P >/dev/null \
      && echo "CACHE=ok" || echo "CACHE=echec"
  elif [ "$VERIF" = quota ]; then
    printf '%s\n' "select public.zeste_or_cours_maj('{\"fournisseur\":\"goldapi\",\"nature\":\"actuel\",\"ok\":false,\"detail\":\"GoldAPI HTTP (quota) — vérification de la clé (appli Mac)\"}'::jsonb);" | P >/dev/null
  fi
  return 0
}
# tout le script est lu avant d'être exécuté (rien ne peut lire la suite du flux par erreur)
principal < /dev/null; CODE_RETOUR=$?
unset K R SORTIE MAJ
exit $CODE_RETOUR
