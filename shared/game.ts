export const factions = ["mafia", "citizen", "third"] as const;
export type Faction = (typeof factions)[number];
export const roleIds = [
  "godfather",
  "saul",
  "matador",
  "terrorist",
  "mafia",
  "doctor",
  "detective",
  "sniper",
  "gunman",
  "constantine",
  "citizen",
  "zodiac",
  "nostradamus",
] as const;
export type Role = (typeof roleIds)[number];
export type RoleCounts = Record<Role, number>;
export const roles: Record<
  Role,
  { faction: Faction; unique: boolean; night: boolean }
> = {
  godfather: { faction: "mafia", unique: true, night: false },
  saul: { faction: "mafia", unique: true, night: true },
  matador: { faction: "mafia", unique: true, night: true },
  terrorist: { faction: "mafia", unique: true, night: false },
  mafia: { faction: "mafia", unique: false, night: false },
  doctor: { faction: "citizen", unique: true, night: true },
  detective: { faction: "citizen", unique: true, night: true },
  sniper: { faction: "citizen", unique: true, night: true },
  gunman: { faction: "citizen", unique: true, night: true },
  constantine: { faction: "citizen", unique: true, night: true },
  citizen: { faction: "citizen", unique: false, night: false },
  zodiac: { faction: "third", unique: true, night: true },
  nostradamus: { faction: "third", unique: true, night: true },
};
export const windows = [
  "mafia",
  "saul",
  "matador",
  "doctor",
  "detective",
  "sniper",
  "gunman",
  "constantine",
  "zodiac",
  "nostradamus",
] as const;
export type NightWindow = (typeof windows)[number];
export type Phase =
  "lobby" | "day" | "night" | "voting" | "defense" | "revenge" | "finished";
export type Winner = Faction | "draw" | "cancelled";
export type Outcome =
  | "pending"
  | "hit"
  | "miss"
  | "no_effect"
  | "blocked"
  | "protected"
  | "success"
  | "skipped";
export type Timer = { kind: "speaking" | "challenge"; endsAt: number } | null;
export type VotingMode = "single" | "twoRound";
export const RULES_VERSION = "mafia-table-1";

export function suggestedCounts(count: number): RoleCounts {
  const counts = Object.fromEntries(
    roleIds.map((role) => [role, 0]),
  ) as RoleCounts;
  counts.godfather = 1;
  counts.mafia = Math.max(0, Math.floor(count / 3) - 1);
  counts.doctor = count >= 5 ? 1 : 0;
  counts.detective = count >= 6 ? 1 : 0;
  counts.citizen = Math.max(
    0,
    count - counts.godfather - counts.mafia - counts.doctor - counts.detective,
  );
  return counts;
}

export type Command =
  | { type: "configure"; counts: RoleCounts; votingMode: VotingMode }
  | { type: "start" }
  | { type: "beginNight" }
  | { type: "nextNight"; skipMissing: boolean }
  | {
      type: "action";
      targetIds: string[];
      window: NightWindow;
      day: number;
      guess?: Role;
      gun?: "real" | "blank";
    }
  | { type: "align"; side: "mafia" | "citizen"; day: number }
  | { type: "openVoting" }
  | { type: "vote"; ballotId: string; targetId: string | null }
  | { type: "closeVoting"; skipMissing: boolean }
  | { type: "shoot"; targetId: string; day: number }
  | { type: "revenge"; targetId: string | null }
  | { type: "skipRevenge" }
  | { type: "remove"; playerId: string }
  | { type: "leave" }
  | { type: "abandon" }
  | { type: "timer"; kind: "speaking" | "challenge" | "stop" };

