#!/usr/bin/env python3
"""Replay a DOSBox-X trace (tools/gt_trace.py output) through tools/mm/sim and report the first divergence.
usage: sim_compare.py <trace_dir> [max_ticks] [--steps-per-tick N] [--verbose]"""
import sys, os, json, struct, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mm.sim.race import DS, Race, CARS, s16

MASK = []   # everything is modelled; add (lo, hi) field ranges here to ignore fields temporarily
ISR_VARS = [(0x26CF, 2), (0x261E, 3)]   # blink flag+counter; 16-bit tick counter at 261f (byte 261e is the PIT divisor tail)                                                             # blink flag/counter owned by int 8
FIELD_NAMES = {0x125c: 'x', 0x1268: 'y', 0x1258: 'fx', 0x1264: 'fy', 0x125e: "x'", 0x126a: "y'", 0x125a: "fx'", 0x1266: "fy'",
               0x1270: 'vx*', 0x1274: 'vy*', 0x1272: 'vx', 0x1276: 'vy', 0x1278: 'heading', 0x127a: 'speed', 0x1282: 'sliding',
               0x12ae: 'state', 0x12b0: 'state_t', 0x1250: 'drawn', 0x12cc: 'block', 0x12ce: 'cell', 0x12da: 'DIR', 0x12dc: 'DIRprev',
               0x12de: 'mapbits', 0x12e0: 'LEV', 0x12e1: 'progprev', 0x12e3: 'prog', 0x12e5: 'progchg', 0x12d0: 'terrain', 0x12d2: 'terrainprev',
               0x12d4: 'vspeed', 0x12d6: 'height', 0x12d8: 'landed', 0x12a8: 'ontrack', 0x12ac: 'carhit', 0x137b: 'input', 0x137e: 'camok',
               0x12f1: 'safex', 0x12f3: 'safey', 0x12f5: 'safex2', 0x12f7: 'safey2', 0x129c: 'maxspd', 0x12ed: 'laps', 0x12e7: 'cpcur', 0x12e9: 'cpsave'}

def masked(off):
    o = (off - 0x1240) % 0x164 + 0x1240 if 0x124c <= off < 0x124c + 4 * 0x164 else off
    # normalise to car-0 field offset: fields are at car_base + (field - 0x124c) but the struct starts at 0x124c
    return any(a <= o < b for a, b in MASK)

