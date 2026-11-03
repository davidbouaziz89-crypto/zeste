# Zeste 🍋 — partie SERVEUR de l'appli Mac « Zeste TEST – clé GoldAPI » (environnement de TEST
# uniquement : conteneur zt-db de ~/zeste-test ; la production n'est jamais visée par ce fichier).
# Envoyée après serveur-commun.sh (fonctions format_ok, verifier_goldapi, enregistrer_cle…).
# Étapes : format → environnement de test pas désactivé → GoldAPI accepte la clé (sinon RIEN n'est
# enregistré) → coffre-fort de la base de TEST → relecture par le chemin de la fonction → cours en cache.
principal() {
  format_ok || { echo "ETAPE=format-refuse"; return 2; }
  # bascule vers la production faite : l'environnement de test ne doit plus consommer le quota partagé
  [ -e "$HOME/zeste-test/GOLDAPI-DESACTIVE" ] && { echo "ETAPE=test-desactive"; return 8; }
  docker inspect -f '{{.State.Running}}' zt-db 2>/dev/null | grep -qx true || { echo "ETAPE=base-arretee"; return 4; }
  P() { docker exec -i zt-db psql -U supabase_admin -d postgres -At -q -v ON_ERROR_STOP=1 2>/dev/null; }
  verifier_goldapi
  [ "$VERIF" = refusee ] && { echo "STOCKAGE=non"; return 3; }
  enregistrer_cle P || { echo "STOCKAGE=echec"; return 5; }
  echo "STOCKAGE=ok"
  verifier_cle_enregistree P
  mettre_en_cache P
  return 0
}
# tout le script est lu avant d'être exécuté (rien ne peut lire la suite du flux par erreur)
principal < /dev/null; CODE_RETOUR=$?
unset K MAJ
exit $CODE_RETOUR
