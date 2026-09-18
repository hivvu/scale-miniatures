/**
 * What the netcode needs of a wire.
 *
 * The house pattern, written twice already (`SoundPort` in `engine/sound/port.ts`, `AnalogueDevices` in
 * `engine/race.ts`): the part that does the thinking declares the interface, the HAL implements it, the page
 * wires the two together. So this file knows nothing about WebSockets, and `src/hal/net/Relay.ts` knows
 * nothing about races. A second implementation (WebRTC, once two people want the relay out of the middle)
 * drops in here without a line changing anywhere else.
 */

/** A member of a room, as everybody in it refers to them: 0 to 3, and the slot is the car. */
export type Slot = number;

export interface NetTransport {
  /** Which of them we are. */
  readonly slot: Slot;
  /** The four letters the other person types. */
  readonly room: string;
  /** Who else is in the room now. */
  readonly peers: readonly Slot[];
  /** True until the wire is gone. */
  readonly open: boolean;

  send(data: Uint8Array): void;
  close(): void;

  /** A packet from somebody else, exactly as they sent it. */
  onPacket: ((from: Slot, data: Uint8Array) => void) | undefined;
  onJoin: ((slot: Slot) => void) | undefined;
  onLeave: ((slot: Slot) => void) | undefined;
  /** Something went wrong the page should say out loud, in words a person can act on. */
  onError: ((why: string) => void) | undefined;
}
