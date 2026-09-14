#!/usr/bin/env python3
"""Generate or verify manifest.json (path, size, sha256) for the MicroMac game files.

Usage:
  python3 tools/manifest.py            # write manifest.json
  python3 tools/manifest.py --verify   # compare MicroMac/ against manifest.json
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "MicroMac"
MANIFEST = ROOT / "manifest.json"


def scan():
    entries = []
    for p in sorted(DATA.rglob("*")):
        if p.is_file():
            rel = p.relative_to(DATA).as_posix()
            entries.append({
                "path": rel,
                "size": p.stat().st_size,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            })
    return entries


def main(argv):
    entries = scan()
    if "--verify" in argv:
        want = {e["path"]: e for e in json.loads(MANIFEST.read_text())["files"]}
        have = {e["path"]: e for e in entries}
        bad = 0
        for path in sorted(set(want) | set(have)):
            if path not in have:
                print(f"MISSING  {path}"); bad += 1
            elif path not in want:
                print(f"EXTRA    {path}"); bad += 1
            elif want[path] != have[path]:
                print(f"CHANGED  {path}"); bad += 1
        print(f"{len(entries)} files, {bad} problems")
        return 1 if bad else 0
    MANIFEST.write_text(json.dumps({
        "game": "Micro Machines (Codemasters, 1994) PC, 1996-12-24 re-release",
        "root": "MicroMac",
        "files": entries,
    }, indent=1) + "\n")
    print(f"wrote {MANIFEST} with {len(entries)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
