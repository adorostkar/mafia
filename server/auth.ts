import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Identity, SessionView } from "../shared/game.js";
import { transaction } from "./database.js";
import { GameError } from "./errors.js";
import { accountEmail, emailSchema, type Mailer } from "./email.js";

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
  username: z.union([usernameSchema, emailSchema]),
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
  email: z.string().nullable(),
  created_at: z.number(),
});
const sessionLifetime = 30 * 24 * 60 * 60_000;
const guestLifetime = 365 * 24 * 60 * 60_000;

export class AuthStore {
  constructor(
    private db: DatabaseSync,
    private email?: Mailer,
  ) {}

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
    const account = this.db
      .prepare("SELECT email FROM accounts WHERE profile_id=?")
      .get(session.profileId);
    const pending = this.db
      .prepare("SELECT email FROM email_registrations WHERE profile_id=?")
      .get(session.profileId);
    return {
      id: session.profileId,
      username: session.username,
      isGuest: !session.username,
      emailEnabled: !!this.email,
      email: account?.email ? String(account.email) : null,
      pendingEmail: pending ? String(pending.email) : null,
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
        .prepare(
          "INSERT INTO accounts(profile_id,username,password_hash,recovery_hash,created_at) VALUES (?,?,?,?,?)",
        )
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
  async beginEmailRegistration(
    session: AuthSession,
    username: string,
    password: string,
    email: string,
    language: string,
  ) {
    if (!this.email) throw new GameError("invalid");
    this.requireSession(session);
    if (session.username) throw new GameError("accountExists");
    const passwordHash = await hashPassword(password);
    const code = randomInt(1_000_000).toString().padStart(6, "0");
    transaction(this.db, () => {
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
      const pending = this.db
        .prepare(
          "SELECT last_sent_at FROM email_registrations WHERE profile_id=?",
        )
        .get(session.profileId);
      if (pending && Number(pending.last_sent_at) > Date.now() - 60_000)
        throw new GameError("rateLimit", 429);
      this.db
        .prepare(
          `INSERT INTO email_registrations(profile_id,username,email,password_hash,code_hash,expires_at,last_sent_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET
        username=excluded.username,email=excluded.email,password_hash=excluded.password_hash,
        code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,last_sent_at=excluded.last_sent_at`,
        )
        .run(
          session.profileId,
          username,
          email,
          passwordHash,
          hashToken(code),
          Date.now() + 15 * 60_000,
          Date.now(),
        );
    });
    await this.deliverVerification(email, code, language);
  }
  private async deliverVerification(
    email: string,
    code: string,
    language: string,
  ) {
    if (!this.email) throw new GameError("notFound", 404);
    try {
      await this.email.send(
        accountEmail("verification", email, code, language),
      );
    } catch (error) {
      console.error("Could not send a verification email", error);
      throw new GameError("emailUnavailable", 503);
    }
  }
  async resendVerification(session: AuthSession, language: string) {
    if (!this.email) throw new GameError("notFound", 404);
    this.requireSession(session);
    const row = this.db
      .prepare(
        "SELECT email,last_sent_at FROM email_registrations WHERE profile_id=?",
      )
      .get(session.profileId);
    if (!row) throw new GameError("emailVerification");
    if (Number(row.last_sent_at) > Date.now() - 60_000)
      throw new GameError("rateLimit", 429);
    const code = randomInt(1_000_000).toString().padStart(6, "0");
    this.db
      .prepare(
        "UPDATE email_registrations SET code_hash=?,expires_at=?,attempts=0,last_sent_at=? WHERE profile_id=?",
      )
      .run(
        hashToken(code),
        Date.now() + 15 * 60_000,
        Date.now(),
        session.profileId,
      );
    await this.deliverVerification(String(row.email), code, language);
  }
  verifyEmail(session: AuthSession, code: string) {
    this.requireSession(session);
    const row = this.db
      .prepare("SELECT * FROM email_registrations WHERE profile_id=?")
      .get(session.profileId);
    if (
      !row ||
      Number(row.expires_at) <= Date.now() ||
      Number(row.attempts) >= 5
    )
      throw new GameError("emailVerification");
    if (
      !timingSafeEqual(
        Buffer.from(String(row.code_hash), "hex"),
        Buffer.from(hashToken(code), "hex"),
      )
    ) {
      this.db
        .prepare(
          "UPDATE email_registrations SET attempts=attempts+1 WHERE profile_id=?",
        )
        .run(session.profileId);
      throw new GameError("emailVerification");
    }
    return transaction(this.db, () => {
      if (
        this.db
          .prepare("SELECT 1 FROM accounts WHERE profile_id=?")
          .get(session.profileId)
      )
        throw new GameError("accountExists");
      if (
        this.db
          .prepare("SELECT 1 FROM accounts WHERE username=?")
          .get(row.username)
      )
        throw new GameError("usernameTaken", 409);
      if (
        this.db.prepare("SELECT 1 FROM accounts WHERE email=?").get(row.email)
      )
        throw new GameError("emailInUse", 409);
      this.db
        .prepare(
          "INSERT INTO accounts(profile_id,username,password_hash,recovery_hash,created_at,email) VALUES (?,?,?,?,?,?)",
        )
        .run(
          session.profileId,
          row.username,
          row.password_hash,
          hashToken(randomBytes(24).toString("base64url")),
          Date.now(),
          row.email,
        );
      this.db
        .prepare("DELETE FROM email_registrations WHERE profile_id=?")
        .run(session.profileId);
      this.db
        .prepare("DELETE FROM sessions WHERE profile_id=?")
        .run(session.profileId);
      return this.issue(session.profileId);
    });
  }
  async requestEmailReset(email: string, language: string, origin: string) {
    if (!this.email) throw new GameError("notFound", 404);
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE email=?")
      .get(email);
    if (!row) return;
    const account = accountSchema.parse(row);
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        "INSERT INTO email_reset_tokens(token_hash,profile_id,credentials_hash,expires_at) VALUES (?,?,?,?)",
      )
      .run(
        hashToken(token),
        account.profile_id,
        hashToken(`${account.password_hash}:${account.recovery_hash}`),
        Date.now() + 30 * 60_000,
      );
    const url = new URL("/?view=reset", origin);
    url.hash = new URLSearchParams({ token }).toString();
    await this.email.send(accountEmail("reset", email, url.href, language));
  }
  async resetPassword(token: string, password: string) {
    const tokenHash = hashToken(token);
    const row = this.db
      .prepare(
        `SELECT a.*, t.credentials_hash, t.expires_at FROM email_reset_tokens t
      JOIN accounts a ON a.profile_id=t.profile_id WHERE t.token_hash=?`,
      )
      .get(tokenHash);
    if (!row || Number(row.expires_at) <= Date.now())
      throw new GameError("resetLink");
    const account = accountSchema.parse(row);
    if (
      row.credentials_hash !==
      hashToken(`${account.password_hash}:${account.recovery_hash}`)
    )
      throw new GameError("resetLink");
    const passwordHash = await hashPassword(password);
    transaction(this.db, () => {
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM email_reset_tokens WHERE token_hash=? AND expires_at>?",
          )
          .get(tokenHash, Date.now())
      )
        throw new GameError("resetLink");
      const changed = this.db
        .prepare(
          `UPDATE accounts SET password_hash=?, recovery_hash=?
        WHERE profile_id=? AND password_hash=? AND recovery_hash=?`,
        )
        .run(
          passwordHash,
          hashToken(randomBytes(24).toString("base64url")),
          account.profile_id,
          account.password_hash,
          account.recovery_hash,
        );
      if (!changed.changes) throw new GameError("resetLink");
      this.db
        .prepare("DELETE FROM email_reset_tokens WHERE profile_id=?")
        .run(account.profile_id);
      this.db
        .prepare("DELETE FROM sessions WHERE profile_id=?")
        .run(account.profile_id);
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
      .prepare("SELECT * FROM accounts WHERE username=? OR email=?")
      .get(username, username);
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
    this.db
      .prepare("DELETE FROM email_registrations WHERE expires_at<=?")
      .run(Date.now());
    this.db
      .prepare("DELETE FROM email_reset_tokens WHERE expires_at<=?")
      .run(Date.now());
  }
}
