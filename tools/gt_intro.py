#!/usr/bin/env python3
"""Ground truth for the intro (SM.EXE): break once per animation frame at cs:097f and dump VRAM.

SM.EXE is a plain MZ, no relocations, cs = ds = the load segment, and it draws straight into A000 while
waiting for the vertical retrace, so one break at the top of fn 097f is one frame of the intro.

usage: gt_intro.py <conf> <workdir> <outdir> [frames]
"""
import os, re, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbg_drive import Debugger
from mm import io as mmio, palette
from PIL import Image

MAIN = 0x097F          # top of the intro's per-frame loop
OPEN = 0x3D            # int 21 ah=3d: SM.EXE opens gfx1.gfx first


def png(binpath, pal_flat, out):
    d = open(binpath, 'rb').read()[:64000]
    img = Image.frombytes('P', (320, 200), d)
    img.putpalette(pal_flat)
    img.convert('RGB').resize((640, 400), Image.NEAREST).save(out)


CONF = """[sdl]
output=surface
[dosbox]
machine=vgaonly
memsize=16
[cpu]
core=normal
cycles=fixed 20000
[render]
aspect=false
scaler=none
[autoexec]
mount c {work}
c:
SM.EXE
"""


def write_conf(path, work):
    """The other ground-truth confs are hand-made in build/; this one is small enough to generate."""
    with open(path, 'w') as f:
        f.write(CONF.format(work=os.path.abspath(work)))


def main():
    conf, work, out = sys.argv[1:4]
    if not os.path.exists(conf):
        write_conf(conf, work)
        print('wrote', conf)
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 200
    os.makedirs(out, exist_ok=True)
    d = Debugger(conf, work)
    d.cmd(f'BPINT 21 {OPEN:02X}')
    # the code pane's top line at the break is the int 21 in fn 0d63, so it names SM.EXE's own segment
    if not d.run(90, marker=b':00000D6D'):
        raise SystemExit('SM.EXE never opened a file')
    m = re.search(r'([0-9A-F]{4}):00000D6D', d.text(d.all[-40000:]))
    if not m:
        raise SystemExit('could not read SM.EXE load segment')
    base = int(m.group(1), 16)
    print('SM.EXE load segment', hex(base)); sys.stdout.flush()
    d.cmd('BPDEL *')
    d.cmd(f'BP {base:04X}:{MAIN:04X}')
    marker = f'{base:04X}:0000{MAIN:04X}'.encode()
    pal = None
    log = []
    t0 = time.time()
    for f in range(n):
        if not d.run(40, marker=marker):
            print('loop breakpoint missed at frame', f); break
        if pal is None:                                   # the palette SM.EXE set with int 10 ax=1012
            p = d.memdump(base, 0x36C, 0x300, os.path.join(out, 'intro_pal.bin'))
            raw = open(p, 'rb').read()
            pal = bytes(min(255, v * 4) for v in raw)
        d.memdump(0xA000, 0, 0xFA00, os.path.join(out, f'vram_{f:04d}.bin'))
        d.memdump(base, 0x2B0, 0x240, os.path.join(out, f'state_{f:04d}.bin'))
        log.append(f)
        if f % 10 == 0:
            png(os.path.join(out, f'vram_{f:04d}.bin'), pal, os.path.join(out, f'frame_{f:04d}.png'))
            print('frame', f, round(time.time() - t0)); sys.stdout.flush()
    json.dump({'base': base, 'frames': log}, open(os.path.join(out, 'intro.json'), 'w'))
    print('done', len(log), 'frames', round(time.time() - t0))
    d.close()


if __name__ == '__main__':
    main()
