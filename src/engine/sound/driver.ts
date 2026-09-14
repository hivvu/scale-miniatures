/**
 * The game's sound driver: a transliteration of DRIVER1.BIN, the Sound Images Generation 2 OPL2 driver
 * Micro Machines loads at segment 1424 and calls with the function number in ah (see re/notes/90-sound.md).
 *
 * The file carries the whole sound set, so everything here reads out of the driver image: the bank of 18
 * sequences, the 128 instrument records, the frequency tables and the four engine records the game rewrites
 * while a race runs. What comes out is the stream of OPL2 register writes the real driver would make.
 */

/** Whatever the register writes go to: the chip, or a log in a test. */
export interface OplSink { write(reg: number, value: number): void; }

const SONG_BANK_PTR = 0x13F0;          // -> the songs: a word table of headers, then the tracks
const BANK_PTR = 0x13F2;               // -> the sound bank
const INSTRUMENT_PTR = 0x13F4;         // -> 128 note bytes, then the 16-byte instrument records
const INSTRUMENT_BASE = 0x80;
const INSTRUMENT_LEN = 0x10;
const CHANNEL_OPS = 0x1038;            // word per OPL channel: low byte = operator 1, high = operator 2
const FNUM_TABLE = 0x0A38;             // 0x300 words: one octave in 1/64 semitone steps
const BLOCK_TABLE = 0x09D3;            // block bits (already shifted into place) per semitone
const ATTENUATION = 0x10CC;            // volume 0..255 -> the OPL's 6-bit attenuation
const ENGINE_RECORDS = 0x0008;         // sounds 0x40 and up play a 16-byte record from here
const ENGINE_LEN = 0x10;
const SILENCE_LIST = 0x104A;           // register/value pairs that shut the chip up, ending with 0000
const EMPTY_SEQUENCE = 0x124D;         // where command 0x9a sends a channel
const SHADOW = 0x114D;                 // the driver's copy of the chip's 256 registers

const SLOTS = 0x1271;                  // sixteen 0x16-byte channel records
const SLOT_LEN = 0x16;
const EFFECT_QUEUE = 0x13D1, MUSIC_QUEUE = 0x13D9;
const MUSIC_RATE = 0x1261, MUSIC_ACCUM = 0x1265;   // 32-bit rate, 32-bit accumulator whose high word is
const EFFECT_RATE_AT = 0x1269, EFFECT_ACCUM = 0x126D;   // the sequencer ticks for this game tick

const TEMPO_A = 0x125E;                // the song's tempo word times [125f]: how fast the sequencer runs
const TEMPO_B = 0x125F;
const REQUESTED_SONG = 0x125A;         // what ah=4 asked for, started by the next tick
const CURRENT_SONG = 0x125B;           // what ah=9 reports on
const TRACK_COUNT = 0x1258;            // how many slots the song took
const PIT_DIVISOR = 0x1254;            // what fn ah=2 was told: PIT ticks per game tick
const GLOBAL_VOLUME = 0x1256;
const PIT_TICKS_PER_MINUTE = 0x04446390;   // 1193182 Hz * 60, as the driver has it
const EFFECT_RATE = 0x1680;            // 5760: the fixed rate channels in state 2 run at

export const CHANNELS = 16;            // slots, of which only the nine OPL channels can sound
export const QUEUE_LEN = 8;

/** One of the sixteen 0x16-byte channel records at 0x1271. */
interface Slot {
  seq: number;            // +00 where the sequence has got to
  time: number;           // +02 signed 32-bit countdown to the next event
  loop: number;           // +06 where command 0x98 jumps back to
  chan: number;           // +08 OPL channel
  note: number;           // +09
  state: number;          // +0a 0 = free, 2 = playing
  b0: number;             // +0b the last value written to 0xb0 + chan (0x20 = key on)
  ops: number;            // +0c operator offsets, low byte and high byte
  instr: number;          // +0e the instrument record in the driver image
  instrNo: number;        // +10
  volume: number;         // +11
  sound: number;          // +12 the sound number that is playing
  drum: number;           // +13 non-zero: the note picks the instrument, as percussion does
  bendRange: number;      // +14
  bend: number;           // +15 0x40 = no bend
}

const newSlot = (): Slot => ({ seq: 0, time: 0, loop: 0, chan: 0, note: 0, state: 0, b0: 0, ops: 0,
  instr: 0, instrNo: 0, volume: 0x7F, sound: 0, drum: 0, bendRange: 0, bend: 0x40 });

