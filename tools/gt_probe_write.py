#!/usr/bin/env python3
"""Find who writes a data-segment word during one race-loop iteration: replays a gt_trace scenario up to step T
(no dumps), then arms a memory-write breakpoint and reports CS:IP of the writer(s) during iteration T.
usage: gt_probe_write.py <conf> <workdir> <scenario> <T> <offset_hex>"""
import os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gt_trace
from gt_frame import Game, DS
from gt_race import opened_files
conf, work, scen, T, off = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5], 16)
gt_trace.SCENARIO = scen; script = gt_trace.script; pokes = gt_trace.POKES.get(scen, {})
g = Game(conf, work, work); t0 = time.time()
gt_trace.start_race(g, scen)
g.use_breakpoint(0x3067); g.frames(1)
for t in range(T):
    for o, vals in pokes.get(t, []): g.poke(o, *vals)
    g.poke(0x107D, script(t)); g.frames(1)
print('at top of iteration', T, round(time.time() - t0)); sys.stdout.flush()
for o, vals in pokes.get(T, []): g.poke(o, *vals)
g.poke(0x107D, script(T))
g.d.cmd('BPDEL *'); g.d.cmd(f'BPM {DS:04X}:{off:04X}'); g.d.cmd(f'BP {gt_trace.seg(0) if hasattr(gt_trace, "seg") else 0x0822:04X}:3067')
for k in range(12):
    ok = g.d.run(60)
    txt = g.d.text(g.d.all[-6000:])
    pane = re.findall(r'0822:0000([0-9A-F]{4})', txt)
    print('stop', k, 'ok', ok, 'code pane', pane[-1] if pane else None); sys.stdout.flush()
    if pane and pane[-1] == '3067': break
g.d.close()
