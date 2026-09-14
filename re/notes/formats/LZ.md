# Codemasters LZ codec (fn 1000:3333). Confidence: verified against game memory (ROUND2BR.VH0 sprite table
# dumped from DOSBox-X = 32/32 frames identical after the 2026-09-11 fix) and 41/41 files consume exactly to EOF.
Implementation and full token table: `tools/mm/lz.py` docstring. Summary: flag byte with 8 bits
MSB-first (0 = literal, 1 = command byte); command ranges: 00-0F literal runs (chain without flag
bits), 10-1F repeat previous byte, 20-4F match len 3-18 off <= 0x2FF, 50-5F long match (16-bit
offset, len = b+4), 60-6F reverse copy (mirrored run, fn 34ac: bytes read backwards from out-b-1; was wrongly
decoded as a single-byte repeat until 2026-09-11, which corrupted every bank subtly), 70-7F incrementing run, 80-FE short match
(len 2-5), FF = end. Decodes in place inside one 64 KB segment: input at 0xC000, output at 0.
Loader quirk (fn 3547): copies only (length & 0xFF00) bytes; bank files are multiples of 256.

Ground truth: build/golden/gt/round2_track1/vh_4d78.bin (frames 0..8 = raw VH0 bytes 0..0x1440) and
vh_5d78.bin (raw 0x1440..0x2F40; bytes past the decoded length are stale LZ-window memory).
