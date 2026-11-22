import { z } from "zod";
import {
  eventKinds,
  noticeKinds,
  roleIds,
  windows,
  type ActionView,
  type Phase,
  type PublicEvent,
  type Role,
  type RoleCounts,
  type Timer,
  type Winner,
} from "../shared/game.js";

export const playerStateSchema = z.object({
  left: z.boolean().default(false),
  revealed: z.boolean().default(false),
  vest: z.number().int().nonnegative().default(0),
  sniperShots: z.number().int().nonnegative().default(0),
  selfHeals: z.number().int().nonnegative().default(1),
  lastHealId: z.string().nullable().default(null),
  lastHealDay: z.number().int().default(-1),
  lastBlockId: z.string().nullable().default(null),
  lastBlockDay: z.number().int().default(-1),
  recruitUsed: z.boolean().default(false),
  reviveUsed: z.boolean().default(false),
  senseUsed: z.boolean().default(false),
  revengeUsed: z.boolean().default(false),
  sealed: z.boolean().default(false),
  gunSupply: z.number().int().nonnegative().default(0),
  gun: z.enum(["real", "blank"]).nullable().default(null),
  alignment: z.enum(["mafia", "citizen"]).nullable().default(null),
  predictionCount: z.number().int().nullable().default(null),
});
export type PlayerState = z.infer<typeof playerStateSchema>;
export function initialPlayerState(role: Role | null): PlayerState {
  return playerStateSchema.parse({
    vest:
      role === "godfather" || role === "sniper" || role === "zodiac" ? 1 : 0,
    sniperShots: role === "sniper" ? 2 : 0,
    gunSupply: role === "gunman" ? 2 : 0,
  });
}
export const voteResultSchema = z.object({
  round: z.union([z.literal(1), z.literal(2)]),
  tally: z.record(z.string(), z.number()),
  abstentions: z.number(),
  eliminatedId: z.string().nullable(),
  candidateIds: z.array(z.string()),
});
export const gameDataSchema = z.object({
  votingMode: z.enum(["single", "twoRound"]).default("twoRound"),
  nightOrder: z.array(z.enum(windows)).default([]),
  nightIndex: z.number().int().default(0),
  ballot: z
    .object({
      id: z.string(),
      round: z.union([z.literal(1), z.literal(2)]),
      candidates: z.array(z.string()),
      eligibleIds: z.array(z.string()),
    })
    .nullable()
    .default(null),
  lastVote: voteResultSchema.nullable().default(null),
  votedDay: z.number().int().default(-1),
  revengeId: z.string().nullable().default(null),
  endReason: z.enum(["victory", "abandoned", "draw"]).nullable().default(null),
});
export type GameData = z.infer<typeof gameDataSchema>;
export interface Player {
  id: string;
  profileId: string;
  name: string;
  role: Role | null;
  originalRole: Role | null;
  alive: boolean;
  firstDay: boolean;
  joinedAt: number;
  state: PlayerState;
  result: "won" | "lost" | "draw" | "cancelled" | null;
}
export interface Action extends ActionView {
  createdAt: number;
}
export interface Vote {
  ballotId: string;
  day: number;
  round: 1 | 2;
  voterId: string;
  targetId: string | null;
}
export const noticeSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  kind: z.enum(noticeKinds),
  day: z.number(),
  targetIds: z.array(z.string()),
  value: z.union([z.string(), z.number()]).nullable(),
});
export type Notice = z.infer<typeof noticeSchema>;
export const publicEventSchema = z.object({
  id: z.string(),
  kind: z.enum(eventKinds),
  day: z.number(),
  playerIds: z.array(z.string()),
  value: z.union([z.string(), z.number()]).nullable(),
  createdAt: z.number(),
});
export interface Game {
  id: string;
  code: string;
  gmId: string;
  phase: Phase;
  day: number;
  counts: RoleCounts;
  timer: Timer;
  winner: Winner | null;
  revision: number;
  createdAt: number;
  finishedAt: number | null;
  rulesVersion: string;
  data: GameData;
  players: Player[];
  actions: Action[];
  votes: Vote[];
  notices: Notice[];
  events: PublicEvent[];
}
export const roleSchema = z.enum(roleIds);
