#!/usr/bin/env python3
"""Ground truth for the front-end screens (everything drawn by the 0x110-wide buffer at segment 6D78).

Walks the menus with the same key script gt_trace uses to reach a race and dumps VRAM (and the data segment)
at each stop, so test/engine/frontend.test.ts can compare the transliterated screens pixel by pixel.

usage: gt_front.py <conf> <workdir> <outdir>
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt_frame import Game, seg, DS

# (name, action) pairs; action runs before the dump
STEPS = [
    ('s00_options',        lambda g: g.frames(6)),                                    # fn 2770 GAME OPTIONS
    ('s01_gameset',        lambda g: (g.key(0x1C), g.frames(20))),                    # fn 2be8 PLAY WHICH GAME SET ?
    ('s02_title',          lambda g: (g.key(0x1C), g.frames(20))),                    # fn 0100 title (LOGO + vehicle)
    ('s03_title_later',    lambda g: g.frames(40)),                                   # vehicle name rotates every 0x118 ticks
    ('s04_selectgame',     lambda g: (g.hold(0x80, 3), g.release(3), g.hold(0x08, 3), g.release(3), g.frames(15))),
    ('s05_selectgame_r',   lambda g: (g.hold(0x40, 3), g.release(3))),
    ('s06_submenu',        lambda g: (g.hold(0x08, 3), g.release(3), g.frames(15))),
    ('s07_charselect',     lambda g: (g.hold(0x08, 3), g.release(3), g.frames(10))),
    ('s08_charselect_r',   lambda g: (g.hold(0x40, 3), g.release(6))),
    ('s09_confirmed',      lambda g: (g.hold(0x08, 3), g.release(3), g.frames(8))),
    ('s10_more',           lambda g: g.frames(25)),
    ('s11_more',           lambda g: g.frames(25)),
]

if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    g = Game(conf, work, out)
    t0 = time.time()
    log = []
    for name, action in STEPS:
        action(g)
        g.dump(0xA000, 0, 0xFA00, f'{name}_vram.bin')
        g.dump(DS, 0, 0x2000, f'{name}_ds.bin')
        log.append({'name': name, 'tick': g.tick})
        print(name, 'tick', g.tick, round(time.time() - t0)); sys.stdout.flush()
    json.dump({'steps': log}, open(os.path.join(out, 'front.json'), 'w'))
    print('done', round(time.time() - t0))
    g.d.close()
