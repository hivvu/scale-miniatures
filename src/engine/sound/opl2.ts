/**
 * YM3812 (OPL2) sound chip: nine two-operator FM channels, the hardware the game's sound driver talks to.
 *
 * This is the one piece of the port that models hardware rather than game code, the same way the renderer
 * models the VGA. It follows the usual description of the chip: a logarithmic sine table and an exponential
 * table, a 20-bit phase accumulator per operator, and a four-stage envelope whose rates come from the
 * register value scaled by the note. Register writes come from src/engine/sound/driver.ts.
 */
export const OPL_RATE = 49716;           // 3.579545 MHz / 72, the chip's own sample rate

const logsin = new Uint16Array(256);     // -log2(sin) in 1/256ths: 0 at the peak, 2137 next to zero
const expTable = new Uint16Array(256);   // 2^-x, the mantissa of the attenuation: 2042 down to 1024
for (let i = 0; i < 256; i++) {
  logsin[i] = Math.round(-Math.log2(Math.sin((i + 0.5) * Math.PI / 512)) * 256);
  expTable[i] = Math.round(Math.pow(2, (255 - i) / 256) * 1024);
}

/** Frequency multiplier per MULT register value, in halves. */
const MULT = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
/** Key scale level: attenuation per sixteenth of the F-number range, with the block taken off it. */
const KSL_TABLE = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64];
const KSL_SHIFT = [8, 4, 2, 0];          // register 0x40 bits 7-6: off, 3 dB, 1.5 dB, 6 dB per octave
/** The vibrato LFO, one step per 1024 samples: about 6.1 Hz, a step being 1/128 of the F-number. */
const VIBRATO = [0, 1, 2, 1, 0, -1, -2, -1];

/** Envelope increments, indexed by the low two bits of the rate and the step of the eight-step cycle. */
const EG_STEPS = [
  [0, 1, 0, 1, 0, 1, 0, 1],
  [0, 1, 0, 1, 1, 1, 0, 1],
  [0, 1, 1, 1, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1],
];

const OFF = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4;

class Operator {
  am = false; vib = false; eg = false; ksr = false; mult = 0;
  ksl = 0; tl = 0;
  ar = 0; dr = 0; sl = 0; rr = 0;
  wave = 0;
  phase = 0;                             // 20 bits: the top ten index the sine
  env = 511;                             // attenuation, 0 loud .. 511 silent
  state = OFF;
  out = 0; prev = 0;                     // the last two outputs, for feedback
}

class Channel {
  readonly ops: [Operator, Operator] = [new Operator(), new Operator()];
  fnum = 0; block = 0; keyOn = false;
  feedback = 0; additive = false;
}

export class OPL2 {
  private readonly channels: Channel[] = Array.from({ length: 9 }, () => new Channel());
  private readonly operators: Operator[] = [];
  private readonly regs = new Uint8Array(256);
  private egTimer = 0;
  private lfo = 0;
  private waveSelect = false;
  private deepTremolo = false; private deepVibrato = false;

  constructor() {
    // the chip's operator numbering: channel n uses slots n and n+3 within each group of six
    for (let i = 0; i < 18; i++) {
      const group = Math.floor(i / 6), rest = i % 6;
      const chan = group * 3 + (rest % 3);
      this.operators[[0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15][i]!] = this.channels[chan]!.ops[rest < 3 ? 0 : 1];
    }
  }

  write(reg: number, value: number): void {
    reg &= 0xFF; value &= 0xFF;
    this.regs[reg] = value;
    const low = reg & 0x1F;
    if (reg === 0x01) { this.waveSelect = (value & 0x20) !== 0; return; }
    if (reg === 0xBD) { this.deepTremolo = (value & 0x80) !== 0; this.deepVibrato = (value & 0x40) !== 0; return; }
    if (reg >= 0x20 && reg <= 0x35) {
      const op = this.operators[low]; if (!op) return;
      op.am = (value & 0x80) !== 0; op.vib = (value & 0x40) !== 0;
      op.eg = (value & 0x20) !== 0; op.ksr = (value & 0x10) !== 0;
      op.mult = value & 0x0F;
      return;
    }
    if (reg >= 0x40 && reg <= 0x55) {
      const op = this.operators[low]; if (!op) return;
      op.ksl = value >> 6; op.tl = value & 0x3F;
      return;
    }
    if (reg >= 0x60 && reg <= 0x75) {
      const op = this.operators[low]; if (!op) return;
      op.ar = value >> 4; op.dr = value & 0x0F;
      return;
    }
    if (reg >= 0x80 && reg <= 0x95) {
      const op = this.operators[low]; if (!op) return;
      op.sl = value >> 4; op.rr = value & 0x0F;
      return;
    }
    if (reg >= 0xE0 && reg <= 0xF5) {
      const op = this.operators[low]; if (!op) return;
      op.wave = this.waveSelect ? value & 3 : 0;
      return;
    }
    if (reg >= 0xA0 && reg <= 0xA8) {
      const c = this.channels[reg - 0xA0]!;
      c.fnum = (c.fnum & 0x300) | value;
      return;
    }
    if (reg >= 0xB0 && reg <= 0xB8) {
      const c = this.channels[reg - 0xB0]!;
      c.fnum = (c.fnum & 0xFF) | ((value & 3) << 8);
      c.block = (value >> 2) & 7;
      const on = (value & 0x20) !== 0;
      // key on restarts the attack from wherever the envelope is, with the phase back at zero
      if (on && !c.keyOn) for (const op of c.ops) { op.state = ATTACK; op.phase = 0; }
      if (!on && c.keyOn) for (const op of c.ops) if (op.state !== OFF) op.state = RELEASE;
      c.keyOn = on;
      return;
    }
    if (reg >= 0xC0 && reg <= 0xC8) {
      const c = this.channels[reg - 0xC0]!;
      c.feedback = (value >> 1) & 7;
      c.additive = (value & 1) !== 0;
    }
  }

