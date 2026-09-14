"""SETTINGS.DAT (32 bytes), written by SM.EXE.
Layout (Confidence: observed; word semantics to be confirmed from SM.EXE code):
  8 x LE16 words, then 16 raw keyboard scancodes (set 1): two 8-key control blocks.
"""
from dataclasses import dataclass
import struct

SCANCODE_NAMES = {
    0x01: "Esc", 0x0E: "Backspace", 0x0F: "Tab", 0x1C: "Enter", 0x1D: "Ctrl", 0x2A: "LShift",
    0x36: "RShift", 0x38: "Alt", 0x39: "Space", 0x3A: "CapsLock",
    0x3B: "F1", 0x3C: "F2", 0x3D: "F3", 0x3E: "F4", 0x3F: "F5", 0x40: "F6", 0x41: "F7", 0x42: "F8",
    0x43: "F9", 0x44: "F10", 0x47: "Home", 0x48: "Up", 0x49: "PgUp", 0x4B: "Left", 0x4D: "Right",
    0x4F: "End", 0x50: "Down", 0x51: "PgDn", 0x52: "Ins", 0x53: "Del",
}
_ROW1 = "1234567890-="
_ROW2 = "QWERTYUIOP[]"
_ROW3 = "ASDFGHJKL;'`"
_ROW4 = "\\ZXCVBNM,./"
for i, c in enumerate(_ROW1): SCANCODE_NAMES[0x02 + i] = c
for i, c in enumerate(_ROW2): SCANCODE_NAMES[0x10 + i] = c
for i, c in enumerate(_ROW3): SCANCODE_NAMES[0x1E + i] = c
for i, c in enumerate(_ROW4): SCANCODE_NAMES[0x2B + i] = c


def scancode_name(sc: int) -> str:
    return SCANCODE_NAMES.get(sc, f"sc{sc:02X}")


@dataclass
class Settings:
    words: list       # 8 LE16 values
    keys_p1: list     # 8 scancodes
    keys_p2: list     # 8 scancodes

    def describe(self):
        return {
            "words": self.words,
            "keys_p1": [scancode_name(k) for k in self.keys_p1],
            "keys_p2": [scancode_name(k) for k in self.keys_p2],
        }


def decode_settings(data: bytes) -> Settings:
    if len(data) != 32:
        raise ValueError(f"SETTINGS.DAT must be 32 bytes, got {len(data)}")
    words = list(struct.unpack_from("<8H", data, 0))
    return Settings(words, list(data[16:24]), list(data[24:32]))


def encode_settings(s: Settings) -> bytes:
    return struct.pack("<8H", *s.words) + bytes(s.keys_p1) + bytes(s.keys_p2)
