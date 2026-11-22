import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "./app.js";
import { openDatabase } from "./database.js";

let db: ReturnType<typeof openDatabase>;
let backend: ReturnType<typeof createApp>;
const password = "a long test passphrase 123";
beforeEach(() => {
  db = openDatabase(":memory:");
  backend = createApp(db);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  backend.closeStreams();
  db.close();
});
async function browser() {
  const client = request.agent(backend.app);
  const identity = (await client.get("/api/me").expect(200)).body;
  return { client, identity };
}
type Browser = Awaited<ReturnType<typeof browser>>["client"];
const post = (client: Browser, path: string, body: unknown) =>
  client
    .post(`/api${path}`)
    .set("X-Mafia-Client", "1")
    .send(body as object);
const register = (client: Browser, username = "aino") =>
  post(client, "/auth/register", {
    username,
    password,
    confirmPassword: password,
  }).expect(201);
const login = (
  client: Browser,
  username = "aino",
  secret = password,
  adoptGuest = true,
) => post(client, "/auth/login", { username, password: secret, adoptGuest });
const command = async (client: Browser, code: string, value: unknown) => {
  const state = (await client.get(`/api/games/${code}`).expect(200)).body;
  return post(client, `/games/${code}/commands`, {
    command: value,
    revision: state.revision,
    requestId: randomUUID(),
  });
};

it("labels guests and accounts without exposing login details or allowing duplicate table names", async () => {
  const gm = await browser();
  const guest = await browser();
  const member = await browser();
  const { code } = (await post(gm.client, "/games", {}).expect(201)).body;
  await post(guest.client, `/games/${code}/join`, { name: "Aino" }).expect(200);
  await register(member.client, "privatelogin");
  const duplicate = await post(member.client, `/games/${code}/join`, {
    name: "aino",
  }).expect(400);
  expect(duplicate.body.error).toBe("duplicateName");
  await post(member.client, `/games/${code}/join`, { name: "Aino K" }).expect(
    200,
  );
  const table = (await guest.client.get(`/api/games/${code}`).expect(200)).body;
  expect(table.players).toEqual([
    expect.objectContaining({ name: "Aino", isGuest: true }),
    expect.objectContaining({ name: "Aino K", isGuest: false }),
  ]);
  expect(JSON.stringify(table)).not.toContain("privatelogin");
  for (const player of table.players) {
    expect(player).not.toHaveProperty("email");
    expect(player).not.toHaveProperty("profileId");
    expect(player.role).toBeNull();
  }

  await register(guest.client, "newmember");
  const updated = (await gm.client.get(`/api/games/${code}`).expect(200)).body;
  expect(
    updated.players.find((player: { name: string }) => player.name === "Aino"),
  ).toMatchObject({
    id: table.players[0].id,
    isGuest: false,
  });
});

it("requires email verification before creating an email-mode account and keeps the guest's games", async () => {
  const messages: { to: string; text: string }[] = [];
  backend = createApp(db, {
    publicOrigin: "https://mafia.example",
    email: {
      send: async (message: { to: string; text: string }) => {
        messages.push(message);
      },
    },
  });
  const first = await browser();
  expect(first.identity).toMatchObject({ isGuest: true, emailEnabled: true });
  const game = (await post(first.client, "/games", {}).expect(201)).body;
  await post(first.client, "/auth/register", {
    username: "emailed",
    password,
    confirmPassword: password,
  }).expect(400);
  const pending = (
    await post(first.client, "/auth/register", {
      username: "emailed",
      password,
      confirmPassword: password,
      email: " Player@Example.com ",
      language: "en",
    }).expect(202)
  ).body;
  expect(pending.identity).toMatchObject({
    id: first.identity.id,
    isGuest: true,
    pendingEmail: "player@example.com",
  });
  expect(pending.recoveryCode).toBeUndefined();
  expect(messages).toHaveLength(1);
  expect(messages[0].to).toBe("player@example.com");
  const code = messages[0].text.match(/^\d{6}$/m)?.[0];
  expect(code).toMatch(/^\d{6}$/);
  await login(first.client, "emailed").expect(401);
  const verified = (
    await post(first.client, "/auth/verify-email", { code }).expect(201)
  ).body;
  expect(verified.identity).toMatchObject({
    id: first.identity.id,
    username: "emailed",
    isGuest: false,
    email: "player@example.com",
    pendingEmail: null,
  });
  expect(verified.recoveryCode).toBeUndefined();
  expect((await first.client.get("/api/games").expect(200)).body).toEqual([
    expect.objectContaining({ code: game.code }),
  ]);
  const second = await browser();
  await login(second.client, "PLAYER@EXAMPLE.COM").expect(200);
});

