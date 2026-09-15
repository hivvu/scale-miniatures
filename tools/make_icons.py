"""Builds the site's icons from the boat sprite. Run from the repo root; writes into public/."""
from struct import unpack, pack
import zlib, os, sys

d = open('public/mm-boat.png','rb').read()
i=8; idat=b''; plte=b''; trns=b''
while i < len(d):
    ln = unpack('>I', d[i:i+4])[0]; typ = d[i+4:i+8]; data = d[i+8:i+8+ln]; i += 12+ln
    if typ==b'IHDR': W,H = unpack('>II', data[:8])
    elif typ==b'IDAT': idat += data
    elif typ==b'PLTE': plte = data
    elif typ==b'tRNS': trns = data
raw = zlib.decompress(idat); stride=W; px=bytearray(); prev=bytearray(stride); pos=0
for y in range(H):
    f=raw[pos]; pos+=1
    line=bytearray(raw[pos:pos+stride]); pos+=stride
    for x in range(stride):
        a=line[x-1] if x>=1 else 0; b=prev[x]; c=prev[x-1] if x>=1 else 0
        if f==1: line[x]=(line[x]+a)&255
        elif f==2: line[x]=(line[x]+b)&255
        elif f==3: line[x]=(line[x]+(a+b)//2)&255
        elif f==4:
            pp=a+b-c; pa=abs(pp-a); pb=abs(pp-b); pc=abs(pp-c)
            pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
            line[x]=(line[x]+pr)&255
    px+=line; prev=line

def sprite(x,y):
    idx = px[y*stride+x]
    return (plte[idx*3], plte[idx*3+1], plte[idx*3+2], trns[idx] if idx < len(trns) else 255)

CYAN = (0x29, 0xAB, 0xE2)

def icon(size, zoom):
    """The boat centred on the page's own blue. Whole-number zoom up, box average down."""
    bw, bh = int(W*zoom), int(H*zoom)
    ox, oy = (size-bw)//2, (size-bh)//2
    out = [[CYAN]*size for _ in range(size)]
    for y in range(bh):
        for x in range(bw):
            if zoom >= 1:
                r,g,b,a = sprite(int(x/zoom), int(y/zoom))
                if a == 0: continue
                col = (r,g,b)
            else:
                n = int(round(1/zoom)); rs=gs=bs=k=0
                for yy in range(n):
                    for xx in range(n):
                        sx, sy = x*n+xx, y*n+yy
                        if sx>=W or sy>=H: continue
                        r,g,b,a = sprite(sx,sy)
                        if a==0: r,g,b = CYAN      # a transparent edge blends into the water, not into black
                        rs+=r; gs+=g; bs+=b; k+=1
                col = (rs//k, gs//k, bs//k)
            out[oy+y][ox+x] = col
    return out

def chunk(t, b):
    c = t+b
    return pack('>I', len(b)) + c + pack('>I', zlib.crc32(c) & 0xffffffff)

def png(rows):
    h = len(rows); w = len(rows[0])
    data = b''.join(b'\x00' + b''.join(bytes(c) for c in r) for r in rows)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))

def dib(rows):
    """One .ico image as a 32-bit DIB: bottom-up BGRA, then an all-opaque mask."""
    h = len(rows); w = len(rows[0])
    xor = b''.join(b''.join(bytes((c[2], c[1], c[0], 255)) for c in row) for row in reversed(rows))
    andmask = b'\x00' * (((w + 31) // 32) * 4 * h)
    return pack('<IiiHHIIiiII', 40, w, h*2, 1, 32, 0, len(xor)+len(andmask), 0, 0, 0, 0) + xor + andmask

sizes = [(16, 0.5), (32, 1)]
images = [dib(icon(s, z)) for s, z in sizes]
ico = pack('<HHH', 0, 1, len(images))
off = 6 + 16*len(images)
for (s, _), img in zip(sizes, images):
    ico += pack('<BBBBHHII', s, s, 0, 0, 1, 32, len(img), off); off += len(img)
ico += b''.join(images)

open('public/favicon.ico','wb').write(ico)
open('public/favicon.png','wb').write(png(icon(96, 3)))
open('public/apple-touch-icon.png','wb').write(png(icon(180, 6)))
for f in ('favicon.ico','favicon.png','apple-touch-icon.png'):
    print(f, os.path.getsize('public/'+f), 'bytes')
