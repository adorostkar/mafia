import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.js";
import { GameStore } from "./game.js";
import { nameSchema } from "./validation.js";
import {
  roleIds,
  type Command,
  type NightWindow,
  type Role,
  type RoleCounts,
} from "../shared/game.js";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close();
});

function table(
  cast: Role[] = [
    "godfather",
    "mafia",
    "doctor",
    "detective",
    "citizen",
    "citizen",
  ],
  path = ":memory:",
) {
  const db = openDatabase(path);
  databases.push(db);
  const store = new GameStore(db);
  const profile = () => {
    const id = randomUUID();
    db.prepare("INSERT INTO profiles(id,created_at) VALUES (?,?)").run(
      id,
      Date.now(),
    );
    return id;
  };
  const gm = profile();
  const users = cast.map(profile);
  const code = store.create(gm);
  users.forEach((id, index) => store.join(code, id, `Player ${index + 1}`));
  const view = () => store.view(code, gm);
  const counts = Object.fromEntries(
    roleIds.map((role) => [role, cast.filter((r) => r === role).length]),
  ) as RoleCounts;
  const send = (command: Command, id = gm, requestId?: string) =>
    store.command(code, id, command, view().revision, requestId);
  const player = (role: Role) => view().players.find((p) => p.role === role)!;
  const user = (role: Role) =>
    users.find((id) => store.view(code, id).selfId === player(role).id)!;
  const next = () => send({ type: "nextNight", skipMissing: true });
  const dawn = () => {
    for (let n = 0; n < 12 && view().phase === "night"; n++) next();
    expect(view().phase).not.toBe("night");
  };
  const start = () => {
    send({ type: "configure", counts, votingMode: "twoRound" });
    send({ type: "start" });
    dawn();
  };
  const night = () => {
    send({ type: "openVoting" });
    send({ type: "closeVoting", skipMissing: true });
    send({ type: "beginNight" });
  };
  const wake = (window: NightWindow) => {
    for (
      let n = 0;
      n < 12 && view().phase === "night" && view().window !== window;
      n++
    )
      next();
    expect(view().window).toBe(window);
  };
  const action = (
    role: Role,
    targets: string[],
    extras: { guess?: Role; gun?: "real" | "blank" } = {},
  ) => {
    send(
      {
        type: "action",
        targetIds: targets,
        window: view().window!,
        day: view().day,
        ...extras,
      },
      user(role),
    );
  };
  const voteOut = (targetId: string) => {
    for (let round = 0; round < 2; round++) {
      send({ type: "openVoting" });
      const ballot = view().ballot!;
      for (const id of users) {
        const state = store.view(code, id);
        if (state.selfId && ballot.eligibleIds.includes(state.selfId)) {
          send(
            {
              type: "vote",
              ballotId: ballot.id,
              targetId: state.selfId === targetId ? null : targetId,
            },
            id,
          );
        }
      }
      send({ type: "closeVoting", skipMissing: false });
      if (view().phase !== "defense") break;
    }
  };
  return {
    db,
    store,
    gm,
    users,
    code,
    view,
    counts,
    send,
    player,
    user,
    next,
    dawn,
    start,
    night,
    wake,
    action,
    voteOut,
  };
}

