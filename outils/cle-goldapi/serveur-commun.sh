# Zeste 🍋 — partie SERVEUR commune aux applis Mac « clé GoldAPI » (TEST et PRODUCTION).
# L'appli envoie, dans le flux d'entrée de « ssh engco 'IFS= read -r K; export K; bash -s' » :
#   1re ligne = la clé, puis CE fichier, puis serveur-test.sh OU serveur-production.sh.
# La clé n'est jamais en argument de commande (invisible dans la liste des processus), jamais affichée,
# jamais écrite sur un disque ; les sorties sont des lignes NOM=VALEUR qui ne la contiennent jamais.

format_ok(){ printf '%s' "$K" | grep -Eq '^[A-Za-z0-9_-]{16,128}$'; }

# GoldAPI accepte-t-elle la clé ? 1 requête « cours actuel », l'en-tête x-access-token passé par l'entrée
# standard de curl. Affiche VERIF=ok|refusee|quota|injoignable|erreur|reponse-inattendue (+ COURS_G,
# COTE_LE, CHAMP, DEVISE, DETAIL) ; remplit VERIF et MAJ (cache, au format de zeste_or_cours_maj).
# ESSAI_SANS_GOLDAPI=1 : réservé aux bancs d'essai de Claude (fausse clé), aucune requête.
verifier_goldapi(){
  MAJ=""
  if [ "${ESSAI_SANS_GOLDAPI:-}" = 1 ]; then VERIF=essai; echo "VERIF=essai"; return; fi
  local R SORTIE
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
        print("CHAMP=" + champ); print("DEVISE=EUR")
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
}

# Enregistre la clé dans le coffre-fort chiffré (Vault, secret « zeste_goldapi ») de la base dont la
# fonction psql est donnée en $1, sans trace : statistiques de requêtes coupées pour la session, erreurs
# non journalisées, sortie d'erreur jetée. Affiche SECRETS=<n> si c'est fait.
enregistrer_cle(){
  printf '%s\n' \
    "set log_min_error_statement = 'panic';" \
    "set pg_stat_statements.track = 'none';" \
    "select vault.update_secret(id, '$K') from vault.secrets where name = 'zeste_goldapi';" \
    "select vault.create_secret('$K', 'zeste_goldapi', 'Clé GoldAPI — onglet Or de Zeste') where not exists (select 1 from vault.secrets where name = 'zeste_goldapi');" \
    "select 'SECRETS=' || count(*) from vault.secrets where name = 'zeste_goldapi';" \
    | "$1" | grep '^SECRETS='
}

# Relit la clé par le chemin qu'utilise la fonction zeste-or-cours (zeste_or_cle_fournisseur) et la compare
# à celle reçue, dans la base : n'affiche que VERIFIE=oui ou VERIFIE=non, jamais la clé.
verifier_cle_enregistree(){
  printf '%s\n' \
    "set log_min_error_statement = 'panic';" \
    "set pg_stat_statements.track = 'none';" \
    "select 'VERIFIE=' || case when public.zeste_or_cle_fournisseur() = '$K' then 'oui' else 'non' end;" \
    | "$1" | grep '^VERIFIE=' || echo "VERIFIE=non"
}

# Cours obtenu pendant la vérification : mis en cache et compté dans le quota, comme zeste-or-cours.
mettre_en_cache(){
  if [ -n "$MAJ" ]; then
    printf '%s\n' "select public.zeste_or_cours_maj(\$zeste\$$MAJ\$zeste\$::jsonb);" | "$1" >/dev/null \
      && echo "CACHE=ok" || echo "CACHE=echec"
  elif [ "$VERIF" = quota ]; then
    printf '%s\n' "select public.zeste_or_cours_maj('{\"fournisseur\":\"goldapi\",\"nature\":\"actuel\",\"ok\":false,\"detail\":\"GoldAPI HTTP (quota) — vérification de la clé (appli Mac)\"}'::jsonb);" | "$1" >/dev/null
  fi
}