it("recovers by a private single-use email link without revealing whether an address has an account", async () => {
  const messages: { to: string; text: string }[] = [];
  backend = createApp(db, {
    publicOrigin: "https://mafia.example",
    email: {
      send: async (message) => {
        messages.push(message);
      },
    },
  });
  const first = await browser();
  await post(first.client, "/auth/register", {
    username: "emailed",
    password,
    confirmPassword: password,
    email: "player@example.com",
    language: "en",
  }).expect(202);
  await post(first.client, "/auth/verify-email", {
    code: messages[0].text.match(/^\d{6}$/m)?.[0],
  }).expect(201);
  const second = await browser();
  await login(second.client, "emailed").expect(200);
  const recovering = await browser();
  const known = await post(recovering.client, "/auth/request-reset", {
    email: "PLAYER@example.com",
    language: "en",
  }).expect(202);
  const unknown = await post(recovering.client, "/auth/request-reset", {
    email: "unknown@example.com",
    language: "en",
  }).expect(202);
  expect(known.body).toEqual(unknown.body);
  expect(messages).toHaveLength(2);
  const link = new URL(messages[1].text.match(/https:\/\/\S+/)![0]);
  expect(link.origin).toBe("https://mafia.example");
  expect(link.searchParams.has("token")).toBe(false);
  const token = new URLSearchParams(link.hash.slice(1)).get("token");
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(known.text).not.toContain(token);
  const body = {
    token,
    password: "another long secret passphrase",
    confirmPassword: "another long secret passphrase",
  };
  const reset = await post(
    recovering.client,
    "/auth/reset-password",
    body,
  ).expect(200);
  expect(reset.body.identity.id).toBe(recovering.identity.id);
  expect(reset.body.recoveryCode).toBeUndefined();
  await first.client.get("/api/games").expect(401);
  await second.client.get("/api/games").expect(401);
  await post(recovering.client, "/auth/reset-password", body).expect(400);
  await login(recovering.client, "emailed", password).expect(401);
  await login(recovering.client, "emailed", body.password).expect(200);
});

it("limits verification attempts, binds codes to the requesting guest and safely resends expired codes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const messages: { text: string; html: string }[] = [];
  backend = createApp(db, {
    publicOrigin: "https://mafia.example",
    email: {
      send: async (message) => {
        messages.push(message);
      },
    },
  });
  const first = await browser();
  await post(first.client, "/auth/register", {
    username: "emailed",
    password,
    confirmPassword: password,
    email: "player@example.com",
    language: "en",
  }).expect(202);
  const code = messages[0].text.match(/^\d{6}$/m)![0];
  const stranger = await browser();
  await post(stranger.client, "/auth/verify-email", { code }).expect(400);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt++) {
    await post(first.client, "/auth/verify-email", { code: wrong }).expect(400);
  }
  await post(first.client, "/auth/verify-email", { code }).expect(400);
  await post(first.client, "/auth/resend-verification", {
    language: "en",
  }).expect(429);
  vi.setSystemTime(Date.now() + 61_000);
  await post(first.client, "/auth/resend-verification", {
    language: "fi",
  }).expect(202);
  expect(messages).toHaveLength(2);
  expect(messages[1].text).toContain("Syötä tämä koodi");
  const resentCode = messages[1].text.match(/^\d{6}$/m)![0];
  vi.setSystemTime(Date.now() + 16 * 60_000);
  await post(first.client, "/auth/verify-email", { code: resentCode }).expect(
    400,
  );
  await post(first.client, "/auth/resend-verification", {
    language: "fa",
  }).expect(202);
  expect(messages[2].html).toContain('lang="fa" dir="rtl"');
  expect(messages[2].text).toContain("کد تا ۱۵ دقیقه معتبر است.");
  const freshCode = messages[2].text.match(/^\d{6}$/m)![0];
  const persianCode = freshCode.replace(
    /\d/g,
    (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)],
  );
  await post(first.client, "/auth/verify-email", { code: persianCode }).expect(
    201,
  );
  await post(first.client, "/auth/verify-email", { code: freshCode }).expect(
    400,
  );
});

