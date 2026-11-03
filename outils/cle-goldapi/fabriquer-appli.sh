#!/bin/bash
# Fabrique l'appli Mac « Zeste TEST – clé GoldAPI » (environnement de TEST uniquement) :
#   ~/Applications/Zeste TEST – clé GoldAPI.app  + un alias sur le Bureau.
# L'appli elle-même n'est PAS posée sur le Bureau : il est synchronisé par iCloud, qui abîme les applis.
# Lancé par Claude (jamais par David). Aucune clé dans l'appli : elle est demandée à chaque lancement.
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
RACINE=$(cd "$ICI/../.." && pwd)
NOM="Zeste TEST – clé GoldAPI"
APP="$HOME/Applications/$NOM.app"
ALIAS="$HOME/Desktop/$NOM"

mkdir -p "$HOME/Applications"
[ -d "$APP" ] && rm -rf "$APP"          # ancienne version de cette même appli fabriquée ici
osacompile -l JavaScript -o "$APP" "$ICI/appli.js"
cp "$ICI/serveur-test.sh" "$APP/Contents/Resources/serveur-test.sh"

# icône : le citron de Zeste
T=$(mktemp -d)
mkdir "$T/zeste.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$RACINE/icon-512.png" --out "$T/zeste.iconset/icon_${s}x${s}.png" >/dev/null
  [ $((s * 2)) -le 512 ] && sips -z $((s * 2)) $((s * 2)) "$RACINE/icon-512.png" --out "$T/zeste.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$T/zeste.iconset" -o "$APP/Contents/Resources/applet.icns"
rm -rf "$T"

PL="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $NOM" "$PL"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string fr.zeste.test.cle-goldapi" "$PL" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier fr.zeste.test.cle-goldapi" "$PL"
codesign --force --deep --sign - "$APP" 2>/dev/null   # signature locale refaite après ajout des ressources
touch "$APP"

# alias Finder sur le Bureau (fichier d'alias macOS, pas de lien symbolique)
rm -f "$ALIAS"
osascript -l JavaScript - "$APP" "$ALIAS" <<'JXA' >/dev/null
ObjC.import('Foundation');
function run(argv) {
  var src = $.NSURL.fileURLWithPath(argv[0]);
  var data = src.bookmarkDataWithOptionsIncludingResourceValuesForKeysRelativeToURLError(
    $.NSURLBookmarkCreationSuitableForBookmarkFile, $(), $(), $());
  return $.NSURL.writeBookmarkDataToURLOptionsError(data, $.NSURL.fileURLWithPath(argv[1]),
    $.NSURLBookmarkCreationSuitableForBookmarkFile, $());
}
JXA
echo "appli : $APP"
echo "alias : $ALIAS"
