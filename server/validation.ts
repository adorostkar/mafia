import { z } from "zod";
import { factions, roleIds, windows, type Command } from "../shared/game.js";
import { gameDataSchema, playerStateSchema } from "./model.js";

export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine(
    (name) =>
      !Array.from(name).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ),
  );
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{6}$/);
export const countsSchema = z.record(
  z.enum(roleIds),
  z.number().int().min(0).max(30),
);
const targetId = z.string().uuid();
export const commandSchema: z.ZodType<Command> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("configure"),
    counts: countsSchema,
    votingMode: z.enum(["single", "twoRound"]),
  }),
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("beginNight") }),
  z.object({ type: z.literal("nextNight"), skipMissing: z.boolean() }),
  z.object({
    type: z.literal("action"),
    targetIds: z.array(targetId).max(3),
    window: z.enum(windows),
    day: z.number().int().nonnegative(),
    guess: z.enum(roleIds).optional(),
    gun: z.enum(["real", "blank"]).optional(),
  }),
  z.object({
    type: z.literal("align"),
    side: z.enum(["mafia", "citizen"]),
    day: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("openVoting") }),
  z.object({
    type: z.literal("vote"),
    ballotId: z.string().uuid(),
    targetId: targetId.nullable(),
  }),
  z.object({ type: z.literal("closeVoting"), skipMissing: z.boolean() }),
  z.object({
    type: z.literal("shoot"),
    targetId,
    day: z.number().int().positive(),
  }),
  z.object({ type: z.literal("revenge"), targetId: targetId.nullable() }),
  z.object({ type: z.literal("skipRevenge") }),
  z.object({ type: z.literal("remove"), playerId: targetId }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("abandon") }),
  z.object({
    type: z.literal("timer"),
    kind: z.enum(["speaking", "challenge", "stop"]),
  }),
]);
export const gameRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  gm_id: z.string(),
  phase: z.enum([
    "lobby",
    "day",
    "night",
    "voting",
    "defense",
    "revenge",
    "finished",
  ]),
  day: z.number(),
  counts: z.string().transform((s) => countsSchema.parse(JSON.parse(s))),
  timer: z.string().nullable(),
  winner: z.enum([...factions, "draw", "cancelled"]).nullable(),
  revision: z.number(),
  created_at: z.number(),
  finished_at: z.number().nullable(),
  state: z.string().transform((s) => gameDataSchema.parse(JSON.parse(s))),
  rules_version: z.string(),
});
export const playerRowSchema = z.object({
  id: z.string(),
  profile_id: z.string(),
  name: z.string(),
  role: z.enum(roleIds).nullable(),
  original_role: z.enum(roleIds).nullable(),
  alive: z.number(),
  first_day: z.number(),
  joined_at: z.number(),
  result: z.enum(["won", "lost", "draw", "cancelled"]).nullable(),
  state: z.string().transform((s) => playerStateSchema.parse(JSON.parse(s))),
});
export const actionRowSchema = z.object({
  id: z.string(),
  actor_id: z.string(),
  targets: z
    .string()
    .transform((s) => z.array(z.string()).parse(JSON.parse(s))),
  night_window: z.enum(windows),
  day: z.number(),
  outcome: z.enum([
    "pending",
    "hit",
    "miss",
    "no_effect",
    "blocked",
    "protected",
    "success",
    "skipped",
  ]),
  guess: z.enum(roleIds).nullable(),
  gun: z.enum(["real", "blank"]).nullable(),
  created_at: z.number(),
});
export const voteRowSchema = z.object({
  ballot_id: z.string(),
  day: z.number(),
  round: z.union([z.literal(1), z.literal(2)]),
  voter_id: z.string(),
  target_id: z.string().nullable(),
});
export const timerSchema = z.object({
  kind: z.enum(["speaking", "challenge"]),
  endsAt: z.number(),
});
