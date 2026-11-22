import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Identity, SessionView } from "../shared/game.js";
import { transaction } from "./database.js";
import { GameError } from "./errors.js";

const passwordCost = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
let hashing = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (hashing >= 2) throw new GameError("busy", 503);
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, passwordCost, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
  } finally {
    hashing--;
  }
}
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const result = await derive(password, salt);
  return `scrypt-131072-8-1$${salt.toString("hex")}$${result.toString("hex")}`;
}
async function verifyPassword(password: string, stored?: string) {
  const parts = stored?.split("$");
  if (
    parts &&
    (parts.length !== 3 ||
      parts[0] !== "scrypt-131072-8-1" ||
      !/^[a-f0-9]{32}$/.test(parts[1]) ||
      !/^[a-f0-9]{128}$/.test(parts[2]))
  ) {
    throw new Error("Invalid stored password hash");
  }
  // Unknown users perform the same expensive operation, without a discoverable dummy account.
  const result = await derive(
    password,
    parts ? Buffer.from(parts[1], "hex") : Buffer.alloc(16),
  );
  const expected = parts ? Buffer.from(parts[2], "hex") : Buffer.alloc(64);
  return timingSafeEqual(result, expected) && !!stored;
}
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/);
export const passwordSchema = z.string().min(15).max(128);
export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128),
  adoptGuest: z.boolean(),
});
export const sessionSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  hash: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  username: z.string().nullable(),
});
export type AuthSession = z.infer<typeof sessionSchema>;
const accountSchema = z.object({
  profile_id: z.string(),
  username: z.string(),
  password_hash: z.string(),
  recovery_hash: z.string(),
  created_at: z.number(),
});
const sessionLifetime = 30 * 24 * 60 * 60_000;
const guestLifetime = 365 * 24 * 60 * 60_000;

export class AuthStore {
  constructor(private db: DatabaseSync) {}