describe("complete game lifecycle", () => {
  it("validates counts, GM authority, unique roles and join names before assigning", () => {
    const t = table();
    expect(() => t.send({ type: "start" }, t.users[0])).toThrow("forbidden");
    expect(() =>
      t.send({
        type: "configure",
        counts: { ...t.counts, doctor: 2 },
        votingMode: "single",
      }),
    ).toThrow("counts");
    expect(() => t.store.join(t.code, randomUUID(), "Player 1")).toThrow(
      "duplicateName",
    );
    expect(t.view().players.every((p) => p.role === null)).toBe(true);
    t.start();
    expect(t.view().phase).toBe("day");
    expect(t.view().day).toBe(1);
  });

  it("protects roles, teammates, private results and completed reports", () => {
    const t = table();
    t.send({ type: "configure", counts: t.counts, votingMode: "twoRound" });
    t.send({ type: "start" });
    for (const id of t.users) {
      const view = t.store.view(t.code, id);
      const mafia = view.players.some(
        (p) => p.role === "godfather" || p.role === "mafia",
      );
      expect(view.players.filter((p) => p.role)).toHaveLength(1);
      expect(view.teammates.length).toBe(mafia ? 2 : 0);
      expect(view.actions).toEqual([]);
      expect(view.missingActorIds).toEqual([]);
      expect(view.counts).toBeNull();
    }
    t.dawn();
    expect(t.store.view(t.code, t.user("mafia")).teammates).toEqual([]);
    expect(() => t.store.view(t.code, randomUUID())).toThrow("forbidden");
    expect(() => t.store.report(t.code, t.users[0])).toThrow("phase");
    t.night();
    t.wake("detective");
    t.action("detective", [t.player("godfather").id]);
    t.dawn();
    expect(
      t.store.view(t.code, t.user("detective")).notices.at(-1),
    ).toMatchObject({ kind: "investigation", value: "citizen" });
    expect(t.store.view(t.code, t.user("doctor")).notices).toEqual([]);
    t.send({ type: "abandon" });
    expect(() => t.store.report(t.code, randomUUID())).toThrow("forbidden");
  });

  it("makes requests idempotent and rejects stale or duplicate private actions", () => {
    const t = table();
    t.start();
    t.night();
    t.wake("doctor");
    const command: Command = {
      type: "action",
      targetIds: [t.player("doctor").id],
      window: "doctor",
      day: 1,
    };
    const id = randomUUID();
    t.send(command, t.user("doctor"), id);
    const revision = t.view().revision;
    t.store.command(t.code, t.user("doctor"), command, 0, id);
    expect(t.view().revision).toBe(revision);
    expect(() => t.send(command, t.user("doctor"))).toThrow("ability");
    expect(() =>
      t.store.command(
        t.code,
        t.gm,
        { type: "nextNight", skipMissing: true },
        0,
      ),
    ).toThrow("stale");
    t.dawn();
    t.night();
    t.wake("doctor");
    expect(() => t.send(command, t.user("doctor"))).toThrow("stale");
  });

  it("requires explicit missing-choice handling and a completed day ballot", () => {
    const t = table();
    t.start();
    expect(() => t.send({ type: "beginNight" })).toThrow("voteRequired");
    t.night();
    expect(() => t.send({ type: "nextNight", skipMissing: false })).toThrow(
      "missingChoices",
    );
    t.dawn();
    t.send({ type: "openVoting" });
    expect(() => t.send({ type: "closeVoting", skipMissing: false })).toThrow(
      "missingChoices",
    );
  });

  it("resolves doctor saves and enforces self-heal and consecutive-target limits", () => {
    const t = table();
    t.start();
    t.night();
    const doctorId = t.player("doctor").id;
    t.wake("mafia");
    t.action("godfather", [doctorId]);
    t.wake("doctor");
    t.action("doctor", [doctorId]);
    t.dawn();
    expect(t.player("doctor").alive).toBe(true);
    expect(
      t
        .view()
        .actions.find(
          (a) => a.actorId === t.player("godfather").id && a.day === 1,
        )?.outcome,
    ).toBe("protected");
    t.night();
    t.wake("doctor");
    expect(
      t.store.view(t.code, t.user("doctor")).eligibleTargetIds,
    ).not.toContain(doctorId);
    expect(() => t.action("doctor", [doctorId])).toThrow("target");
  });

  it("applies Matador blocks before healing, without consuming a blocked ability", () => {
    const t = table([
      "godfather",
      "matador",
      "doctor",
      "citizen",
      "citizen",
      "citizen",
    ]);
    t.start();
    t.night();
    const doctor = t.player("doctor").id;
    t.wake("matador");
    t.action("matador", [doctor]);
    t.wake("mafia");
    t.action("godfather", [doctor]);
    t.wake("doctor");
    t.action("doctor", [doctor]);
    t.dawn();
    expect(t.player("doctor").alive).toBe(false);
    expect(t.store.view(t.code, t.user("doctor")).abilities?.selfHeals).toBe(1);
    expect(t.store.view(t.code, t.user("doctor")).notices).toContainEqual(
      expect.objectContaining({ kind: "blocked" }),
    );
  });

  it("handles sniper ammunition, vests, automatic victory and saved hit statistics", () => {
    const t = table(["godfather", "sniper", "doctor", "citizen", "citizen"]);
    t.start();
    const sniper = t.user("sniper");
    const target = t.player("godfather").id;
    t.night();
    t.wake("sniper");
    t.action("sniper", [target]);
    t.dawn();
    expect(t.player("godfather").alive).toBe(true);
    expect(t.store.view(t.code, sniper).abilities?.sniperShots).toBe(1);
    t.night();
    t.wake("sniper");
    t.action("sniper", [target]);
    t.dawn();
    expect(t.view().winner).toBe("citizen");
    expect(t.store.reports(sniper).stats).toMatchObject({
      matches: 1,
      wins: 1,
      sniperHits: 1,
      sniperShots: 2,
      roleHistory: { sniper: 1 },
    });
    expect(t.store.reports(t.gm).stats.matches).toBe(0);
  });

  it("penalizes sniper friendly fire even through a vest or heal", () => {
    const t = table(["godfather", "sniper", "doctor", "citizen", "citizen"]);
    t.start();
    t.night();
    const sniper = t.player("sniper").id;
    t.wake("doctor");
    t.action("doctor", [sniper]);
    t.wake("sniper");
    t.action("sniper", [t.player("citizen").id]);
    t.dawn();
    expect(t.player("sniper").alive).toBe(false);
    expect(t.player("citizen").alive).toBe(true);
  });

  it("supports Godfather's one-use role guess that bypasses protection", () => {
    const t = table();
    t.start();
    t.night();
    const doctor = t.player("doctor").id;
    t.wake("mafia");
    t.action("godfather", [doctor], { guess: "doctor" });
    t.wake("doctor");
    t.action("doctor", [doctor]);
    t.dawn();
    expect(t.player("doctor").alive).toBe(false);
    expect(
      t.store.view(t.code, t.user("godfather")).abilities?.senseAvailable,
    ).toBe(false);
  });

  it("recruits only plain Citizens, replaces the Mafia shot and changes the private team", () => {
    const t = table([
      "godfather",
      "saul",
      "doctor",
      "citizen",
      "citizen",
      "citizen",
      "citizen",
    ]);
    t.start();
    t.voteOut(t.player("godfather").id);
    t.send({ type: "beginNight" });
    const target = t.player("citizen");
    const targetUser = t.users.find(
      (id) => t.store.view(t.code, id).selfId === target.id,
    )!;
    t.wake("saul");
    t.action("saul", [target.id]);
    t.wake("mafia");
    t.action("saul", [t.player("doctor").id]);
    t.dawn();
    expect(t.view().players.find((p) => p.id === target.id)).toMatchObject({
      role: "mafia",
      originalRole: "citizen",
      alive: true,
    });
    expect(t.player("doctor").alive).toBe(true);
    expect(t.store.view(t.code, targetUser).notices.at(-1)?.kind).toBe(
      "recruited",
    );
    t.night();
    t.wake("mafia");
    expect(
      t.store.view(t.code, targetUser).teammates.map((p) => p.id),
    ).toContain(t.player("saul").id);
  });

  it.each(["real", "blank"] as const)(
    "delivers a %s gun without revealing ammunition to its recipient",
    (gun) => {
      const t = table([
        "godfather",
        "gunman",
        "doctor",
        "citizen",
        "citizen",
        "citizen",
      ]);
      t.start();
      t.night();
      t.wake("gunman");
      const recipient = t.player("citizen");
      const owner = t.users.find(
        (id) => t.store.view(t.code, id).selfId === recipient.id,
      )!;
      t.action("gunman", [recipient.id], { gun });
      t.dawn();
      expect(t.store.view(t.code, owner).abilities?.hasGun).toBe(true);
      expect(JSON.stringify(t.store.view(t.code, owner))).not.toContain(
        `"${gun}"`,
      );
      t.send(
        { type: "shoot", targetId: t.player("doctor").id, day: t.view().day },
        owner,
      );
      expect(t.player("doctor").alive).toBe(gun === "blank");
      expect(t.store.view(t.code, t.user("gunman")).abilities?.gunSupply).toBe(
        gun === "blank" ? 2 : 1,
      );
      expect(t.store.view(t.code, owner).abilities?.hasGun).toBe(false);
    },
  );

  it("revives a previously eliminated player once while retaining the first-day record", () => {
    const t = table([
      "godfather",
      "constantine",
      "doctor",
      "citizen",
      "citizen",
      "citizen",
    ]);
    t.start();
    const target = t.player("citizen");
    t.voteOut(target.id);
    t.send({ type: "beginNight" });
    t.wake("constantine");
    t.action("constantine", [target.id]);
    t.dawn();
    expect(t.view().players.find((p) => p.id === target.id)?.alive).toBe(true);
    expect(
      t.store.view(t.code, t.user("constantine")).abilities?.reviveAvailable,
    ).toBe(false);
    t.voteOut(t.player("godfather").id);
    expect(
      t.store.report(t.code, t.gm).players.find((p) => p.id === target.id)
        ?.firstDay,
    ).toBe(true);
  });

  it("gives Nostradamus private three-player information and a secret winning side", () => {
    const t = table([
      "godfather",
      "mafia",
      "nostradamus",
      "doctor",
      "citizen",
      "citizen",
      "citizen",
    ]);
    t.send({ type: "configure", counts: t.counts, votingMode: "twoRound" });
    t.send({ type: "start" });
    expect(t.view().window).toBe("nostradamus");
    t.action("nostradamus", [
      t.player("godfather").id,
      t.player("mafia").id,
      t.player("doctor").id,
    ]);
    const user = t.user("nostradamus");
    expect(t.store.view(t.code, user).abilities).toMatchObject({
      predictionCount: 1,
      needsAlignment: true,
    });
    expect(t.store.view(t.code, t.user("doctor")).notices).toEqual([]);
    t.send({ type: "align", side: "mafia", day: 0 }, user);
    expect(t.store.view(t.code, user).abilities?.alignment).toBe("mafia");
    t.dawn();
    expect(t.view().day).toBe(1);
  });

  it("completes the Terrorist's last move before checking victory", () => {
    const t = table([
      "godfather",
      "terrorist",
      "doctor",
      "citizen",
      "citizen",
      "citizen",
    ]);
    t.start();
    const terrorist = t.user("terrorist");
    t.voteOut(t.player("terrorist").id);
    expect(t.view().phase).toBe("revenge");
    expect(t.view().winner).toBeNull();
    t.send({ type: "revenge", targetId: t.player("godfather").id }, terrorist);
    expect(t.view().winner).toBe("citizen");
  });

  it("does not finish a Citizen victory while Zodiac is alive", () => {
    const t = table(["godfather", "zodiac", "doctor", "citizen", "citizen"]);
    t.start();
    t.night();
    t.wake("zodiac");
    t.action("zodiac", [t.player("godfather").id]);
    t.dawn();
    expect(t.view().winner).toBeNull();
    t.voteOut(t.player("citizen").id);
    t.send({ type: "beginNight" });
    t.wake("zodiac");
    t.action("zodiac", [t.player("doctor").id]);
    t.dawn();
    expect(t.view().winner).toBe("third");
  });

  it("preserves a completed game and reports across a database restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "mafia-persistence-"));
    try {
      const path = join(directory, "game.sqlite");
      const t = table(
        ["godfather", "doctor", "citizen", "citizen", "citizen"],
        path,
      );
      t.start();
      t.voteOut(t.player("godfather").id);
      t.db.close();
      const reopened = openDatabase(path);
      databases.push(reopened);
      const store = new GameStore(reopened);
      expect(store.report(t.code, t.gm).winner).toBe("citizen");
      expect(store.reports(t.users[0]).stats.matches).toBe(1);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("handles tied nominations, changed votes, abstentions, and a strict final majority", () => {
    const t = table(["godfather", "doctor", "citizen", "citizen"]);
    t.start();
    t.send({ type: "openVoting" });
    const ballot = t.view().ballot!;
    const players = t.view().players;
    for (let i = 0; i < t.users.length; i++) {
      const selfId = t.store.view(t.code, t.users[i]).selfId!;
      const target = players.find((player) => player.id !== selfId)!;
      t.send(
        { type: "vote", ballotId: ballot.id, targetId: target.id },
        t.users[i],
      );
      t.send({ type: "vote", ballotId: ballot.id, targetId: null }, t.users[i]);
    }
    t.send({ type: "closeVoting", skipMissing: false });
    expect(t.view()).toMatchObject({
      phase: "day",
      votedToday: true,
      lastVote: { abstentions: 4, eliminatedId: null },
    });
    t.send({ type: "beginNight" });
    t.dawn();
    t.send({ type: "openVoting" });
    const nextBallot = t.view().ballot!;
    t.users.forEach((user) => {
      const index = players.findIndex(
        (player) => player.id === t.store.view(t.code, user).selfId,
      );
      t.send(
        {
          type: "vote",
          ballotId: nextBallot.id,
          targetId: players[(index + 1) % players.length].id,
        },
        user,
      );
    });
    t.send({ type: "closeVoting", skipMissing: false });
    expect(t.view()).toMatchObject({
      phase: "defense",
      lastVote: {
        candidateIds: expect.arrayContaining(players.map((p) => p.id)),
      },
    });
    t.send({ type: "openVoting" });
    const finalBallot = t.view().ballot!;
    const target = players[0].id;
    const voters = t.users
      .filter((id) => t.store.view(t.code, id).selfId !== target)
      .slice(0, 2);
    for (const user of t.users) {
      t.send(
        {
          type: "vote",
          ballotId: finalBallot.id,
          targetId: voters.includes(user) ? target : null,
        },
        user,
      );
    }
    t.send({ type: "closeVoting", skipMissing: false });
    expect(t.view().players.every((player) => player.alive)).toBe(true);
  });

  it("does not let Mafia tied target proposals become an arbitrary attack", () => {
    const t = table([
      "mafia",
      "mafia",
      "doctor",
      "citizen",
      "citizen",
      "citizen",
    ]);
    t.start();
    t.night();
    const targets = t
      .view()
      .players.filter((player) => player.role === "citizen");
    let index = 0;
    for (const user of t.users) {
      const view = t.store.view(t.code, user);
      if (view.canAct)
        t.send(
          {
            type: "action",
            targetIds: [targets[index++].id],
            day: 1,
            window: "mafia",
          },
          user,
        );
    }
    t.dawn();
    expect(t.view().players.every((player) => player.alive)).toBe(true);
    expect(
      t
        .view()
        .actions.filter(
          (action) => action.window === "mafia" && action.day === 1,
        )
        .every((action) => action.outcome === "no_effect"),
    ).toBe(true);
  });

  it("awards Mafia parity automatically and preserves the first-day elimination", () => {
    const t = table();
    t.start();
    const citizen = t.player("citizen").id;
    t.voteOut(citizen);
    t.send({ type: "beginNight" });
    t.wake("mafia");
    t.action("godfather", [t.player("doctor").id]);
    t.dawn();
    expect(t.view().winner).toBe("mafia");
    const report = t.store.report(t.code, t.gm);
    expect(report.players.filter((player) => player.won)).toHaveLength(2);
    expect(
      report.players.find((player) => player.id === citizen)?.firstDay,
    ).toBe(true);
  });

  it("resolves all simultaneous night actions before declaring a draw", () => {
    const t = table(["godfather", "zodiac", "sniper", "doctor"]);
    t.start();
    t.night();
    t.wake("sniper");
    t.action("sniper", [t.player("godfather").id]);
    t.dawn();
    t.voteOut(t.player("doctor").id);
    t.send({ type: "beginNight" });
    t.wake("mafia");
    t.action("godfather", [t.player("zodiac").id], { guess: "zodiac" });
    t.wake("sniper");
    t.action("sniper", [t.player("godfather").id]);
    t.wake("zodiac");
    t.action("zodiac", [t.player("sniper").id]);
    t.dawn();
    expect(t.view().winner).toBe("draw");
    expect(t.view().players.every((player) => !player.alive)).toBe(true);
  });

  it("forces Nostradamus to join Mafia after counting three apparent Mafia players", () => {
    const t = table([
      "mafia",
      "mafia",
      "mafia",
      "nostradamus",
      "doctor",
      "citizen",
      "citizen",
    ]);
    t.send({ type: "configure", counts: t.counts, votingMode: "single" });
    t.send({ type: "start" });
    t.action(
      "nostradamus",
      t
        .view()
        .players.filter((player) => player.role === "mafia")
        .map((player) => player.id),
    );
    expect(() =>
      t.send({ type: "align", side: "citizen", day: 0 }, t.user("nostradamus")),
    ).toThrow("ability");
    t.next();
    expect(
      t.store.view(t.code, t.user("nostradamus")).abilities?.alignment,
    ).toBe("mafia");
  });

  it("excludes cancelled games from stats and paginates participant-only reports", () => {
    const t = table();
    t.start();
    t.send({ type: "abandon" });
    for (let n = 0; n < 20; n++) {
      const code = t.store.create(t.gm);
      t.store.command(code, t.gm, { type: "abandon" }, 0);
    }
    expect(t.store.reports(t.users[0]).stats.matches).toBe(0);
    const first = t.store.reports(t.gm);
    const second = t.store.reports(t.gm, first.nextPage!);
    expect(first.matches).toHaveLength(20);
    expect(second.matches).toHaveLength(1);
    expect(second.nextPage).toBeNull();
    expect(
      new Set([...first.matches, ...second.matches].map((match) => match.code))
        .size,
    ).toBe(21);
    expect(t.store.reports(randomUUID()).matches).toEqual([]);
  });
});

describe("privacy, membership and cleanup", () => {
  const guest = (t: ReturnType<typeof table>) => {
    const id = randomUUID();
    t.db
      .prepare("INSERT INTO profiles(id,created_at) VALUES (?,?)")
      .run(id, Date.now());
    return id;
  };
  const day = 24 * 60 * 60_000;

  it("tells players about a night step only while it is their own turn", () => {
    const t = table();
    t.start();
    t.night();
    t.wake("doctor");
    const idle = t.store.view(t.code, t.user("citizen"));
    expect(idle).toMatchObject({
      window: null,
      canAct: false,
      neededTargets: 1,
      nightProgress: { current: 0, total: 0 },
    });
    expect(idle.events.some((event) => event.kind === "awake")).toBe(false);
    const doctor = t.store.view(t.code, t.user("doctor"));
    expect(doctor).toMatchObject({ window: "doctor", canAct: true });
    expect(doctor.events.some((event) => event.kind === "awake")).toBe(false);
    expect(t.view()).toMatchObject({
      window: "doctor",
      nightProgress: { current: 2, total: 3 },
    });
    expect(t.view().events.some((event) => event.kind === "awake")).toBe(true);
    t.send({ type: "abandon" });
    expect(
      t.store
        .view(t.code, t.user("citizen"))
        .events.some((event) => event.kind === "awake"),
    ).toBe(true);
  });

  it("ends access for players who left or were removed before the start", () => {
    const t = table();
    const removed = guest(t);
    const leaver = guest(t);
    t.store.join(t.code, removed, "Removed");
    t.store.join(t.code, leaver, "Leaver");
    t.send({
      type: "remove",
      playerId: t.view().players.find((p) => p.name === "Removed")!.id,
    });
    t.send({ type: "leave" }, leaver);
    expect(() => t.store.view(t.code, removed)).toThrow("removed");
    expect(() => t.store.join(t.code, removed, "Back again")).toThrow(
      "removed",
    );
    expect(() => t.store.view(t.code, leaver)).toThrow("forbidden");
    expect(t.view().players).toHaveLength(6);
    expect(t.view().events.filter((event) => event.kind !== "joined")).toEqual(
      [],
    );
    expect(t.view().events).toHaveLength(6);
    // Someone who left on their own may take a seat again while the lobby is open.
    t.store.join(t.code, leaver, "Leaver");
    expect(t.store.view(t.code, leaver).players).toHaveLength(7);
    t.send({ type: "leave" }, leaver);
    t.start();
    expect(t.view().players).toHaveLength(6);
    expect(t.store.view(t.code, t.users[0]).players).toHaveLength(6);
    t.send({ type: "abandon" });
    for (const outsider of [removed, leaver]) {
      expect(() => t.store.report(t.code, outsider)).toThrow();
      expect(t.store.reports(outsider).matches).toEqual([]);
      expect(t.store.export(outsider)).toEqual([]);
    }
    const members = new Set(t.view().players.map((p) => p.id));
    expect(
      t.store
        .report(t.code, t.users[0])
        .events.every((event) =>
          event.playerIds.every((id) => members.has(id)),
        ),
    ).toBe(true);
  });

  it("treats look-alike names as one name and refuses invisible names", () => {
    const t = table(["godfather", "doctor", "citizen", "citizen"]);
    expect(nameSchema.parse("  Ali\u200b  ")).toBe("Ali");
    expect(nameSchema.parse("\u202eAli")).toBe("Ali");
    expect(nameSchema.parse("Ame\u0301lie")).toBe("Am\u00e9lie");
    expect(nameSchema.parse("علی\u200cرضا")).toBe("علی\u200cرضا");
    expect(nameSchema.parse("Mikko 🎭")).toBe("Mikko 🎭");
    for (const empty of ["   ", "\u200b\u200c", "\u202e\u2066"])
      expect(nameSchema.safeParse(empty).success).toBe(false);
    t.store.join(t.code, guest(t), nameSchema.parse("Ali"));
    t.store.join(t.code, guest(t), nameSchema.parse("علی\u200cرضا"));
    for (const copy of ["ALI\u200b", "Ａｌｉ", "علیرضا"])
      expect(() =>
        t.store.join(t.code, guest(t), nameSchema.parse(copy)),
      ).toThrow("duplicateName");
  });

  it("counts a win on the last allowed night before calling a draw", () => {
    const lastNight = (shoot: boolean) => {
      const t = table(["mafia", "sniper", "citizen", "citizen"]);
      t.start();
      t.db.prepare("UPDATE games SET day=50 WHERE code=?").run(t.code);
      t.night();
      if (shoot) {
        t.wake("sniper");
        t.action("sniper", [t.player("mafia").id]);
      }
      t.dawn();
      return t.view().winner;
    };
    expect(lastNight(true)).toBe("citizen");
    expect(lastNight(false)).toBe("draw");
  });

  it("removes idle lobbies, ends stalled matches and keeps finished reports", () => {
    const t = table();
    t.start();
    const lobby = t.store.create(t.gm);
    t.store.join(lobby, guest(t), "Visitor");
    const finished = t.store.create(t.gm);
    t.store.command(finished, t.gm, { type: "abandon" }, 0);
    const now = Date.now();
    expect(t.store.prune(now + 6 * day)).toEqual([]);
    expect(t.store.prune(now + 8 * day)).toEqual([lobby]);
    expect(() => t.store.view(lobby, t.gm)).toThrow("notFound");
    expect(t.view().phase).toBe("day");
    expect(t.store.prune(now + 31 * day)).toEqual([t.code]);
    expect(t.view()).toMatchObject({ phase: "finished", winner: "cancelled" });
    expect(t.store.report(finished, t.gm).winner).toBe("cancelled");
    expect(
      t.db.prepare("SELECT COUNT(*) AS n FROM command_receipts").get()!.n,
    ).toBe(0);
  });

  it("saves only what changed and still reloads the same match", () => {
    const t = table();
    t.start();
    const written = (work: () => void) => {
      const count = () =>
        Number(t.db.prepare("SELECT total_changes() AS n").get()!.n);
      const before = count();
      work();
      return count() - before;
    };
    // The match row, the public timer event, the command log entry and the retry receipt.
    expect(written(() => t.send({ type: "timer", kind: "speaking" }))).toBe(4);
    t.night();
    t.wake("doctor");
    // The match row, the new action, the command log entry and the retry receipt.
    expect(written(() => t.action("doctor", [t.player("doctor").id]))).toBe(4);
    t.dawn();
    const reopened = new GameStore(t.db);
    expect(reopened.view(t.code, t.gm)).toMatchObject({
      phase: "day",
      day: 2,
      players: t.view().players,
      actions: t.view().actions,
    });
  });
});