export class SoundDriver {
  readonly data: Uint8Array;
  private readonly slots: Slot[] = Array.from({ length: CHANNELS }, newSlot);
  private readonly effects = new Uint8Array(QUEUE_LEN);     // ah=5
  private readonly music = new Uint8Array(QUEUE_LEN);       // ah=8
  private stopEverything = false;                           // ah=6, done on the next tick
  private stopChannels = false;                             // ah=7
  private musicRate = 0; private musicAccum = 0;            // 16.16 sequencer ticks per game tick
  private effectRate = 0; private effectAccum = 0;                                      // [125b]: the sound ah=9 reports on

  constructor(image: Uint8Array, readonly opl: OplSink) {
    this.data = image.slice();
  }

  private byte(at: number): number { return this.data[at]!; }
  private word(at: number): number { return this.data[at]! | (this.data[at + 1]! << 8); }
  private dword(at: number): number { return (this.word(at) | (this.word(at + 2) << 16)) >>> 0; }

  /**
   * Seed the driver from a dump of its work area (tools/gt_opl.py takes 0x1100..0x1440), so a capture of the
   * real driver can be replayed tick for tick. The port keeps the channel records, the two request queues and
   * the tempo accumulators in TypeScript rather than in the image, so they are read back out here.
   */
  loadState(dump: Uint8Array, at: number): void {
    this.data.set(dump, at);
    for (let i = 0; i < CHANNELS; i++) {
      const p = SLOTS + i * SLOT_LEN, s = this.slots[i]!;
      s.seq = this.word(p);
      s.time = this.dword(p + 2) | 0;
      s.loop = this.word(p + 6);
      s.chan = this.byte(p + 8); s.note = this.byte(p + 9); s.state = this.byte(p + 0x0A);
      s.b0 = this.byte(p + 0x0B); s.ops = this.word(p + 0x0C); s.instr = this.word(p + 0x0E);
      s.instrNo = this.byte(p + 0x10); s.volume = this.byte(p + 0x11); s.sound = this.byte(p + 0x12);
      s.drum = this.byte(p + 0x13); s.bendRange = this.byte(p + 0x14); s.bend = this.byte(p + 0x15);
    }
    for (let i = 0; i < QUEUE_LEN; i++) {
      this.effects[i] = this.byte(EFFECT_QUEUE + i);
      this.music[i] = this.byte(MUSIC_QUEUE + i);
    }
    this.musicRate = this.dword(MUSIC_RATE); this.musicAccum = this.word(MUSIC_ACCUM);
    this.effectRate = this.dword(EFFECT_RATE_AT); this.effectAccum = this.word(EFFECT_ACCUM);
    this.stopEverything = false; this.stopChannels = false;
  }

  /** The same region as `loadState` reads, with the TypeScript-side state written back into it. */
  saveState(at: number, len: number): Uint8Array {
    for (let i = 0; i < CHANNELS; i++) {
      const p = SLOTS + i * SLOT_LEN, s = this.slots[i]!;
      const w = (o: number, v: number): void => { this.data[o] = v & 0xFF; this.data[o + 1] = (v >> 8) & 0xFF; };
      w(p, s.seq);
      w(p + 2, s.time & 0xFFFF); w(p + 4, (s.time >> 16) & 0xFFFF);
      w(p + 6, s.loop);
      this.data[p + 8] = s.chan; this.data[p + 9] = s.note; this.data[p + 0x0A] = s.state;
      this.data[p + 0x0B] = s.b0; w(p + 0x0C, s.ops); w(p + 0x0E, s.instr);
      this.data[p + 0x10] = s.instrNo; this.data[p + 0x11] = s.volume; this.data[p + 0x12] = s.sound;
      this.data[p + 0x13] = s.drum; this.data[p + 0x14] = s.bendRange; this.data[p + 0x15] = s.bend;
    }
    for (let i = 0; i < QUEUE_LEN; i++) {
      this.data[EFFECT_QUEUE + i] = this.effects[i]!;
      this.data[MUSIC_QUEUE + i] = this.music[i]!;
    }
    this.data[MUSIC_ACCUM] = this.musicAccum & 0xFF; this.data[MUSIC_ACCUM + 1] = (this.musicAccum >> 8) & 0xFF;
    this.data[EFFECT_ACCUM] = this.effectAccum & 0xFF; this.data[EFFECT_ACCUM + 1] = (this.effectAccum >> 8) & 0xFF;
    return this.data.subarray(at, at + len);
  }

