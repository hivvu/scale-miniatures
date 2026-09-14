#!/usr/bin/env python3
"""Ground-truth driver: run MICRONCC.EXE under the DOSBox-X debugger, break once per game tick
(fn 2d5b = per-frame input poll), poke inputs, dump VRAM / memory. No screen needed.
usage: gt_frame.py <conf> <workdir> <outdir>
"""
import os, sys, time, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbg_drive import Debugger
from mm import io as mmio, palette
from PIL import Image

# Load segment of MICRONCC.EXE under DOSBox-X. 0x822 with the plain conf; a conf with a Sound Blaster puts
# BLASTER=... in the DOS environment, which pushes it to 0x824, so the sound captures set MM_LOAD_SEG=824.
LOAD = int(os.environ.get('MM_LOAD_SEG', '822'), 16)
def seg(rel): return (LOAD + rel) & 0xFFFF
DS = seg(0x93C); VH = seg(0x4D78); VH2 = seg(0x5D78); WORK = seg(0x6D78)

def vram_png(path_bin, pal_file, out_png):
    d = open(path_bin, 'rb').read()[:64000]
    pal = palette.decode_palette(mmio.read(pal_file)).to_pil_flat()
    img = Image.frombytes('P', (320, 200), d); img.putpalette(pal)
    img.convert('RGB').resize((640, 400), Image.NEAREST).save(out_png)

class Game:
    def __init__(self, conf, work, out):
        self.out = out; os.makedirs(out, exist_ok=True)
        self.d = Debugger(conf, work)
        self.tick_bp = 0x489C                      # int 8 handler = one break per game tick (70 Hz)
        self.d.cmd(f'BP {seg(0):04X}:{self.tick_bp:04X}')
        self.tick = 0
    def frames(self, n):
        for _ in range(n):
            if not self.d.run(30, marker=f'{seg(0):04X}:0000{self.tick_bp:04X}'.encode()): raise RuntimeError(f'tick breakpoint not hit within 30 s at tick {self.tick}')
            self.tick += 1
    def use_breakpoint(self, addr):
        """Switch the stepping breakpoint (0x489C = int 8 tick, 0x3067 = top of the race loop iteration)."""
        self.d.cmd('BPDEL *'); self.tick_bp = addr; self.d.cmd(f'BP {seg(0):04X}:{addr:04X}')
    def poke(self, off, *vals):
        self.d.cmd(f'SM {DS:04X}:{off:04X} ' + ' '.join(f'{v:02X}' for v in vals))
    def hold(self, byte, n):          # hold P1 input byte for n ticks ([107d] = keyboard set 1)
        for _ in range(n):
            self.poke(0x107D, byte); self.frames(1)
    def release(self, n=2):
        self.hold(0, n)
    def key(self, scancode):          # raw last-make scancode ([107e]) for Return-driven screens
        self.poke(0x107E, scancode); self.frames(1)
    def vram(self, name, pal):
        p = os.path.join(self.out, name + '.bin'); self.d.memdump(0xA000, 0, 0xFA00, p)
        vram_png(p, pal, os.path.join(self.out, name + '.png')); return p
    def dump(self, sg, off, n, name):
        return self.d.memdump(sg, off, n, os.path.join(self.out, name))

if __name__ == '__main__':
    conf, work, out = sys.argv[1:4]
    g = Game(conf, work, out)
    t0 = time.time()
    g.frames(1); print('first tick', time.time() - t0)
    g.vram('01_first', 'INTRO.PAL')
    g.frames(5); g.vram('02_options', 'INTRO.PAL')
    g.key(0x1C); g.frames(20); g.vram('03_after_return', 'INTRO.PAL')
    g.key(0x1C); g.frames(20); g.vram('04_after_return2', 'INTRO.PAL')
    g.hold(0x80, 3); g.release(3); g.vram('05_left', 'INTRO.PAL')
    g.hold(0x08, 3); g.release(3); g.frames(20); g.vram('06_fire', 'INTRO.PAL')
    print('ticks', g.tick, 'elapsed', time.time() - t0)
    g.d.close()
