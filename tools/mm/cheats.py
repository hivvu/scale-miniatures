"""CHEATS.BIN (360 bytes): 30 records x 12 bytes = 6 LE16 (round, track, x, y, kind, value).

The pause handler (fn 35f0) looks for a record whose round/track match and whose (x, y) is within 0x18 of the
player's car, and applies `kind` to it (see re/notes/53-cheats.md). Confirmed against the disassembly.
"""
import struct

KINDS = {
    0: "lose a life",
    1: "end the race as a win",
    2: "top speed forward = value",
    3: "top speed sideways = value",
    4: "acceleration = value",
    5: "the fire button stops jumping",
    6: "set [2917] (read nowhere else)",
    7: "clear the car's on-track flag",
    8: "max speed = 0x800",
    9: "jump on any round, [291b] = 4",
}


def decode_cheats(data: bytes):
    if len(data) % 12:
        raise ValueError(f"CHEATS.BIN size {len(data)} not a multiple of 12")
    recs = []
    for off in range(0, len(data), 12):
        rnd, trk, x, y, kind, val = struct.unpack_from("<6H", data, off)
        recs.append({"round": rnd, "track": trk, "x": x, "y": y, "kind": kind, "value": val, "effect": KINDS.get(kind, "?")})
    return recs
