// Diagnostic tool (skipped unless MM_SOUND_WAV names an output file): render one of the game's songs or
// sound effects through the driver and the OPL2 core and write it as a WAV, to listen to or to analyse.
//   MM_SOUND_WAV=/tmp/song.wav SONG=1 SECS=8 npx vitest run test/engine/diag_sound.test.ts
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SoundDriver } from '../../src/engine/sound/driver';
import { OPL2, OPL_RATE } from '../../src/engine/sound/opl2';

const TICK_RATE = 70.086;

it.skipIf(!process.env['MM_SOUND_WAV'])('render a sound to a wav', () => {
  const data = process.env['MM_DATA_DIR'] ?? join(process.cwd(), 'MicroMac');
  const opl = new OPL2();
  const driver = new SoundDriver(new Uint8Array(readFileSync(join(data, 'DRIVER1.BIN'))), opl);
  driver.init();
  const song = Number(process.env['SONG'] ?? 0);
  const engine = process.env['ENGINE'] !== undefined;     // sweep a car's engine note instead
  if (engine) driver.engine(0, 0x0A, true);
  else if (song > 0) driver.setSong(song); else driver.play(Number(process.env['SFX'] ?? 1));

  const seconds = Number(process.env['SECS'] ?? 8);
  const total = Math.floor(OPL_RATE * seconds);
  const buf = new Float32Array(total);
  const samplesPerTick = OPL_RATE / TICK_RATE;
  for (let at = 0, carry = 0; at < total;) {
    if (engine) driver.engine(0, 0x0A + Math.round((at / total) * 0x50), true);
    driver.tick();
    carry += samplesPerTick;
    const n = Math.min(Math.floor(carry), total - at);
    carry -= n;
    opl.render(buf.subarray(at, at + n), n);
    at += n;
  }

  const wav = Buffer.alloc(44 + total * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(OPL_RATE, 24); wav.writeUInt32LE(OPL_RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i]! * 32767))), 44 + i * 2);
  writeFileSync(process.env['MM_SOUND_WAV']!, wav);
});
