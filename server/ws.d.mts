/** Types for ws.mjs, which is plain JavaScript so it can be run with nothing but node. */

export const OP: { CONT: number; TEXT: number; BINARY: number; CLOSE: number; PING: number; PONG: number };

export interface Message { opcode: number; payload: Buffer }
/** A message that arrived in pieces and is not finished yet. */
export interface Carry { opcode: number; parts: Buffer[] }

export function accept(key: string): string;
export function handshake(key: string): Buffer;
export function encode(opcode: number, payload?: Buffer | string): Buffer;
export function decode(buffer: Buffer, limit?: number, carry?: Carry | null): {
  messages: Message[];
  rest: Buffer;
  error?: string;
  carry: Carry | null;
};
export function close(code?: number, reason?: string): Buffer;