it("reports verification delivery failures without creating an account and allows the guest to resume", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const messages: { text: string }[] = [];
  let available = false;
  backend = createApp(db, {
    publicOrigin: "https://mafia.example",
    email: {
      send: async (message) => {
        if (!available) throw new Error("Test mail provider unavailable");
        messages.push(message);
      },
    },
  });
  const first = await browser();
  const response = await post(first.client, "/auth/register", {
    username: "emailed",
    password,
    confirmPassword: password,
    email: "player@example.com",
  }).expect(503);
  expect(response.body.error).toBe("emailUnavailable");
  expect(logged).toHaveBeenCalled();
  expect((await first.client.get("/api/me")).body).toMatchObject({
    isGuest: true,
    pendingEmail: "player@example.com",
  });
  await login(first.client, "emailed").expect(401);
  available = true;
  vi.setSystemTime(Date.now() + 61_000);
  await post(first.client, "/auth/resend-verification", {}).expect(202);
  await post(first.client, "/auth/verify-email", {
    code: messages[0].text.match(/^\d{6}$/m)?.[0],
  }).expect(201);
});

it("expires reset links and invalidates them when account credentials change", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const messages: { text: string }[] = [];
  backend = createApp(db, {
    publicOrigin: "https://mafia.example",
    email: {
      send: async (message) => {
        messages.push(message);
      },
    },
  });
  const first = await browser();
  await post(first.client, "/auth/register", {
    username: "emailed",
    password,
    confirmPassword: password,
    email: "player@example.com",
  }).expect(202);
  await post(first.client, "/auth/verify-email", {
    code: messages[0].text.match(/^\d{6}$/m)?.[0],
  }).expect(201);
  const recovering = await browser();
  const resetToken = async () => {
    await post(recovering.client, "/auth/request-reset", {
      email: "player@example.com",
    }).expect(202);
    const link = new URL(messages.at(-1)!.text.match(/https:\/\/\S+/)![0]);
    return new URLSearchParams(link.hash.slice(1)).get("token");
  };
  const body = {
    password: "a replacement secret passphrase",
    confirmPassword: "a replacement secret passphrase",
  };
  const expired = await resetToken();
  vi.setSystemTime(Date.now() + 31 * 60_000);
  await post(recovering.client, "/auth/reset-password", {
    ...body,
    token: expired,
  }).expect(400);
  const beforeChange = await resetToken();
  await post(first.client, "/account/password", {
    ...body,
    currentPassword: password,
  }).expect(200);
  await post(recovering.client, "/auth/reset-password", {
    ...body,
    token: beforeChange,
  }).expect(400);
  const beforeCode = await resetToken();
  await post(first.client, "/account/recovery", {
    password: body.password,
  }).expect(200);
  await post(recovering.client, "/auth/reset-password", {
    ...body,
    token: beforeCode,
  }).expect(400);
});

it("keeps guest games on registration and recovers the same profile on another device", async () => {
  const first = await browser();
  const game = (await post(first.client, "/games", {}).expect(201)).body;
  const registered = (await register(first.client)).body;
  expect(registered.identity).toEqual({
    id: first.identity.id,
    username: "aino",
    isGuest: false,
    emailEnabled: false,
    email: null,
    pendingEmail: null,
  });
  expect(registered.recoveryCode).toHaveLength(32);
  const second = await browser();
  const otherGame = (await post(second.client, "/games", {}).expect(201)).body;
  const loggedIn = (await login(second.client).expect(200)).body;
  expect(loggedIn.identity.id).toBe(first.identity.id);
  expect(
    (await second.client.get("/api/games")).body.map(
      (g: { code: string }) => g.code,
    ),
  ).toEqual(expect.arrayContaining([game.code, otherGame.code]));
  const exported = (await second.client.get("/api/account/export").expect(200))
    .text;
  expect(exported).not.toContain(password);
  expect(exported).not.toContain(registered.recoveryCode);
  expect(exported).not.toContain("password_hash");
  expect(exported).not.toContain("token_hash");
});

it("uses generic login errors, checks passwords and protects writes against cross-origin requests", async () => {
  const { client } = await browser();
  await post(client, "/auth/register", {
    username: "aino",
    password: "short",
    confirmPassword: "short",
  }).expect(400);
  await register(client);
  const other = await browser();
  const wrong = await login(other.client, "aino", "wrong password").expect(401);
  const unknown = await login(other.client, "unknown", "wrong password").expect(
    401,
  );
  expect(wrong.body).toEqual(unknown.body);
  await other.client
    .post("/api/auth/login")
    .set("Origin", "https://untrusted.example")
    .set("X-Mafia-Client", "1")
    .send({ username: "aino", password, adoptGuest: true })
    .expect(403);
  expect((await other.client.get("/api/me")).body.isGuest).toBe(true);
  await post(other.client, "/auth/register", {
    username: "AINO",
    password,
    confirmPassword: password,
  }).expect(409);
});