  get soundCount(): number { return this.byte(this.word(BANK_PTR)); }

  /** fn 0175: the driver keeps a shadow of the chip and skips writes that would not change anything. */
  private out(reg: number, value: number): void {
    reg &= 0xFF; value &= 0xFF;
    if (this.data[SHADOW + reg] === value) return;
    this.data[SHADOW + reg] = value;
    this.opl.write(reg, value);
  }

  /** fn 019d: the same write, but always, shadow or no shadow. The reset and the silence list use it. */
  private force(reg: number, value: number): void {
    reg &= 0xFF; value &= 0xFF;
    this.data[SHADOW + reg] = value;
    this.opl.write(reg, value);
  }

  /** fn 00e8: reset the chip. The detection dance it does first needs no port reads here. */
  init(): void {
    this.force(0x01, 0x20);                                 // waveform select enabled
    this.force(0xBD, 0x00);
    this.force(0x08, 0x00);
    this.silence();
    this.setTempo(this.word(PIT_DIVISOR));
  }

  /** fn 0098f: cx = PIT ticks per game tick; works out how far the sequencer moves each tick. */
  setTempo(pitDivisor: number): boolean {
    this.data[PIT_DIVISOR] = pitDivisor & 0xFF;
    this.data[PIT_DIVISOR + 1] = (pitDivisor >> 8) & 0xFF;
    if (pitDivisor < 0x445) { this.musicRate = 1 << 16; return false; }
    const perMinute = Math.floor(PIT_TICKS_PER_MINUTE / pitDivisor);
    this.musicRate = rate32(this.byte(TEMPO_A) * this.byte(TEMPO_B), perMinute);
    this.effectRate = rate32(EFFECT_RATE, perMinute);
    return true;
  }

  /** fn 06c8 (ah=5) and fn 06c3 (ah=8): put a sound number in one of the two eight-slot queues. */
  play(sound: number, music = false): boolean {
    const queue = music ? this.music : this.effects;
    if (sound >= 0x40 && queue.includes(sound)) return true;   // one engine note per car at a time
    const free = queue.indexOf(0);
    if (free < 0) return false;
    queue[free] = sound;
    return true;
  }

  /** fn 0492 (ah=4): ask for a song. The next tick stops whatever is playing and starts this one. */
  setSong(song: number): void {
    if (this.byte(CURRENT_SONG) !== song) this.data[REQUESTED_SONG] = song & 0xFF;
  }

  /** fn 08f1 (ah=9): zero when that song is the one playing. */
  songPlaying(song: number): boolean { return this.byte(CURRENT_SONG) === song; }

  /** fn 08f6 (ah=0a): is any channel playing this sound number? */
  isPlaying(sound: number): boolean {
    return this.slots.some(s => s.state !== 0 && s.sound === sound);
  }

  /** fn 0804 (ah=6) and fn 0841 (ah=7): both take effect on the next tick, as in the driver. */
  stopAll(): void { this.stopEverything = true; }
  stopVoices(): void { this.stopChannels = true; }

  /** fn 021a: one tick of the sequencer, called at 70.086 Hz by the game's int 8 handler. */
  tick(): void {
    if (this.stopEverything) {
      this.effects.fill(0);
      this.silence();
      for (const s of this.slots) { s.state = 0; s.sound = 0; }
      this.stopEverything = false; this.data[CURRENT_SONG] = 0;
    }
    if (this.stopChannels) {                                 // fn 084a: only the song's own tracks
      const tracks = this.word(TRACK_COUNT);
      for (let i = 0; i < Math.min(tracks, CHANNELS); i++) {
        const s = this.slots[i]!;
        this.keyOff(s); s.state = 0; s.sound = 0;
      }
      this.stopChannels = false; this.data[CURRENT_SONG] = 0;
    }
    this.startSong();
    this.runQueue(this.music);
    this.runQueue(this.effects);
    this.musicAccum += this.musicRate;
    this.effectAccum += this.effectRate;
    const musicTicks = this.musicAccum >>> 16, effectTicks = this.effectAccum >>> 16;
    this.musicAccum &= 0xFFFF; this.effectAccum &= 0xFFFF;
    for (const s of this.slots) this.advance(s, s.state === 2 ? effectTicks : musicTicks);
  }

