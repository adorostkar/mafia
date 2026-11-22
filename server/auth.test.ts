import { afterEach, beforeEach, expect, it } from "vitest";
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

it("keeps guest games on registration and recovers the same profile on another device", async () => {
  const first = await browser();
  const game = (await post(first.client, "/games", {}).expect(201)).body;
  const registered = (await register(first.client)).body;
  expect(registered.identity).toEqual({
    id: first.identity.id,
    username: "aino",
    isGuest: false,
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