it("makes recovery codes single-use, rotates them and invalidates all prior sessions", async () => {
  const first = await browser();
  const recoveryCode = (await register(first.client)).body.recoveryCode;
  const second = await browser();
  await login(second.client).expect(200);
  const recovering = await browser();
  const guestGame = (await post(recovering.client, "/games", {}).expect(201))
    .body.code;
  const newPassword = "a new and different passphrase";
  const body = {
    username: "aino",
    code: recoveryCode,
    password: newPassword,
    confirmPassword: newPassword,
  };
  const result = (
    await post(recovering.client, "/auth/recover", body).expect(200)
  ).body;
  expect(result.identity.isGuest).toBe(true);
  expect(result.identity.id).toBe(recovering.identity.id);
  expect(
    (await recovering.client.get("/api/games").expect(200)).body.map(
      (game: { code: string }) => game.code,
    ),
  ).toContain(guestGame);
  expect(result.recoveryCode).not.toBe(recoveryCode);
  await first.client.get("/api/games").expect(401);
  await second.client.get("/api/games").expect(401);
  await post(recovering.client, "/auth/recover", body).expect(401);
  await login(recovering.client, "aino", password).expect(401);
  await login(recovering.client, "aino", newPassword).expect(200);
});

it("requires reauthentication for account changes and revokes other sessions on password change", async () => {
  const first = await browser();
  await register(first.client);
  const second = await browser();
  await login(second.client).expect(200);
  const newPassword = "a changed secure test passphrase";
  await post(first.client, "/account/password", {
    currentPassword: "wrong",
    password: newPassword,
    confirmPassword: newPassword,
  }).expect(401);
  await post(first.client, "/account/password", {
    currentPassword: password,
    password: newPassword,
    confirmPassword: newPassword,
  }).expect(200);
  await second.client.get("/api/reports").expect(401);
  expect(
    (await first.client.get("/api/account/sessions").expect(200)).body,
  ).toHaveLength(1);
  await post(first.client, "/account/recovery", {
    password: newPassword,
  }).expect(200);
  await post(first.client, "/account/delete", {
    confirm: true,
    password: "wrong",
  }).expect(401);
});

it("lets a user revoke another session without exposing its token", async () => {
  const first = await browser();
  await register(first.client);
  const second = await browser();
  await login(second.client).expect(200);
  const sessions = (await first.client.get("/api/account/sessions").expect(200))
    .body;
  const other = sessions.find((s: { current: boolean }) => !s.current);
  expect(other).toBeTruthy();
  expect(Object.keys(other).sort()).toEqual([
    "createdAt",
    "current",
    "id",
    "lastSeenAt",
  ]);
  await post(first.client, "/account/sessions/revoke", { id: other.id }).expect(
    200,
  );
  await second.client.get("/api/games").expect(401);
});

it("refuses conflicting guest-history merges instead of merging two players in one game", async () => {
  const gm = await browser();
  const code = (await post(gm.client, "/games", {}).expect(201)).body.code;
  const first = await browser();
  await post(first.client, `/games/${code}/join`, { name: "Aino" }).expect(200);
  await register(first.client);
  const second = await browser();
  await post(second.client, `/games/${code}/join`, { name: "Matti" }).expect(
    200,
  );
  expect((await login(second.client).expect(409)).body.error).toBe(
    "accountConflict",
  );
  expect((await second.client.get("/api/me")).body.isGuest).toBe(true);
  await login(second.client, "aino", password, false).expect(400);
  await command(second.client, code, { type: "leave" });
  await login(second.client, "aino", password, false).expect(200);
});

it("deletes credentials and names while retaining opponents' anonymous match records", async () => {
  const gm = await browser();
  const code = (await post(gm.client, "/games", {}).expect(201)).body.code;
  const player = await browser();
  await post(player.client, `/games/${code}/join`, {
    name: "Private Name",
  }).expect(200);
  await register(player.client);
  await post(player.client, "/account/delete", {
    password,
    confirm: true,
  }).expect(400);
  await command(gm.client, code, { type: "abandon" });
  const deleted = (
    await post(player.client, "/account/delete", {
      password,
      confirm: true,
    }).expect(200)
  ).body;
  expect(deleted.identity.isGuest).toBe(true);
  expect(deleted.identity.id).not.toBe(player.identity.id);
  expect(
    db.prepare("SELECT 1 FROM accounts WHERE username='aino'").get(),
  ).toBeUndefined();
  expect(
    db.prepare("SELECT 1 FROM profiles WHERE id=?").get(player.identity.id),
  ).toBeUndefined();
  expect(
    db
      .prepare(
        "SELECT name FROM players WHERE game_id=(SELECT id FROM games WHERE code=?)",
      )
      .get(code)?.name,
  ).toBe("");
  expect((await gm.client.get(`/api/games/${code}`)).text).not.toContain(
    "Private Name",
  );
});
