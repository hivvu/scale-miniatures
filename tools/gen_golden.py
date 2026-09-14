#!/usr/bin/env python3
"""Write decoded outputs to build/golden/ and their SHA-256 to test/golden/hashes.json (no game bytes committed)."""
import hashlib, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mm import io, lz, pklite

def main():
    golden = io.ROOT / "build" / "golden"; (golden / "lz").mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name in io.list_files():
        up = name.upper()
        if up.endswith(('.PH0',)) or '.PI' in up or '.PR' in up or up.endswith('.VH0'):
            if up.endswith('.PIF'):
                continue
            r = lz.decode(io.read(name))
            (golden / "lz" / (Path(name).name + ".bin")).write_bytes(r.data)
            hashes[f"lz/{Path(name).name}"] = {"sha256": hashlib.sha256(r.data).hexdigest(), "length": r.length, "consumed": r.consumed}
    u = pklite.unpack(io.read('MICRO.EXE'))
    hashes["pklite/MICRO.EXE.image"] = {"sha256": hashlib.sha256(u.image).hexdigest(), "length": len(u.image), "relocs": len(u.relocs)}
    out = io.ROOT / "test" / "golden" / "hashes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(hashes, indent=1, sort_keys=True) + "\n")
    print(f"wrote {out} with {len(hashes)} entries")

if __name__ == "__main__":
    main()
