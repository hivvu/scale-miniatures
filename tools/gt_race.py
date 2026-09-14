#!/usr/bin/env python3
"""Drive MICRONCC.EXE headless to the first Challenge race and dump ground truth:
VRAM frames (PNG), the 32-frame vehicle sprite table (segment 4D78), extra sprites (5D78), data segment.
usage: gt_race.py <conf> <workdir> <outdir> [ticks_in_race=150]"""
import os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt_frame import Game, seg, DS, VH, VH2, WORK
from dbg_drive import ANSI

def opened_files(g):
    return re.findall(r'file open command \w+ file ([\w\.\\]+)', ANSI.sub(b'', g.d.all).decode('latin1', 'replace'))

if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]; race_ticks = int(sys.argv[4]) if len(sys.argv) > 4 else 150
    g = Game(conf, work, out); t0 = time.time()
    g.frames(6)
    g.key(0x1C); g.frames(20)                       # options -> title
    g.key(0x1C); g.frames(20)                       # title -> SELECT GAME
    g.hold(0x80, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)   # ONE PLAYER
    g.vram('07_oneplayer', 'INTRO.PAL')
    g.hold(0x40, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)   # Challenge
    g.vram('08_after_challenge', 'INTRO.PAL')        # WHO DO YOU WANT TO BE ?
    g.hold(0x08, 3); g.release(3); g.frames(10)      # pick default character (SPIDER)
    g.vram('09_press_any_key', 'INTRO.PAL')
    g.key(0x1C)                                       # PRESS ANY KEY TO START
    # wait for the round files with an int 21h open breakpoint instead of ticking
    g.d.cmd('BPDEL *'); g.d.cmd('BPINT 21 3D')
    pal = 'INTRO.PAL'; seen = []
    for _ in range(40):
        if not g.d.run(60): break
        names = opened_files(g); new = names[len(seen):] if len(names) > len(seen) else []
        seen = names
        last = names[-1] if names else ''
        print('open:', last)
        m = re.search(r'ROUND(\d)\.PAL', last.upper())
        if m: pal = f'GAME1/ROUND{m.group(1)}.PAL'
        if 'VH0' in last.upper(): break
    g.d.cmd('BPDEL *'); g.d.cmd(f'BP {seg(0):04X}:{g.tick_bp:04X}')
    print('race files loaded; pal =', pal)
    g.frames(race_ticks)
    g.vram('10_race', pal)
    g.dump(VH, 0, 0x4800, 'vh_4d78.bin'); g.dump(VH2, 0, 0x1B00, 'vh_5d78.bin')
    g.dump(DS, 0, 0x8000, 'ds_0000_8000.bin'); g.dump(WORK, 0, 0x10000, 'work_6d78.bin')
    g.hold(0x20, 40); g.vram('11_race_accel', pal); g.dump(DS, 0, 0x8000, 'ds_after_accel.bin')
    print('ticks', g.tick, 'elapsed', round(time.time() - t0), 'pal', pal)
    g.d.close()
