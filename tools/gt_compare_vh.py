#!/usr/bin/env python3
"""Compare the dumped vehicle frame table (segment 4D78) with tools/mm/sprites.py. usage: gt_compare_vh.py <round> <vh_4d78.bin> [vh_5d78.bin]"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mm import io, lz, sprites
rnd = int(sys.argv[1]); dump = open(sys.argv[2], 'rb').read()
v = sprites.decode_vehicle(lz.decode(io.read(f'GAME1/ROUND{rnd}BR.VH0')).data, rnd)
ours = sprites.frame_table_bytes(v)
n = min(len(ours), len(dump)); fsz = v.size * v.size
bad = [i for i in range(n // fsz) if ours[i*fsz:(i+1)*fsz] != dump[i*fsz:(i+1)*fsz]]
print(f'round {rnd}: {n//fsz} frames compared, mismatching frames: {bad}')
if bad:
    i = bad[0]; a, b = ours[i*fsz:(i+1)*fsz], dump[i*fsz:(i+1)*fsz]
    j = next(k for k in range(fsz) if a[k] != b[k]); print(f'first diff frame {i} byte {j}: ours {a[j]:02x} dump {b[j]:02x}')
if len(sys.argv) > 3:
    d2 = open(sys.argv[3], 'rb').read(); ex = b''.join(v.extra)
    m = min(len(d2), len(ex)); print('extra (5D78) bytes equal:', sum(1 for k in range(m) if d2[k] == ex[k]), '/', m)
