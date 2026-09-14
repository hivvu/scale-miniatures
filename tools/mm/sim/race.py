"""Race tick transliteration (fn 3039 loop body: 2d5b input, 4aee physics, render side effects, 7429/73e7/51b2).

Every routine below mirrors one 16-bit routine of MICRO_U.EXE (addresses relative to CS=1000 in the Ghidra
project). The state is a byte image of the data segment (DS=093C); offsets are the ones used by the code.
See re/notes/70-physics.md and 80-ai-collision.md.
"""
from __future__ import annotations
import struct

CAR_STRIDE = 0x164
CARS = (0, 0x164, 0x2C8, 0x42C)


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def s8(v):
    v &= 0xFF
    return v - 0x100 if v & 0x80 else v


def mulfix(a, b):
    """imul 16x16 -> (product >> 8) << 1, as the game does with `mov al,ah ; mov ah,dl ; shl ax,1`."""
    p = s16(a) * s16(b)
    return ((p >> 8) << 1) & 0xFFFF


class DS:
    def __init__(self, image: bytes):
        self.m = bytearray(0x10000)
        self.m[:len(image)] = image

    def r8(self, o): return self.m[o & 0xFFFF]
    def rs8(self, o): return s8(self.m[o & 0xFFFF])
    def r16(self, o): o &= 0xFFFF; return self.m[o] | (self.m[(o + 1) & 0xFFFF] << 8)
    def rs16(self, o): return s16(self.r16(o))
    def w8(self, o, v): self.m[o & 0xFFFF] = v & 0xFF
    def w16(self, o, v):
        o &= 0xFFFF; v &= 0xFFFF
        self.m[o] = v & 0xFF; self.m[(o + 1) & 0xFFFF] = v >> 8
    def add16(self, o, v): self.w16(o, self.r16(o) + v)


