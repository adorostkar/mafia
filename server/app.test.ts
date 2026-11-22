import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  suggestedCounts,
  type Command,
  type GameView,
  type Role,
} from "../shared/game.js";
import { openDatabase } from "./database.js";
import { createApp } from "./app.js";

let db: ReturnType<typeof openDatabase>;
let backend: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDatabase(":memory:");
  backend = createApp(db);
});
afterEach(() => {
  backend.closeStreams();
  db.close();
});

it("uses private cookie sessions and rejects cross-origin writes and strangers", async () => {
  const gm = request.agent(backend.app);
  const me = await gm.get("/api/me").expect(200);
  expect(me.headers["set-cookie"][0]).toContain("HttpOnly");
  expect(me.headers["set-cookie"][0]).toContain("SameSite=Strict");
  expect((await gm.get("/api/me")).body.id).toBe(me.body.id);
  await gm.post("/api/games").send({}).expect(403);
  await gm
    .post("/api/games")
    .set("X-Mafia-Client", "1")
    .set("Origin", "https://elsewhere.invalid")
    .send({})
    .expect(403);
  const { body } = await gm
    .post("/api/games")
    .set("X-Mafia-Client", "1")
    .send({})
    .expect(201);
  const stranger = request.agent(backend.app);
  await stranger.get("/api/me");
  await stranger.get(`/api/games/${body.code}`).expect(403);
  await stranger.get(`/api/games/${body.code}/events`).expect(403);
  await stranger
    .post(`/api/games/${body.code}/join`)
    .set("X-Mafia-Client", "1")
    .send({ name: "   " })
    .expect(400);
  await stranger
    .post(`/api/games/${body.code}/join`)
    .set("X-Mafia-Client", "1")
    .send({ name: "Aino" })
    .expect(200);
  expect((await gm.get(`/api/games/${body.code}`)).body.players[0].name).toBe(
    "Aino",
  );
});

it("completes a multiplayer match through HTTP with private night choices and saved statistics", async () => {
  const gm = request.agent(backend.app);
  await gm.get("/api/me").expect(200);
  const created = await gm
    .post("/api/games")
    .set("X-Mafia-Client", "1")
    .send({})
    .expect(201);
  const path = `/api/games/${created.body.code}`;
  const view = async (client = gm): Promise<GameView> =>
    (await client.get(path).expect(200)).body;
  const send = async (command: Command, client = gm): Promise<GameView> => {
    const current = await view();
    const response = await client
      .post(`${path}/commands`)
      .set("X-Mafia-Client", "1")
      .send({ command, revision: current.revision, requestId: randomUUID() })
      .expect(200);
    return response.body;
  };
  const clients = Array.from({ length: 7 }, () => request.agent(backend.app));
  for (const [index, client] of clients.entries()) {
    await client.get("/api/me").expect(200);
    await client
      .post(`${path}/join`)
      .set("X-Mafia-Client", "1")
      .send({ name: `Player ${index + 1}` })
      .expect(200);
  }
  await send({ type: "leave" }, clients[0]);
  expect((await view()).players).toHaveLength(6);
  await clients[0]
    .post(`${path}/join`)
    .set("X-Mafia-Client", "1")
    .send({ name: "Player 1" })
    .expect(200);
  await send({
    type: "configure",
    counts: { ...suggestedCounts(7), sniper: 1, citizen: 2 },
    votingMode: "single",
  });
  await send({ type: "start" });
  const initialViews = await Promise.all(clients.map((client) => view(client)));
  expect(
    initialViews.every(
      (state) => state.players.filter((player) => player.role).length === 1,
    ),
  ).toBe(true);
  const actor = (role: Role) => {
    const index = initialViews.findIndex((state) =>
      state.players.some(
        (player) => player.id === state.selfId && player.role === role,
      ),
    );
    const id = initialViews[index]?.selfId;
    if (!id) throw new Error(`Missing test role: ${role}`);
    return { id, client: clients[index] };
  };
  const mafia = actor("mafia");
  const godfather = actor("godfather");
  const doctor = actor("doctor");
  const detective = actor("detective");
  const sniper = actor("sniper");
  expect((await view(mafia.client)).teammates).toHaveLength(2);
  expect((await view(doctor.client)).teammates).toEqual([]);
  await send({ type: "nextNight", skipMissing: true });
  expect(await view()).toMatchObject({ phase: "day", day: 1 });
  expect((await view(mafia.client)).teammates).toEqual([]);
  expect(await send({ type: "timer", kind: "speaking" })).toMatchObject({
    timer: { kind: "speaking" },
  });
  expect(await send({ type: "timer", kind: "challenge" })).toMatchObject({
    timer: { kind: "challenge" },
  });
  const vote = async (targetId: string | null) => {
    const { ballot } = await send({ type: "openVoting" });
    if (!ballot) throw new Error("Missing test ballot");
    for (const client of clients) {
      const current = await view(client);
      if (current.selfId && ballot.eligibleIds.includes(current.selfId)) {
        await send(
          {
            type: "vote",
            ballotId: ballot.id,
            targetId: current.selfId === targetId ? null : targetId,
          },
          client,
        );
      }
    }
    return send({ type: "closeVoting", skipMissing: false });
  };
  await vote(null);
  await send({ type: "beginNight" });
  for (let step = 0; step < 10 && (await view()).phase === "night"; step++) {
    for (const client of clients) {
      const current = await view(client);
      if (!current.canAct || !current.window) continue;
      const target =
        current.window === "mafia" || current.window === "doctor"
          ? doctor.id
          : mafia.id;
      await send(
        {
          type: "action",
          day: current.day,
          window: current.window,
          targetIds: [target],
        },
        client,
      );
    }
    if ((await view()).window === "doctor") {
      expect((await view()).actions).toContainEqual(
        expect.objectContaining({ actorId: doctor.id, targetIds: [doctor.id] }),
      );
      expect((await view(actor("citizen").client)).actions).toEqual([]);
    }
    await send({ type: "nextNight", skipMissing: false });
  }
  const dawn = await view();
  expect(dawn).toMatchObject({ phase: "day", day: 2 });
  expect(dawn.players.find((player) => player.id === doctor.id)?.alive).toBe(
    true,
  );
  expect(dawn.players.find((player) => player.id === mafia.id)?.alive).toBe(
    false,
  );
  expect((await view(detective.client)).notices).toContainEqual(
    expect.objectContaining({
      kind: "investigation",
      targetIds: [mafia.id],
      value: "mafia",
    }),
  );
  expect(
    (await view(doctor.client)).notices.some(
      (notice) => notice.kind === "investigation",
    ),
  ).toBe(false);
  expect(await vote(godfather.id)).toMatchObject({
    phase: "finished",
    winner: "citizen",
  });
  const report = await sniper.client.get(`${path}/report`).expect(200);
  expect(report.body.players).toHaveLength(7);
  expect(report.body.actions).toContainEqual(
    expect.objectContaining({ actorId: sniper.id, outcome: "hit" }),
  );
  const history = await sniper.client.get("/api/reports").expect(200);
  expect(history.body.stats).toMatchObject({
    matches: 1,
    wins: 1,
    sniperShots: 1,
    sniperHits: 1,
    roleHistory: { sniper: 1 },
  });
  const stranger = request.agent(backend.app);
  await stranger.get("/api/me").expect(200);
  await stranger.get(`${path}/report`).expect(403);
});

