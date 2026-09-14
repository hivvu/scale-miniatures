#!/usr/bin/env python3
"""Ground truth for the sound driver: walk to the first Challenge race, hold the accelerator, and dump the
driver's own memory (the engine records at 0008 and the 256-byte register shadow at 114d) plus the data
segment, so the port can be compared against what the real driver told the OPL2 to do.

Needs a work directory whose SETTINGS.DAT has word 3 = 1 (DRIVER1, the AdLib one) and a conf with an OPL2 at
0x388; fn 321c spins for ever if the chip does not answer the driver's detection. A Sound Blaster in the conf
also puts BLASTER=... in the DOS environment, which moves the load segment, hence MM_LOAD_SEG:

    MM_LOAD_SEG=824 python3 tools/gt_sound.py build/dos-snd/run_sound.conf build/dos-snd build/golden/gt/sound

usage: gt_sound.py <conf> <workdir> <outdir>
"""
import os, sys, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt_frame import Game, seg, DS
from dbg_drive import ANSI

DRIVER = seg(0x1424)


def opened_files(g):
    return re.findall(r'file open command \w+ file ([\w\.\\]+)', ANSI.sub(b'', g.d.all).decode('latin1', 'replace'))


if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]
    g = Game(conf, work, out); t0 = time.time()
    g.frames(6)
    drv = g.dump(DRIVER, 0xC3, 1, 'drv_limit.bin')          # fn 0 sets this to 0x10 once the OPL answered
    if open(drv, 'rb').read() != b'\x10':
        print('WARNING: the driver never initialised; is there an OPL2 at 0x388, and is SETTINGS.DAT word 3 = 1?')
    g.key(0x1C); g.frames(20)                                                   # options -> title
    g.key(0x1C); g.frames(20)                                                   # title -> SELECT GAME
    g.hold(0x80, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)  # ONE PLAYER
    g.hold(0x40, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)  # Challenge
    g.hold(0x08, 3); g.release(3); g.frames(10)                                 # the default character
    g.dump(DRIVER, 0, 0x60, 'drv_menu_records.bin')
    g.dump(DRIVER, 0x1100, 0x200, 'drv_menu_shadow.bin')
    print('menus done', round(time.time() - t0)); sys.stdout.flush()
    g.key(0x1C)                                                                 # PRESS ANY KEY TO START
    g.d.cmd('BPDEL *'); g.d.cmd('BPINT 21 3D')
    seen = []
    for _ in range(40):
        if not g.d.run(60): break
        names = opened_files(g)
        seen = names
        if names and 'VH0' in names[-1].upper(): break
    g.d.cmd('BPDEL *'); g.d.cmd(f'BP {seg(0):04X}:{g.tick_bp:04X}')
    print('race loaded', round(time.time() - t0)); sys.stdout.flush()
    g.frames(40)
    g.dump(DRIVER, 0, 0x60, 'drv_idle_records.bin')
    g.dump(DRIVER, 0x1100, 0x200, 'drv_idle_shadow.bin')
    g.dump(DS, 0, 0x8000, 'ds_idle.bin')
    g.hold(0x20, 90)                                                            # accelerate
    g.dump(DRIVER, 0, 0x60, 'drv_fast_records.bin')
    g.dump(DRIVER, 0x1100, 0x200, 'drv_fast_shadow.bin')
    g.dump(DS, 0, 0x8000, 'ds_fast.bin')
    print('done', g.tick, round(time.time() - t0))
    g.d.close()
