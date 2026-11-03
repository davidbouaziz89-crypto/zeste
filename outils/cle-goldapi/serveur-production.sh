# Zeste 🍋 — partie SERVEUR de l'appli Mac « Zeste PRODUCTION – clé GoldAPI » : ta VRAIE Zeste
# (pile /opt/supabase). Envoyée après serveur-commun.sh. N'écrit QUE dans le coffre-fort de la base de
# production et dans le journal/cache du cours de l'or (schéma zeste) ; aucun fichier de configuration,
# aucun redémarrage, aucune autre appli touchée.
#
# Garde-fous, dans l'ordre :
#   1. format de la clé ;
#   2. la mise en ligne de l'onglet Or est faite (fonctions zeste_or_* présentes), sinon rien ;
#   3. QUOTA PARTAGÉ (300 requêtes/mois pour la même clé) : refus tant que l'environnement de TEST a
#      encore une clé dans son coffre (Claude la retire d'abord : outils/cle-goldapi/bascule-quota.sh) ;
#   4. GoldAPI doit accepter la clé (1 requête), sinon RIEN n'est enregistré ;
#   5. coffre-fort, puis relecture par le chemin de la fonction zeste-or-cours (comparaison dans la base,
#      clé jamais affichée) ;
#   6. le quota déjà consommé ce mois-ci par l'environnement de test est reporté dans le journal de la
#      production (une seule fois par mois), pour que le plafond de 280 couvre les deux ;
#   7. cours obtenu mis en cache.
# ESSAI_BASE_ISOLEE=1 : réservé aux bancs d'essai de Claude — vise deux conteneurs jetables
# (zeste-essai-prod / zeste-essai-test) au lieu de la production et de l'environnement de test.
principal() {
  format_ok || { echo "ETAPE=format-refuse"; return 2; }
  if [ "${ESSAI_BASE_ISOLEE:-}" = 1 ]; then
    P() { docker exec -i zeste-essai-prod psql -U supabase_admin -d postgres -At -q -v ON_ERROR_STOP=1 2>/dev/null; }
    T() { docker exec -i zeste-essai-test psql -U supabase_admin -d postgres -At -q -v ON_ERROR_STOP=1 2>/dev/null; }
    BASE_TEST=zeste-essai-test
  else
    P() { (cd /opt/supabase && sudo -n docker compose exec -T db psql -U supabase_admin -d postgres -At -q -v ON_ERROR_STOP=1) 2>/dev/null; }
    T() { docker exec -i zt-db psql -U supabase_admin -d postgres -At -q -v ON_ERROR_STOP=1 2>/dev/null; }
    BASE_TEST=zt-db
  fi
  local pret
  pret=$(echo "select to_regprocedure('public.zeste_or_cle_fournisseur()') is not null and to_regprocedure('public.zeste_or_cours_maj(jsonb)') is not null;" | P)
  [ "$pret" = t ] || { [ -z "$pret" ] && echo "ETAPE=base-injoignable" || echo "ETAPE=or-pas-en-ligne"; return 6; }
  # environnement de test : s'il existe, il ne doit plus avoir de clé
  if docker inspect "$BASE_TEST" >/dev/null 2>&1; then
    local cle_test
    cle_test=$(echo "select count(*) from vault.secrets where name = 'zeste_goldapi';" | T)
    [ -n "$cle_test" ] || { echo "ETAPE=test-injoignable"; return 7; }
    [ "$cle_test" = 0 ] || { echo "ETAPE=cle-test-active"; return 7; }
  fi
  verifier_goldapi
  [ "$VERIF" = refusee ] && { echo "STOCKAGE=non"; return 3; }
  enregistrer_cle P || { echo "STOCKAGE=echec"; return 5; }
  echo "STOCKAGE=ok"
  verifier_cle_enregistree P
  # report du quota consommé ce mois-ci par le test (lignes datées du 1er du mois : elles comptent dans le
  # plafond du mois, pas dans celui du jour), une seule fois par mois
  local n_test deja
  n_test=$(echo "select count(*) from zeste.or_appels_api where fournisseur = 'goldapi' and nature <> 'report' and le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';" | T)
  deja=$(echo "select count(*) from zeste.or_appels_api where nature = 'report' and le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';" | P)
  if [ "${deja:-0}" = 0 ] && [ "${n_test:-0}" -gt 0 ] 2>/dev/null; then
    echo "insert into zeste.or_appels_api (le, fournisseur, nature, ok, detail) select date_trunc('month', now() at time zone 'UTC') at time zone 'UTC', 'goldapi', 'report', true, 'quota consommé ce mois-ci par l''environnement de test' from generate_series(1, $n_test);" | P >/dev/null
    echo "REPORT_TEST=$n_test"
  else
    echo "REPORT_TEST=0"
  fi
  mettre_en_cache P
  echo "APPELS_MOIS=$(echo "select count(*) from zeste.or_appels_api where fournisseur = 'goldapi' and le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';" | P)"
  return 0
}
# tout le script est lu avant d'être exécuté (rien ne peut lire la suite du flux par erreur)
principal < /dev/null; CODE_RETOUR=$?
unset K MAJ
exit $CODE_RETOUR
