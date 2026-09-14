#!/usr/bin/env python3
"""Localise a per-step mismatch: replay a gt_trace scenario up to the top of iteration T (no dumps), then break at
several points inside that iteration and dump the car structs at each stop (phase_<addr>.bin in outdir).
usage: gt_probe_phases.py <conf> <workdir> <outdir> <scenario> <T> [addr_hex ...]"""
import os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gt_trace
from gt_frame import Game, DS, seg
from gt_race import opened_files
conf, work, out, scen, T = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
addrs = [int(a, 16) for a in sys.argv[6:]] or [0x307E, 0x4FE2, 0x4FFA, 0x5001, 0x3095, 0x3098, 0x309F, 0x30B7]
gt_trace.SCENARIO = scen; script = gt_trace.script; pokes = gt_trace.POKES.get(scen, {})
g = Game(conf, work, out); t0 = time.time()
gt_trace.start_race(g, scen)
g.use_breakpoint(0x3067); g.frames(1)
for t in range(T):
    for o, vals in pokes.get(t, []): g.poke(o, *vals)
    g.poke(0x107D, script(t)); g.frames(1)
print('at top of iteration', T, round(time.time() - t0)); sys.stdout.flush()
for o, vals in pokes.get(T, []): g.poke(o, *vals)
g.poke(0x107D, script(T))
g.dump(DS, 0x1240, 0x600, 'phase_top.bin')
g.d.cmd('BPDEL *')
for a in addrs: g.d.cmd(f'BP {seg(0):04X}:{a:04X}')
g.d.cmd(f'BP {seg(0):04X}:3067')
for k in range(40):
    ok = g.d.run(60)
    pane = re.findall(r'0822:0000([0-9A-F]{4})', g.d.text(g.d.all[-6000:]))
    at = pane[-1] if pane else '????'
    p = g.dump(DS, 0x1240, 0x600, f'phase_{k:02d}_{at}.bin')
    b = open(p, 'rb').read(); w = lambda o: b[o - 0x1240] | (b[o - 0x1240 + 1] << 8)
    print(f'stop {k} at {at}: [125a]={w(0x125a):x} [125e]={w(0x125e):x} [1266]={w(0x1266):x} [126a]={w(0x126a):x} [12c2]={w(0x12c2):x} [12ae]={w(0x12ae):x}'); sys.stdout.flush()
    if at in ('3067', '306C'): break
g.d.close()