it("streams invalidations without private payloads and catches up on reconnect", async () => {
  const server = backend.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  const base = `http://127.0.0.1:${address.port}`;
  const abort = new AbortController();
  try {
    const me = await fetch(`${base}/api/me`);
    const cookie = me.headers.get("set-cookie")!.split(";")[0];
    const created = await fetch(`${base}/api/games`, {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/json",
        "X-Mafia-Client": "1",
      },
      body: "{}",
    });
    const { code } = (await created.json()) as { code: string };
    const response = await fetch(`${base}/api/games/${code}/events`, {
      headers: { cookie },
      signal: abort.signal,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      "event: update\ndata: {}",
    );
    const otherMe = await fetch(`${base}/api/me`);
    const otherCookie = otherMe.headers.get("set-cookie")!.split(";")[0];
    await fetch(`${base}/api/games/${code}/join`, {
      method: "POST",
      headers: {
        cookie: otherCookie,
        "Content-Type": "application/json",
        "X-Mafia-Client": "1",
      },
      body: JSON.stringify({ name: "Matti" }),
    });
    const update = new TextDecoder().decode((await reader.read()).value);
    expect(update).toBe("event: update\ndata: {}\n\n");
    await reader.cancel();
    const reconnected = await fetch(`${base}/api/games/${code}/events`, {
      headers: { cookie },
      signal: abort.signal,
    });
    const reconnectReader = reconnected.body!.getReader();
    expect(
      new TextDecoder().decode((await reconnectReader.read()).value),
    ).toContain("event: update");
    await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/json",
        "X-Mafia-Client": "1",
      },
      body: "{}",
    });
    expect(new TextDecoder().decode((await reconnectReader.read()).value)).toBe(
      "event: session\ndata: {}\n\n",
    );
    expect(
      (await fetch(`${base}/api/games/${code}`, { headers: { cookie } }))
        .status,
    ).toBe(401);
    await reconnectReader.cancel();
  } finally {
    abort.abort();
    backend.closeStreams();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("limits repeated join-code guesses before looking up the game", async () => {
  const client = request.agent(backend.app);
  await client.get("/api/me").expect(200);
  for (let attempt = 0; attempt < 90; attempt++) {
    await client
      .post("/api/games/AAAAAA/join")
      .set("X-Mafia-Client", "1")
      .send({ name: "Guest" })
      .expect(404);
  }
  const limited = await client
    .post("/api/games/AAAAAA/join")
    .set("X-Mafia-Client", "1")
    .send({ name: "Guest" })
    .expect(429);
  expect(limited.body.error).toBe("rateLimit");
});
