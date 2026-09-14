#!/usr/bin/env python3
"""Per-step ground-truth trace of the car structs in the first Challenge race (round 2 track 1).
usage: gt_trace.py <conf> <workdir> <outdir> [steps=300] [scenario=steer]
One dump per race-loop iteration (state_NNNN.bin = ds:1240..2700). The P1 input script is written to trace.json
at the start so tools/sim_compare.py can replay while the trace is still running."""
import os, sys, time, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt_frame import Game, seg, DS
from gt_race import opened_files

STATE_OFF, STATE_LEN = 0x1240, 0x14C0         # car structs (0x124c..0x17dc) up to the race globals (0x26xx)
SCENARIOS = {
    # the countdown takes ~96 steps ([26d5] += 2 per frame, 2 steps per frame, until 0x60)
    'steer': lambda t: 0x20 if t < 100 else 0xA0 if t < 180 else 0x60 if t < 260 else 0x00,
    'ram':   lambda t: 0x20,                                             # full throttle into the AI car ahead
    'wall':  lambda t: 0xA0 if 96 <= t < 130 else 0x20,                 # turn left then drive into the bath wall
    'brake': lambda t: 0x20 if t < 150 else 0x10 if t < 200 else 0x30,  # reverse, then up+down together
    'collide': lambda t: 0x60 if 144 <= t < 149 else 0x20,              # nudge right into the AI car alongside at ~t=150
    'whirl': lambda t: 0x20 if t < 100 else 0x00,                       # teleported next to the drain at t=100, then pulled in
    'finish': lambda t: 0x00,                                           # player car driven by the AI ([2658] = 6), 1 lap each
    'r1': lambda t: 0x20 if t < 130 else 0xA0 if t < 170 else 0x20,     # round 1 track 1 (see ROUNDS): drive, swerve left, drive
    'r3': lambda t: 0x20 if t < 130 else 0x60 if t < 170 else 0x20,     # round 3 track 1: drive, swerve right, drive
    'r4': lambda t: 0x20 if t < 130 else 0xA0 if t < 170 else 0x20,
    'r5': lambda t: 0x20 if t < 130 else 0x60 if t < 170 else 0x20,
    'r6': lambda t: 0x20 if t < 130 else 0xA0 if t < 170 else 0x20,
    'r7': lambda t: 0x20 if t < 130 else 0x60 if t < 170 else 0x20,
    'r8': lambda t: 0x20 if t < 130 else 0xA0 if t < 170 else 0x20,
    'r9': lambda t: 0x20 if t < 130 else 0x60 if t < 170 else 0x20,
    'r3pocket': lambda t: 0x20 if t < 100 else 0x00,                   # round 3 track 3: teleported onto the pocket at block (21,3)
}
# scenarios that race another round/track: [28bf]/[28c0] are poked at the top of fn 3039 (bp 0822:3043), after the
# menus have set them and before fn 37fc patches the file names
ROUNDS = {'r1': (1, 1), 'r3': (3, 1), 'r3pocket': (3, 3), 'r4': (4, 1), 'r5': (5, 1), 'r6': (6, 1), 'r7': (7, 1), 'r8': (8, 1), 'r9': (9, 1)}
# memory pokes applied at the top of iteration t (before its input): {t: [(offset, [bytes...]), ...]}
WHIRL_X, WHIRL_Y = 0x650, 0xB70            # inside the capture box (fn 62e3: x 644..65c, y b64..b7c)
POKES = {
    'whirl': {100: [(0x125C, list(WHIRL_X.to_bytes(2, 'little')) * 2), (0x1268, list(WHIRL_Y.to_bytes(2, 'little')) * 2),
                    (0x12F1, list(WHIRL_X.to_bytes(2, 'little')) + list(WHIRL_Y.to_bytes(2, 'little')))]},
    # input source 6 (AI) for car 0 with its fn 2d00 handler pointer (0x2ded); laps to go = 1 for the four cars
    # pocket cell (0x820..0x830, 0x140..0x150) of the record (21, 3); progress [12e7] raised to its minimum (2)
    'r3pocket': {100: [(0x125C, [0x28, 0x08] * 2), (0x1268, [0x48, 0x01] * 2), (0x12F1, [0x28, 0x08, 0x48, 0x01]), (0x12E7, [2, 0])]},
    'finish': {0: [(0x2658, [6, 0]), (0x1083, [0xED, 0x2D])],
               100: [(0x12ED, [1, 0]), (0x1451, [1, 0]), (0x15B5, [1, 0]), (0x1719, [1, 0])]},
}
# VRAM captured every step inside these windows (in addition to every 50th step)
VRAM_WINDOWS = {'whirl': [(100, 300)], 'r3pocket': [(100, 300)]}
SCENARIO = 'steer'
def script(t): return SCENARIOS[SCENARIO](t)

