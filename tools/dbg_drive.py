#!/usr/bin/env python3
"""Drive the DOSBox-X debugger through a pseudo-terminal (no screen needed).
usage as a library:  d = Debugger(conf, workdir); d.cmd('BPINT 21 3D'); d.run(); regs = d.regs(); d.memdump(seg, off, n, path)
"""
import os, pty, re, select, signal, sys, time, shutil
DX = os.path.expanduser('~/tools/dosbox-x/dosbox-x-sdl2/dosbox-x.app/Contents/MacOS/dosbox-x')
ANSI = re.compile(rb'\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][0-9A-Za-z]|\x1b[=>]')

class Debugger:
    def __init__(self, conf, workdir, extra=()):
        self.workdir = workdir; os.makedirs(workdir, exist_ok=True)
        conf = os.path.abspath(conf)                 # the child chdirs to workdir: a relative conf would silently fall back to the default config
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.environ['TERM'] = 'xterm'; os.environ['LINES'] = '60'; os.environ['COLUMNS'] = '160'
            os.chdir(workdir)
            os.execv(DX, ['dosbox-x', '-conf', conf, '-fastlaunch', '-break-start', *extra])
        self.buf = b''; self.all = b''
        self.wait_prompt(15)

    def read(self, timeout=0.3):
        got = b''
        while True:
            r, _, _ = select.select([self.fd], [], [], timeout)
            if not r: break
            try: chunk = os.read(self.fd, 65536)
            except OSError: break
            if not chunk: break
            got += chunk
        self.buf += got; self.all += got
        return got

    def text(self, raw=None):
        return ANSI.sub(b'', raw if raw is not None else self.buf).decode('latin1', 'replace')

    def wait_prompt(self, timeout=10):
        t0 = time.time(); acc = b''
        while time.time() - t0 < timeout:
            acc += self.read(0.2)
            if b'I-> ' in acc[-400:] or b'I->' in acc[-200:]:
                self.read(0.3); return True
        return False

    def cmd(self, c, wait=0.4):
        self.buf = b''
        os.write(self.fd, (c + '\r').encode())
        time.sleep(wait); self.read(0.2)
        return self.text()

    def run(self, timeout=60, marker=None):
        """RUN until the debugger regains control (breakpoint). Detects the redrawn prompt, or `marker`
        (e.g. b'0822:00002D5B' = code pane top line at the breakpoint)."""
        self.buf = b''
        os.write(self.fd, b'RUN\r')
        t0 = time.time(); acc = b''
        while time.time() - t0 < timeout:
            got = self.read(0.3)
            if got:
                acc += ANSI.sub(b'', got)
                if marker and marker in acc: self.read(0.4); return True
                if not marker and re.search(rb'I-> ', acc[20:]): self.read(0.4); return True
        return False

    def regs(self):
        """Parse the register pane (drawn on stop); returns dict of 16-bit segment/registers."""
        self.read(0.3)
        t = self.text(self.all[-40000:])
        d = {}
        for m in re.finditer(r'\b(E?[A-D]X|E?[SD]I|E?[SB]P|[CDSEFG]S|E?IP)=([0-9A-Fa-f]{4,8})', t):
            d[m.group(1)] = int(m.group(2), 16)
        return d

    def memdump(self, seg, off, n, dest):
        p = os.path.join(self.workdir, 'MEMDUMP.BIN')
        if os.path.exists(p): os.remove(p)
        for attempt in range(3):                       # the debugger occasionally drops a command under load
            self.cmd(f'MEMDUMPBIN {seg:04X}:{off:04X} {n:X}', 0.8)
            for _ in range(150):
                if os.path.exists(p) and os.path.getsize(p) >= n: break
                time.sleep(0.1)
            if os.path.exists(p) and os.path.getsize(p) >= n: break
            sys.stderr.write(f'memdump retry {attempt + 1} for {seg:04X}:{off:04X}\n')
        shutil.move(p, dest); return dest

    def close(self):
        try: os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError: pass

if __name__ == '__main__':
    conf, work = sys.argv[1], sys.argv[2]
    d = Debugger(conf, work)
    print('prompt ok'); print(d.text()[-300:])
    print(d.cmd('BPINT 21 3D')[-200:])
    hit = d.run(30); print('break:', hit)
    r = d.regs(); print({k: hex(v) for k, v in r.items()})
    print(d.text()[-1500:])
    d.close()
