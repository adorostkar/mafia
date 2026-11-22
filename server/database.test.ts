import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { suggestedCounts } from "../shared/game.js";
import { backupDatabase } from "./backup.js";
import { openDatabase } from "./database.js";
import { GameStore } from "./game.js";

const directories: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), "mafia-database-test-"));
  directories.push(path);
  return path;
}
function legacyDatabase(path: string, finished = true) {
  const db = new DatabaseSync(path);
  databases.push(db);
  db.exec(`
    CREATE TABLE profiles(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),expires_at INTEGER NOT NULL);
    CREATE TABLE games(
      id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,gm_id TEXT NOT NULL REFERENCES profiles(id),
      phase TEXT NOT NULL DEFAULT 'lobby',day INTEGER NOT NULL DEFAULT 0,counts TEXT NOT NULL,
      night_window TEXT,timer TEXT,winner TEXT,revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,finished_at INTEGER
    );
    CREATE TABLE players(
      id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id),profile_id TEXT NOT NULL REFERENCES profiles(id),
      name TEXT NOT NULL,role TEXT,alive INTEGER NOT NULL DEFAULT 1,first_day INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL,UNIQUE(game_id,profile_id)
    );
    CREATE TABLE actions(
      id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id),actor_id TEXT NOT NULL REFERENCES players(id),
      target_id TEXT NOT NULL REFERENCES players(id),night_window TEXT NOT NULL,day INTEGER NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,UNIQUE(game_id,actor_id,day,night_window)
    );
    CREATE INDEX actions_game ON actions(game_id);
  `);
  for (const id of ["gm", "player", "mafia", "citizen1", "citizen2"])
    db.prepare("INSERT INTO profiles VALUES (?,1)").run(id);
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    "test-session-hash",
    "player",
    Date.now() + 60_000,
  );
  const counts = { ...suggestedCounts(4), doctor: 1, citizen: 2 };
  db.prepare(
    "INSERT INTO games(id,code,gm_id,phase,day,counts,night_window,winner,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "match",
    "BCD234",
    "gm",
    finished ? "finished" : "night",
    1,
    JSON.stringify(counts),
    "doctor",
    finished ? "citizen" : null,
    1,
    finished ? 2 : null,
  );
  for (const [id, role] of [
    ["player", "doctor"],
    ["mafia", "godfather"],
    ["citizen1", "citizen"],
    ["citizen2", "citizen"],
  ]) {
    db.prepare(
      "INSERT INTO players(id,game_id,profile_id,name,role,joined_at) VALUES (?,'match',?,?,?,1)",
    ).run(id, id, id, role);
  }
  db.exec(
    "INSERT INTO actions VALUES ('choice','match','player','citizen1','doctor',1,'hit',1)",
  );
  db.close();
}

it("migrates the original schema once, preserving reports, sessions, and the actions index", () => {
  const path = join(directory(), "legacy.sqlite");
  legacyDatabase(path);
  const db = openDatabase(path);
  databases.push(db);
  const store = new GameStore(db);
  expect(store.report("BCD234", "player")).toMatchObject({
    winner: "citizen",
    rulesVersion: "legacy-gm-led",
    actions: [{ id: "choice", targetIds: ["citizen1"], outcome: "hit" }],
  });
  expect(store.reports("player").stats).toMatchObject({
    matches: 1,
    wins: 1,
    roleHistory: { doctor: 1 },
  });
  expect(db.prepare("SELECT id FROM sessions").get()?.id).toBeTruthy();
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='actions_game'",
      )
      .all(),
  ).toHaveLength(1);
  db.close();
  const reopened = openDatabase(path);
  databases.push(reopened);
  expect(
    new GameStore(reopened).report("BCD234", "player").actions,
  ).toHaveLength(1);
});

it("does not silently apply new abilities to a legacy match that was already in progress", () => {
  const path = join(directory(), "active-legacy.sqlite");
  legacyDatabase(path, false);
  const db = openDatabase(path);
  databases.push(db);
  const store = new GameStore(db);
  const game = store.view("BCD234", "gm");
  expect(game.phase).toBe("night");
  expect(store.view("BCD234", "player")).toMatchObject({
    canAct: false,
    eligibleTargetIds: [],
  });
  expect(() =>
    store.command(
      game.code,
      "gm",
      { type: "nextNight", skipMissing: true },
      game.revision,
    ),
  ).toThrow("legacyRules");
  store.command(game.code, "gm", { type: "abandon" }, game.revision);
  expect(store.report(game.code, "gm").winner).toBe("cancelled");
  expect(store.reports("player").stats.matches).toBe(0);
});

it("backs up committed WAL data while the source is open and refuses to overwrite files", async () => {
  const root = directory();
  const source = join(root, "source.sqlite");
  const target = join(root, "backup.sqlite");
  const db = openDatabase(source);
  databases.push(db);
  const profile = randomUUID();
  db.prepare("INSERT INTO profiles VALUES (?,?)").run(profile, Date.now());
  const store = new GameStore(db);
  const code = store.create(profile);
  await backupDatabase(source, target);
  const copy = openDatabase(target);
  databases.push(copy);
  expect(new GameStore(copy).view(code, profile).code).toBe(code);
  expect(statSync(target).mode & 0o777).toBe(0o600);
  const protectedFile = join(root, "existing.sqlite");
  writeFileSync(protectedFile, "keep this file");
  await expect(backupDatabase(source, protectedFile)).rejects.toThrow();
  expect(readFileSync(protectedFile, "utf8")).toBe("keep this file");
  await expect(backupDatabase(source, source)).rejects.toThrow(
    "different file",
  );
});

it("refuses databases made by a newer application version", () => {
  const path = join(directory(), "future.sqlite");
  const future = new DatabaseSync(path);
  future.exec("PRAGMA user_version=99");
  future.close();
  expect(() => openDatabase(path)).toThrow("newer version");
});
