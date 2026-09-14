#!/usr/bin/env python3
"""Print decompiled function(s) or listing ranges from the Ghidra exports.
  re_fn.py <prog> fn <addr> [addr...]      decompiled C of the function starting at 1000:addr
  re_fn.py <prog> asm <start> <end>        listing lines whose 1000:offset is in [start, end)
  re_fn.py <prog> list                     all function addresses with line counts
"""
import re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

def load(prog):
    d = ROOT / "re" / "exports" / prog
    return (d / "decomp.c").read_text(errors="replace"), (d / "listing.asm").read_text(errors="replace")

def functions(dec):
    parts = re.split(r"^// ===== (\S+) @ (\S+)$", dec, flags=re.M)
    out = {}
    for i in range(1, len(parts), 3):
        out[parts[i + 1].lower()] = (parts[i], parts[i + 2])
    return out

def main():
    prog, cmd = sys.argv[1], sys.argv[2]
    dec, asm = load(prog)
    fns = functions(dec)
    if cmd == "list":
        for a, (n, body) in sorted(fns.items()):
            print(f"{a} {n} {body.count(chr(10))} lines")
    elif cmd == "fn":
        for a in sys.argv[3:]:
            key = a.lower() if ":" in a else f"1000:{int(a,16):04x}"
            if key in fns:
                print(f"// ===== {fns[key][0]} @ {key}"); print(fns[key][1])
            else:
                print(f"// no function at {key}")
    elif cmd == "asm":
        s, e = int(sys.argv[3], 16), int(sys.argv[4], 16)
        seg = sys.argv[5] if len(sys.argv) > 5 else "1000"
        for line in asm.splitlines():
            m = re.match(r"^([0-9a-f]{4}):([0-9a-f]{4})\s", line)
            if m and m.group(1) == seg and s <= int(m.group(2), 16) < e:
                print(line.rstrip())
            elif line.startswith(";=====") or line.endswith(":"):
                # print labels/function headers near the range
                mm = re.search(r"1000:([0-9a-f]{4})", line)
                if mm and s <= int(mm.group(1), 16) < e: print(line)

main()
