#!/bin/bash
# Fabrique l'appli Mac « clé GoldAPI » :
#   bash fabriquer-appli.sh TEST                    → ~/Applications/Zeste TEST – clé GoldAPI.app + alias Bureau
#   bash fabriquer-appli.sh PRODUCTION              → ~/Applications/Zeste PRODUCTION – clé GoldAPI.app, SANS alias
#   bash fabriquer-appli.sh PRODUCTION --alias      → idem + alias Bureau (le jour de l'activation seulement)
# L'appli elle-même n'est PAS posée sur le Bureau : il est synchronisé par iCloud, qui abîme les applis.
# Lancé par Claude (jamais par David). Aucune clé dans l'appli : elle est demandée à chaque lancement.
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
RACINE=$(cd "$ICI/../.." && pwd)
ENV=${1:-TEST}
case "$ENV" in TEST|PRODUCTION) ;; *) echo "usage : $0 TEST|PRODUCTION [--alias]"; exit 1 ;; esac
NOM="Zeste $ENV – clé GoldAPI"
SERVEUR=$( [ "$ENV" = PRODUCTION ] && echo serveur-production.sh || echo serveur-test.sh )
APP="$HOME/Applications/$NOM.app"
ALIAS="$HOME/Desktop/$NOM"

mkdir -p "$HOME/Applications"
[ -d "$APP" ] && rm -rf "$APP"          # ancienne version de cette même appli fabriquée ici
osacompile -l JavaScript -o "$APP" "$ICI/appli.js"
cp "$ICI/serveur-commun.sh" "$APP/Contents/Resources/serveur-commun.sh"
cp "$ICI/$SERVEUR" "$APP/Contents/Resources/serveur.sh"
printf '%s\n' "$ENV" > "$APP/Contents/Resources/environnement.txt"

# icône : le citron de Zeste ; en PRODUCTION, barré d'un bandeau rouge « PROD »
T=$(mktemp -d)
mkdir "$T/zeste.iconset"
SRC="$RACINE/icon-512.png"
if [ "$ENV" = PRODUCTION ]; then
  osascript -l JavaScript - "$SRC" "$T/prod.png" <<'JXA' >/dev/null && SRC="$T/prod.png"
ObjC.import('AppKit');
function run(argv) {
  var img = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, 512, 512, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, 512, 512), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
  $.NSColor.colorWithSRGBRedGreenBlueAlpha(0.82, 0.08, 0.08, 0.96).setFill;
  $.NSBezierPath.fillRect($.NSMakeRect(0, 0, 512, 170));
  var attr = $.NSDictionary.dictionaryWithObjectsForKeys(
    $([$.NSFont.boldSystemFontOfSize(132), $.NSColor.whiteColor]), $(['NSFont', 'NSColor']));
  $('PROD').drawAtPointWithAttributes($.NSMakePoint(78, 10), attr);
  $.NSGraphicsContext.restoreGraphicsState;
  return rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(argv[1], true);
}
JXA
fi
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$T/zeste.iconset/icon_${s}x${s}.png" >/dev/null
  [ $((s * 2)) -le 512 ] && sips -z $((s * 2)) $((s * 2)) "$SRC" --out "$T/zeste.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$T/zeste.iconset" -o "$APP/Contents/Resources/applet.icns"
rm -rf "$T"

PL="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $NOM" "$PL"
ID="fr.zeste.$(echo "$ENV" | tr 'A-Z' 'a-z').cle-goldapi"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $ID" "$PL" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $ID" "$PL"
codesign --force --deep --sign - "$APP" 2>/dev/null   # signature locale refaite après ajout des ressources
touch "$APP"

# alias Finder sur le Bureau (fichier d'alias macOS, pas de lien symbolique) ; en PRODUCTION seulement avec --alias
if [ "$ENV" = PRODUCTION ] && [ "${2:-}" != --alias ]; then echo "appli : $APP (pas d'alias sur le Bureau)"; exit 0; fi
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
