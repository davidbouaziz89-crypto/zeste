#!/bin/bash
# Zeste 🍋 — enregistre la clé GoldAPI dans le coffre-fort chiffré de la base (Supabase Vault),
# SANS qu'elle passe par une conversation et SANS redémarrer quoi que ce soit.
#
# Double-clique ce fichier (sur le Mac qui a l'accès « engco »), colle la clé quand c'est demandé.
#  - la saisie est invisible (pas d'écho, pas d'historique : ce n'est pas un terminal interactif) ;
#  - la clé ne touche jamais le disque du Mac, elle part chiffrée par SSH, dans le flux d'entrée
#    (jamais en argument de commande : invisible dans la liste des processus) ;
#  - côté base : requêtes SELECT simples, dont le module de statistiques remplace les valeurs par
#    des marqueurs ($1) ; journalisation des requêtes désactivée (log_statement = none, vérifié
#    le 02/11/2026) ; la clé est stockée chiffrée (vault.secrets), lisible seulement par le
#    service_role via zeste_or_cle_fournisseur ;
#  - aucun fichier de configuration modifié, aucun redémarrage : la fonction zeste-or-cours lit
#    le coffre à chaque actualisation du cours. Les autres applis ne sont pas touchées.
# Changer la clé plus tard : relancer ce fichier (la valeur est remplacée).
clear
echo "🍋 Zeste — enregistrement de la clé GoldAPI — ⚠️ BASE DE PRODUCTION (ta vraie Zeste)"
echo "   À n'utiliser qu'au moment de la publication complète, avec l'accord donné à Claude."
printf "Tape PRODUCTION (en majuscules) pour continuer, ou Entrée pour annuler : "
read -r CONFIRME
[ "$CONFIRME" = "PRODUCTION" ] || { echo "Annulé : rien n'a été envoyé."; read -n1 -rsp "Appuie sur une touche pour fermer."; exit 1; }
echo
printf "Colle ta clé GoldAPI puis appuie sur Entrée (elle reste invisible) : "
read -rs CLE; echo
CLE=$(printf '%s' "$CLE" | tr -d '[:space:]')
if ! printf '%s' "$CLE" | grep -Eq '^[A-Za-z0-9_-]{16,128}$'; then
  echo "❌ Ça ne ressemble pas à une clé GoldAPI. Rien n'a été envoyé."
  unset CLE; read -n1 -rsp "Appuie sur une touche pour fermer."; exit 1
fi
# 1re ligne du flux : la clé ; la suite : le script exécuté sur le serveur (lu par « bash -s »)
if { printf '%s\n' "$CLE"; cat <<'SUR_LE_SERVEUR'
set -e
printf '%s' "$K" | grep -Eq '^[A-Za-z0-9_-]{16,128}$' || { echo "clé refusée par le serveur"; exit 1; }
cd /opt/supabase
printf "%s\n" \
  "set log_min_error_statement = 'panic';" \
  "set pg_stat_statements.track = 'none';" \
  "select vault.update_secret(id, '$K') from vault.secrets where name = 'zeste_goldapi';" \
  "select vault.create_secret('$K', 'zeste_goldapi', 'Clé GoldAPI — onglet Or de Zeste') where not exists (select 1 from vault.secrets where name = 'zeste_goldapi');" \
  "select 'secrets zeste_goldapi : ' || count(*) from vault.secrets where name = 'zeste_goldapi';" \
  | sudo docker compose exec -T db psql -U supabase_admin -d postgres -At -q -v ON_ERROR_STOP=1 2>/dev/null | grep '^secrets' \
  || { unset K; echo "échec de l'enregistrement (détail masqué volontairement)"; exit 1; }
unset K
SUR_LE_SERVEUR
} | ssh -o BatchMode=yes -o ConnectTimeout=15 engco 'IFS= read -r K; export K; bash -s'; then
  echo "✅ Clé enregistrée dans le coffre-fort (aucun redémarrage)."
  echo "   Écris simplement à Claude : « clé GoldAPI ajoutée »."
else
  echo "❌ L'enregistrement a échoué : rien n'a changé. Préviens Claude."
fi
unset CLE
read -n1 -rsp "Appuie sur une touche pour fermer."
