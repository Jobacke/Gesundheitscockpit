#!/bin/sh
# Signiert die drei Kurzbefehle, damit sie sich auf dem iPhone importieren lassen.
# Aufruf im Terminal:  sh ~/Gesundheitscockpit/kurzbefehle/signieren.sh
cd "$(dirname "$0")" || exit 1
for f in *.unsigned.shortcut; do
  name="${f%.unsigned.shortcut}"
  if shortcuts sign --mode anyone --input "$f" --output "$name.shortcut"; then
    echo "✓ $name.shortcut"
  else
    echo "✗ Fehler bei $name"
  fi
done
open .