  /** fn 0606: start the song ah=4 asked for, one slot per track. */
  private startSong(): void {
    const song = this.byte(REQUESTED_SONG);
    if (song === 0) return;
    this.data[REQUESTED_SONG] = 0;
    const bank = this.word(SONG_BANK_PTR);
    const count = this.byte(bank);
    if (count === 0 || song > count) return;
    for (const s of this.slots) {                            // every channel goes quiet first
      if (s.state === 0) continue;
      this.keyOff(s);
      s.state = 0; s.sound = 0;
    }
    this.data[CURRENT_SONG] = song;
    const table = bank + this.word(bank + 1);                // fn 0645: the word table of song headers
    const at = bank + this.word(table + (song - 1) * 2);
    const tempo = this.word(at);
    this.data[TEMPO_A] = tempo & 0xFF; this.data[TEMPO_A + 1] = (tempo >> 8) & 0xFF;
    const tracks = this.byte(at + 2);
    this.data[TRACK_COUNT] = tracks & 0xFF; this.data[TRACK_COUNT + 1] = 0;
    for (let i = 0; i < Math.min(tracks, CHANNELS); i++) {
      const s = this.slots[i]!;
      s.seq = bank + this.word(at + 3 + i * 2);
      s.loop = s.seq;
      const [delta, next] = this.vlq(s.seq);
      s.time = delta; s.seq = next;
      s.state = 1;                                           // a song track runs at the song's tempo
      s.bendRange = 2; s.bend = 0x40; s.drum = 0; s.instrNo = 0xFF; s.volume = 0x7F;
      s.sound = 0; s.b0 = 0;
    }
    this.setTempo(this.word(PIT_DIVISOR));
  }

  /**
   * fn 7b46's half of the engine note: the pitch goes into the 0x95 command of that car's record and the
   * command after it decides whether the little sequence loops on or ends.
   */
  engine(car: number, pitch: number, running: boolean): void {
    const at = ENGINE_RECORDS + car * ENGINE_LEN;
    this.data[at + 0x0A] = pitch & 0xFF;
    this.data[at + 0x0C] = running ? 0x98 : 0x91;
    if (running && !this.isPlaying(0x40 + car)) this.play(0x40 + car);
  }

  /** fn 0704 / 089e: start everything the queue asked for, then empty it. */
  private runQueue(queue: Uint8Array): void {
    for (let i = 0; i < queue.length; i++) {
      const sound = queue[i]!;
      if (sound === 0) continue;
      queue[i] = 0;
      if (!this.start(sound)) return;                      // 071a: nothing free, the rest waits
    }
  }

  /** fn 0722: find a free slot and point it at the sequence. */
  private start(sound: number): boolean {
    const slot = this.slots.find(s => s.state === 0);
    if (!slot) return false;
    const chan = this.freeChannel();
    if (chan === undefined) return false;
    slot.chan = chan;
    slot.sound = sound;
    slot.ops = this.word(CHANNEL_OPS + chan * 2);
    slot.seq = this.sequenceStart(sound);
    slot.volume = 0x7F; slot.bend = 0x40; slot.drum = 0; slot.note = 0; slot.b0 = 0;
    const [delta, next] = this.vlq(slot.seq);
    slot.time = delta; slot.seq = next;
    slot.state = 2;
    return true;
  }

  /** fn 07be: the highest OPL channel no slot is using (the original counts down from 8). */
  private freeChannel(): number | undefined {
    for (let chan = 8; chan >= 0; chan--) {
      if (!this.slots.some(s => s.state !== 0 && s.chan === chan)) return chan;
    }
    return undefined;
  }

  /** fn 0759: sounds below 0x40 come from the bank, the rest are the engine records at driver:0008. */
  sequenceStart(sound: number): number {
    if (sound >= 0x40) return ENGINE_RECORDS + (sound - 0x40) * ENGINE_LEN;
    const bank = this.word(BANK_PTR);
    return bank + this.word(bank + 1 + (sound - 1) * 2);
  }

