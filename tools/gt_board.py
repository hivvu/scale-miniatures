#!/usr/bin/env python3
"""Ground truth for the RESULTS!! board (fn 13e4), which only appears from the second Challenge race on.

Race 0 is cut short and its finishing order is forced so the player qualifies; race 1 is cut short the same
way and the screens that follow it are dumped every few ticks.

usage: gt_board.py <conf> <workdir> <outdir> [dumps=60] [every=8]
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt_frame import Game, seg, DS
from gt_trace import start_race

DS_LEN = 0x2A00                                   # far enough to include [28bf]/[28c0]/[28c1]


def end_race_now(g):
    """From the top of fn 3039: let the setup run, then force the race-over branch (26c6 >= 2 and the
    26cc countdown about to expire) so the loop takes its 30df exit on the next iteration."""
    g.use_breakpoint(0x3067)
    g.frames(2)
    g.poke(0x26C6, 2, 0)
    g.poke(0x26CC, 1, 0)
    # no frames() here: the next iteration leaves the race loop, so the 3067 breakpoint would never hit again


if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]
    dumps = int(sys.argv[4]) if len(sys.argv) > 4 else 60
    every = int(sys.argv[5]) if len(sys.argv) > 5 else 8
    os.makedirs(out, exist_ok=True)
    g = Game(conf, work, out)
    t0 = time.time()
    start_race(g, 'board')
    end_race_now(g)
    print('race 0 running', round(time.time() - t0)); sys.stdout.flush()

    # end of race 0: force the finishing order (car 0 first) so the player qualifies
    g.d.cmd('BPDEL *'); g.d.cmd(f'BP {seg(0):04X}:3115')
    if not g.d.run(600): raise RuntimeError('race 0 never ended')
    g.poke(0x2678, 0x00, 0x00, 0x64, 0x01, 0xC8, 0x02, 0x2C, 0x04)
    # give the three AI cars a driver so fn 1a4a finds nobody left to choose and does not wait for the player
    for off, ch in ((0x0C31, 3), (0x0C4C, 5), (0x0C67, 7)):
        g.poke(off, ch, 0)
    print('race 0 over', round(time.time() - t0)); sys.stdout.flush()

    # the qualification screen waits up to 700 ticks, then race 1 starts
    g.d.cmd('BPDEL *'); g.d.cmd(f'BP {seg(0):04X}:3043')
    if not g.d.run(600): raise RuntimeError('race 1 never started')
    g.dump(DS, 0, DS_LEN, 'prerace_ds.bin')
    g.dump(0xA000, 0, 0xFA00, 'prerace_vram.bin')
    end_race_now(g)
    print('race 1 running', round(time.time() - t0)); sys.stdout.flush()

    g.d.cmd('BPDEL *'); g.d.cmd(f'BP {seg(0):04X}:30DF')
    if not g.d.run(600): raise RuntimeError('race 1 never ended')
    print('race 1 over', round(time.time() - t0)); sys.stdout.flush()

    g.use_breakpoint(0x489C)
    log = []
    for k in range(dumps):
        g.frames(every)
        name = f'b{(k + 1) * every:03d}'
        g.dump(0xA000, 0, 0xFA00, f'{name}_vram.bin')
        g.dump(DS, 0, DS_LEN, f'{name}_ds.bin')
        log.append({'name': name, 'tick': g.tick})
        if k % 5 == 0: print(name, round(time.time() - t0)); sys.stdout.flush()
    json.dump({'dumps': log, 'every': every}, open(os.path.join(out, 'board.json'), 'w'))
    print('done', round(time.time() - t0))
    g.d.close()