def car_field(off):
    for i, bx in enumerate(CARS):
        if bx + 0x124A <= off < bx + 0x124A + 0x164:
            f = off - bx
            return i, f
    return None, off

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('trace'); ap.add_argument('max_ticks', nargs='?', type=int, default=10 ** 6)
    ap.add_argument('--search', action='store_true', help='try 0..2 steps per dump (for tick-based traces)'); ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--skip', type=int, default=0, help='number of leading ticks to take from the trace instead of simulating')
    a = ap.parse_args()
    meta = json.load(open(os.path.join(a.trace, 'trace.json'))) if os.path.exists(os.path.join(a.trace, 'trace.json')) else None
    inputs = meta['inputs_p1'] if meta else None
    coff, goff = 0x1240, 0x2600
    def load(t):
        st = os.path.join(a.trace, f'state_{t:04d}.bin')
        if os.path.exists(st):
            b = open(st, 'rb').read(); return b[:0x600], b[goff - coff:goff - coff + 0x100]
        c = os.path.join(a.trace, f'cars_{t:04d}.bin'); g = os.path.join(a.trace, f'glob_{t:04d}.bin')
        if not os.path.exists(c) or not os.path.exists(g): return None, None
        return open(c, 'rb').read(), open(g, 'rb').read()
    ds = DS(open(os.path.join(a.trace, 'ds_full_start.bin'), 'rb').read())
    race = Race(ds)
    # pacing report
    prev = None; changes = []
    t = 0
    while t < a.max_ticks:
        c, g = load(t)
        if c is None: break
        changes.append(prev is not None and c != prev); prev = c; t += 1
    n = t
    print(f'{n} dumps in trace; dumps whose car block changed vs previous: {sum(changes)} -> pattern {"".join("1" if x else "." for x in changes[:80])}')
    if inputs is None:
        from gt_trace import script            # trace still running: use the same input script it uses
        inputs = [script(t) for t in range(n)]
    # seed the simulator with the state at tick `skip`
    c, g = load(a.skip)
    ds.m[coff:coff + len(c)] = c; ds.m[goff:goff + len(g)] = g
    first_bad = None; step_log = []
    for t in range(a.skip + 1, n):
        cprev, gprev = load(t - 1)
        for off, ln in ISR_VARS: ds.m[off:off + ln] = gprev[off - goff:off - goff + ln]
        c, g = load(t)
        def diff_state():
            diffs = [coff + i for i in range(len(c)) if ds.m[coff + i] != c[i] and not masked(coff + i)]
            gdiffs = [goff + i for i in range(len(g)) if ds.m[goff + i] != g[i] and not any(o <= goff + i < o + l for o, l in ISR_VARS)]
            return diffs, gdiffs
        # the game runs [263a] logic steps per displayed frame and waits table[263c+[263a]] ticks: the number of
        # steps between two tick dumps is 0..2. Try each count and keep the one that matches (or the closest).
        snapshot = bytes(ds.m)
        best = None
        try:
            for steps in ((0, 1, 2) if a.search else (1,)):
                ds.m[:] = snapshot
                for _ in range(steps): race.step(inputs[t])
                diffs, gdiffs = diff_state()
                score = len(diffs) + len(gdiffs)
                if best is None or score < best[0]: best = (score, steps, bytes(ds.m), diffs, gdiffs)
                if score == 0: break
        except NotImplementedError as e:
            print(f'tick {t}: simulator gap: {e}'); break
        score, steps, state, diffs, gdiffs = best
        ds.m[:] = state
        step_log.append(steps)
        if score and a.verbose and a.search:
            # show what each step count would have produced, to separate pacing from simulation errors
            for cand_steps in (0, 1, 2):
                ds.m[:] = snapshot
                for _ in range(cand_steps): race.step(inputs[t])
                dd, gg = diff_state()
                names = []
                for o in sorted({o & ~1 for o in dd})[:6]:
                    car, f = car_field(o); names.append(f'car{car}.{FIELD_NAMES.get(f, f"{f:04x}")}' if car is not None else f'{o:04x}')
                names += [f'[{o:04x}]' for o in sorted({o & ~1 for o in gg})[:6]]
                print(f'      {cand_steps} steps -> {len(dd)} car byte diffs, {len(gg)} global byte diffs: {" ".join(names)}')
            ds.m[:] = state
        if diffs or gdiffs:
            # group into words
            words = sorted({o & ~1 if (o - 0x124c) % 2 == 0 or True else o for o in diffs})
            shown = []
            for o in words[:12]:
                car, f = car_field(o)
                name = FIELD_NAMES.get(f, f'{f:04x}') if car is not None else f'{o:04x}'
                sim = struct.unpack_from('<h', ds.m, o)[0]; real = struct.unpack_from('<h', c, o - coff)[0]
                shown.append(f'car{car}.{name}={sim} (game {real})' if car is not None else f'[{o:04x}]={sim} (game {real})')
            gshown = [f'[{o:04x}]={struct.unpack_from("<h", ds.m, o & ~1)[0]} (game {struct.unpack_from("<h", g, (o & ~1) - goff)[0]})' for o in sorted(set(o & ~1 for o in gdiffs))[:8]]
            print(f'tick {t} (input {inputs[t]:#04x}, best with {steps} steps): {len(words)} car word diffs, {len(gshown)} global diffs')
            for s in shown: print('   ', s)
            for s in gshown: print('   ', s)
            if first_bad is None: first_bad = t
            if not a.verbose:
                break
            # resync from the trace to keep going
            ds.m[coff:coff + len(c)] = c; ds.m[goff:goff + len(g)] = g
        elif a.verbose and t % 25 == 0:
            print(f'tick {t}: ok')
    print('steps per tick:', ''.join(str(x) for x in step_log[:120]))
    if first_bad is None: print(f'all {n - a.skip - 1} simulated ticks match')

if __name__ == '__main__':
    main()
