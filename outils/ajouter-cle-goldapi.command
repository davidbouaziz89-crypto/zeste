#!/bin/bash
# Zeste 🍋 — enregistre la clé GoldAPI sur le serveur SANS qu'elle passe par une conversation.
# Double-clique ce fichier (sur le Mac qui a l'accès « engco »), colle la clé quand c'est demandé :
# elle ne s'affiche pas à l'écran et ne quitte le Mac que chiffrée (SSH), vers le fichier secret
# des fonctions du serveur (/opt/supabase/functions.env, réservé à l'administrateur).
# Une copie du fichier est faite avant. RIEN n'est redémarré : la clé sera activée par Claude
# après ton accord (court redémarrage des fonctions serveur).
clear
echo "🍋 Zeste — enregistrement de la clé GoldAPI"
echo
printf "Colle ta clé GoldAPI puis appuie sur Entrée (elle reste invisible) : "
read -rs CLE; echo
CLE=$(printf '%s' "$CLE" | tr -d '[:space:]')
if ! printf '%s' "$CLE" | grep -Eq '^[A-Za-z0-9_-]{16,128}$'; then
  echo "❌ Ça ne ressemble pas à une clé GoldAPI. Rien n'a été envoyé."
  unset CLE; read -n1 -rsp "Appuie sur une touche pour fermer."; exit 1
fi
if printf '%s' "$CLE" | ssh -o BatchMode=yes -o ConnectTimeout=15 engco '
  set -e; cd /opt/supabase; umask 077
  cp functions.env "functions.env.avant-goldapi-$(date +%Y%m%d-%H%M%S)"
  K=$(cat)
  grep -v "^GOLDAPI_KEY=" functions.env > functions.env.tmp || true
  printf "GOLDAPI_KEY=%s\n" "$K" >> functions.env.tmp
  chmod 600 functions.env.tmp && mv functions.env.tmp functions.env
  grep -c "^GOLDAPI_KEY=." functions.env'; then
  echo "✅ Clé enregistrée sur le serveur (pas encore activée)."
  echo "   Écris simplement à Claude : « clé GoldAPI ajoutée »."
else
  echo "❌ L'envoi a échoué : rien n'a changé. Préviens Claude."
fi
unset CLE
read -n1 -rsp "Appuie sur une touche pour fermer."
