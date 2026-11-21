#!/usr/bin/env bash
# Check that the studio's copy of the runtime matches this repository.
#
# The game is the source of truth for runtime code. The studio carries a copy so
# its Play tab behaves exactly like the game, and a change that reaches only one
# of them shows the studio a different game from the one that ships. Every script
# and stylesheet index.html loads is compared, except the two files that are
# deliberately different: js/main.js (game boot vs editor boot) and
# js/systems/menu.js (the game's menu has no editor tools).
#
#   tools/check-studio-sync.sh [studio-dir]     # default: ../studio
#
# Exit 0 when every shared file matches, 1 when anything differs or is missing.
set -euo pipefail
cd "$(dirname "$0")/.."

STUDIO="${1:-../studio}"
if [ ! -d "$STUDIO" ]; then
  echo "No studio checkout at $STUDIO."
  echo "Clone the studio next to this repository, or pass its path."
  exit 2
fi

FILES=$(grep -oE '(src|href)="[^"]+"' index.html \
  | sed -E 's/.*="([^"]+)"/\1/' \
  | grep -E '^(js|css)/' \
  | grep -vE '^(js/main\.js|js/systems/menu\.js)$' \
  | sort -u)

drift=0
count=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  count=$((count + 1))
  if [ ! -f "$STUDIO/$file" ]; then
    echo "missing in studio: $file"
    drift=1
  elif ! cmp -s "$file" "$STUDIO/$file"; then
    echo "differs: $file"
    drift=1
  fi
done <<< "$FILES"

# main.js is deliberately different, so it is not compared above. The studio's
# copy boots the editors; a whole-tree copy from the game silently kills every
# tab, which happened once, so insist its boot is still there.
if ! grep -q "WA\.editor\.init" "$STUDIO/js/main.js" 2>/dev/null; then
  echo "studio/js/main.js has lost its editor boot (WA.editor.init)"
  drift=1
fi

if [ "$drift" -ne 0 ]; then
  echo
  echo "Studio is out of sync — copy the files listed above into $STUDIO/."
  echo "Runtime code is canonical here; never copy studio-only js/editors/ back."
  exit 1
fi

echo "Studio in sync: $count shared scripts and stylesheets match."
