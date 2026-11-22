import { createHash, randomInt, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  RULES_VERSION,
  suggestedCounts,
  type ActionView,
  type Command,
  type GameSummary,
  type GameView,
  type MatchSummary,
  type PublicEvent,
  type Report,
  type ReportsView,
} from "../shared/game.js";
import { nameKey } from "../shared/input.js";
import { transaction } from "./database.js";
import { GameError } from "./errors.js";
import {
  gameDataSchema,
  initialPlayerState,
  noticeSchema,
  publicEventSchema,
  type Game,
  type Player,
} from "./model.js";
import {
  applyCommand,
  currentWindow,
  eligibleActors,
  eligibleTargets,
  factionOf,
  finishGame,
  isMember,
  isPlayerCommand,
  missingActors,
  publish,
  submittedAction,
} from "./rules.js";
import {
  actionRowSchema,
  gameRowSchema,
  playerRowSchema,
  timerSchema,
  voteRowSchema,
} from "./validation.js";

export { GameError } from "./errors.js";
const actionView = (a: ActionView): ActionView => ({
  id: a.id,
  actorId: a.actorId,
  targetIds: a.targetIds,
  window: a.window,
  day: a.day,
  outcome: a.outcome,
  guess: a.guess,
  gun: a.gun,
});

const lobbyEvents = new Set<PublicEvent["kind"]>(["joined", "left", "removed"]);
const staleLobby = 7 * 24 * 60 * 60_000;
const staleGame = 30 * 24 * 60 * 60_000;
const receiptLifetime = 24 * 60 * 60_000;
// The columns that save() may change after a row exists.
const playerRow = (p: Player) =>
  JSON.stringify([
    p.name,
    p.role,
    p.originalRole,
    p.alive,
    p.firstDay,
    p.state,
    p.result,
  ]);
interface Snapshot {
  rows: Map<string, string>;
  notices: number;
  events: number;
}
function snapshotOf(game: Game): Snapshot {
  const rows = new Map<string, string>();
  for (const p of game.players) rows.set(`p:${p.id}`, playerRow(p));
  for (const a of game.actions) rows.set(`a:${a.id}`, a.outcome);
  for (const v of game.votes)
    rows.set(`v:${v.ballotId}:${v.voterId}`, String(v.targetId));
  return { rows, notices: game.notices.length, events: game.events.length };
}

export class GameStore {
  private snapshots = new WeakMap<Game, Snapshot>();
  constructor(private db: DatabaseSync) {}

