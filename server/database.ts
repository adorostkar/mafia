import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { roles, windows, type Role } from "../shared/game.js";
import { gameDataSchema, initialPlayerState } from "./model.js";

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(path: string) {
  const db = new DatabaseSync(path);
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (version > 3) {
    db.close();
    throw new Error(
      "The database was created by a newer version of Mafia Table.",
    );
  }
  try {
    db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      gm_id TEXT NOT NULL REFERENCES profiles(id),
      phase TEXT NOT NULL DEFAULT 'lobby',
      day INTEGER NOT NULL DEFAULT 0,
      counts TEXT NOT NULL,
      night_window TEXT,
      timer TEXT,
      winner TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      name TEXT NOT NULL,
      role TEXT,
      alive INTEGER NOT NULL DEFAULT 1,
      first_day INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL,
      UNIQUE(game_id, profile_id)
    );
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      actor_id TEXT NOT NULL REFERENCES players(id),
      target_id TEXT NOT NULL REFERENCES players(id),
      night_window TEXT NOT NULL,
      day INTEGER NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      UNIQUE(game_id, actor_id, day, night_window)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      actor_profile_id TEXT NOT NULL REFERENCES profiles(id),
      type TEXT NOT NULL,
      day INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS players_profile ON players(profile_id);
    CREATE INDEX IF NOT EXISTS actions_game ON actions(game_id);
    CREATE INDEX IF NOT EXISTS events_game ON events(game_id);
    CREATE INDEX IF NOT EXISTS games_gm ON games(gm_id);
  `);
    if (version < 2) {
      transaction(db, () => {
        db.exec(`
        ALTER TABLE games ADD COLUMN state TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE games ADD COLUMN rules_version TEXT NOT NULL DEFAULT 'mafia-table-1';
        ALTER TABLE players ADD COLUMN original_role TEXT;
        ALTER TABLE players ADD COLUMN state TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE players ADD COLUMN result TEXT;
        ALTER TABLE sessions ADD COLUMN id TEXT;
        ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
        UPDATE players SET original_role = role;
        ALTER TABLE actions RENAME TO legacy_actions;
        CREATE TABLE actions (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id),
          actor_id TEXT NOT NULL REFERENCES players(id),
          targets TEXT NOT NULL,
          night_window TEXT NOT NULL,
          day INTEGER NOT NULL,
          outcome TEXT NOT NULL DEFAULT 'pending',
          guess TEXT,
          gun TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(game_id, actor_id, day, night_window)
        );
        INSERT INTO actions(id,game_id,actor_id,targets,night_window,day,outcome,created_at)
          SELECT id,game_id,actor_id,json_array(target_id),night_window,day,outcome,created_at FROM legacy_actions;
        DROP TABLE legacy_actions;
        CREATE INDEX actions_game ON actions(game_id);
        CREATE TABLE accounts (
          profile_id TEXT PRIMARY KEY REFERENCES profiles(id),
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          recovery_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE votes (
          game_id TEXT NOT NULL REFERENCES games(id),
          ballot_id TEXT NOT NULL,
          day INTEGER NOT NULL,
          round INTEGER NOT NULL,
          voter_id TEXT NOT NULL REFERENCES players(id),
          target_id TEXT REFERENCES players(id),
          PRIMARY KEY(ballot_id, voter_id)
        );
        CREATE INDEX votes_game ON votes(game_id);
        CREATE TABLE private_notices (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id),
          player_id TEXT NOT NULL REFERENCES players(id),
          data TEXT NOT NULL
        );
        CREATE INDEX notices_game ON private_notices(game_id);
        CREATE TABLE public_events (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL REFERENCES games(id),
          data TEXT NOT NULL
        );
        CREATE INDEX public_events_game ON public_events(game_id);
        CREATE TABLE command_receipts (
          request_id TEXT NOT NULL,
          game_id TEXT NOT NULL REFERENCES games(id),
          profile_id TEXT NOT NULL REFERENCES profiles(id),
          payload_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(game_id, profile_id, request_id)
        );
        CREATE INDEX sessions_profile ON sessions(profile_id);
        CREATE UNIQUE INDEX sessions_id ON sessions(id);
        CREATE INDEX games_finished ON games(finished_at DESC);
        PRAGMA user_version = 2;
      `);
        for (const row of db
          .prepare("SELECT id, role, game_id FROM players")
          .all()) {
          const role = row.role as Role | null;
          const game = db
            .prepare("SELECT winner FROM games WHERE id = ?")
            .get(row.game_id)!;
          db.prepare(
            "UPDATE players SET state = ?, result = ? WHERE id = ?",
          ).run(
            JSON.stringify(initialPlayerState(role)),
            game.winner && role
              ? roles[role].faction === game.winner
                ? "won"
                : "lost"
              : null,
            row.id,
          );
        }
        for (const row of db
          .prepare("SELECT id, phase, day, night_window FROM games")
          .all()) {
          const data = gameDataSchema.parse({});
          if (row.phase === "night") {
            const assigned = db
              .prepare(
                "SELECT role FROM players WHERE game_id = ? AND alive = 1",
              )
              .all(row.id)
              .map((p) => p.role as Role);
            data.nightOrder = windows.filter((window) =>
              window === "mafia"
                ? assigned.some((role) => roles[role].faction === "mafia")
                : assigned.includes(window),
            );
            if (!data.nightOrder.length) data.nightOrder = ["mafia"];
            data.nightIndex = Math.max(
              0,
              data.nightOrder.findIndex(
                (window) => window === row.night_window,
              ),
            );
          }
          if (row.phase === "finished") data.endReason = "victory";
          if (row.phase !== "lobby") {
            db.prepare(
              "UPDATE games SET rules_version = 'legacy-gm-led' WHERE id = ?",
            ).run(row.id);
          }
          db.prepare("UPDATE games SET state = ? WHERE id = ?").run(
            JSON.stringify(data),
            row.id,
          );
        }
        for (const row of db.prepare("SELECT token_hash FROM sessions").all()) {
          db.prepare(
            "UPDATE sessions SET id = ?, created_at = ?, last_seen_at = ? WHERE token_hash = ?",
          ).run(randomUUID(), Date.now(), Date.now(), row.token_hash);
        }
      });
    }
    if (version < 3) {
      transaction(db, () => {
        db.exec(`
          ALTER TABLE accounts ADD COLUMN email TEXT;
          CREATE UNIQUE INDEX accounts_email ON accounts(email) WHERE email IS NOT NULL;
          CREATE TABLE email_registrations (
            profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            code_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_sent_at INTEGER NOT NULL
          );
          CREATE TABLE email_reset_tokens (
            token_hash TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL REFERENCES accounts(profile_id) ON DELETE CASCADE,
            credentials_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL
          );
          CREATE INDEX email_reset_profile ON email_reset_tokens(profile_id);
          PRAGMA user_version = 3;
        `);
      });
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
