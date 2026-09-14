/**
 * GAME1/CHEATS.BIN (360 B): 30 records of six LE16, `round, track, x, y, kind, value`. The pause handler
 * (fn 35f0) looks for one whose round and track match and whose (x, y) is within 0x18 of the player's car,
 * and applies `kind` to it. Port of tools/mm/cheats.py; see re/notes/53-cheats.md.
 */
export interface CheatSpot {
  round: number; track: number; x: number; y: number;
  /** 0 lose a life, 1 win the race, 2/3 top speed, 4 acceleration, 5/6 flags, 7 off-track, 8 max speed, 9 jump. */
  kind: number;
  value: number;
}

export const CHEAT_EFFECTS: Record<number, string> = {
  0: 'lose a life',
  1: 'end the race as a win',
  2: 'top speed forward = value',
  3: 'top speed sideways = value',
  4: 'acceleration = value',
  5: 'the fire button stops jumping',
  6: 'set [2917] (read nowhere else)',
  7: "clear the car's on-track flag",
  8: 'max speed = 0x800',
  9: 'jump on any round, [291b] = 4',
};

export function decodeCheats(data: Uint8Array): CheatSpot[] {
  if (data.length % 12) throw new Error(`CHEATS.BIN size ${data.length} is not a multiple of 12`);
  const out: CheatSpot[] = [];
  const r = (o: number): number => data[o]! | (data[o + 1]! << 8);
  for (let o = 0; o < data.length; o += 12) {
    out.push({ round: r(o), track: r(o + 2), x: r(o + 4), y: r(o + 6), kind: r(o + 8), value: r(o + 0x0A) });
  }
  return out;
}