  session(token: string | undefined): AuthSession | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.db
      .prepare(
        `SELECT s.*,a.username FROM sessions s LEFT JOIN accounts a ON a.profile_id=s.profile_id
      WHERE s.token_hash=? AND s.expires_at>?`,
      )
      .get(hashToken(token), Date.now());
    if (!row) return null;
    if (Date.now() - Number(row.last_seen_at) > 60_000) {
      this.db
        .prepare("UPDATE sessions SET last_seen_at=? WHERE token_hash=?")
        .run(Date.now(), row.token_hash);
    }
    return sessionSchema.parse({
      id: row.id,
      profileId: row.profile_id,
      hash: row.token_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      username: row.username,
    });
  }
  isValid(session: AuthSession) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM sessions WHERE id=? AND profile_id=? AND expires_at>?",
      )
      .get(session.id, session.profileId, Date.now());
  }
  private requireSession(session: AuthSession) {
    if (!this.isValid(session)) throw new GameError("authentication", 401);
  }
  identity(session: AuthSession): Identity {
    return {
      id: session.profileId,
      username: session.username,
      isGuest: !session.username,
    };
  }
  private issue(profileId: string) {
    const token = randomBytes(32).toString("hex");
    const account = this.db
      .prepare("SELECT username FROM accounts WHERE profile_id=?")
      .get(profileId);
    const duration = account ? sessionLifetime : guestLifetime;
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO sessions(token_hash,profile_id,expires_at,id,created_at,last_seen_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        hashToken(token),
        profileId,
        Date.now() + duration,
        id,
        Date.now(),
        Date.now(),
      );
    return { token, maxAge: duration, session: this.session(token)! };
  }
  guest() {
    return transaction(this.db, () => {
      const profile = randomUUID();
      this.db
        .prepare("INSERT INTO profiles(id,created_at) VALUES (?,?)")
        .run(profile, Date.now());
      return this.issue(profile);
    });
  }
  async register(session: AuthSession, username: string, password: string) {
    if (session.username) throw new GameError("accountExists");
    const passwordHash = await hashPassword(password);
    const recoveryCode = randomBytes(24).toString("base64url");
    return transaction(this.db, () => {
      this.requireSession(session);
      if (
        this.db
          .prepare("SELECT 1 FROM accounts WHERE profile_id=?")
          .get(session.profileId)
      )
        throw new GameError("accountExists");
      if (
        this.db.prepare("SELECT 1 FROM accounts WHERE username=?").get(username)
      )
        throw new GameError("usernameTaken", 409);
      this.db
        .prepare("INSERT INTO accounts VALUES (?,?,?,?,?)")
        .run(
          session.profileId,
          username,
          passwordHash,
          hashToken(recoveryCode),
          Date.now(),
        );
      this.db
        .prepare("DELETE FROM sessions WHERE profile_id=?")
        .run(session.profileId);
      return { ...this.issue(session.profileId), recoveryCode };
    });
  }
  private adoptGuest(source: string, destination: string) {
    if (source === destination) return;
    if (
      this.db.prepare("SELECT 1 FROM accounts WHERE profile_id=?").get(source)
    )
      throw new GameError("accountExists");
    const conflicts = this.db
      .prepare(
        `SELECT g.id FROM games g
      WHERE (g.gm_id=? OR g.id IN (SELECT game_id FROM players WHERE profile_id=?))
        AND (g.gm_id=? OR g.id IN (SELECT game_id FROM players WHERE profile_id=?)) LIMIT 1`,
      )
      .get(source, source, destination, destination);
    if (conflicts) throw new GameError("accountConflict", 409);
    this.db
      .prepare("UPDATE players SET profile_id=? WHERE profile_id=?")
      .run(destination, source);
    this.db
      .prepare("UPDATE games SET gm_id=? WHERE gm_id=?")
      .run(destination, source);
    this.db
      .prepare("UPDATE events SET actor_profile_id=? WHERE actor_profile_id=?")
      .run(destination, source);
    this.db
      .prepare("UPDATE command_receipts SET profile_id=? WHERE profile_id=?")
      .run(destination, source);
    this.db.prepare("DELETE FROM sessions WHERE profile_id=?").run(source);
    this.db.prepare("DELETE FROM profiles WHERE id=?").run(source);
  }
  private hasActiveGames(profile: string) {
    return !!this.db
      .prepare(
        `SELECT 1 FROM games g WHERE g.phase!='finished' AND (
      g.gm_id=? OR g.id IN (SELECT game_id FROM players WHERE profile_id=? AND json_extract(state,'$.left')=0)
    ) LIMIT 1`,
      )
      .get(profile, profile);
  }
  async login(
    session: AuthSession,
    username: string,
    password: string,
    adoptGuest: boolean,
  ) {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE username=?")
      .get(username);
    const account = row ? accountSchema.parse(row) : null;
    if (!(await verifyPassword(password, account?.password_hash)) || !account)
      throw new GameError("authentication", 401);
    return transaction(this.db, () => {
      this.requireSession(session);
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM accounts WHERE profile_id=? AND password_hash=?",
          )
          .get(account.profile_id, account.password_hash)
      )
        throw new GameError("authentication", 401);
      if (session.username && session.profileId !== account.profile_id)
        throw new GameError("accountExists");
      if (!session.username && session.profileId !== account.profile_id) {
        if (adoptGuest) this.adoptGuest(session.profileId, account.profile_id);
        else if (this.hasActiveGames(session.profileId))
          throw new GameError("activeGames");
      }
      this.db.prepare("DELETE FROM sessions WHERE id=?").run(session.id);
      return this.issue(account.profile_id);
    });
  }
  logout(session: AuthSession) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(session.id);
    return this.guest();
  }
  async reauthenticate(session: AuthSession, password: string) {
    this.requireSession(session);
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE profile_id=?")
      .get(session.profileId);
    if (!row) throw new GameError("authentication", 401);
    const account = accountSchema.parse(row);
    if (!(await verifyPassword(password, account.password_hash)))
      throw new GameError("authentication", 401);
    this.requireSession(session);
    return account;
  }
  async changePassword(
    session: AuthSession,
    currentPassword: string,
    newPassword: string,
  ) {
    const account = await this.reauthenticate(session, currentPassword);
    const newHash = await hashPassword(newPassword);
    return transaction(this.db, () => {
      this.requireSession(session);
      const changed = this.db
        .prepare(
          "UPDATE accounts SET password_hash=? WHERE profile_id=? AND password_hash=?",
        )
        .run(newHash, session.profileId, account.password_hash);
      if (!changed.changes) throw new GameError("authentication", 401);
      this.db
        .prepare("DELETE FROM sessions WHERE profile_id=?")
        .run(session.profileId);
      return this.issue(session.profileId);
    });
  }
  async rotateRecovery(session: AuthSession, password: string) {
    const account = await this.reauthenticate(session, password);
    return transaction(this.db, () => {
      this.requireSession(session);
      const recoveryCode = randomBytes(24).toString("base64url");
      const changed = this.db
        .prepare(
          "UPDATE accounts SET recovery_hash=? WHERE profile_id=? AND password_hash=?",
        )
        .run(hashToken(recoveryCode), session.profileId, account.password_hash);
      if (!changed.changes) throw new GameError("authentication", 401);
      this.db
        .prepare("DELETE FROM sessions WHERE profile_id=?")
        .run(session.profileId);
      return { ...this.issue(session.profileId), recoveryCode };
    });
  }
  async recover(username: string, code: string, newPassword: string) {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE username=?")
      .get(username);
    const account = row ? accountSchema.parse(row) : null;
    const expected = account
      ? Buffer.from(account.recovery_hash, "hex")
      : Buffer.alloc(32);
    const valid = timingSafeEqual(
      Buffer.from(hashToken(code), "hex"),
      expected,
    );
    if (!account || !valid) throw new GameError("authentication", 401);
    const passwordHash = await hashPassword(newPassword);
    return transaction(this.db, () => {
      const recoveryCode = randomBytes(24).toString("base64url");
      const result = this.db
        .prepare(
          "UPDATE accounts SET password_hash=?,recovery_hash=? WHERE profile_id=? AND recovery_hash=?",
        )
        .run(
          passwordHash,
          hashToken(recoveryCode),
          account.profile_id,
          account.recovery_hash,
        );
      if (!result.changes) throw new GameError("authentication", 401);
      this.db
        .prepare("DELETE FROM sessions WHERE profile_id=?")
        .run(account.profile_id);
      return { recoveryCode };
    });
  }
  sessions(session: AuthSession): SessionView[] {
    return this.db
      .prepare(
        "SELECT id,created_at,last_seen_at FROM sessions WHERE profile_id=? AND expires_at>? ORDER BY created_at DESC",
      )
      .all(session.profileId, Date.now())
      .map((row) => ({
        id: String(row.id),
        createdAt: Number(row.created_at),
        lastSeenAt: Number(row.last_seen_at),
        current: row.id === session.id,
      }));
  }
  revoke(session: AuthSession, id: string) {
    if (id === session.id) throw new GameError("invalid");
    const result = this.db
      .prepare("DELETE FROM sessions WHERE profile_id=? AND id=?")
      .run(session.profileId, id);
    if (!result.changes) throw new GameError("notFound", 404);
  }
  async deleteProfile(session: AuthSession, password: string | undefined) {
    const account = session.username
      ? await this.reauthenticate(session, password ?? "")
      : null;
    transaction(this.db, () => {
      this.requireSession(session);
      if (this.hasActiveGames(session.profileId))
        throw new GameError("activeGames");
      if (
        account &&
        !this.db
          .prepare(
            "SELECT 1 FROM accounts WHERE profile_id=? AND password_hash=?",
          )
          .get(session.profileId, account.password_hash)
      )
        throw new GameError("authentication", 401);
      // Keep opponents' match records, but sever identity links and remove the player's names.
      const anonymous = randomUUID();
      this.db
        .prepare("INSERT INTO profiles(id,created_at) VALUES (?,0)")
        .run(anonymous);
      this.db
        .prepare("UPDATE players SET profile_id=?,name='' WHERE profile_id=?")
        .run(anonymous, session.profileId);
      this.db
        .prepare("UPDATE games SET gm_id=? WHERE gm_id=?")
        .run(anonymous, session.profileId);
      this.db
        .prepare(
          "UPDATE events SET actor_profile_id=?,payload='{}' WHERE actor_profile_id=?",
        )
        .run(anonymous, session.profileId);
      this.db
        .prepare("DELETE FROM command_receipts WHERE profile_id=?")
        .run(session.profileId);
      this.db
        .prepare("DELETE FROM accounts WHERE profile_id=?")
        .run(session.profileId);
      this.db
        .prepare("DELETE FROM sessions WHERE profile_id=?")
        .run(session.profileId);
      this.db.prepare("DELETE FROM profiles WHERE id=?").run(session.profileId);
    });
    return this.guest();
  }
  pruneExpiredSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
  }
}
