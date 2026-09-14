#!/usr/bin/env python3
"""Ground truth for the OPL2 driver: dump its whole work area every N game ticks while a song plays, so the
port can be seeded with one sample and checked against the next.

The driver keeps everything in its own segment: the 256-byte register shadow at 114d, the tempo rate and
accumulator pairs at 1261/1265 (music) and 1269/126d (effects), the two eight-slot request queues at 13d1
and 13d9, and the sixteen 0x16-byte channel records at 1271. 1100..1440 covers the lot. int 8 (fn 489c)
calls the driver's ah=3 exactly once per tick and the breakpoint sits above that call, so `frames(n)` between
two dumps is exactly n driver ticks.

    MM_LOAD_SEG=824 python3 tools/gt_opl.py build/dos-snd/run_sound.conf build/dos-snd build/golden/gt/sound/opl

usage: gt_opl.py <conf> <workdir> <outdir> [samples] [ticks-per-sample]
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt_frame import Game, seg, DS

DRIVER = seg(0x1424)
STATE, STATE_LEN = 0x1100, 0x340

if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]
    samples = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    step = int(sys.argv[5]) if len(sys.argv) > 5 else 8
    os.makedirs(out, exist_ok=True)
    g = Game(conf, work, out)
    t0 = time.time()
    g.frames(6)
    g.key(0x1C); g.frames(30)                                  # GAME OPTIONS -> PLAY WHICH GAME SET ?
    g.key(0x1C); g.frames(30)                                  # -> the title, where song 1 starts
    limit = g.dump(DRIVER, 0xC3, 1, 'drv_limit.bin')
    if open(limit, 'rb').read() != b'\x10':
        raise SystemExit('the driver never initialised: is there an OPL2 at 0x388 and SETTINGS.DAT word 3 = 1?')
    log = []
    # MM_OPL_SWITCH=n walks into the Challenge character select before sample n, so the second half of the
    # trace listens to song 2 instead of song 1
    switch = int(os.environ.get('MM_OPL_SWITCH', '-1'))
    for i in range(samples):
        if i == switch:
            g.hold(0x80, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)   # ONE PLAYER
            g.hold(0x40, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)   # Challenge
        g.dump(DRIVER, STATE, STATE_LEN, f'state_{i:02d}.bin')
        log.append({'sample': i, 'tick': g.tick})
        print('sample', i, 'tick', g.tick, round(time.time() - t0)); sys.stdout.flush()
        if i + 1 < samples:
            g.frames(step)
    g.dump(DS, 0, 0x2000, 'ds_title.bin')
    json.dump({'step': step, 'samples': log, 'state_at': STATE, 'state_len': STATE_LEN},
              open(os.path.join(out, 'opl.json'), 'w'))
    print('done', round(time.time() - t0))
    g.d.close()
