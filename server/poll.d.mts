/** Types for poll.mjs, which is plain JavaScript so it can be run with nothing but node. */
import type { Server } from 'node:http';

export interface PollOption { id: string; label: string }
export interface Vote { choices: string[]; comment?: string; voter?: string }
export interface Tally { options: PollOption[]; counts: Record<string, number>; votes: number }

export const OPTIONS: PollOption[];
export function parseVote(body: unknown): { vote: Vote; error?: undefined } | { vote?: undefined; error: string };
export const MAX_FEEDBACK: number;
export type Feedback =
  | { note: { text: string; room?: string }; error?: undefined }
  | { note?: undefined; error: string };
export function parseFeedback(body: unknown): Feedback;
export function tally(votes: Vote[]): Tally;
export function readVotes(file: string): Promise<Vote[]>;
export function makeLimiter(perWindow?: number, windowMs?: number): (ip: string, now?: number) => boolean;
export function start(): Promise<Server>;