  private load(code: string): Game {
    const row = this.db.prepare("SELECT * FROM games WHERE code = ?").get(code);
    if (!row) throw new GameError("notFound", 404);
    const g = gameRowSchema.parse(row);
    const game: Game = {
      id: g.id,
      code: g.code,
      gmId: g.gm_id,
      phase: g.phase,
      day: g.day,
      counts: g.counts,
      timer: g.timer ? timerSchema.parse(JSON.parse(g.timer)) : null,
      winner: g.winner,
      revision: g.revision,
      createdAt: g.created_at,
      finishedAt: g.finished_at,
      rulesVersion: g.rules_version,
      data: g.state,
      players: playerRowSchema
        .array()
        .parse(
          this.db
            .prepare(
              "SELECT * FROM players WHERE game_id = ? ORDER BY joined_at,id",
            )
            .all(g.id),
        )
        .map((p) => ({
          id: p.id,
          profileId: p.profile_id,
          name: p.name,
          role: p.role,
          originalRole: p.original_role,
          alive: p.alive === 1,
          firstDay: p.first_day === 1,
          joinedAt: p.joined_at,
          state: p.state,
          result: p.result,
        })),
      actions: actionRowSchema
        .array()
        .parse(
          this.db
            .prepare(
              "SELECT * FROM actions WHERE game_id = ? ORDER BY created_at,id",
            )
            .all(g.id),
        )
        .map((a) => ({
          id: a.id,
          actorId: a.actor_id,
          targetIds: a.targets,
          window: a.night_window,
          day: a.day,
          outcome: a.outcome,
          guess: a.guess,
          gun: a.gun,
          createdAt: a.created_at,
        })),
      votes: voteRowSchema
        .array()
        .parse(
          this.db
            .prepare(
              "SELECT * FROM votes WHERE game_id = ? ORDER BY day,round,voter_id",
            )
            .all(g.id),
        )
        .map((v) => ({
          ballotId: v.ballot_id,
          day: v.day,
          round: v.round,
          voterId: v.voter_id,
          targetId: v.target_id,
        })),
      notices: this.db
        .prepare(
          "SELECT data FROM private_notices WHERE game_id = ? ORDER BY rowid",
        )
        .all(g.id)
        .map((r) => noticeSchema.parse(JSON.parse(String(r.data)))),
      events: this.db
        .prepare(
          "SELECT data FROM public_events WHERE game_id = ? ORDER BY rowid",
        )
        .all(g.id)
        .map((r) => publicEventSchema.parse(JSON.parse(String(r.data)))),
    };
    this.snapshots.set(game, snapshotOf(game));
    return game;
  }
  private save(game: Game) {
    this.db
      .prepare(
        `UPDATE games SET phase=?,day=?,counts=?,night_window=?,timer=?,winner=?,revision=?,finished_at=?,state=?,rules_version=? WHERE id=?`,
      )
      .run(
        game.phase,
        game.day,
        JSON.stringify(game.counts),
        currentWindow(game),
        game.timer ? JSON.stringify(game.timer) : null,
        game.winner,
        game.revision,
        game.finishedAt,
        JSON.stringify(game.data),
        game.rulesVersion,
        game.id,
      );
    const player = this.db
      .prepare(`INSERT INTO players(id,game_id,profile_id,name,role,original_role,alive,first_day,joined_at,state,result)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,
      original_role=excluded.original_role,alive=excluded.alive,first_day=excluded.first_day,state=excluded.state,result=excluded.result`);
    const saved = this.snapshots.get(game);
    const unchanged = (key: string, value: string) =>
      saved?.rows.get(key) === value;
    for (const p of game.players) {
      if (unchanged(`p:${p.id}`, playerRow(p))) continue;
      player.run(
        p.id,
        game.id,
        p.profileId,
        p.name,
        p.role,
        p.originalRole,
        Number(p.alive),
        Number(p.firstDay),
        p.joinedAt,
        JSON.stringify(p.state),
        p.result,
      );
    }
    const action = this.db
      .prepare(`INSERT INTO actions(id,game_id,actor_id,targets,night_window,day,outcome,guess,gun,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome`);
    for (const a of game.actions) {
      if (unchanged(`a:${a.id}`, a.outcome)) continue;
      action.run(
        a.id,
        game.id,
        a.actorId,
        JSON.stringify(a.targetIds),
        a.window,
        a.day,
        a.outcome,
        a.guess,
        a.gun,
        a.createdAt,
      );
    }
    const vote = this.db
      .prepare(`INSERT INTO votes(game_id,ballot_id,day,round,voter_id,target_id) VALUES (?,?,?,?,?,?)
      ON CONFLICT(ballot_id,voter_id) DO UPDATE SET target_id=excluded.target_id`);
    for (const v of game.votes) {
      if (unchanged(`v:${v.ballotId}:${v.voterId}`, String(v.targetId)))
        continue;
      vote.run(game.id, v.ballotId, v.day, v.round, v.voterId, v.targetId);
    }
    const notice = this.db.prepare(
      "INSERT OR IGNORE INTO private_notices(id,game_id,player_id,data) VALUES (?,?,?,?)",
    );
    // Notices and public events are only ever added.
    for (const n of game.notices.slice(saved?.notices ?? 0))
      notice.run(n.id, game.id, n.playerId, JSON.stringify(n));
    const event = this.db.prepare(
      "INSERT OR IGNORE INTO public_events(id,game_id,data) VALUES (?,?,?)",
    );
    for (const e of game.events.slice(saved?.events ?? 0))
      event.run(e.id, game.id, JSON.stringify(e));
    this.snapshots.set(game, snapshotOf(game));
  }
  private authorize(game: Game, profileId: string) {
    const seat = game.players.find((p) => p.profileId === profileId);
    const self = seat && isMember(seat) ? seat : undefined;
    const isGm = game.gmId === profileId;
    if (!self && !isGm)
      throw new GameError(seat?.state.removed ? "removed" : "forbidden", 403);
    return { self, isGm };
  }
  // Joining and leaving the lobby is only shown for people who are still at the table.
  private publicEvents(game: Game) {
    const members = new Set(game.players.filter(isMember).map((p) => p.id));
    return game.events.filter(
      (event) =>
        !lobbyEvents.has(event.kind) ||
        event.playerIds.every((id) => members.has(id)),
    );
  }
  create(profile: string): string {
    return transaction(this.db, () => {
      if (
        Number(
          this.db
            .prepare(
              "SELECT COUNT(*) AS count FROM games WHERE gm_id = ? AND phase != 'finished'",
            )
            .get(profile)!.count,
        ) >= 5
      ) {
        throw new GameError("activeGames");
      }
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code: string;
      do {
        code = Array.from(
          { length: 6 },
          () => alphabet[randomInt(alphabet.length)],
        ).join("");
      } while (this.db.prepare("SELECT 1 FROM games WHERE code = ?").get(code));
      this.db
        .prepare(
          "INSERT INTO games(id,code,gm_id,counts,created_at,state,rules_version) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          code,
          profile,
          JSON.stringify(suggestedCounts(6)),
          Date.now(),
          JSON.stringify(gameDataSchema.parse({})),
          RULES_VERSION,
        );
      return code;
    });
  }
  join(code: string, profile: string, name: string) {
    transaction(this.db, () => {
      const game = this.load(code);
      if (game.gmId === profile) return;
      const existing = game.players.find((p) => p.profileId === profile);
      if (existing && !existing.state.left) return;
      if (existing?.state.removed) throw new GameError("removed", 403);
      if (game.phase !== "lobby") throw new GameError("closed");
      const active = game.players.filter((p) => !p.state.left);
      if (active.length >= 30) throw new GameError("full");
      if (active.some((p) => nameKey(p.name) === nameKey(name)))
        throw new GameError("duplicateName");
      if (existing) {
        existing.name = name;
        existing.state = initialPlayerState(null);
        existing.alive = true;
      } else {
        const player: Player = {
          id: randomUUID(),
          profileId: profile,
          name,
          role: null,
          originalRole: null,
          alive: true,
          firstDay: false,
          joinedAt: Date.now(),
          state: initialPlayerState(null),
          result: null,
        };
        game.players.push(player);
      }
      publish(game, "joined", Date.now(), [
        game.players.find((p) => p.profileId === profile)!.id,
      ]);
      game.revision++;
      this.save(game);
    });
  }
  view(code: string, profile: string): GameView {
    const game = this.load(code);
    const { self, isGm } = this.authorize(game, profile);
    const window = currentWindow(game);
    const currentRules = game.rulesVersion === RULES_VERSION;
    const awake =
      currentRules &&
      self &&
      eligibleActors(game).some((p) => p.id === self.id);
    const submitted = self ? submittedAction(game, self.id) : undefined;
    const targets = currentRules && self ? eligibleTargets(game, self) : [];
    const ballot = game.data.ballot;
    const votes = ballot
      ? game.votes.filter((v) => v.ballotId === ballot.id)
      : [];
    const myVote = votes.find((v) => v.voterId === self?.id);
    const mafiaAwake = awake && window === "mafia";
    // Players only learn about a night step while it is their own turn.
    const shownWindow = isGm || awake ? window : null;
    const accountPlayers = new Set(
      this.db
        .prepare(
          `SELECT players.id FROM players
           JOIN accounts ON accounts.profile_id = players.profile_id
           WHERE players.game_id = ?`,
        )
        .all(game.id)
        .map((row) => String(row.id)),
    );
    return {
      code,
      isGm,
      selfId: self?.id ?? null,
      phase: game.phase,
      day: game.day,
      counts: isGm ? game.counts : null,
      players: game.players.filter(isMember).map((p) => {
        const reveal =
          isGm ||
          p.id === self?.id ||
          p.state.revealed ||
          game.phase === "finished";
        return {
          id: p.id,
          name: p.name,
          isGuest: !accountPlayers.has(p.id),
          alive: p.alive,
          role: reveal ? p.role : null,
          originalRole: reveal ? p.originalRole : null,
          left: p.state.left,
          revealed: p.state.revealed,
        };
      }),
      window: shownWindow,
      canAct: !!awake && !submitted,
      eligibleTargetIds: targets.map((p) => p.id),
      neededTargets: shownWindow === "nostradamus" ? 3 : game.day === 0 ? 0 : 1,
      missingActorIds: isGm ? missingActors(game).map((p) => p.id) : [],
      nightProgress: isGm
        ? {
            current: game.data.nightIndex + 1,
            total: game.data.nightOrder.length,
          }
        : { current: 0, total: 0 },
      submitted: submitted ? actionView(submitted) : null,
      actions: isGm ? game.actions.map(actionView) : [],
      teammates: mafiaAwake
        ? game.players
            .filter((p) => factionOf(p) === "mafia")
            .map((p) => ({ id: p.id, name: p.name }))
        : [],
      mafiaChoices: mafiaAwake
        ? game.actions
            .filter((a) => a.day === game.day && a.window === "mafia")
            .map((a) => ({ actorId: a.actorId, targetIds: a.targetIds }))
        : [],
      timer: game.timer,
      winner: game.winner,
      endReason: game.data.endReason,
      revision: game.revision,
      serverNow: Date.now(),
      votingMode: game.data.votingMode,
      rulesVersion: game.rulesVersion,
      ballot: ballot
        ? {
            ...ballot,
            submittedIds: votes.map((v) => v.voterId),
            myVote: myVote ? { targetId: myVote.targetId } : null,
          }
        : null,
      lastVote: game.data.lastVote,
      votedToday: game.data.votedDay === game.day,
      revengeId: game.data.revengeId,
      abilities: self
        ? {
            sniperShots: self.state.sniperShots,
            selfHeals: self.state.selfHeals,
            recruitAvailable: !self.state.recruitUsed,
            reviveAvailable: !self.state.reviveUsed,
            senseAvailable: !self.state.senseUsed,
            gunSupply: self.state.gunSupply,
            hasGun: !!self.state.gun,
            alignment: self.state.alignment,
            predictionCount: self.state.predictionCount,
            needsAlignment:
              !!awake &&
              self.role === "nostradamus" &&
              self.state.predictionCount !== null &&
              !self.state.alignment,
          }
        : null,
      notices: game.notices
        .filter((n) => n.playerId === self?.id)
        .map(({ id, kind, day, targetIds, value }) => ({
          id,
          kind,
          day,
          targetIds,
          value,
        })),
      events: this.publicEvents(game)
        .filter(
          (event) =>
            isGm || game.phase === "finished" || event.kind !== "awake",
        )
        .slice(-40),
    };
  }
  command(
    code: string,
    profile: string,
    command: Command,
    revision: number,
    requestId: string = randomUUID(),
  ) {
    transaction(this.db, () => {
      const game = this.load(code);
      this.authorize(game, profile);
      if (game.rulesVersion !== RULES_VERSION && command.type !== "abandon")
        throw new GameError("legacyRules");
      const payloadHash = createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex");
      const receipt = this.db
        .prepare(
          "SELECT payload_hash FROM command_receipts WHERE game_id=? AND profile_id=? AND request_id=?",
        )
        .get(game.id, profile, requestId);
      if (receipt) {
        if (receipt.payload_hash !== payloadHash)
          throw new GameError("invalid");
        return;
      }
      if (!isPlayerCommand(command) && revision !== game.revision)
        throw new GameError("stale", 409);
      applyCommand(game, profile, command, Date.now());
      game.revision++;
      this.save(game);
      this.db
        .prepare(
          "INSERT INTO events(game_id,actor_profile_id,type,day,payload,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          game.id,
          profile,
          command.type,
          game.day,
          JSON.stringify(command),
          Date.now(),
        );
      this.db
        .prepare("INSERT INTO command_receipts VALUES (?,?,?,?,?)")
        .run(requestId, game.id, profile, payloadHash, Date.now());
    });
  }
  list(profile: string): GameSummary[] {
    const rows = this.db
      .prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM players WHERE game_id=g.id AND json_extract(state,'$.left')=0) AS player_count
      FROM games g WHERE (gm_id=? OR id IN (SELECT game_id FROM players WHERE profile_id=? AND json_extract(state,'$.left')=0))
      AND phase!='finished' ORDER BY created_at DESC LIMIT 30`,
      )
      .all(profile, profile);
    return rows.map((row) => {
      const g = gameRowSchema.parse(row);
      return {
        code: g.code,
        phase: g.phase,
        day: g.day,
        isGm: g.gm_id === profile,
        playerCount: Number(row.player_count),
        createdAt: g.created_at,
      };
    });
  }
  reports(profile: string, page = 0): ReportsView {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) AS matches,
      SUM(CASE WHEN p.result='won' THEN 1 ELSE 0 END) AS wins, SUM(p.first_day) AS first_day
      FROM players p JOIN games g ON p.game_id=g.id
      WHERE p.profile_id=? AND g.phase='finished' AND p.result IN ('won','lost','draw')`,
      )
      .get(profile)!;
    const shots = this.db
      .prepare(
        `SELECT COUNT(*) AS shots, SUM(CASE WHEN a.outcome='hit' THEN 1 ELSE 0 END) AS hits
      FROM actions a JOIN players p ON p.id=a.actor_id JOIN games g ON g.id=a.game_id
      WHERE p.profile_id=? AND g.phase='finished' AND g.winner!='cancelled' AND a.night_window='sniper' AND json_array_length(a.targets)>0 AND a.outcome!='blocked'`,
      )
      .get(profile)!;
    const roleHistory: ReportsView["stats"]["roleHistory"] = {};
    for (const row of this.db
      .prepare(
        `SELECT p.original_role,COUNT(*) AS count FROM players p JOIN games g ON p.game_id=g.id
      WHERE p.profile_id=? AND g.phase='finished' AND p.result IN ('won','lost','draw') GROUP BY p.original_role`,
      )
      .all(profile)) {
      const role = playerRowSchema.shape.original_role.parse(row.original_role);
      if (role) roleHistory[role] = Number(row.count);
    }
    const rows = this.db
      .prepare(
        `SELECT g.*,p.original_role AS own_role,p.result AS own_result,
      (SELECT COUNT(*) FROM players WHERE game_id=g.id AND role IS NOT NULL) AS player_count
      FROM games g LEFT JOIN players p ON p.game_id=g.id AND p.profile_id=?
        AND (p.role IS NOT NULL OR json_extract(p.state,'$.left')=0)
      WHERE g.phase='finished' AND (g.gm_id=? OR p.id IS NOT NULL)
      ORDER BY g.finished_at DESC,g.id LIMIT 21 OFFSET ?`,
      )
      .all(profile, profile, page * 20);
    const matches: MatchSummary[] = rows.slice(0, 20).map((row) => {
      const g = gameRowSchema.parse(row);
      return {
        code: g.code,
        finishedAt: g.finished_at!,
        winner: g.winner ?? "cancelled",
        playerCount: Number(row.player_count),
        role: playerRowSchema.shape.original_role.parse(row.own_role ?? null),
        result: playerRowSchema.shape.result.parse(row.own_result ?? null),
      };
    });
    return {
      stats: {
        matches: Number(result.matches),
        wins: Number(result.wins ?? 0),
        firstDay: Number(result.first_day ?? 0),
        sniperHits: Number(shots.hits ?? 0),
        sniperShots: Number(shots.shots),
        roleHistory,
      },
      matches,
      nextPage: rows.length > 20 ? page + 1 : null,
    };
  }
  report(code: string, profile: string): Report {
    const game = this.load(code);
    this.authorize(game, profile);
    if (game.phase !== "finished") throw new GameError("phase");
    return {
      code,
      finishedAt: game.finishedAt!,
      winner: game.winner ?? "cancelled",
      rulesVersion: game.rulesVersion,
      players: game.players
        .filter((p) => p.role !== null)
        .map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role!,
          originalRole: p.originalRole!,
          won: p.result === "won",
          firstDay: p.firstDay,
          alignment: p.state.alignment,
        })),
      actions: game.actions.map(actionView),
      events: this.publicEvents(game),
      votes: game.votes.map(({ day, round, voterId, targetId }) => ({
        day,
        round,
        voterId,
        targetId,
      })),
    };
  }
  export(profile: string) {
    const games = this.db
      .prepare(
        `SELECT code FROM games WHERE gm_id=? OR id IN
      (SELECT game_id FROM players WHERE profile_id=?
        AND (role IS NOT NULL OR json_extract(state,'$.left')=0)) ORDER BY created_at`,
      )
      .all(profile, profile);
    return games.map((row) => {
      const game = this.load(String(row.code));
      const self = game.players.find((p) => p.profileId === profile);
      return {
        view: this.view(game.code, profile),
        report:
          game.phase === "finished" ? this.report(game.code, profile) : null,
        ownActions: game.actions
          .filter((a) => a.actorId === self?.id)
          .map(actionView),
      };
    });
  }
  // Every table this profile hosts or sits at. Used to tell only those tables about a change.
  codesFor(profile: string): string[] {
    return this.db
      .prepare(
        `SELECT code FROM games WHERE gm_id=? OR id IN
      (SELECT game_id FROM players WHERE profile_id=?)`,
      )
      .all(profile, profile)
      .map((row) => String(row.code));
  }
  // Removes lobbies nobody used for a week, ends matches that stood still for a month,
  // and drops old retry receipts. Returns the codes of the tables that changed.
  prune(now = Date.now()): string[] {
    const lastActivity = `max(g.created_at,
      COALESCE((SELECT MAX(created_at) FROM events WHERE game_id=g.id),0),
      COALESCE((SELECT MAX(joined_at) FROM players WHERE game_id=g.id),0))`;
    return transaction(this.db, () => {
      const changed: string[] = [];
      for (const row of this.db
        .prepare(
          `SELECT g.id,g.code FROM games g WHERE g.phase='lobby' AND ${lastActivity} < ?`,
        )
        .all(now - staleLobby)) {
        for (const table of [
          "command_receipts",
          "events",
          "public_events",
          "private_notices",
          "votes",
          "actions",
          "players",
        ])
          this.db.prepare(`DELETE FROM ${table} WHERE game_id=?`).run(row.id);
        this.db.prepare("DELETE FROM games WHERE id=?").run(row.id);
        changed.push(String(row.code));
      }
      for (const row of this.db
        .prepare(
          `SELECT g.code FROM games g WHERE g.phase NOT IN ('lobby','finished') AND ${lastActivity} < ?`,
        )
        .all(now - staleGame)) {
        const game = this.load(String(row.code));
        finishGame(game, "cancelled", now);
        game.revision++;
        this.save(game);
        changed.push(game.code);
      }
      this.db
        .prepare("DELETE FROM command_receipts WHERE created_at < ?")
        .run(now - receiptLifetime);
      return changed;
    });
  }
}