  /** fn 0925: a MIDI variable-length quantity. */
  private vlq(at: number): [number, number] {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.byte(at); at++;
      if (b < 0x80) return [value + b, at];
      value = (value + (b & 0x7F)) * 0x80;
    }
    return [value, at];
  }

  /** fn 0273: take the elapsed sequencer ticks off the countdown and run whatever comes due. */
  private advance(s: Slot, elapsed: number): void {
    if (s.state === 0) return;
    s.time -= elapsed;
    let guard = 0;
    while (s.time < 0 && s.state !== 0 && guard++ < 1000) {
      this.event(s);
      if (s.state === 0) return;
      const [delta, next] = this.vlq(s.seq);
      s.seq = next;
      s.time += delta;
    }
  }

  /** fn 0294: one event of a sequence. */
  private event(s: Slot): void {
    const kind = this.byte(s.seq); s.seq++;
    if (kind < 0x80) {                                       // note on: note, then velocity
      s.note = kind;
      // 02a1: a note that is already sounding is keyed off first, except on the engine records (sound
      // numbers 0x40 and up), which hold one note down for ever and only bend its pitch
      if ((s.b0 & 0x20) !== 0 && !(s.state === 2 && s.sound >= 0x40)) this.keyOff(s);
      this.noteOn(s);
      const velocity = this.byte(s.seq); s.seq++;
      this.level(s, velocity);
      return;
    }
    if (kind <= 0x8F) { this.useChannel(s, kind & 0x0F); return; }
    switch (kind) {
      case 0x90: {                                           // note off, if it is still that note
        const note = this.byte(s.seq); s.seq++;
        if (note === s.note) this.keyOff(s);
        return;
      }
      case 0x91:                                             // end of sequence
        s.state = 0; s.sound = 0;
        this.keyOff(s);
        return;
      case 0x92: {                                           // instrument
        s.volume = 0x7F; s.bend = 0x40;
        const n = this.byte(s.seq); s.seq++;
        this.useInstrument(s, n);
        return;
      }
      case 0x93: {                                           // tempo
        this.data[TEMPO_B] = this.byte(s.seq); s.seq++;
        this.setTempo(this.word(PIT_DIVISOR));
        return;
      }
      case 0x94: return;
      case 0x95: {                                           // pitch bend
        s.bend = this.byte(s.seq); s.seq++;
        if ((s.b0 & 0x20) !== 0) this.noteOn(s);
        return;
      }
      case 0x96: s.volume = this.byte(s.seq); s.seq++; return;
      case 0x97: s.drum = this.byte(s.seq); s.seq++; return;
      case 0x98: s.seq = s.loop; return;
      case 0x99: this.keyOff(s); return;
      case 0x9A: s.seq = EMPTY_SEQUENCE; return;
      case 0x9B: s.seq++; return;
      case 0x9C: s.loop = s.seq; return;
      case 0x9D: s.seq += 2; return;
      default: return;                                       // 0xff and anything else: just the delta
    }
  }

  /** fn 0311: the low nibble of 0x80..0x8f picks the OPL channel the slot plays on. */
  private useChannel(s: Slot, chan: number): void {
    s.chan = chan;
    s.ops = this.word(CHANNEL_OPS + chan * 2);
  }

  /** fn 0398: point the slot at an instrument record and push it to the chip. */
  private useInstrument(s: Slot, n: number): void {
    s.instrNo = n;
    s.instr = this.word(INSTRUMENT_PTR) + INSTRUMENT_BASE + n * INSTRUMENT_LEN;
    s.bendRange = this.byte(s.instr + 0x0F);
    this.loadInstrument(s);
  }

  /** fn 03c4: the sixteen bytes of a record are nine OPL registers. */
  private loadInstrument(s: Slot): void {
    const bx = s.instr, op1 = s.ops & 0xFF, op2 = (s.ops >> 8) & 0xFF;
    this.out(0x60 + op1, this.byte(bx + 0)); this.out(0x60 + op2, this.byte(bx + 1));
    this.out(0x80 + op1, this.byte(bx + 2)); this.out(0x80 + op2, this.byte(bx + 3));
    this.out(0xE0 + op1, this.byte(bx + 6)); this.out(0xE0 + op2, this.byte(bx + 7));
    this.out(0xC0 + s.chan, this.byte(bx + 9));
    this.out(0x20 + op1, this.byte(bx + 4)); this.out(0x20 + op2, this.byte(bx + 5));
  }

  /** fn 049e: work out the note and key it on. */
  private noteOn(s: Slot): void {
    let note: number;
    if (s.drum === 0) {
      note = (s.note - 0x18 + this.byte(s.instr + 8)) & 0xFF;
    } else {                                                 // percussion: the note picks the instrument
      const mapped = this.byte(this.word(INSTRUMENT_PTR) + s.note);
      if (mapped !== s.instrNo) this.useInstrument(s, mapped);
      note = this.byte(s.instr + 8);
      s.note = note;
    }
    const f = this.frequency(s, note);
    this.out(0xA0 + s.chan, f & 0xFF);
    s.b0 = ((f >> 8) | 0x20) & 0xFF;
    this.out(0xB0 + s.chan, s.b0);
  }

  private keyOff(s: Slot): void {
    if ((s.b0 & 0x20) === 0) return;
    s.b0 &= ~0x20;
    this.out(0xB0 + s.chan, s.b0);
  }

  /** fn 0503: note (in 1/64 semitone steps, with the bend) -> the 0xa0 and 0xb0 bytes. */
  private frequency(s: Slot, note: number): number {
    const base = (note << 6) & 0xFFFF;
    let ax = (base + this.bend(s)) & 0xFFFF;
    const semitone = (ax >> 6) & 0xFF;                       // the octave and note within it
    let index = ax;
    while (index >= 0x300) index -= 0x300;
    let block = this.byte(BLOCK_TABLE + semitone);
    let fnum = this.word(FNUM_TABLE + index * 2);
    if (fnum & 0x8000) { fnum &= 0x1FFF; block = (block + 4) & 0xFF; }
    if (semitone < 7) fnum >>= 1;
    fnum &= 0x1FFF;
    return (fnum & 0xFF) | ((((fnum >> 8) | block) & 0xFF) << 8);
  }

  /** fn 0551: the bend byte, 0x40 in the middle, scaled by the instrument's range. */
  private bend(s: Slot): number {
    const d = (s.bend - 0x40) & 0xFF;
    if (s.bend >= 0x40) return ((s.bend - 0x40) * s.bendRange) & 0xFFFF;
    return (-(((0x100 - d) & 0xFF) * s.bendRange)) & 0xFFFF;
  }

  /** fn 0567: instrument level, note velocity, channel volume and the global volume into registers 0x40. */
  private level(s: Slot, velocity: number): void {
    const bx = s.instr, op1 = s.ops & 0xFF, op2 = (s.ops >> 8) & 0xFF;
    // the instrument's byte 0x0c holds both key scale levels: bits 1-0 the carrier's, bits 5-4 the modulator's
    const carrier = this.attenuate(this.byte(bx + 0x0B), velocity, s.volume);
    this.out(0x40 + op2, carrier | ((this.byte(bx + 0x0C) << 6) & 0xC0));
    // the modulator only follows the velocity when the pair is additive, but either way its level goes
    // through the same table: what the instrument holds is loudness, what the chip wants is attenuation
    const raw = this.byte(bx + 0x0A);
    const modulator = (this.byte(bx + 9) & 1) !== 0
      ? this.attenuate(raw, velocity, s.volume)
      : this.byte(ATTENUATION + raw);
    this.out(0x40 + op1, modulator | ((this.byte(bx + 0x0C) << 2) & 0xC0));
  }

  /** The chain of multiplies in fn 0567, then the driver's own 0..255 to 6-bit attenuation table. */
  private attenuate(instrument: number, velocity: number, channel: number): number {
    let v = ((((instrument + 1) * (velocity + 1)) >> 1) * 8) >>> 1;
    v = Math.floor((v * ((channel + 1) * 2)) / 0x100) & 0xFFFF;      // 0589: ax = (dx:ax) >> 8
    v = Math.floor((v * (this.word(GLOBAL_VOLUME) + 1)) / 0x10000);  // 0594: al = dl
    return this.byte(ATTENUATION + (v & 0xFF));
  }

  /** fn 088f and the list at 0x104a: shut every channel up. */
  private silence(): void {
    for (const s of this.slots) s.b0 &= ~0x20;
    for (let at = SILENCE_LIST; at + 1 < this.data.length; at += 2) {   // fn 080d: through fn 019d, so it lands
      const pair = this.word(at);
      if (pair === 0) break;
      this.force(pair & 0xFF, (pair >> 8) & 0xFF);
    }
  }
}

/** The driver's pair of divisions: a 16.16 rate of sequencer ticks per game tick. */
function rate32(numerator: number, perMinute: number): number {
  const whole = Math.floor(numerator / perMinute);
  const rest = numerator % perMinute;
  const fraction = Math.floor(((rest * 0x10000) + whole) / perMinute);
  return ((whole << 16) | (fraction & 0xFFFF)) >>> 0;
}
