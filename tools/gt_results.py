#!/usr/bin/env python3
"""Ground truth for the end of a race and the screens that follow it (fn 30df hold, fn 13e4 results).

Drives the first Challenge race with the AI at the wheel and one lap to go for every car, runs at full speed
until the race loop takes its exit branch, then dumps VRAM every few ticks through the 100 held frames, the
front-end reload and the results screen.

usage: gt_results.py <conf> <workdir> <outdir> [dumps=50] [every=8]
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt_frame import Game, seg, DS
from gt_trace import start_race

if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]
    dumps = int(sys.argv[4]) if len(sys.argv) > 4 else 50
    every = int(sys.argv[5]) if len(sys.argv) > 5 else 8
    os.makedirs(out, exist_ok=True)
    g = Game(conf, work, out)
    t0 = time.time()
    start_race(g, 'results')                       # not in ROUNDS: plain round 2 track 1 Challenge race
    g.use_breakpoint(0x3067)
    g.frames(2)
    g.poke(0x2658, 6, 0)                           # car 0 input source = AI
    g.poke(0x1083, 0xED, 0x2D)                     # ... with its fn 2d00 handler
    for off in (0x12ED, 0x1451, 0x15B5, 0x1719):   # one lap to go for all four cars
        g.poke(off, 1, 0)
    g.frames(1)
    g.dump(DS, 0, 0x2000, 'race_start_ds.bin')
    print('race running', round(time.time() - t0)); sys.stdout.flush()

    g.d.cmd('BPDEL *')
    g.d.cmd(f'BP {seg(0):04X}:30DF')               # race loop takes its exit branch
    if not g.d.run(900):
        raise RuntimeError('the race never reached its end branch')
    print('race over', round(time.time() - t0)); sys.stdout.flush()
    g.dump(0xA000, 0, 0xFA00, 'e000_vram.bin')
    g.dump(DS, 0, 0x2000, 'e000_ds.bin')

    g.use_breakpoint(0x489C)                       # back to one break per tick
    log = []
    for k in range(dumps):
        g.frames(every)
        name = f'e{(k + 1) * every:03d}'
        g.dump(0xA000, 0, 0xFA00, f'{name}_vram.bin')
        g.dump(DS, 0, 0x2000, f'{name}_ds.bin')
        log.append({'name': name, 'tick': g.tick})
        if k % 5 == 0: print(name, round(time.time() - t0)); sys.stdout.flush()
    json.dump({'dumps': log, 'every': every}, open(os.path.join(out, 'results.json'), 'w'))
    print('done', round(time.time() - t0))
    g.d.close()
