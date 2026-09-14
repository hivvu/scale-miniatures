#!/bin/sh
# Copy MicroMac/ into build/dos-work/ (a writable copy for DOSBox-X; the game writes SETTINGS.DAT).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/build/dos-work"
mkdir -p "$ROOT/build/dos-work"
cp -R "$ROOT/MicroMac/." "$ROOT/build/dos-work/"
# copy any DOS tools (UNP etc.) and unpacked EXEs if present
[ -d "$ROOT/re/dos-tools" ] && find "$ROOT/re/dos-tools" -type f \( -iname '*.exe' -o -iname '*.com' \) -exec cp {} "$ROOT/build/dos-work/" \; || true
[ -d "$ROOT/re/unpacked" ] && find "$ROOT/re/unpacked" -type f -iname '*.exe' -exec cp {} "$ROOT/build/dos-work/" \; || true
echo "dos-work ready: $(ls "$ROOT/build/dos-work" | wc -l | tr -d ' ') entries"