class Race:
    def __init__(self, ds: DS):
        self.d = ds
        self.sounds = []           # (fn, arg) driver calls, for reference only

    # ---------------------------------------------------------------- helpers
    @property
    def round(self): return self.d.r8(0x28BF)

    def snd(self, ah, al): self.sounds.append((ah, al))

    def wrap_pos(self, v):
        v = s16(v)
        if v <= -1: v += 0xC00
        if v >= 0xC00: v -= 0xC00
        return v & 0xFFFF

    def candidate(self, bx):
        """x' = x + hi8(vx + fx) ; fx' = lo8 (fn 5532 / 5960 / 5be7 prologue), wrapped to 0..0xBFF."""
        d = self.d
        ax = (d.r16(bx + 0x1272) + d.r16(bx + 0x1258)) & 0xFFFF
        d.w16(bx + 0x125E, self.wrap_pos(s8(ax >> 8) + d.rs16(bx + 0x125C)))
        d.w16(bx + 0x125A, ax & 0xFF)
        ax = (d.r16(bx + 0x1276) + d.r16(bx + 0x1264)) & 0xFFFF
        d.w16(bx + 0x126A, self.wrap_pos(s8(ax >> 8) + d.rs16(bx + 0x1268)))
        d.w16(bx + 0x1266, ax & 0xFF)

    def catchup_flag(self, bx):
        """fn 4aee / 525e prologue: cl = 1 when this (non-leading) car is off-screen and listed in [2678..[267e]]."""
        d = self.d
        cl = 0
        if bx != 0 and d.r16(bx + 0x1250) == 0:
            si = 0x2678
            while True:
                ax = d.r16(si); si += 2
                if ax == bx: break
                if ax == 0: cl = 1; break
                if si > d.r16(0x267E): break
        d.w8(0x262F, cl)
        return cl

    def respawn(self, bx):
        d = self.d
        d.w16(bx + 0x12BA, d.r16(bx + 0x125C)); d.w16(bx + 0x12BC, d.r16(bx + 0x1268))
        d.w16(bx + 0x12AE, 0x0D)

    # ---------------------------------------------------------------- input (fn 2d5b / 5429)
    def fn_5429_ai(self, bx):
        d = self.d
        d.w8(bx + 0x137B, 0)
        ax = d.r16(bx + 0x12DA); dx = d.r16(bx + 0x12DE); cx = d.r8(bx + 0x12E0)
        if self.round == 2: ax &= 7
        ax &= 0xF
        if dx & 2:
            cx = (cx >> 5) & 3
            ax = d.r8(0x191B + cx * 16 + ax)
        ax = d.r16(0x18FB + ax * 2)
        if dx & 1: ax ^= 0x80
        al = s8((ax - d.r16(bx + 0x1278)) & 0xFF)
        if al < 0: d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x80)
        elif al >= 3: d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x40)
        brk = d.r8(d.r16(0x28BB) + d.r16(bx + 0x12E3))
        mode = brk >> 4
        def full():
            d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x20); d.w16(bx + 0x129C, d.r16(bx + 0x129E))
        def target_speed():
            ax = (((brk & 0xF) << 8) >> 1) + 0x380
            if d.r8(0x28C1) == 0x17: ax += 0x50
            if self.round == 7:
                if d.r8(0x28C1) >= 0x13: ax -= 0x20
                ax -= 0xD0
            if d.rs16(bx + 0x127A) > s16(ax):
                d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x10)
            else:
                d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x20)
            d.w16(bx + 0x129C, d.r16(bx + 0x129E))
        if mode == 0: full()
        elif mode == 1: target_speed()
        elif mode == 2:
            ax = (((brk & 0xF) << 8) >> 2) + 0x600
            d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 0x20)
            if d.rs16(bx + 0x129C) <= s16(ax): d.w16(bx + 0x129C, ax)
        else:
            if d.r8(bx + 0x137B) & 0xC0: target_speed()
            else: full()
        d.w8(bx + 0x137B, d.r8(bx + 0x137B) | 8)
        return d.r8(bx + 0x137B)

    def fn_2d5b_input(self, keys1: int, keys2: int = 0):
        """Per-frame input poll. keys1/keys2 = the two keyboard input bytes ([107d]/[107c])."""
        d = self.d
        d.w8(0x107D, keys1); d.w8(0x107C, keys2)
        outs = (0x137B, 0x14DF, 0x1643, 0x17A7)
        for i, bx in enumerate(CARS):
            src = d.r16(0x2658 + i * 2)
            if src == 4: al = keys1
            elif src == 5: al = keys2
            elif src in (1, 2, 3): raise NotImplementedError('joystick/mouse input source')
            else:
                al = 0
                if d.r8(0x1082) != 0: al = self.fn_5429_ai(bx)
            d.w8(outs[i], al)
        if d.r16(0x1080) == 0:
            d.w8(0x108B, d.r8(0x137B) | d.r8(0x14DF))
        else:
            d.w8(0x108B, d.r8(d.r16(0x1080)))

    # ---------------------------------------------------------------- fn 4aee physics
    def fn_4edc_steer_rate(self, bx):
        d = self.d
        cx = d.r16(bx + 0x129A)
        if self.round == 7:
            if d.r16(bx + 0x12EB) == 1: return (cx + 1) & 0xFFFF
            if d.rs16(bx + 0x127A) >= 0x320: cx = (s16(cx) >> 1) & 0xFFFF
        return cx

    def fn_4aee(self):
        d = self.d
        for bx in CARS:
            self._car_control(bx)
        for p in (0x2660, 0x2662, 0x2664, 0x2666):
            self.fn_525e_move(d.r16(p))
        self.fn_5921_collisions()
        for p in (0x2660, 0x2662, 0x2664, 0x2666):
            self.fn_5be7_track(d.r16(p))
        self._camera()

    def _coast(self, bx):                       # 4e38
        d = self.d
        ax = d.rs16(bx + 0x12A6); cx = d.rs16(bx + 0x127A)
        if cx < -1:
            d.add16(bx + 0x127A, ax)
            if d.rs16(bx + 0x127A) >= 0: d.w16(bx + 0x127A, 0)
        else:
            d.add16(bx + 0x127A, -ax)
            if d.rs16(bx + 0x127A) < 0: d.w16(bx + 0x127A, 0)

    def _jump_trigger(self, bx):                # 4f17
        d = self.d
        if d.r16(0x26C6) == 2: return
        if d.r16(0x2919) != 1 and self.round != 7: return
        if d.r16(bx + 0x13A4) != 0: return
        if d.r16(bx + 0x1250) == 0: return
        self.snd(5, 0x0E)
        d.w16(bx + 0x1394, 1); d.w16(bx + 0x1396, 0); d.w16(bx + 0x13A4, 0x3C)
        d.w16(bx + 0x139A, 10); d.w16(bx + 0x139E, 10)
        si = d.r16(bx + 0x1278) & 0xF8
        al = d.r8(0x10A0 + si)
        dx = (d.r16(bx + 0x1272) + d.r16(bx + 0x1258)) & 0xFFFF
        ah = ((dx >> 8) + 8) & 0xF
        d.w16(bx + 0x13A0, (ah << 8) | al)
        d.w16(bx + 0x1398, (s8(al) >> 3) + d.rs16(bx + 0x125C))
        si = (si - 0x40) & 0xF8
        al = d.r8(0x10A0 + si)
        dx = (d.r16(bx + 0x1276) + d.r16(bx + 0x1264)) & 0xFFFF
        ah = ((dx >> 8) + 8) & 0xF
        d.w16(bx + 0x13A2, (ah << 8) | al)
        d.w16(bx + 0x139C, (s8(al) >> 3) + d.rs16(bx + 0x1268))

    def _car_control(self, bx):
        d = self.d
        rnd = self.round
        if rnd == 9:
            if d.r16(bx + 0x12ED) != 2:
                return self._car_control_main(bx)
            d.w16(0x26CA, 1)
            if d.r16(bx + 0x127A) == 0:
                d.w16(bx + 0x12AE, 0x0F); return
            return self._coast(bx)
        self.catchup_flag(bx)
        if d.rs16(bx + 0x12ED) > 0:
            return self._car_control_main(bx)
        if d.r16(0x2656) != 2:
            sp = d.rs16(bx + 0x127A)
            if sp > 0:
                d.add16(bx + 0x127A, -d.rs16(bx + 0x12A4))
                if d.rs16(bx + 0x127A) < 0: d.w16(bx + 0x127A, 0)
                return self._car_control_main(bx)
            if sp != 0:
                return self._car_control_main(bx)
            d.w16(0x26C6, 0)
            for laps, spd in ((0x12ED, 0x127A), (0x1451, 0x13DE), (0x15B5, 0x1542), (0x1719, 0x16A6)):
                if d.r16(laps) == 0 and d.r16(spd) == 0: d.add16(0x26C6, 1)
            if d.r16(d.r16(0x2660) + 0x12ED) == 0: d.w16(0x26C6, 2)
            return
        # head to head end-of-race handling (4be7)
        if d.r16(0x26B4) == 4:
            if d.r16(0x26C2) != 2:
                if d.r16(0x26C2) == 0:
                    d.w16(0x26C2, 3); d.w16(0x26BE, 0x158); d.w16(0x26C0, 0x7C)
                if d.r16(0x26BE) == 0x80:
                    d.add16(0x26C2, 1)
                    if d.r16(0x26C2) == 0x64:
                        d.w16(0x26C2, 3); d.add16(0x26BE, -8)
                elif d.rs16(0x26BE) <= -0x58:
                    d.w16(0x26C2, 0xC8)
                else:
                    d.add16(0x26BE, -8)
            return self._car_control_main(bx)
        if d.rs16(0x26B4) < 4:
            if d.r16(0x26C4) == 1:
                b = d.r16(0x2662); d.w16(0x26C4, b); d.w16(0x26B8, b)
                d.w16(0x26C4, 0x2C8); d.w16(0x2678, 0x2C8); d.w16(0x267A, 0)
                d.w16(0x267C, 0x164); d.w16(0x267E, 0x42C)
                for o in (0x2670, 0x2672, 0x2674, 0x2676): d.w16(o, 0x7D00)
                d.w16(0x26C2, 0xC8); d.w16(0x26BC, 0)
        else:
            if d.r16(0x26C4) == 1:
                b = d.r16(0x2660); d.w16(0x26C4, b); d.w16(0x26B8, b)
                d.w16(0x26C4, 0); d.w16(0x2678, 0); d.w16(0x267A, 0x2C8)
                d.w16(0x267C, 0x164); d.w16(0x267E, 0x42C)
                for o in (0x2670, 0x2672, 0x2674, 0x2676): d.w16(o, 0x7D00)
                d.w16(0x26C2, 0xC8); d.w16(0x26BC, 0)
        return

    def _car_control_main(self, bx):            # 4d04
        d = self.d
        if d.r16(bx + 0x12AE) != 0: return
        if d.r16(bx + 0x1380) != 0:
            if d.r16(bx + 0x137E) != 1: return
            d.w16(bx + 0x1380, 0)
        if d.r16(bx + 0x124C) == 0: return
        if not (d.rs16(bx + 0x12ED) > 0 or d.r16(0x2656) == 2 or d.r16(bx + 0x12EB) != 1):
            return self._coast(bx)
        dl = d.r8(bx + 0x137B)
        if d.r16(bx + 0x12EB) != 1:
            ax = d.r16(0x2658 + (d.r16(bx + 0x124A) - 1) * 2)
            if ax != 1 and ax != 2 and (dl & 8):
                return self._fire_path(bx)
        if (dl & 0xC0) == 0:
            h = d.r16(bx + 0x1278)
            low = h & 0xF
            if low <= 4: d.w16(bx + 0x1278, h & 0xF0)
            elif low < 0xC: d.w16(bx + 0x1278, (h & 0xF0) | 8)
            else: d.w16(bx + 0x1278, (h & 0xF0) + 0x10)
        d.w16(bx + 0x1278, d.r16(bx + 0x1278) & 0xFF)
        if dl & 0x80:
            cx = self.fn_4edc_steer_rate(bx)
            d.w16(bx + 0x1278, (d.r16(bx + 0x1278) - cx) & 0xFF)
            sp = d.rs16(bx + 0x127A)
            if -0xFF <= sp <= 0xFF and self.round <= 6: d.w16(bx + 0x127A, 0xFF)
        if dl & 0x40:
            cx = self.fn_4edc_steer_rate(bx)
            d.add16(bx + 0x1278, cx)                  # no mask here (original quirk)
            sp = d.rs16(bx + 0x127A)
            if -0xFF <= sp <= 0xFF and self.round <= 6: d.w16(bx + 0x127A, 0xFF)
        if d.r16(0x2656) != 2:
            if d.rs16(0x26C6) >= 2: return self._coast(bx)
            if d.rs16(bx + 0x12ED) <= 0: return self._coast(bx)
        if (dl & 0x30) == 0x30:
            return self._jump_trigger(bx)
        if (dl & 0x30) == 0:
            if d.rs16(bx + 0x12D6) <= 0: return self._coast(bx)
            return
        if d.r16(0x2656) != 2:
            if d.rs16(0x26C6) >= 2: return
            if d.rs16(bx + 0x12ED) <= 0: return
        if dl & 0x20:
            ax = d.rs16(bx + 0x12A2)
            if d.r8(0x262F) == 1:
                for _ in range(5): d.add16(bx + 0x127A, ax)
            d.add16(bx + 0x127A, ax)
            cx = d.rs16(bx + 0x129C)
            if d.rs16(bx + 0x127A) >= cx: d.w16(bx + 0x127A, cx)
        if dl & 0x10:
            d.add16(bx + 0x127A, -d.rs16(bx + 0x12A4))
            cx = d.rs16(bx + 0x12A0)
            if d.rs16(bx + 0x127A) <= cx: d.w16(bx + 0x127A, cx)
            return
        if dl & 8:
            return self._fire_path(bx)

    def _fire_path(self, bx):                   # 4f03
        d = self.d
        if d.r16(0x26C6) == 2 or d.r16(0x2915) == 1:
            if d.rs16(bx + 0x12D6) <= 0: return self._coast(bx)
            return
        return self._jump_trigger(bx)

    # ---------------------------------------------------------------- fn 525e movement
    def fn_525e_move(self, bx):
        d = self.d
        if d.r16(bx + 0x124C) != 0 and d.r16(bx + 0x12AE) == 0 and d.rs16(bx + 0x12D6) <= 0 \
                and d.r16(bx + 0x1380) == 0:
            self.catchup_flag(bx)
            cx = d.r16(bx + 0x127A)
            si = d.r16(bx + 0x1278) & 0xF8
            d.w16(bx + 0x1270, mulfix(d.rs8(0x10A0 + si), cx))
            si = s16(d.r16(bx + 0x1278) - 0x40)
            if si <= -1: si += 0x100
            si &= 0xF8
            d.w16(bx + 0x1274, mulfix(d.rs8(0x10A0 + si), cx))
            cx = d.r16(bx + 0x127E); dx = d.r16(bx + 0x127C)
            if d.r8(0x262F) != 0:
                cx = (cx + (cx >> 1)) & 0xFFFF; dx = (dx + (dx >> 1)) & 0xFFFF
            if d.r16(bx + 0x1286) != 0:
                cx = d.r16(0x28C4); dx = d.r16(0x28C2); d.add16(bx + 0x1286, -1)
            elif d.r16(bx + 0x1284) != 0:
                cx = d.r16(0x28C4); dx = d.r16(0x28C2); d.add16(bx + 0x1284, -1)
            for tgt, cur in ((0x1270, 0x1272), (0x1274, 0x1276)):
                slide = False
                if d.r16(bx + 0x1280) != 0:
                    ax = s16(d.r16(bx + tgt) - d.r16(bx + cur))
                    if ax <= -1: ax = -ax
                    if ax > s16(dx): slide = True
                if slide:
                    d.w16(bx + 0x1282, 1)
                    ax = d.rs16(bx + cur)
                    if ax < d.rs16(bx + tgt): ax += s16(cx)
                    else: ax -= s16(cx)
                    d.w16(bx + cur, ax)
                else:
                    d.w16(bx + 0x1282, 0)
                    d.w16(bx + cur, d.r16(bx + tgt))
            d.w16(bx + 0x1262, 0x80); d.w16(bx + 0x126E, 0x64)
        # 53c8: skid sound bookkeeping
        if d.r16(bx + 0x1282) != 1: return
        if self.round in (2, 8): return
        if self.round == 6:
            ax = d.r16(0x28FB)
            if ax != 0:
                d.w16(0x28FB, ax - 1); return
        d.w16(0x28FB, 0x32)
        if d.r16(0x0F64) != 1 or bx != 0 or d.r16(bx + 0x124C) != 1 or d.r16(bx + 0x1250) == 0: return
        if d.r16(0x26B8) != 1: return
        self.snd(5, 5)

    # ---------------------------------------------------------------- terrain lookups
    def fn_589c_col(self, x, y):
        """-> (block, mapbits, cell(bh<<8|bl), progress, solid). x, y world pixels 0..0xBFF."""
        d = self.d
        x &= 0xFFFF; y &= 0xFFFF
        bx_col, rem = divmod(x, 0x60); bh = rem >> 3
        by_row, rem = divmod(y, 0x60); bl = rem >> 3
        cell = (bx_col + (by_row << 5)) & 0xFFFF
        mb = d.r8(0x2963 + cell)
        di = mb >> 6; block = mb & 0x3F
        prog = d.r8(0x2D63 + cell)
        idx = (bl * 12 + bh) & 0xFF
        byte = d.r8(0x3163 + block * 18 + (idx >> 3))
        solid = (byte & (0x80 >> (idx & 7))) != 0
        return block, di, (bh << 8) | bl, prog, solid

    def fn_585b_dir(self, bx):
        d = self.d
        si = ((d.r16(bx + 0x12CC) & 0xFF) * 0x24) & 0xFFFF
        si += 0x35E3
        ax = d.r16(bx + 0x12CE)
        si += (ax >> 8) >> 1
        cx = (ax & 0xFF) & ~1
        si += 3 * cx
        val = d.r8(si)
        d.w16(bx + 0x12DC, d.r16(bx + 0x12DA)); d.w16(bx + 0x12DA, val)

    def _progress_update(self, bx, cx):
        """[12e1] <- [12e3] <- cx ; [12e5] = 1 ; returns True when the progress is 0xFF (void)."""
        d = self.d
        d.w16(bx + 0x12E1, d.r16(bx + 0x12E3)); d.w16(bx + 0x12E3, cx); d.w16(bx + 0x12E5, 1)
        return d.r16(bx + 0x12E3) == 0xFF

    def _round3_skip(self, bx):
        d = self.d
        return self.round == 3 and d.r16(bx + 0x1388) != 1 and d.r8(0x25CC + d.r16(bx + 0x12CC)) == 1

    def fn_5532_terrain(self, bx):
        d = self.d
        if d.r16(bx + 0x124C) == 0 or d.r16(bx + 0x12AE) != 0: return
        self.candidate(bx)
        x, y = d.r16(bx + 0x125E), d.r16(bx + 0x126A)
        block, di, cell, cx, solid = self.fn_589c_col(x, y)
        d.w16(bx + 0x12CC, block); d.w16(bx + 0x12DE, di); d.w16(bx + 0x12CE, cell); d.w16(bx + 0x12E5, 0)
        self.fn_585b_dir(bx)
        rnd = self.round
        if rnd == 3:
            if solid:
                if (d.r16(bx + 0x12DA) & 0xE0) == 0xE0: return self._not_solid(bx, cx)
                return self._solid(bx, cx)
            if d.r16(bx + 0x12DC) & 0x10:
                if (d.r16(bx + 0x12DA) & 0xF0) == 0: self.fn_683c(bx)
                return self._not_solid(bx, cx)
            if (d.r16(bx + 0x12DA) & 0x10) == 0: return self._not_solid(bx, cx)
            if d.r16(bx + 0x12DA) & 0xA0:
                d.w16(bx + 0x12DC, d.r16(bx + 0x12DA)); return self._not_solid(bx, cx)
            d.w16(bx + 0x12DA, d.r16(bx + 0x12DC))
            if cx != 0 and not self._round3_skip(bx):
                if self._progress_update(bx, cx): return self.respawn(bx)
            d.w16(bx + 0x138A, 1)
            if d.rs16(bx + 0x127A) >= 0x100: d.w16(bx + 0x127A, 0x100)
            return self._solid_tail(bx)
        if not solid: return self._not_solid(bx, cx)
        if rnd == 7:
            t = d.r16(bx + 0x12DA) >> 4
            if t < 8 and t >= 1: return self._not_solid(bx, cx)
        elif rnd in (4, 5):
            if (d.r16(bx + 0x12DA) >> 4) >= 5: return self._not_solid(bx, cx)
        return self._solid(bx, cx)

    def _solid(self, bx, cx):                   # 561d
        d = self.d
        if cx != 0 and not self._round3_skip(bx):
            if self._progress_update(bx, cx): return self.respawn(bx)
        return self._solid_tail(bx)

    def _solid_tail(self, bx):                  # 5659
        d = self.d
        if d.r16(bx + 0x1390) != 0:
            d.add16(bx + 0x13AC, 1)
            if d.rs16(bx + 0x13AC) > 0x32:
                d.w16(bx + 0x13AC, 0); return self.respawn(bx)
        else:
            d.w16(bx + 0x13AC, 0)
            if d.r16(bx + 0x1250) != 0: self.snd(5, 4 if self.round == 2 else 6)
        ax = d.rs16(bx + 0x125C); dx = d.rs16(bx + 0x1268)
        ax -= 8
        if ax <= -1: ax += 0xC00
        if self.fn_589c_col(ax, dx)[4]: d.w16(bx + 0x12C4, 1)
        ax += 0x10
        if ax >= 0xC00: ax -= 0xC00
        if self.fn_589c_col(ax, dx)[4]: d.w16(bx + 0x12C6, 1)
        dx -= 8
        if dx <= -1: dx += 0xC00
        ax -= 8
        if ax <= -1: ax += 0xC00
        if self.fn_589c_col(ax, dx)[4]: d.w16(bx + 0x12C8, 1)
        dx += 0x10
        if ax >= 0xC00: ax -= 0xC00
        if self.fn_589c_col(ax, dx)[4]: d.w16(bx + 0x12CA, 1)
        if not any(d.r16(bx + o) == 1 for o in (0x12C8, 0x12CA, 0x12C4, 0x12C6)):
            d.w16(bx + 0x12C8, 1); d.w16(bx + 0x12C4, 1)
        d.w16(bx + 0x12A8, 1)

    def _not_solid(self, bx, cx):               # 57fb
        d = self.d
        d.w16(bx + 0x12A8, 0); d.w16(bx + 0x12E5, 0)
        if cx != 0 and not self._round3_skip(bx):
            if self._progress_update(bx, cx): return self.respawn(bx)

    def fn_683c(self, bx):
        raise NotImplementedError('fn 683c (round 3 only)')

    # ---------------------------------------------------------------- fn 5be7 collision response + commit
    def fn_5be7_track(self, bx):
        d = self.d
        if d.r16(bx + 0x124C) == 0: return self._5e36(bx)
        if d.r16(bx + 0x12AC) != 0:
            d.w16(bx + 0x12AC, 0); self.candidate(bx)
        self.fn_5532_terrain(bx)
        self.fn_5e4e_progress(bx)
        if d.r16(bx + 0x12FB) != 0 and d.r16(bx + 0x12A8) != 0:
            if d.r16(bx + 0x12EB) != 0:
                d.add16(bx + 0x12AA, 1)
                if d.rs16(bx + 0x12AA) >= 0x14: self.respawn(bx)
            probes = [d.r16(bx + o) for o in (0x12C4, 0x12C6, 0x12C8, 0x12CA)]
            halve = d.r16(bx + 0x138A) != 0
            if not any(probes):
                d.w16(bx + 0x1272, -d.rs16(bx + 0x1272)); d.w16(bx + 0x1276, -d.rs16(bx + 0x1276))
                if halve:
                    d.w16(bx + 0x1272, d.rs16(bx + 0x1272) >> 1); d.w16(bx + 0x1276, d.rs16(bx + 0x1276) >> 1)
            else:
                if probes[0] == 1 or probes[1] == 1:
                    d.w16(bx + 0x1272, -d.rs16(bx + 0x1272))
                    if halve: d.w16(bx + 0x1272, d.rs16(bx + 0x1272) >> 1)
                if probes[2] == 1 or probes[3] == 1:
                    d.w16(bx + 0x1276, -d.rs16(bx + 0x1276))
                    if halve: d.w16(bx + 0x1276, d.rs16(bx + 0x1276) >> 1)
            for o in (0x12C4, 0x12C6, 0x12C8, 0x12CA): d.w16(bx + o, 0)
            self.candidate(bx)
        # 5da1 commit
        st = d.r16(bx + 0x12AE)
        if st in (0x0E, 2, 0):
            d.w16(bx + 0x125C, d.r16(bx + 0x125E)); d.w16(bx + 0x1268, d.r16(bx + 0x126A))
            d.w16(bx + 0x1258, d.r16(bx + 0x125A)); d.w16(bx + 0x1264, d.r16(bx + 0x1266))
            al = d.r8(d.r16(0x28B9) + (d.r16(bx + 0x12CC) & 0x3F))
            d.w8(bx + 0x12E0, al)
            if not (al & 0x80):
                skip = False
                if self.round == 3:
                    v = d.r8(0x25CC + d.r16(bx + 0x12CC))
                    if d.r16(bx + 0x1388) != 1: skip = (v == 1)
                    else: skip = (v == 0)
                if not skip:
                    d.w16(bx + 0x12F5, d.r16(bx + 0x12F1)); d.w16(bx + 0x12F1, d.r16(bx + 0x125C))
                    d.w16(bx + 0x12F7, d.r16(bx + 0x12F3)); d.w16(bx + 0x12F3, d.r16(bx + 0x1268))
        self._5e36(bx)

    def _5e36(self, bx):
        d = self.d
        d.w16(bx + 0x138A, 1)
        if d.r16(0x2919) == 1 or self.round == 7:
            raise NotImplementedError('fn 79fd')

    # ---------------------------------------------------------------- fn 5e4e terrain type, checkpoints, laps
    def _checkpoint_list(self):
        d = self.d
        return d.r16(0x1FEB + (self.round - 1) * 8 + (d.r8(0x28C0) - 1) * 2)

    def fn_5e4e_progress(self, bx):
        d = self.d
        rnd = self.round
        if d.r16(0x2656) == 2:
            a, b = d.r16(0x2660), d.r16(0x2662)
            if d.r16(a + 0x12AE) == 1 and d.r16(b + 0x12AE) == 1: d.w16(0x2913, 1); return
            if d.r16(a + 0x12AE) == 5 and d.r16(b + 0x12AE) == 5: d.w16(0x2913, 1); return
        if d.r16(bx + 0x12AE) != 0: return self._60c0(bx)
        ax = d.r16(bx + 0x12DA)
        shift = 5 if (rnd <= 3 or rnd == 6) else 4
        ax = (ax & 0xFF00) | ((ax & 0xFF) >> shift)
        d.w16(bx + 0x12D2, d.r16(bx + 0x12D0)); d.w16(bx + 0x12D0, ax)
        call = False
        if d.rs16(bx + 0x12D0) < 5:
            call = d.r16(bx + 0x12D6) == 0
        elif rnd in (4, 5):
            call = True
        else:
            call = d.r16(bx + 0x12D6) == 0
        if call:
            self.terrain_handler(bx, d.r16(d.r16(0x28BD) + ax * 2))
        if rnd == 2 and (d.r16(bx + 0x12DA) & 0x18): self.fn_6231_current(bx)
        if self._round3_skip(bx): return self._60c0(bx)
        if d.r16(bx + 0x12E5) == 0: return self._60c0(bx)
        ax = s16(d.r16(bx + 0x12E3) - d.r16(bx + 0x12E1)); cx = d.rs16(0x2654)
        if ax > cx: return self._6078(bx)
        if ax < -cx: return self._5fd0(bx)
        return self._5f41(bx)

    def _5f41(self, bx):
        d = self.d
        si = self._checkpoint_list() + d.r16(bx + 0x12E7)
        ax = d.r16(si)
        if ax == 0xFFFF: return self._60c0(bx)
        lo, hi = ax & 0xFF, ax >> 8
        if d.rs16(bx + 0x12E1) < lo: return self._60c0(bx)
        if d.rs16(bx + 0x12E1) < hi:
            d.add16(bx + 0x12E7, 2); return self._60c0(bx)
        return self._5f85(bx)

    def _5f85(self, bx):
        d = self.d
        if d.r16(0x2656) != 2:
            d.w16(bx + 0x12F1, d.r16(bx + 0x12F5)); d.w16(bx + 0x12F3, d.r16(bx + 0x12F7))
            self.respawn(bx)
            if d.r16(bx + 0x1250) != 0: self.snd(5, 1)
        else:
            d.add16(bx + 0x12E7, 2)
        return self._60c0(bx)

    def _5fd0(self, bx):
        d = self.d
        base = self._checkpoint_list()
        si = base + d.r16(bx + 0x12E7)
        ax = d.r16(si); si += 2
        if ax != 0xFFFF: return self._5f85(bx)
        si = (si - d.r16(bx + 0x12E7) - 2) & 0xFFFF
        ax = d.r16(si)
        if d.rs16(bx + 0x12E3) >= (ax >> 8): return self._5f85(bx)
        # lap completed
        d.add16(bx + 0x12ED, -1)
        if d.r16(0x2656) == 1:
            if d.r16(bx + 0x1250) != 0: self.snd(5, 2)
            if self.round == 2 and d.r8(0x28C0) == 1 and d.rs16(bx + 0x12ED) <= 2 and bx == 0:
                ax = d.rs16(bx + 0x12ED)
                if d.rs16(0x15B5) > ax and d.rs16(0x1451) > ax and d.rs16(0x1719) > ax:
                    d.w16(0x26C6, 2)
        if d.rs16(bx + 0x12ED) < 0: d.w16(bx + 0x12ED, 0)
        d.w16(bx + 0x12E7, d.r16(bx + 0x12E9)); d.w16(bx + 0x12E9, 0)
        return self._60c0(bx)

    def _6078(self, bx):
        d = self.d
        base = self._checkpoint_list(); si = base + d.r16(bx + 0x12E7)
        while True:
            ax = d.r16(si); si += 2
            if ax == 0xFFFF: break
        si = (si - 2 - base) & 0xFFFF
        d.w16(bx + 0x12E9, d.r16(bx + 0x12E7)); d.w16(bx + 0x12E7, si)
        d.add16(bx + 0x12ED, 1)
        if d.rs16(bx + 0x12ED) > 9: d.w16(bx + 0x12ED, 9)
        return self._60c0(bx)

    def _60c0(self, bx):
        if self.round == 2: self.fn_62e3_whirlpool(bx)

    # ---------------------------------------------------------------- terrain handlers ([28bd] table)
    def _vsq(self, bx):
        """(hi8(vx))^2 + (hi8(vy))^2 with 8-bit signed imul, as at 60de."""
        d = self.d
        a = s8(d.r16(bx + 0x1272) >> 8); b = s8(d.r16(bx + 0x1276) >> 8)
        return (a * a + b * b) & 0xFFFF

    def terrain_handler(self, bx, addr):
        d = self.d
        h = {0x35BE: self._h_ret, 0x60CB: self._h_60cb, 0x6169: self._h_6169, 0x618C: self._h_618c,
             0x61B0: self._h_61b0, 0x63D6: self._h_63d6, 0x63DD: self._h_63dd, 0x641A: self._h_641a,
             0x6456: self._h_6456, 0x64F5: self._h_64f5, 0x6768: self._h_6768, 0x67D8: self._h_67d8}
        if addr not in h: raise NotImplementedError(f'terrain handler {addr:04x}')
        h[addr](bx)

    def _h_ret(self, bx): pass

    def _h_60cb(self, bx):
        d = self.d
        d.w16(bx + 0x1390, 0)
        if d.r16(bx + 0x138E) != 0:
            d.w16(bx + 0x138E, 0)
            d.w16(bx + 0x12D4, self._vsq(bx) // 15 + 4)
        if self.round != 1: return
        if d.r16(bx + 0x12D2) == 4:
            d.w16(bx + 0x12D4, self._vsq(bx) // 7 + 4)
        elif d.r16(bx + 0x12D2) == 3:
            d.w16(bx + 0x12D4, self._vsq(bx) // 12 + 4 + 4)

    def _h_6169(self, bx):
        d = self.d
        d.w16(bx + 0x1390, 0); self.respawn(bx); d.w16(bx + 0x1382, 0x46)

    def _h_618c(self, bx):
        d = self.d
        if d.r16(bx + 0x1390) != 1:
            d.w16(bx + 0x1390, 1); return
        d.w16(bx + 0x1390, 2)
        if d.rs16(bx + 0x1272) >= 0: d.add16(bx + 0x1272, 0xC8)

    def _h_61b0(self, bx):
        d = self.d
        if d.r16(bx + 0x138E) != 0:
            d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, self._vsq(bx) // 15 + 4); return
        if self.round == 5:
            skip = d.r16(bx + 0x12D2) == 3
        else:
            skip = d.r16(bx + 0x12D2) == 4
        if not skip:
            d.w16(bx + 0x1272, d.rs16(bx + 0x1272) >> 1); d.w16(bx + 0x1276, d.rs16(bx + 0x1276) >> 1)
            if d.r16(bx + 0x1250) != 0: self.snd(5, 6)
        if d.rs16(bx + 0x127A) >= 0x200:
            d.w16(bx + 0x127A, 0x200); self.snd(0x0A, 6)

    def _h_63d6(self, bx): self.d.w16(bx + 0x128A, 1)

    def _h_63dd(self, bx):
        d = self.d
        if d.r16(bx + 0x12D6) != 0: return
        v = self._vsq(bx)
        if s16(v) < 0x1C: v = 0x1C
        d.w16(bx + 0x12D4, v // 8 + 5); d.w16(bx + 0x12D8, 0)

    def _h_641a(self, bx):
        d = self.d
        if d.r16(bx + 0x12D2) == 6: return
        v = self._vsq(bx)
        if s16(v) < 0xE: return
        if s16(v) < 0x1C: v = 0x1C
        d.w16(bx + 0x12D4, v // 10 + 5)

    def _pull_to_centre(self, bx, shift):
        d = self.d
        if d.r16(bx + 0x12F9) == 0: return
        d.w16(bx + 0x12AE, 1); d.w16(bx + 0x12B0, 0)
        d.w16(bx + 0x125E, (d.r16(bx + 0x125E) & 0xFFF0) + 8)
        d.w16(bx + 0x126A, (d.r16(bx + 0x126A) & 0xFFF0) + 8)
        for cand, cur, out in ((0x125E, 0x125C, 0x12BE), (0x126A, 0x1268, 0x12C0)):
            ax = s16(d.r16(bx + cand) - d.r16(bx + cur))
            if ax >= 0xBE0: ax -= 0xC00
            if ax <= -0xBE0: ax += 0xC00
            d.w16(bx + out, ax >> 2)
        d.w16(bx + 0x12C2, 4)
        for o in (0x1282, 0x1284, 0x1286, 0x1288, 0x1270, 0x1274, 0x1272, 0x1276): d.w16(bx + o, 0)

    def _h_6456(self, bx): self._pull_to_centre(bx, 2)
    def _h_64f5(self, bx): self._pull_to_centre(bx, 2)

    def _h_6768(self, bx):
        d = self.d
        if d.r16(bx + 0x138E) != 0:
            d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, self._vsq(bx) // 15 + 4)
        v = self._vsq(bx)
        if s16(v) < 0xE: return
        if s16(v) < 0x1C: v = 0x1C
        ax = v // 7
        if self.round == 2: ax += 7
        d.w16(bx + 0x12D4, ax)

    def _h_67d8(self, bx):
        d = self.d
        if d.r16(bx + 0x138E) != 0:
            d.w16(bx + 0x138E, 0); d.w16(bx + 0x12D4, self._vsq(bx) // 15 + 4)
        raise NotImplementedError('handler 67d8 tail')

    def fn_6231_current(self, bx):
        d = self.d
        ax = d.r16(bx + 0x12DA); dx = d.r16(bx + 0x12DE); cx = d.r8(bx + 0x12E0)
        if self.round == 2: ax &= 7
        ax &= 0xF
        if dx & 2:
            ax = d.r8(0x191B + ((cx >> 5) & 3) * 16 + ax)
        ax = d.r16(0x18FB + ax * 2)
        if dx & 1: ax ^= 0x80
        si = 0x10A0 + ax
        v = mulfix(d.rs8(si), 0x100)
        if s16(v) > d.rs16(bx + 0x129C): v = d.r16(bx + 0x129C)
        if s16(v) < d.rs16(bx + 0x12A0): v = d.r16(bx + 0x12A0)
        d.add16(bx + 0x1272, v)
        si = si + 1 - 0x41
        if si <= 0x109F: si += 0x100
        v = mulfix(d.rs8(si), 0x100)
        if s16(v) > d.rs16(bx + 0x129C): v = d.r16(bx + 0x129C)
        if s16(v) < d.rs16(bx + 0x12A0): v = d.r16(bx + 0x12A0)
        d.add16(bx + 0x1276, v)
        if d.rs16(bx + 0x127A) >= 0x100: d.w16(bx + 0x127A, 0x100)

    def fn_62e3_whirlpool(self, bx):
        d = self.d
        if d.r16(bx + 0x12AE) != 0: return
        x = d.rs16(bx + 0x125C); y = d.rs16(bx + 0x1268)
        if not (0x614 <= x <= 0x68C and 0xB34 <= y <= 0xBAC): return
        si = x - 0x650
        if si <= -1: si = -si
        cx = ((0x3C - si) * 4 + 0x28)
        si = y - 0xB70
        if si <= -1: si = -si
        cy = ((0x3C - si) * 4 + 5)
        c = cy if cx > cy else cx
        k = c
        if x - 0x650 >= 0: k = -k          # jb (unsigned): x < 0x650 -> keep sign
        d.add16(bx + 0x1272, k)
        k = c
        if y - 0xB70 >= 0: k = -k
        d.add16(bx + 0x1276, k)
        if 0x644 <= x <= 0x65C and 0xB64 <= y <= 0xB7C:
            d.w16(bx + 0x1382, 0x46); d.w16(bx + 0x12AE, 1)
            d.w16(bx + 0x125E, 0x650); d.w16(bx + 0x126A, 0xB70); d.w16(bx + 0x12C2, 4)
            d.w16(bx + 0x12BE, (0x650 - x) >> 2); d.w16(bx + 0x12C0, (0xB70 - y) >> 2)

    # ---------------------------------------------------------------- car-car collisions (fn 5921 / 5960)
    def fn_5921_collisions(self):
        d = self.d
        # 5921 rewrites only one of [27b1]/[27b3] per call: pairs (0,1) (0,2) (0,3) (1,3) (1,2) (3,2). bx is not
        # reloaded between calls: it enters as the last car of the fn 525e loop and leaves each call as A (A inactive
        # or not in state 0/2) or B; fn 5960 recomputes that car's candidate first.
        bx = CARS[-1]
        pairs = ((0x2660, 0x2662), (0x2660, 0x2664), (0x2660, 0x2666), (0x2662, 0x2666), (0x2662, 0x2664),
                 (0x2666, 0x2664))
        for a, b in pairs:
            d.w16(0x27B1, d.r16(a)); d.w16(0x27B3, d.r16(b))
            bx = self.fn_5960_pair(bx)

    def fn_5960_pair(self, bx_entry):
        d = self.d
        self.candidate(bx_entry)                # quirk: recomputes the candidate of whatever bx holds
        A = d.r16(0x27B1); B = d.r16(0x27B3)
        if d.r16(A + 0x124C) == 0: return A
        dx = d.rs16(A + 0x125E); di = d.rs16(A + 0x126A)
        if d.r16(A + 0x12AE) != 2:
            if d.r16(A + 0x12AE) != 0: return A
            if d.r16(B + 0x124C) == 0: return B
            if d.r16(B + 0x12AE) != 2 and d.r16(B + 0x12AE) != 0: return B
        dx -= d.rs16(B + 0x125E); di -= d.rs16(B + 0x126A)
        if dx >= 0xBF0: dx -= 0xC00
        if dx <= -0xBF0: dx += 0xC00
        if di >= 0xBF0: di -= 0xC00
        if di <= -0xBF0: di += 0xC00
        if dx > 0x10 or dx < -0x10 or di > 0x10 or di < -0x10: return B
        dx = ((dx + 0x10) & 0xFFFF) >> 1; di = ((di + 0x10) & 0xFFFF) >> 1
        di = di * 17 + dx + 0x17DA
        if di >= 0x18FB: return B
        n = d.r8(di)
        if n == 0: return B
        if d.r16(A + 0x12AE) == 2 or d.r16(B + 0x12AE) == 2:
            d.w16(A + 0x12AC, 1); d.w16(A + 0x1272, 0x40); d.w16(A + 0x1276, 0x40)
            d.w16(B + 0x12AC, 1); d.w16(B + 0x1272, 0xFFC0); d.w16(B + 0x1276, 0xFFC0)
            return B
        cx = s16(d.r16(A + 0x1272) - d.r16(B + 0x1272)); dvy = s16(d.r16(A + 0x1276) - d.r16(B + 0x1276))
        si = 0x10A0 + n
        sin = d.rs8(si); si += 1
        si -= 0x41
        if si <= 0x109F: si += 0x100
        cos = d.rs8(si)
        imp = s16(mulfix(cx, sin)) - s16(mulfix(dvy, cos))
        imp = s16(imp)
        if imp <= 0x1F4: imp = 0x1F4
        if self.round == 6 and imp > 0x1F4:
            if d.r16(A + 0x1250) != 0:
                self.respawn(A); self.snd(5, 1)
                if d.r16(B + 0x1250) != 0: self.respawn(B); self.snd(5, 1)
        ix = mulfix(imp, sin); iy = mulfix(imp, cos)
        d.w16(A + 0x12AC, 1); d.add16(A + 0x1272, -ix); d.add16(A + 0x1276, -iy)
        d.w16(B + 0x12AC, 1); d.add16(B + 0x1272, ix); d.add16(B + 0x1276, iy)
        if d.r16(B + 0x1250) != 0: self.snd(5, 3)
        return B

    # ---------------------------------------------------------------- camera (4fd1..51b0)

    def _camera(self):
        d = self.d
        bx = d.r16(0x27B7 + d.r16(0x27B5) * 2)
        if bx != 1:
            ax = s16(d.r16(bx + 0x125C) - d.r16(bx + 0x1262))
            if ax <= -1: ax += 0xC00
            d.w16(0x2646, ax)
            ax = s16(d.r16(bx + 0x1268) - d.r16(bx + 0x126E))
            if ax <= -1: ax += 0xC00
            d.w16(0x2648, ax)
        else:
            a, b = d.r16(0x2660), d.r16(0x2662)
            cx = d.rs16(b + 0x125C); ax = s16(d.r16(a + 0x125C) - cx)
            if ax >= 0xB18: ax -= 0xC00
            if ax <= -0xB18: ax += 0xC00
            if ax > 0xE8 or ax < -0xE8:
                if d.r16(0x2911) != 2: d.w16(0x2911, 1)
            else:
                ax = (ax >> 1) + cx - 0x80
                cy = d.rs16(b + 0x1268); dx = s16(d.r16(a + 0x1268) - cy)
                if dx >= 0xB50: dx -= 0xC00
                if dx <= -0xB50: dx += 0xC00
                if dx > 0xB0 or dx < -0xB0:
                    if d.r16(0x2911) != 2: d.w16(0x2911, 1)
                else:
                    dx = (dx >> 1) + cy - 0x64
                    if ax <= -1: ax += 0xC00
                    if ax >= 0xC00: ax -= 0xC00
                    if dx <= -1: dx += 0xC00
                    if dx >= 0xC00: dx -= 0xC00
                    d.w16(0x2646, ax); d.w16(0x2648, dx)
        for o in (0x137E, 0x14E2, 0x1646, 0x17AA): d.w16(o, 0)
        for tgt, cam, step in ((0x2646, 0x264A, 0x264E), (0x2648, 0x264C, 0x2650)):
            cx = d.rs16(step)
            ax = s16(d.r16(tgt) - d.r16(cam)); dx = ax
            if ax <= -1: ax = -ax
            if ax > 0x3E8 or ax <= cx:
                d.w16(step, 0x32)
            else:
                ax = cx
                if dx <= -1: ax = -ax
                dx = ax
            d.add16(cam, dx)
        if d.r16(0x2650) == 0x32 and d.r16(0x264E) == 0x32:
            for o in (0x137E, 0x14E2, 0x1646, 0x17AA): d.w16(o, 1)

    # ---------------------------------------------------------------- render-pass side effects (fn 90c5)
    def fn_7d73_visibility(self, bx):
        """Car sprite draw: sets [1250] = drawn. Rounds 1-8 (24x24); round 9 handled for car 0 only."""
        d = self.d
        if d.r16(0x2621) == bx: d.w16(bx + 0x1250, 0); return
        d.w16(bx + 0x1250, 1)
        dx = 0 if self.round == 8 else d.rs16(bx + 0x12D6)
        di = d.rs16(bx + 0x125C) - dx; ax = d.rs16(bx + 0x1268) - dx
        if self.round == 9:
            if bx != 0: return
            di -= d.rs16(0x264A)
            if di <= -4: di += 0xC00
            ax -= d.rs16(0x264C)
            if ax <= -4: ax += 0xC00
            ax -= 0x14; di -= 0x14; w = 0x28
        else:
            di -= d.rs16(0x264A)
            if di <= -0xC: di += 0xC00
            ax -= d.rs16(0x264C)
            if ax <= -0xC: ax += 0xC00
            ax -= 0xC; di -= 0xC; w = 0x18
        x, y = s16(di), s16(ax)
        clipped = False
        if x < 0:
            if x + w <= 0: clipped = True
        elif x >= 0x100: clipped = True
        if not clipped:
            if y < 0:
                if y + w <= 0: clipped = True
            elif y >= 0xE0: clipped = True
        if clipped: d.w16(bx + 0x1250, 0)

    def fn_8dfc_ranking(self):
        """HUD/ranking: race score per car (leader list order), bubble sort of the leader list, rank -> [12ef]."""
        d = self.d
        rnd = self.round
        if rnd == 9 or d.r16(0x2656) == 2: raise NotImplementedError('ranking for round 9 / head to head')
        cl = d.r16(0x2652) & 0xFF
        for si in range(0, 8, 2):
            bx = d.r16(0x2678 + si)
            if d.rs16(bx + 0x12ED) > 0 and d.rs16(0x26C6) < 2:
                ax = ((9 - d.r16(bx + 0x12ED)) & 0xFF) * cl
                d.w16(0x2670 + si, ax + d.r16(bx + 0x12E3))
            else:
                for o in (0x2670, 0x2672, 0x2674, 0x2676): d.w16(o, 0x7D00)
        for _ in range(3):
            for bx in (0, 2, 4):
                ax = d.rs16(bx + 0x2670); dx = d.rs16(bx + 0x2672)
                if ax < dx:
                    d.w16(bx + 0x2670, dx); d.w16(bx + 0x2672, ax)
                    a2 = d.r16(bx + 0x2678); d.w16(bx + 0x2678, d.r16(bx + 0x267A)); d.w16(bx + 0x267A, a2)
        for i, o in enumerate((0x2678, 0x267A, 0x267C, 0x267E)):
            d.w16(d.r16(o) + 0x12EF, i + 1)

    def render_side_effects(self):
        """State changes made by fn 90c5 (renderer) that the physics reads back."""
        d = self.d
        if self.round == 2: d.add16(0x26D1, 1)                 # fn 89e0 water colour cycling counter
        elif self.round == 8: raise NotImplementedError('fn 8a2b counter')
        for bx in CARS:
            self.fn_8386_skids(bx); self.fn_8083_tracks(bx)
        for bx in CARS:
            if d.r16(bx + 0x13A4) != 0: self.fn_8712_particles(bx)
        for bx in CARS:
            if d.r16(bx + 0x12AE) == 0x0E or d.r16(bx + 0x124C) != 0:
                st = d.r16(bx + 0x12AE)
                if st in (0, 0x0B, 0x0C): self.fn_7d73_visibility(bx)
                elif st == 0x0A: self.fn_849b_countdown(bx)
                elif st == 0x0D or st == 2: self.fn_82be_respawn(bx)
                elif st == 7: self.fn_6feb_reappear(bx)
                elif st == 1: self.fn_880a_pulled(bx)
                else:
                    raise NotImplementedError(f'state handler for state {st:#x}')
        self.fn_8dfc_ranking()

    def fn_849b_countdown(self, bx):
        """State 0x0A: start-line countdown. Car 0 advances [26d5] by the smoothness value per step."""
        d = self.d
        d.w16(0x26CA, 1)
        car0 = d.r16(0x2660)
        if d.r16(0x2656) != 2 and bx != car0:
            if d.r16(0x12AE) == 0x0A: return self.fn_7d73_visibility(bx)
            d.w16(bx + 0x12AE, 0); return
        cx = d.r16(0x263A)
        if bx == car0: d.add16(0x26D5, cx)
        if d.rs16(0x26D5) >= 0x60:
            for o in (0x12AE, 0x1412, 0x1576, 0x16DA): d.w16(o, 0)
            d.w16(0x264E, 0x32); d.w16(0x2650, 0x32); d.w16(0x26CA, 0)
        elif d.r8(0x26CF) == 1:
            return
        self.fn_7d73_visibility(bx)
        if bx == car0 and d.r16(bx + 0x1250) != 0: self.snd(5, 9)

    def fn_880a_pulled(self, bx):
        """State 1: car captured (whirlpool / pulled to a cell centre): animation from the per-round frame
        tables, then state 7."""
        d = self.d
        d.w16(bx + 0x127A, 0)
        rnd = self.round
        if rnd in (9, 4):
            h = d.r16(bx + 0x1278) & 0xF8
            if h == 0:
                if d.r16(bx + 0x12C2) != 0: return self.fn_7d73_visibility(bx)
                base, stride = 0x27C1, 0x0E
            elif h == 0x80:
                if d.r16(bx + 0x12C2) != 0: return self.fn_7d73_visibility(bx)
                base, stride = 0x27DD, 0x0E
            else:
                if h < 0x40 or (0x80 < h <= 0xC0): d.add16(bx + 0x1278, -4)
                else: d.add16(bx + 0x1278, 4)
                return self.fn_7d73_visibility(bx)
        else:
            if d.r16(bx + 0x12C2) != 0: return self.fn_7d73_visibility(bx)
            base, stride = (0x2835, 0x10) if rnd == 2 else (0x27F9, 0x1E)
        si = base + d.r16(bx + 0x12B6) * 2
        ax = d.r16(si); frame = d.r16(si + stride)
        if frame == 0xFFFF:
            d.w16(bx + 0x12B6, 0); d.w16(bx + 0x12AE, 7); d.w16(bx + 0x12B0, 0); return
        # frame != -2: fn 7fe8 / 8034 draw the animation frame (no data-segment writes)
        if d.rs16(bx + 0x12B0) < s16(ax): return
        d.add16(bx + 0x12B6, 1)
        if rnd in (4, 9, 2):
            if d.r16(bx + 0x12B6) == 4 and d.r16(bx + 0x1250) != 0: self.snd(5, 0x11)
        elif d.r16(bx + 0x12B6) == 8 and d.r16(bx + 0x1250) != 0: self.snd(5, 7)

    def fn_82be_respawn(self, bx):
        """States 2 and 0x0D: respawn animation driven by the duration table at ds:289d."""
        d = self.d
        si = 0x289D + d.r16(bx + 0x12B8) * 2
        ax = d.r16(si); frame = d.r16(si + 0x0E)
        if frame == 0xFFFE:
            pass
        elif frame == 0xFFFF:
            d.w16(bx + 0x12B8, 0); d.w16(bx + 0x12B0, 0)
            if d.r16(bx + 0x12AE) == 0x0D: d.w16(bx + 0x12AE, 7)
            else:
                d.w16(bx + 0x12AE, 0); d.w16(0x2911, 0); self.fn_7d73_visibility(bx)
            d.w16(bx + 0x12AA, 0); return
        else:
            if d.r16(bx + 0x12AE) != 2:
                if d.rs16(bx + 0x12B8) <= 3: self.fn_7d73_visibility(bx)
            elif d.rs16(bx + 0x12B8) >= 3: self.fn_7d73_visibility(bx)
        if d.rs16(bx + 0x12B0) >= s16(ax): d.add16(bx + 0x12B8, 1)
        d.w16(bx + 0x12AA, 0)

    def fn_6feb_reappear(self, bx):
        """State 7: place the car back on the track at the centre of its last safe 96x96 block, facing the
        block's LEV direction, then hand over to the respawn animation (state 2 / 0x0E)."""
        d = self.d
        if self.round in (2, 8):
            d.add16(bx + 0x1382, -1)
            if d.rs16(bx + 0x1382) > 0: return
        if d.r8(0x28C1) == 0x16 and d.r16(bx + 0x12CC) == 4: d.add16(bx + 0x12F3, -0x60)
        if d.r16(0x2656) == 2:
            di = d.r16(bx + 0x138C)
            for o in (0x268A, 0x2686, 0x2688, 0x2684): d.w16(di + o, 0)
        d.w16(bx + 0x129C, d.r16(bx + 0x129E))
        for o in (0x127A, 0x1272, 0x1270, 0x125A, 0x1258, 0x1276, 0x1274, 0x1266, 0x1264, 0x12D0, 0x12D2, 0x12DA, 0x12DC):
            d.w16(bx + o, 0)
        x = (d.r16(bx + 0x12F1) // 0x60) * 0x60 + 0x30; y = (d.r16(bx + 0x12F3) // 0x60) * 0x60 + 0x30
        d.w16(bx + 0x125C, x); d.w16(bx + 0x1268, y)
        block, di, cell, prog, solid = self.fn_589c_col(x, y)
        lev = d.r8(d.r16(0x28B9) + block)
        si = 0x1FCB + (lev & 0x1C); cx = (lev >> 5) & 3
        x = self.wrap_pos(d.rs16(si) + x); y = self.wrap_pos(d.rs16(si + 2) + y)
        d.w16(bx + 0x125C, x); d.w16(bx + 0x125E, x); d.w16(bx + 0x1268, y); d.w16(bx + 0x126A, y)
        block, di, cell, prog, solid = self.fn_589c_col(x, y)
        d.w16(bx + 0x12E3, prog); d.w16(bx + 0x12E1, prog); d.w16(bx + 0x12CC, block)
        lst = self._checkpoint_list(); c2 = 0
        while True:
            v = d.r16(lst + c2)
            if (prog & 0xFF) < (v & 0xFF): break
            c2 += 2
        d.w16(bx + 0x12E7, c2)
        if block == 0x1A: d.w16(bx + 0x1388, 0)
        d.w16(bx + 0x12DE, di); d.w16(bx + 0x12CE, cell)
        ax = {0: 0x40, 1: 0x80, 2: 0x60, 3: 0xA0}.get(cx, None)
        if ax is None: raise NotImplementedError('fn 6feb heading for lev variant')
        if di & 2: ax ^= 0x80
        if di & 1: ax ^= 0x80
        d.w16(bx + 0x1278, ax)
        # 71b8: nudge 12 px along the heading (player: forward, others: backward)
        si = d.r16(bx + 0x1278) & 0xF8
        if bx == d.r16(0x2660):
            si += 0x40
            if si >= 0x100: si -= 0x100
        else:
            si -= 0x40
            if si <= -1: si += 0x100
        si += 0x10A0
        x = s16(mulfix(d.rs8(si), 0xC)) + d.rs16(bx + 0x125C)
        si = si + 1 - 0x41
        if si <= 0x109F: si += 0x100
        y = s16(mulfix(d.rs8(si), 0xC)) + d.rs16(bx + 0x1268)
        x = self.wrap_pos(x); y = self.wrap_pos(y)
        d.w16(bx + 0x125C, x); d.w16(bx + 0x125E, x); d.w16(bx + 0x1268, y); d.w16(bx + 0x126A, y)
        d.w16(bx + 0x12AE, 2)
        d.w16(bx + 0x12BA, x); d.w16(bx + 0x12BC, y)
        d.w16(bx + 0x1380, 1); d.w16(bx + 0x137E, 0)
        for o in (0x12B6, 0x12B8, 0x12B0, 0x12D6, 0x12D4): d.w16(bx + o, 0)
        d.w16(bx + 0x12D8, 1)
        for o in (0x1282, 0x1284, 0x1286, 0x128C, 0x1288, 0x128A): d.w16(bx + o, 0)
        d.w16(bx + 0x128E, 0xFFE2); d.w16(bx + 0x1290, 0x14); d.w16(bx + 0x1292, 0x1E); d.w16(bx + 0x1294, 0xFFEC)
        for o in (0x1270, 0x1274, 0x1272, 0x1276): d.w16(bx + o, 0)
        d.w16(bx + 0x138A, 1)
        di = d.r16(bx + 0x138C); d.w16(di + 0x268A, 0)
        d.w16(bx + 0x1382, 0)
        for o in (0x26BC, 0x26C2, 0x26BE, 0x26C0): d.w16(o, 0)
        if d.r16(bx + 0x1250) != 0: self.snd(5, 9)
        d.w16(bx + 0x1296, 0); d.w16(bx + 0x1298, 0); d.w16(bx + 0x1384, 0)
        d.w16(bx + 0x12B2, 0); d.w16(bx + 0x12B4, 0)
        for o in range(0x12FD, 0x12FD + 0x60, 2): d.w16(bx + o, 0xFFFF)
        for o in range(0x135D, 0x135D + 0x1E, 2): d.w16(bx + o, 0xFFFF)
        d.w16(0x264E, 8); d.w16(0x2650, 8)
        self.fn_585b_dir(bx); self.fn_585b_dir(bx)
        if self.round in (4, 5):
            ax = d.r16(bx + 0x12DA) >> 4
            if ax >= 5:
                if ax == 0x0D: d.w16(bx + 0x138E, 0xFFFF)
                elif ax == 0x0E: d.w16(bx + 0x138E, 4)
                else: d.w16(bx + 0x138E, ax - 4)
        if d.r16(0x2656) == 2:
            a, b = d.r16(0x2660), d.r16(0x2662)
            m = min(d.rs16(a + 0x12ED), d.rs16(b + 0x12ED))
            d.w16(a + 0x12ED, m); d.w16(b + 0x12ED, m)

    def fn_8386_skids(self, bx):
        """Skid-mark ring (5 x 6 B at [135d]): age the entries, emit a new one when [128c] is set.
        Quirk kept from the original: the new entry is always written to slot 0 although the index advances."""
        d = self.d
        if d.rs16(bx + 0x1298) > 0:
            for dx in range(0, 0x1E, 6):
                p = bx + dx
                if d.r16(p + 0x1361) == 0xFFFF: continue
                if d.rs16(bx + 0x12B2) > 0: continue
                d.add16(p + 0x1361, 1)
                if d.rs16(p + 0x1361) >= 5: d.w16(p + 0x1361, 0xFFFF)
        if d.r16(bx + 0x128C) == 0 or d.rs16(bx + 0x12B4) > 0: return
        d.w16(bx + 0x12B4, 6); d.w16(bx + 0x128C, 0)
        d.w16(bx + 0x135D, d.r16(bx + 0x125C)); d.w16(bx + 0x135F, d.r16(bx + 0x1268)); d.w16(bx + 0x1361, 0)
        d.add16(bx + 0x1298, 6)
        if d.r16(bx + 0x1298) >= 0x1E: d.add16(bx + 0x1298, -0x18)
        d.w16(bx + 0x12B4, 6)

    def fn_8083_tracks(self, bx):
        """Tyre-track ring (8 x 12 B at [12fd]): age entries, emit a pair of points behind the wheels."""
        d = self.d
        if d.rs16(bx + 0x1296) > 0:
            for dx in range(0, 0x60, 12):
                p = bx + dx
                if d.r16(p + 0x1305) == 0xFFFF: continue
                if d.rs16(bx + 0x12B2) < 1:
                    d.add16(p + 0x1305, 1)
                    if d.rs16(p + 0x1305) > 7: d.w16(p + 0x1305, 0xFFFF)
        if d.rs16(bx + 0x12B2) >= 1: return
        d.w16(bx + 0x12B2, 3)
        if d.r16(bx + 0x1284) == 0:
            if d.r16(bx + 0x1288) == 0:
                if d.r16(bx + 0x128A) == 0: return
                d.w16(bx + 0x128A, 0); img = 0x3FE3
            else:
                d.w16(bx + 0x1288, 0); img = 0x41E3
        else:
            if d.r16(bx + 0x1272) == 0 and d.r16(bx + 0x1276) == 0: return
            img = 0x43E3
        def point(off_a, off_b, delta):
            x = d.rs16(bx + 0x125C); y = d.rs16(bx + 0x1268)
            if self.round == 2:
                ang = (d.r16(bx + 0x1278) + d.r16(bx + off_a)) & 0xFF
                v = (d.r16(bx + off_a) + d.r16(bx + off_b)) & 0xFFFF
                d.w16(bx + off_a, v)
                if v > 0x7FFF: v = (-v) & 0xFFFF
                if s16(v) > 0x1D: d.w16(bx + off_b, -d.rs16(bx + off_b))
            else:
                ang = (d.r16(bx + 0x1278) + delta) & 0xFFFF
            a = (ang + 0x80) & 0xFF
            x = (x + (d.rs8(0x10A0 + a) >> 4)) & 0xFFFF
            y = y + (d.rs8(0x10A0 + ((a - 0x40) & 0xFF)) >> 4)
            if x > 0x7FFF: x = (x + 0xC00) & 0xFFFF
            if s16(x) > 0xBFF: x = (x - 0xC00) & 0xFFFF
            if y < -0xB: y += 0xC00
            if y > 0xBFF: y -= 0xC00
            return x, y & 0xFFFF
        slot = bx + d.r16(bx + 0x1296)
        x, y = point(0x128E, 0x1290, -0x1E)
        d.w16(slot + 0x12FD, x); d.w16(slot + 0x12FF, y); d.w16(slot + 0x1305, 0); d.w16(slot + 0x1307, img)
        x, y = point(0x1292, 0x1294, 0x1E)
        d.w16(slot + 0x1301, x); d.w16(slot + 0x1303, y)
        d.add16(bx + 0x1296, 12)
        if d.r16(bx + 0x1296) > 0x5F: d.add16(bx + 0x1296, -0x54)
        d.w16(bx + 0x12B2, 3)

    def fn_8712_particles(self, bx):
        d = self.d
        if d.r16(bx + 0x1394) != 0:
            if d.r16(bx + 0x1396) < 5: d.add16(bx + 0x1396, 1)
        d.add16(bx + 0x13A4, -1)
        if d.r16(bx + 0x13A4) == 0: d.w16(bx + 0x1394, 0)

    # ---------------------------------------------------------------- post-render per car (7429 / 73e7 / 51b2)
    def fn_7429_jump(self, bx):
        d = self.d
        if self.round == 9 and d.r16(0x26CA) == 0:
            d.add16(0x26C8, -1)
            if d.r16(0x26C8) == 0:
                if d.r16(bx + 0x1250) != 0: self.snd(5, 0x0F)
                d.w16(0x26CA, 1); d.w16(0x12AE, 0x10)
        if d.rs16(bx + 0x12B2) > 0: d.add16(bx + 0x12B2, -1)
        if d.rs16(bx + 0x12B4) > 0: d.add16(bx + 0x12B4, -1)
        if d.r16(bx + 0x124C) == 0: return
        if d.rs16(bx + 0x12D6) > 0:
            d.add16(bx + 0x12D6, d.rs16(bx + 0x12D4) >> 2)
            d.add16(bx + 0x12D4, -1)
            if d.rs16(bx + 0x12D6) > 0: return
            if self.round == 2: d.w16(bx + 0x128C, 1)
            if d.r16(bx + 0x1384) != 0:
                self.respawn(bx); d.w16(bx + 0x1384, 0)
            if d.r16(bx + 0x12D8) != 0:
                d.w16(bx + 0x12D4, -d.rs16(bx + 0x12D4))
                d.add16(bx + 0x12D4, -d.rs16(0x24FF + self.round * 2))
            else:
                d.w16(bx + 0x12D4, 0); d.w16(bx + 0x12D6, 0); d.w16(bx + 0x12D8, 1)
            if d.r16(0x0F64) == 1 and d.r16(bx + 0x1250) != 0:
                self.snd(5, 7 if self.round == 2 else 4)
            return
        if d.rs16(bx + 0x12D4) > 0:
            d.add16(bx + 0x12D6, d.r16(bx + 0x12D4) >> 2)
            d.add16(bx + 0x12D4, -1)
            if d.r16(0x0F64) == 1 and d.r16(bx + 0x1250) != 0:
                self.snd(5, 7 if self.round == 2 else 4)
            return
        d.w16(bx + 0x12D6, 0)
        if d.r16(0x2656) != 2: return
        raise NotImplementedError('head-to-head finish (fn 7429 75d2)')

    def fn_73e7_knockback(self, bx):
        d = self.d
        if self.round == 9 and bx != 0: return
        d.add16(bx + 0x12B0, 1)
        if d.r16(bx + 0x12AE) in (1, 4, 5) and d.r16(bx + 0x12C2) != 0:
            d.add16(bx + 0x12C2, -1)
            d.add16(bx + 0x125C, d.r16(bx + 0x12BE)); d.add16(bx + 0x1268, d.r16(bx + 0x12C0))

    def fn_51b2_particles(self, bx):
        d = self.d
        if d.r16(bx + 0x13A4) == 0: return
        d.add16(bx + 0x13A4, -1)
        if d.r16(bx + 0x13A4) < 0x28: return
        if d.r16(bx + 0x1396) < 5: d.add16(bx + 0x1396, 1)
        for pos, vel in ((0x1398, 0x13A0), (0x139C, 0x13A2)):
            ax = d.r16(bx + vel); cx = d.r16(bx + pos)
            for _ in range(6):
                ax, cx = self._fn_87f3(ax, cx)
            ax = (ax & 0xF0FF) | (d.r16(bx + vel) & 0xF00)
            d.w16(bx + vel, ax)
            d.w16(bx + pos, cx + s8(((ax >> 8) & 0xF) - 8))
        if d.r16(bx + 0x139A) != 0:
            d.add16(bx + 0x139A, -1); d.add16(bx + 0x139E, -1)

    @staticmethod
    def _fn_87f3(ax, cx):
        al, ah = ax & 0xFF, (ax >> 8) & 0xF0
        if al & 0x80:
            al = (-al) & 0xFF
            r = ah - al
            if r < 0: cx = (cx - 1) & 0xFFFF
            ah = r & 0xFF
            al = (-al) & 0xFF
        else:
            r = ah + al
            if r > 0xFF: cx = (cx + 1) & 0xFFFF
            ah = r & 0xFF
        return (ah << 8) | al, cx

    # ---------------------------------------------------------------- one logic step (fn 3039 body)
    def race_loop_init(self):
        """fn 3039 prologue (3055..3064): run once when the race loop starts."""
        d = self.d
        d.w16(0x2621, 0xFFFF); d.w16(0x2638, d.r16(0x263A))

    def step(self, keys1, keys2=0):
        """One iteration of the fn 3039 loop body (a logic step). The game runs [263a] of these per displayed frame."""
        d = self.d
        self.fn_2d5b_input(keys1, keys2)
        if d.r8(0x107C) & 2: raise NotImplementedError('cheat scan fn 35f0')
        self.fn_4aee()
        if d.rs16(0x26C6) >= 2 and (d.r16(0x2656) == 2 or d.r16(0x26CC) - 1 == 0):
            raise NotImplementedError('race end sequence (30df)')
        if d.rs16(0x26C6) >= 2: d.add16(0x26CC, -1)
        if d.r16(0x2638) == 1: self.render_side_effects()          # fn 90c5 draws only on the last step of a frame
        for bx in CARS:
            self.fn_7429_jump(bx)
            if d.r16(bx + 0x12AE) != 0: self.fn_73e7_knockback(bx)
            self.fn_51b2_particles(bx)
        d.add16(0x2638, -1)
        if d.r16(0x2638) == 0: d.w16(0x2638, d.r16(0x263A))       # frame presented here (fn 92bc)
