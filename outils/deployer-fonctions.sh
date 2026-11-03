#!/bin/bash
# Zeste 🍋 — installe les fonctions serveur zeste-or-cours et zeste-suggest (copie de fichiers, AUCUN
# redémarrage : le routeur des fonctions crée un « worker » par requête ; un code modifié est pris en
# compte en ≤ 6 min, une nouvelle fonction immédiatement). L'ancienne version est d'abord sauvegardée.
# Lancé par Claude depuis le Mac, à la racine du dépôt, avec l'accord de David :
#   bash outils/deployer-fonctions.sh production zeste-or-cours        (étape « fonction du cours »)
#   bash outils/deployer-fonctions.sh production zeste-suggest         (après la publication de l'appli)
#   bash outils/deployer-fonctions.sh retour production <dossier de sauvegarde>   (remet les versions sauvegardées)
#   bash outils/deployer-fonctions.sh test zeste-or-cours              (environnement de test, pour essai)
set -euo pipefail
cd "$(dirname "$0")/.."
CIBLE=$1; shift
RETOUR=""; [ "$CIBLE" = retour ] && { RETOUR=1; CIBLE=$1; shift; }
case "$CIBLE" in
  production) DOSSIER=/opt/supabase/volumes/functions; SUDO="sudo -n" ;;
  test) DOSSIER='$HOME/zeste-test/functions'; SUDO="" ;;
  *) echo "usage : $0 production|test <fonction…>  |  $0 retour production|test <dossier de sauvegarde>"; exit 1 ;;
esac
if [ -n "$RETOUR" ]; then
  SAUV=$1
  ssh -o BatchMode=yes engco "set -e; cd $DOSSIER; for f in \$(ls $SAUV); do
    if [ -f $SAUV/\$f/index.ts ]; then $SUDO install -D -m 644 $SAUV/\$f/index.ts \$f/index.ts; echo \"remise : \$f (\$(md5sum \$f/index.ts | cut -c1-32))\";
    else $SUDO rm -rf \$f; echo \"retirée : \$f (n'existait pas avant)\"; fi; done"
  exit 0
fi
H=$(date +%Y%m%d-%H%M%S)
for F in "$@"; do
  SRC="supabase/functions/$F/index.ts"
  [ -f "$SRC" ] || { echo "fonction inconnue : $F"; exit 1; }
  ATT=$(md5 -q "$SRC")
  ssh -o BatchMode=yes engco "set -e; D=$DOSSIER; S=\$D/.sauvegardes-zeste/$H
    $SUDO mkdir -p \$S/$F
    if [ -f \$D/$F/index.ts ]; then $SUDO cp -p \$D/$F/index.ts \$S/$F/index.ts; echo \"sauvegarde de l'ancienne $F : \$S\"; else echo \"$F n'existait pas (retour = la retirer) : \$S\"; fi
    cat > /tmp/zeste-$F.ts
    $SUDO install -D -m 644 /tmp/zeste-$F.ts \$D/$F/index.ts; rm -f /tmp/zeste-$F.ts
    OBT=\$(md5sum \$D/$F/index.ts | cut -c1-32)
    [ \"\$OBT\" = $ATT ] && echo \"OK   $F installée, identique au dépôt ($ATT)\" || { echo \"KO   $F : empreinte \$OBT ≠ $ATT\"; exit 1; }" < "$SRC"
done
