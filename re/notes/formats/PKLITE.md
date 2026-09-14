# PKLITE 1.15 (extra compression, large model) as used by MICRO.EXE

Confidence: verified (depacker transliterated from the stub; output stream ends exactly at EOF,
strings and entry code are sane). Implementation: `tools/mm/pklite.py`.

- MZ header 0x60 bytes; version byte 0x0F at 0x1C, flags 0x31 at 0x1D. One MZ relocation (offset 7)
  patches the `add ax,imm16` of the memory check with the load segment.
- Stub (image offsets): loader 0x000-0x033; XOR-chain decryptor 0x034-0x047 over 0x136 words from
  0x2B2 downwards (`plain[i] = cipher[i] ^ cipher[i+2 bytes above]`, seed word 0x070C);
  decompressor 0x058-0x274 (copied to run at seg:0000); tables 0x275-0x2B1; bitstream from 0x2C0.
- Bit reader: LE16 words, LSB first; counter `dx` = bits left, reload when it hits 0.
- Token: flag 0 = literal byte XOR (bits-left counter & 0xFF); flag 1 = match.
- Length tree (values from tables at decomp+0x21D / +0x228 / +0x233): 10->2, 11->3, 000->4,
  001x, 01xx ... escape 0x19 = raw byte follows: len = 0x19+byte; byte 0xFE = pointer normalise
  (no output), 0xFF = end of stream.
- Offset: if len == 2, low byte only (high = 0); else high byte via prefix tree
  (table at decomp+0x243; 1 -> 0; deepest codes give 0x0E..0x1F via `and 0xDF`), then raw low byte.
- After end marker: relocation blocks `[count u16][offset u16 * count]`; count 0 = next segment
  (+0x0FFF paragraphs); 0xFFFF = end. Then SS, SP, CS, IP (segments relative to load segment).