def start_race(g, scenario):
    """Menus -> Challenge -> first race, with the scenario's round/track poked at the top of fn 3039; returns when the
    VH0 file has been opened (the race files are loading)."""
    rnd, trk = ROUNDS.get(scenario, (2, 1))
    g.frames(6); g.key(0x1C); g.frames(20); g.key(0x1C); g.frames(20)
    g.hold(0x80, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)
    g.hold(0x40, 3); g.release(3); g.hold(0x08, 3); g.release(3); g.frames(15)
    g.hold(0x08, 3); g.release(3); g.frames(10)
    if scenario in ROUNDS:
        g.d.cmd('BPDEL *'); g.d.cmd(f'BP {seg(0):04X}:3043'); g.poke(0x107E, 0x1C)
        if not g.d.run(60): raise RuntimeError('fn 3039 breakpoint not hit')
        g.poke(0x28BF, rnd); g.poke(0x28C0, trk)
    else:
        g.key(0x1C)
    g.d.cmd('BPDEL *'); g.d.cmd('BPINT 21 3D')
    for _ in range(40):
        if not g.d.run(60): raise RuntimeError('lost control of the debugger while loading')
        names = opened_files(g); last = names[-1] if names else ''
        print('open:', last); sys.stdout.flush()
        if 'VH0' in last.upper(): break                 # like gt_race: from here on tick breakpoints keep control

if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]; n = int(sys.argv[4]) if len(sys.argv) > 4 else 300
    if len(sys.argv) > 5: SCENARIO = sys.argv[5]
    os.makedirs(out, exist_ok=True)
    pokes = POKES.get(SCENARIO, {}); windows = VRAM_WINDOWS.get(SCENARIO, []); rnd, trk = ROUNDS.get(SCENARIO, (2, 1))
    PAL = f'GAME1/ROUND{rnd}.PAL'
    json.dump({'round': rnd, 'track': trk, 'state_off': STATE_OFF, 'scenario': SCENARIO, 'inputs_p1': [script(t) for t in range(n)],
               'pokes': {str(t): [[off, vals] for off, vals in lst] for t, lst in pokes.items()},
               'note': 'state_NNNN.bin = ds:1240..2700 at the top of race-loop iteration t+1 (bp 0822:3067), i.e. after '
                       'iteration t consumed inputs_p1[t]; ds_full_start.bin = ds:0000..8000 at the top of iteration 0'},
              open(os.path.join(out, 'trace.json'), 'w'))
    g = Game(conf, work, out); t0 = time.time()
    start_race(g, SCENARIO)
    g.use_breakpoint(0x3067)                       # one break per race-loop iteration (logic step)
    print('race loaded', round(time.time() - t0)); sys.stdout.flush()
    g.frames(1)                                      # first iteration boundary = consistent seed state
    g.dump(DS, 0, 0x8000, 'ds_full_start.bin')
    ending = False
    for t in range(n):
        for off, vals in pokes.get(t, []): g.poke(off, *vals)
        b = script(t); g.poke(0x107D, b)
        g.frames(1)
        st = open(g.dump(DS, STATE_OFF, STATE_LEN, f'state_{t:04d}.bin'), 'rb').read()
        w = lambda o: st[o - STATE_OFF] | (st[o - STATE_OFF + 1] << 8)
        finished = w(0x26C6) >= 1 or any(w(bx + 0x12AE) in (0xB, 0xC) for bx in (0, 0x164, 0x2C8, 0x42C))
        if t % 50 == 0 or finished or any(a <= t < z for a, z in windows):
            g.vram(f'vram_{t:04d}', PAL)
        if t % 25 == 0: print('tick', t, round(time.time() - t0)); sys.stdout.flush()
        if w(0x26C6) >= 2 and w(0x26CC) <= 1:                 # next iteration leaves the loop for the end sequence (30df)
            ending = True; n_steps = t + 1; break
    if ending:
        # end sequence: 100 x {wait tick, fn 855a, fn 92bc}; break after each present (0822:30ff) and dump VRAM + state
        g.use_breakpoint(0x30FF)
        for k in range(100):
            g.frames(1)
            g.dump(DS, STATE_OFF, STATE_LEN, f'end_state_{k:04d}.bin'); g.vram(f'end_vram_{k:04d}', PAL)
            if k % 10 == 0: print('end', k, round(time.time() - t0)); sys.stdout.flush()
        json.dump({'steps': n_steps, 'end_frames': 100}, open(os.path.join(out, 'end.json'), 'w'))
    print('done', g.tick, round(time.time() - t0)); g.d.close()
