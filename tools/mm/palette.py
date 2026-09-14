"""VGA palette (.PAL): 256 x (r,g,b), 6-bit DAC values (0..63). Confidence: verified (all values <= 0x3F)."""
from dataclasses import dataclass


@dataclass
class Palette:
    rgb6: list  # 256 tuples of 6-bit values

    def rgb8(self):
        """Expand 6-bit DAC to 8-bit the way most VGA DACs/emulators do: v<<2 | v>>4."""
        return [((r << 2) | (r >> 4), (g << 2) | (g >> 4), (b << 2) | (b >> 4)) for r, g, b in self.rgb6]

    def to_pil_flat(self):
        out = []
        for r, g, b in self.rgb8():
            out += [r, g, b]
        return out


def decode_palette(data: bytes) -> Palette:
    if len(data) != 768:
        raise ValueError(f"palette must be 768 bytes, got {len(data)}")
    if max(data) > 0x3F:
        raise ValueError("palette has values above 0x3F; not a 6-bit VGA palette")
    return Palette([(data[i], data[i + 1], data[i + 2]) for i in range(0, 768, 3)])
