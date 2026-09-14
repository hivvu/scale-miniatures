"""Sound Images Generation 2 driver files (DRIVER1.BIN = OPL2, DRIVER2.BIN = PC speaker).

Reads the sound bank and the instrument records the game plays through the driver, and turns a sequence
into the delta/event list the sequencer walks. See re/notes/90-sound.md.

    python3 -m tools.mm.sound [DRIVER1.BIN]
"""
from dataclasses import dataclass, field

# where each driver keeps the two pointers the sequencer uses
BANK_PTR = {1: 0x13F2, 2: 0x74B}
INSTRUMENT_PTR = {1: 0x13F4, 2: 0x74D}
NOTE_TABLE_LEN = 0x80
INSTRUMENT_LEN = 0x10
ENGINE_RECORDS = 0x0008        # sound numbers >= 0x40 play a 16-byte record from here
ENGINE_LEN = 0x10

# bytes each event takes after its own byte (0x00..0x7f is a note: note, velocity)
EVENT_ARGS = {0x90: 1, 0x91: 0, 0x92: 1, 0x93: 1, 0x94: 1, 0x95: 1, 0x96: 1, 0x97: 1,
              0x98: 0, 0x99: 0, 0x9A: 0, 0x9B: 1, 0x9C: 0, 0x9D: 2, 0xFF: 0}


@dataclass
class Event:
    delta: int                  # ticks to wait before this event
    kind: int                   # the event byte
    args: tuple = ()

    def __str__(self) -> str:
        if self.kind < 0x80:
            return f'+{self.delta} note {self.kind} vel {self.args[0]}'
        if 0x80 <= self.kind <= 0x8F:
            return f'+{self.delta} channel {self.kind & 0xF}'
        names = {0x90: 'note off', 0x91: 'end', 0x92: 'instrument', 0x93: 'tempo', 0x98: 'loop',
                 0x99: 'all notes off', 0x9A: 'silence', 0x9C: 'loop point', 0xFF: 'nop'}
        name = names.get(self.kind, f'cmd {self.kind:02x}')
        return f'+{self.delta} {name}' + (' ' + ' '.join(str(a) for a in self.args) if self.args else '')


@dataclass
class Driver:
    data: bytes
    generation: int = 1
    bank: int = 0
    instruments: int = 0
    sounds: list = field(default_factory=list)      # file offsets, one per sound number

    @classmethod
    def load(cls, path: str, generation: int = 1) -> 'Driver':
        data = open(path, 'rb').read()
        d = cls(data, generation)
        d.bank = d.word(BANK_PTR[generation])
        d.instruments = d.word(INSTRUMENT_PTR[generation])
        count = data[d.bank]
        d.sounds = [d.bank + d.word(d.bank + 1 + i * 2) for i in range(count)]
        return d

    def word(self, at: int) -> int:
        return self.data[at] | (self.data[at + 1] << 8)

    def instrument(self, n: int) -> bytes:
        at = self.instruments + NOTE_TABLE_LEN + n * INSTRUMENT_LEN
        return self.data[at:at + INSTRUMENT_LEN]

    def start(self, sound: int) -> int:
        """File offset of the sequence sound `sound` plays (1-based, as the game numbers them)."""
        if sound >= 0x40:
            return ENGINE_RECORDS + (sound - 0x40) * ENGINE_LEN
        return self.sounds[sound - 1]

    def vlq(self, at: int) -> tuple:
        """MIDI variable-length quantity; returns (value, next offset)."""
        value = 0
        for _ in range(5):
            b = self.data[at]; at += 1
            if b < 0x80:
                return value + b, at
            value = (value + (b & 0x7F)) * 0x80
        return value, at

    def sequence(self, sound: int, limit: int = 4096) -> list:
        """The events of one sound, up to its 0x91 (or `limit` events)."""
        at = self.start(sound)
        out = []
        for _ in range(limit):
            delta, at = self.vlq(at)
            kind = self.data[at]; at += 1
            if kind < 0x80:
                out.append(Event(delta, kind, (self.data[at],))); at += 1
            elif kind <= 0x8F:
                out.append(Event(delta, kind))
            else:
                n = EVENT_ARGS.get(kind)
                if n is None:
                    out.append(Event(delta, kind)); break
                out.append(Event(delta, kind, tuple(self.data[at:at + n]))); at += n
                if kind == 0x91:
                    break
        return out


if __name__ == '__main__':
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else 'MicroMac/DRIVER1.BIN'
    gen = 2 if path.upper().endswith('DRIVER2.BIN') else 1
    d = Driver.load(path, gen)
    print(f'{path}: bank at {d.bank:#06x}, {len(d.sounds)} sounds, instruments at {d.instruments:#06x}')
    for n in range(1, len(d.sounds) + 1):
        events = d.sequence(n)
        print(f'--- sound {n} at {d.start(n):#06x} ({len(events)} events)')
        print('   ', '; '.join(str(e) for e in events[:14]), '...' if len(events) > 14 else '')
    for n in range(0x40, 0x44):
        print(f'--- engine record {n:#04x} at {d.start(n):#06x}')
        print('   ', '; '.join(str(e) for e in d.sequence(n, 12)))
