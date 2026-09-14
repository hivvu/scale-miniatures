#!/usr/bin/env python3
"""Linear-sweep 16-bit disassembly of a range of the unpacked MICRO_U.EXE image with capstone.
usage: disasm.py <start_hex> <end_hex> [file]"""
import sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_16
s, e = int(sys.argv[1], 16), int(sys.argv[2], 16)
path = sys.argv[3] if len(sys.argv) > 3 else 're/unpacked/MICRO_U.EXE'
d = open(path, 'rb').read()
hdr = (d[8] | (d[9] << 8)) * 16
img = d[hdr:]
md = Cs(CS_ARCH_X86, CS_MODE_16); md.skipdata = True
for i in md.disasm(img[s:e], s):
    print(f"{i.address:04x}: {i.bytes.hex():<12} {i.mnemonic} {i.op_str}")