export interface PlayerView {
  id: string;
  name: string;
  isGuest: boolean;
  alive: boolean;
  role: Role | null;
  originalRole: Role | null;
  left: boolean;
  revealed: boolean;
}
export interface ActionView {
  id: string;
  actorId: string;
  targetIds: string[];
  window: NightWindow;
  day: number;
  outcome: Outcome;
  guess: Role | null;
  gun: "real" | "blank" | null;
}
export const noticeKinds = [
  "investigation",
  "prediction",
  "alignment",
  "recruited",
  "recruitFailed",
  "blocked",
  "gunReceived",
  "nightResult",
] as const;
export interface PrivateNotice {
  id: string;
  kind: (typeof noticeKinds)[number];
  day: number;
  targetIds: string[];
  value: string | number | null;
}
export const eventKinds = [
  "joined",
  "left",
  "removed",
  "configured",
  "started",
  "awake",
  "nightResolved",
  "voteOpened",
  "voteClosed",
  "shot",
  "revenge",
  "finished",
  "abandoned",
  "timer",
] as const;
export interface PublicEvent {
  id: string;
  kind: (typeof eventKinds)[number];
  day: number;
  playerIds: string[];
  value: string | number | null;
  createdAt: number;
}
export interface BallotView {
  id: string;
  round: 1 | 2;
  candidates: string[];
  eligibleIds: string[];
  submittedIds: string[];
  myVote: { targetId: string | null } | null;
}
export interface VoteResult {
  round: 1 | 2;
  tally: Record<string, number>;
  abstentions: number;
  eliminatedId: string | null;
  candidateIds: string[];
}
export interface AbilityView {
  sniperShots: number;
  selfHeals: number;
  recruitAvailable: boolean;
  reviveAvailable: boolean;
  senseAvailable: boolean;
  gunSupply: number;
  hasGun: boolean;
  alignment: "mafia" | "citizen" | null;
  predictionCount: number | null;
  needsAlignment: boolean;
}
export interface GameView {
  code: string;
  isGm: boolean;
  selfId: string | null;
  phase: Phase;
  day: number;
  counts: RoleCounts | null;
  players: PlayerView[];
  window: NightWindow | null;
  canAct: boolean;
  eligibleTargetIds: string[];
  neededTargets: number;
  missingActorIds: string[];
  nightProgress: { current: number; total: number };
  submitted: ActionView | null;
  actions: ActionView[];
  teammates: { id: string; name: string }[];
  timer: Timer;
  winner: Winner | null;
  endReason: "victory" | "abandoned" | "draw" | null;
  revision: number;
  serverNow: number;
  votingMode: VotingMode;
  rulesVersion: string;
  ballot: BallotView | null;
  lastVote: VoteResult | null;
  votedToday: boolean;
  revengeId: string | null;
  abilities: AbilityView | null;
  notices: PrivateNotice[];
  events: PublicEvent[];
  mafiaChoices: { actorId: string; targetIds: string[] }[];
}
export interface GameSummary {
  code: string;
  phase: Phase;
  day: number;
  isGm: boolean;
  playerCount: number;
  createdAt: number;
}
export interface MatchSummary {
  code: string;
  finishedAt: number;
  winner: Winner;
  playerCount: number;
  role: Role | null;
  result: "won" | "lost" | "draw" | "cancelled" | null;
}
export interface Report {
  code: string;
  finishedAt: number;
  winner: Winner;
  rulesVersion: string;
  players: {
    id: string;
    name: string;
    role: Role;
    originalRole: Role;
    won: boolean;
    firstDay: boolean;
    alignment: "mafia" | "citizen" | null;
  }[];
  actions: ActionView[];
  events: PublicEvent[];
  votes: {
    day: number;
    round: number;
    voterId: string;
    targetId: string | null;
  }[];
}
export interface ReportsView {
  stats: {
    matches: number;
    wins: number;
    firstDay: number;
    sniperHits: number;
    sniperShots: number;
    roleHistory: Partial<Record<Role, number>>;
  };
  matches: MatchSummary[];
  nextPage: number | null;
}
export interface Identity {
  id: string;
  username: string | null;
  isGuest: boolean;
  emailEnabled: boolean;
  email: string | null;
  pendingEmail: string | null;
}
export interface SessionView {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}
export const errorCodes = [
  "invalid",
  "notFound",
  "forbidden",
  "closed",
  "full",
  "counts",
  "phase",
  "target",
  "pending",
  "stale",
  "rateLimit",
  "server",
  "network",
  "authentication",
  "usernameTaken",
  "weakPassword",
  "accountExists",
  "activeGames",
  "accountConflict",
  "busy",
  "duplicateName",
  "ability",
  "voteRequired",
  "missingChoices",
  "csrf",
  "legacyRules",
  "emailUnavailable",
  "emailVerification",
  "emailInUse",
  "resetLink",
] as const;
export type ErrorCode = (typeof errorCodes)[number];
