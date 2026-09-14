"""STRT_POS.BIN (144 bytes): 9 rounds x 4 track slots x (x, y) LE16. Confidence: guessed from sizes and values."""
import struct


def decode_strtpos(data: bytes):
    if len(data) != 144:
        raise ValueError(f"STRT_POS.BIN must be 144 bytes, got {len(data)}")
    vals = struct.unpack("<72H", data)
    rounds = []
    for r in range(9):
        slots = []
        for t in range(4):
            x, y = vals[r * 8 + t * 2], vals[r * 8 + t * 2 + 1]
            slots.append({"x": x, "y": y})
        rounds.append(slots)
    return rounds