  /** One sample per entry, at OPL_RATE. */
  render(out: Float32Array, count = out.length): void {
    for (let i = 0; i < count; i++) out[i] = this.sample();
  }

  sample(): number {
    this.egTimer++;
    this.lfo++;
    // the two LFOs the chip shares: a 3.7 Hz triangle for tremolo and a 6.1 Hz one for vibrato
    const pos = (this.lfo >> 7) % 210;
    const tremolo = (pos < 105 ? pos >> 2 : (210 - pos) >> 2) >> (this.deepTremolo ? 0 : 2);
    const vibrato = VIBRATO[(this.lfo >> 10) & 7]!;
    let mix = 0;
    for (const c of this.channels) {
      const [m, car] = c.ops;
      this.envelope(m, c);
      this.envelope(car, c);
      const fb = c.feedback === 0 ? 0 : (m.out + m.prev) >> (9 - c.feedback);
      const modulator = this.operate(m, c, fb, tremolo, vibrato);
      m.prev = m.out; m.out = modulator;
      const carrier = this.operate(car, c, c.additive ? 0 : modulator, tremolo, vibrato);
      car.out = carrier;
      mix += c.additive ? modulator + carrier : carrier;
    }
    return Math.max(-1, Math.min(1, mix / 16384));
  }

  /** Phase accumulator, waveform and the exponential table: one operator's output, -4084..4084. */
  private operate(op: Operator, c: Channel, modulation: number, tremolo: number, vibrato: number): number {
    const fnum = op.vib ? c.fnum + (((c.fnum >> 7) * vibrato) >> (this.deepVibrato ? 0 : 1)) : c.fnum;
    const inc = ((fnum << c.block) * MULT[op.mult]!) >> 1;
    op.phase = (op.phase + inc) & 0xFFFFF;
    if (op.env >= 511) return 0;
    const phase = ((op.phase >> 10) + modulation) & 0x3FF;
    let value: number, negate = false;
    switch (op.wave) {
      case 1:                                              // the negative half is silent
        if (phase & 0x200) return 0;
        value = logsin[(phase & 0x100) ? 0xFF - (phase & 0xFF) : phase & 0xFF]!;
        break;
      case 2:                                              // both halves positive
        value = logsin[(phase & 0x100) ? 0xFF - (phase & 0xFF) : phase & 0xFF]!;
        break;
      case 3:                                              // the rising quarter only
        if (phase & 0x100) return 0;
        value = logsin[phase & 0xFF]!;
        break;
      default:
        value = logsin[(phase & 0x100) ? 0xFF - (phase & 0xFF) : phase & 0xFF]!;
        negate = (phase & 0x200) !== 0;
    }
    const level = op.env + (op.tl << 2) + this.keyScaleLevel(op, c) + (op.am ? tremolo : 0);
    const total = value + (level << 3);
    const amplitude = (expTable[total & 0xFF]! << 1) >> (total >> 8);
    return negate ? -amplitude : amplitude;
  }

  private keyScaleLevel(op: Operator, c: Channel): number {
    if (op.ksl === 0) return 0;
    const attenuation = (KSL_TABLE[c.fnum >> 6]! << 2) - ((8 - c.block) << 5);
    return attenuation <= 0 ? 0 : attenuation >> KSL_SHIFT[op.ksl]!;
  }

  /** The four-stage envelope. Rates are the register value scaled by the note, as the chip does. */
  private envelope(op: Operator, c: Channel): void {
    if (op.state === OFF) return;
    const ksr = op.ksr ? (c.block << 1) | (c.fnum >> 9) : c.block >> 1;
    const reg = op.state === ATTACK ? op.ar : op.state === DECAY ? op.dr
      : op.state === SUSTAIN ? (op.eg ? 0 : op.rr) : op.rr;
    if (op.state === SUSTAIN && op.eg) return;
    if (reg === 0) { if (op.state === ATTACK) op.state = DECAY; return; }
    const rate = Math.min(63, reg * 4 + ksr);
    const hi = rate >> 2, lo = rate & 3;
    const shift = hi < 13 ? 13 - hi : 0;
    if ((this.egTimer & ((1 << shift) - 1)) !== 0) return;
    const step = EG_STEPS[lo]![(this.egTimer >> shift) & 7]! * (hi >= 13 ? 1 << (hi - 12) : 1);
    if (step === 0) return;
    switch (op.state) {
      case ATTACK:
        op.env += (~op.env * step) >> 3;
        if (op.env <= 0) { op.env = 0; op.state = DECAY; }
        break;
      case DECAY: {
        const sustain = op.sl === 15 ? 0x1F0 : op.sl << 4;   // 3 dB per step, and 15 means all the way down
        op.env += step;
        if (op.env >= sustain) { op.env = sustain; op.state = SUSTAIN; }
        break;
      }
      default:
        op.env += step;
        if (op.env >= 511) { op.env = 511; if (op.state === RELEASE) op.state = OFF; }
    }
  }
}
