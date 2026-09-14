"""ROUNDrBR.VH0 vehicle sprites: rotation table as built by MICRO.EXE fn 4611/4696/46f6 (see re/notes/61-sprites.md)."""
from dataclasses import dataclass

@dataclass
class VehicleSprites:
    size: int            # 24 or 40
    frames: list         # 32 rotation frames (bytes, size*size each), index = heading >> 3
    extra: list          # extra sprites copied to segment 5D78 (12 x 24x24 or 5 x 40x40)
    raw_frames: int      # frames present in the decoded file

def _vflip(f, w):
    return b''.join(f[r * w:(r + 1) * w] for r in range(w - 1, -1, -1))

def _hflip(f, w):
    return b''.join(f[r * w:(r + 1) * w][::-1] for r in range(w))

def build_frames(base9, w):
    """9 source frames (0..90 deg) -> 32 frames exactly like fn 4696 (24) / fn 46f6 (40)."""
    fr = list(base9)
    fr += [_vflip(base9[i], w) for i in range(7, -1, -1)]          # 9..16  = vflip(7..0)
    fr += [_hflip(fr[i], w) for i in range(15, 8, -1)]              # 17..23 = hflip(15..9)
    fr += [_hflip(base9[i], w) for i in range(8, 0, -1)]            # 24..31 = hflip(8..1)
    assert len(fr) == 32
    return fr

def decode_vehicle(data: bytes, round_no: int) -> VehicleSprites:
    w = 40 if round_no == 9 else 24
    fsz = w * w
    n_rot = 9
    n_extra = 5 if round_no == 9 else 12
    need = (n_rot + n_extra) * fsz
    buf = data + bytes(max(0, need - len(data)))    # the game copies past the decoded data (stale LZ window); zero here
    base9 = [buf[i * fsz:(i + 1) * fsz] for i in range(n_rot)]
    extra = [buf[(n_rot + i) * fsz:(n_rot + i + 1) * fsz] for i in range(n_extra)]
    return VehicleSprites(w, build_frames(base9, w), extra, len(data) // fsz)

def frame_table_bytes(v: VehicleSprites) -> bytes:
    """Exact image of segment 4D78 after loading (0x4800 B for 24x24, 0xC800 B for 40x40)."""
    return b''.join(v.frames)
