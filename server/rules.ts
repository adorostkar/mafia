import { randomInt, randomUUID } from "node:crypto";
import {
  roles,
  roleIds,
  type Command,
  type Faction,
  type NightWindow,
  type Outcome,
  type PublicEvent,
  type Role,
  type RoleCounts,
  type Winner,
} from "../shared/game.js";
import { GameError } from "./errors.js";
import {
  initialPlayerState,
  type Action,
  type Game,
  type Notice,
  type Player,
} from "./model.js";

export const living = (game: Game) =>
  game.players.filter((p) => p.alive && !p.state.left);
export const factionOf = (player: Player): Faction =>
  player.role ? roles[player.role].faction : "citizen";
export const currentWindow = (game: Game): NightWindow | null =>
  game.phase === "night"
    ? (game.data.nightOrder[game.data.nightIndex] ?? null)
    : null;
const findPlayer = (game: Game, id: string) => {
  const player = game.players.find((p) => p.id === id);
  if (!player) throw new GameError("target");
  return player;
};
export function publish(
  game: Game,
  kind: PublicEvent["kind"],
  now: number,
  playerIds: string[] = [],
  value: string | number | null = null,
) {
  game.events.push({
    id: randomUUID(),
    kind,
    day: game.day,
    playerIds,
    value,
    createdAt: now,
  });
}
function tell(
  game: Game,
  player: Player,
  kind: Notice["kind"],
  targetIds: string[] = [],
  value: Notice["value"] = null,
) {
  game.notices.push({
    id: randomUUID(),
    playerId: player.id,
    kind,
    day: game.day,
    targetIds,
    value,
  });
}

export function validateCounts(counts: RoleCounts, playerCount?: number) {
  if (
    roleIds.some(
      (role) =>
        !Number.isInteger(counts[role]) ||
        counts[role] < 0 ||
        counts[role] > 30 ||
        (roles[role].unique && counts[role] > 1),
    )
  ) {
    throw new GameError("counts");
  }
  const total = roleIds.reduce((sum, role) => sum + counts[role], 0);
  const mafia = roleIds.reduce(
    (sum, role) => sum + (roles[role].faction === "mafia" ? counts[role] : 0),
    0,
  );
  const citizens = roleIds.reduce(
    (sum, role) => sum + (roles[role].faction === "citizen" ? counts[role] : 0),
    0,
  );
  if (
    total < 4 ||
    total > 30 ||
    (playerCount !== undefined && total !== playerCount) ||
    mafia < 1 ||
    citizens < 1 ||
    mafia * 2 >= total
  ) {
    throw new GameError("counts");
  }
}

function roleCanWake(game: Game, player: Player, window: NightWindow) {
  if (!player.alive || player.state.left || !player.role) return false;
  if (window === "mafia") return factionOf(player) === "mafia";
  if (player.role !== window) return false;
  if (window === "nostradamus")
    return game.day === 0 && !player.state.alignment;
  if (game.day === 0) return false;
  if (window === "sniper") return player.state.sniperShots > 0;
  if (window === "saul")
    return (
      !player.state.recruitUsed &&
      game.players.some(
        (p) =>
          p.originalRole &&
          roles[p.originalRole].faction === "mafia" &&
          !p.alive,
      )
    );
  if (window === "constantine")
    return (
      !player.state.reviveUsed &&
      game.players.some((p) => !p.alive && !p.state.sealed && !p.state.left)
    );
  return true;
}
export function eligibleActors(game: Game, window = currentWindow(game)) {
  return window ? game.players.filter((p) => roleCanWake(game, p, window)) : [];
}
export function submittedAction(
  game: Game,
  playerId: string,
  window = currentWindow(game),
) {
  return game.actions.find(
    (a) => a.actorId === playerId && a.day === game.day && a.window === window,
  );
}
export function missingActors(game: Game) {
  return eligibleActors(game).filter((p) => {
    if (currentWindow(game) === "nostradamus") return !p.state.alignment;
    return !submittedAction(game, p.id);
  });
}
export function eligibleTargets(
  game: Game,
  player: Player,
  window = currentWindow(game),
) {
  if (!window || !roleCanWake(game, player, window)) return [];
  if (game.day === 0 && window === "mafia") return [];
  return game.players.filter((p) => {
    if (p.state.left) return false;
    if (window === "constantine") return !p.alive && !p.state.sealed;
    if (!p.alive) return false;
    if (window === "doctor") {
      return (
        !(p.id === player.id && player.state.selfHeals === 0) &&
        !(
          p.id === player.state.lastHealId &&
          player.state.lastHealDay === game.day - 1
        )
      );
    }
    if (p.id === player.id) return false;
    if (
      ["mafia", "saul", "matador"].includes(window) &&
      factionOf(p) === "mafia"
    )
      return false;
    if (
      window === "matador" &&
      p.id === player.state.lastBlockId &&
      player.state.lastBlockDay === game.day - 1
    )
      return false;
    if (window === "gunman" && p.state.gun) return false;
    return true;
  });
}
function nightOrder(game: Game): NightWindow[] {
  const order: NightWindow[] =
    game.day === 0
      ? ["nostradamus", "mafia"]
      : [
          "matador",
          "saul",
          "mafia",
          "doctor",
          "detective",
          "sniper",
          "gunman",
          "constantine",
          "zodiac",
        ];
  return order.filter((window) => eligibleActors(game, window).length > 0);
}
function beginNight(game: Game, now: number) {
  game.phase = "night";
  game.timer = null;
  game.data.ballot = null;
  game.data.nightOrder = nightOrder(game);
  game.data.nightIndex = 0;
  publish(game, "awake", now, [], currentWindow(game));
}
function eliminate(
  game: Game,
  player: Player,
  cause: "night" | "vote" | "shot" | "revenge" | "leave",
) {
  player.alive = false;
  player.state.gun = null;
  if (game.day === 1 && cause !== "night" && cause !== "leave")
    player.firstDay = true;
  if (cause === "revenge") player.state.sealed = true;
}
export function finishGame(game: Game, winner: Winner, now: number) {
  game.phase = "finished";
  game.winner = winner;
  game.finishedAt = now;
  game.timer = null;
  game.data.ballot = null;
  game.data.revengeId = null;
  game.data.endReason =
    winner === "cancelled"
      ? "abandoned"
      : winner === "draw"
        ? "draw"
        : "victory";
  for (const player of game.players) {
    if (!player.role) {
      player.result = "cancelled";
      continue;
    }
    if (winner === "draw" || winner === "cancelled") {
      player.result = winner;
      continue;
    }
    const side =
      player.role === "nostradamus"
        ? player.state.alignment
        : factionOf(player);
    player.result = side === winner && !player.state.left ? "won" : "lost";
  }
  publish(
    game,
    winner === "cancelled" ? "abandoned" : "finished",
    now,
    [],
    winner,
  );
}
export function checkVictory(game: Game, now: number) {
  if (
    game.phase === "lobby" ||
    game.phase === "night" ||
    game.phase === "revenge" ||
    game.phase === "finished"
  )
    return;
  const alive = living(game);
  const mafia = alive.filter((p) => factionOf(p) === "mafia").length;
  const zodiac = alive.some((p) => p.role === "zodiac");
  if (alive.length === 0) finishGame(game, "draw", now);
  else if (zodiac && alive.length <= 2) finishGame(game, "third", now);
  else if (!zodiac && mafia === 0) finishGame(game, "citizen", now);
  else if (!zodiac && mafia >= alive.length - mafia)
    finishGame(game, "mafia", now);
}
function addAction(
  game: Game,
  player: Player,
  command: Extract<Command, { type: "action" }>,
  now: number,
): Action {
  const action: Action = {
    id: randomUUID(),
    actorId: player.id,
    targetIds: command.targetIds,
    window: command.window,
    day: command.day,
    outcome: command.targetIds.length ? "pending" : "skipped",
    guess: command.guess ?? null,
    gun: command.gun ?? null,
    createdAt: now,
  };
  game.actions.push(action);
  return action;
}

function resolveNight(game: Game, now: number) {
  const aliveAtStart = new Set(living(game).map((p) => p.id));
  const tonight = game.actions.filter(
    (a) => a.day === game.day && a.outcome === "pending",
  );
  const actorOf = (action: Action) => findPlayer(game, action.actorId);
  const targetOf = (action: Action) => findPlayer(game, action.targetIds[0]);
  const byWindow = (window: NightWindow) =>
    tonight.filter((a) => a.window === window && aliveAtStart.has(a.actorId));
  const blocked = new Set<string>();
  const healed = new Set<string>();
  const deaths = new Set<string>();
  const revived = new Set<string>();
  for (const action of byWindow("matador")) {
    const actor = actorOf(action);
    blocked.add(action.targetIds[0]);
    actor.state.lastBlockId = action.targetIds[0];
    actor.state.lastBlockDay = game.day;
    action.outcome = "success";
  }
  for (const action of tonight) {
    if (!aliveAtStart.has(action.actorId)) action.outcome = "no_effect";
    else if (blocked.has(action.actorId)) {
      action.outcome = "blocked";
      tell(game, actorOf(action), "blocked");
    }
  }
  const available = (window: NightWindow) =>
    byWindow(window).filter((a) => a.outcome === "pending");
  let recruitmentReplacesShot = false;
  for (const action of available("saul")) {
    const actor = actorOf(action);
    const target = targetOf(action);
    actor.state.recruitUsed = true;
    recruitmentReplacesShot = true;
    if (target.role === "citizen" && target.alive && !target.state.left) {
      target.role = "mafia";
      action.outcome = "success";
      tell(game, actor, "recruited", [target.id]);
      tell(game, target, "recruited", [target.id]);
    } else {
      action.outcome = "miss";
      tell(game, actor, "recruitFailed", [target.id]);
    }
  }
  for (const action of available("doctor")) {
    const actor = actorOf(action);
    healed.add(action.targetIds[0]);
    actor.state.lastHealId = action.targetIds[0];
    actor.state.lastHealDay = game.day;
    if (action.targetIds[0] === actor.id) actor.state.selfHeals--;
    action.outcome = "success";
  }
  function attack(target: Player, piercing = false): Outcome {
    if (!aliveAtStart.has(target.id)) return "no_effect";
    if (!piercing && (healed.has(target.id) || target.role === "nostradamus"))
      return "protected";
    if (!piercing && target.state.vest > 0) {
      target.state.vest--;
      return "protected";
    }
    eliminate(game, target, "night");
    deaths.add(target.id);
    return "hit";
  }
  const mafia = available("mafia");
  if (recruitmentReplacesShot) {
    mafia.forEach((a) => {
      a.outcome = "no_effect";
    });
  } else if (mafia.length) {
    const leader = mafia.find((a) => actorOf(a).role === "godfather");
    let chosen = leader;
    if (!chosen) {
      const counts = new Map<string, number>();
      mafia.forEach((a) =>
        counts.set(a.targetIds[0], (counts.get(a.targetIds[0]) ?? 0) + 1),
      );
      const highest = Math.max(...counts.values());
      const targets = [...counts].filter(([, count]) => count === highest);
      if (targets.length === 1)
        chosen = mafia.find((a) => a.targetIds[0] === targets[0][0]);
    }
    let result: Outcome = "no_effect";
    if (chosen) {
      if (chosen.guess) {
        actorOf(chosen).state.senseUsed = true;
        result =
          targetOf(chosen).role === chosen.guess
            ? attack(targetOf(chosen), true)
            : "miss";
        if (result === "hit") targetOf(chosen).state.sealed = true;
      } else result = attack(targetOf(chosen));
    }
    mafia.forEach((a) => {
      a.outcome =
        chosen && a.targetIds[0] === chosen.targetIds[0] ? result : "no_effect";
    });
  }
  for (const action of available("sniper")) {
    const actor = actorOf(action);
    const target = targetOf(action);
    actor.state.sniperShots--;
    const friendly =
      factionOf(target) === "citizen" ||
      (target.role === "nostradamus" && target.state.alignment === "citizen");
    if (friendly) {
      eliminate(game, actor, "night");
      deaths.add(actor.id);
      action.outcome = "miss";
    } else action.outcome = attack(target);
  }
  for (const action of available("zodiac"))
    action.outcome = attack(targetOf(action), true);
  for (const action of available("constantine")) {
    const actor = actorOf(action);
    const target = targetOf(action);
    actor.state.reviveUsed = true;
    if (
      !target.alive &&
      !target.state.sealed &&
      !target.state.left &&
      !aliveAtStart.has(target.id)
    ) {
      target.alive = true;
      revived.add(target.id);
      action.outcome = "success";
    } else action.outcome = "no_effect";
  }
  for (const action of available("detective")) {
    const target = targetOf(action);
    tell(
      game,
      actorOf(action),
      "investigation",
      [target.id],
      target.role === "godfather" ? "citizen" : factionOf(target),
    );
    action.outcome = "success";
  }
  for (const action of available("gunman")) {
    const actor = actorOf(action);
    const target = targetOf(action);
    if (!target.alive || target.state.gun || target.state.left) {
      action.outcome = "no_effect";
      continue;
    }
    target.state.gun = action.gun ?? "real";
    if (target.state.gun === "real") actor.state.gunSupply--;
    tell(game, target, "gunReceived");
    action.outcome = "success";
  }
  for (const action of tonight) {
    if (action.outcome === "pending") action.outcome = "no_effect";
  }
  game.phase = "day";
  game.day++;
  game.data.lastVote = null;
  game.timer = null;
  publish(game, "nightResolved", now, [...deaths], [...revived].join(","));
  if (game.day > 50) finishGame(game, "draw", now);
  else checkVictory(game, now);
}

function nextNight(game: Game, skipMissing: boolean, now: number) {
  if (game.phase !== "night") throw new GameError("phase");
  const window = currentWindow(game);
  if (!window) throw new GameError("phase");
  const missing = missingActors(game);
  if (missing.length && !skipMissing) throw new GameError("missingChoices");
  for (const player of missing) {
    if (!submittedAction(game, player.id)) {
      addAction(
        game,
        player,
        { type: "action", targetIds: [], day: game.day, window },
        now,
      );
    }
    if (window === "nostradamus") {
      player.state.alignment =
        player.state.predictionCount === 3 ? "mafia" : "citizen";
      tell(game, player, "alignment", [], player.state.alignment);
    }
  }
  game.data.nightIndex++;
  if (game.data.nightIndex < game.data.nightOrder.length) {
    publish(game, "awake", now, [], currentWindow(game));
    return;
  }
  if (game.day === 0) {
    game.phase = "day";
    game.day = 1;
    publish(game, "nightResolved", now);
  } else resolveNight(game, now);
}
function openVoting(game: Game, now: number) {
  if (
    !["day", "defense"].includes(game.phase) ||
    game.data.votedDay === game.day
  )
    throw new GameError("phase");
  const round = game.phase === "defense" ? 2 : 1;
  const eligible = living(game).map((p) => p.id);
  const candidates =
    round === 2
      ? game.data.lastVote!.candidateIds.filter((id) => eligible.includes(id))
      : eligible;
  if (!candidates.length) throw new GameError("target");
  game.data.ballot = {
    id: randomUUID(),
    round,
    candidates,
    eligibleIds: eligible,
  };
  game.phase = "voting";
  game.timer = null;
  publish(game, "voteOpened", now, candidates, round);
}
function closeVoting(game: Game, skipMissing: boolean, now: number) {
  const ballot = game.data.ballot;
  if (game.phase !== "voting" || !ballot) throw new GameError("phase");
  const votes = game.votes.filter((vote) => vote.ballotId === ballot.id);
  const missing = ballot.eligibleIds.filter(
    (id) => !votes.some((vote) => vote.voterId === id),
  );
  if (missing.length && !skipMissing) throw new GameError("missingChoices");
  for (const id of missing) {
    const vote = {
      ballotId: ballot.id,
      day: game.day,
      round: ballot.round,
      voterId: id,
      targetId: null,
    };
    game.votes.push(vote);
    votes.push(vote);
  }
  const tally: Record<string, number> = {};
  votes.forEach((vote) => {
    if (vote.targetId) tally[vote.targetId] = (tally[vote.targetId] ?? 0) + 1;
  });
  const highest = Math.max(0, ...Object.values(tally));
  const candidateIds = Object.keys(tally).filter((id) => tally[id] === highest);
  game.data.lastVote = {
    round: ballot.round,
    tally,
    abstentions: votes.filter((v) => v.targetId === null).length,
    eliminatedId: null,
    candidateIds,
  };
  game.data.ballot = null;
  if (
    game.data.votingMode === "twoRound" &&
    ballot.round === 1 &&
    candidateIds.length
  ) {
    game.phase = "defense";
    publish(game, "voteClosed", now, candidateIds, "defense");
    return;
  }
  game.phase = "day";
  game.data.votedDay = game.day;
  if (candidateIds.length === 1 && highest > ballot.eligibleIds.length / 2) {
    const player = findPlayer(game, candidateIds[0]);
    eliminate(game, player, "vote");
    game.data.lastVote.eliminatedId = player.id;
    if (player.role === "terrorist" && !player.state.revengeUsed) {
      player.state.revengeUsed = true;
      player.state.sealed = true;
      player.state.revealed = true;
      game.data.revengeId = player.id;
      game.phase = "revenge";
    }
  }
  publish(
    game,
    "voteClosed",
    now,
    game.data.lastVote.eliminatedId ? [game.data.lastVote.eliminatedId] : [],
    "final",
  );
  checkVictory(game, now);
}
function revenge(game: Game, targetId: string | null, now: number) {
  if (game.phase !== "revenge" || !game.data.revengeId)
    throw new GameError("phase");
  if (targetId) {
    const target = findPlayer(game, targetId);
    if (!target.alive || target.state.left) throw new GameError("target");
    eliminate(game, target, "revenge");
  }
  publish(
    game,
    "revenge",
    now,
    targetId ? [game.data.revengeId, targetId] : [game.data.revengeId],
  );
  game.data.revengeId = null;
  game.phase = "day";
  checkVictory(game, now);
}

const playerCommands = new Set<Command["type"]>([
  "action",
  "align",
  "vote",
  "shoot",
  "revenge",
  "leave",
]);
export const isPlayerCommand = (command: Command) =>
  playerCommands.has(command.type);

export function applyCommand(
  game: Game,
  profileId: string,
  command: Command,
  now: number,
) {
  const gm = game.gmId === profileId;
  const self = game.players.find((p) => p.profileId === profileId);
  if (!gm && !self) throw new GameError("forbidden", 403);
  if (!gm && !isPlayerCommand(command)) throw new GameError("forbidden", 403);
  if (game.phase === "finished") throw new GameError("closed");
  if (isPlayerCommand(command) && (!self || self.state.left))
    throw new GameError("forbidden", 403);
  switch (command.type) {
    case "configure":
      if (game.phase !== "lobby") throw new GameError("phase");
      validateCounts(command.counts);
      game.counts = command.counts;
      game.data.votingMode = command.votingMode;
      publish(game, "configured", now);
      break;
    case "start": {
      if (game.phase !== "lobby") throw new GameError("phase");
      const players = game.players.filter((p) => !p.state.left);
      validateCounts(game.counts, players.length);
      const deck = roleIds.flatMap((role) =>
        Array<Role>(game.counts[role]).fill(role),
      );
      for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      players.forEach((player, index) => {
        player.role = deck[index];
        player.originalRole = deck[index];
        player.state = initialPlayerState(player.role);
      });
      game.day = 0;
      publish(game, "started", now);
      beginNight(game, now);
      break;
    }
    case "beginNight":
      if (game.phase !== "day") throw new GameError("phase");
      if (game.data.votedDay !== game.day) throw new GameError("voteRequired");
      beginNight(game, now);
      if (!game.data.nightOrder.length) {
        game.phase = "day";
        checkVictory(game, now);
      }
      break;
    case "nextNight":
      nextNight(game, command.skipMissing, now);
      break;
    case "action": {
      const player = self!;
      const window = currentWindow(game);
      if (game.day !== command.day || window !== command.window)
        throw new GameError("stale", 409);
      if (
        !roleCanWake(game, player, window) ||
        submittedAction(game, player.id)
      )
        throw new GameError("ability");
      const targets = eligibleTargets(game, player, window);
      const needed = window === "nostradamus" ? 3 : 1;
      if (
        command.targetIds.length &&
        (command.targetIds.length !== needed ||
          new Set(command.targetIds).size !== needed ||
          command.targetIds.some((id) => !targets.some((p) => p.id === id)))
      )
        throw new GameError("target");
      if (
        command.guess &&
        (window !== "mafia" ||
          player.role !== "godfather" ||
          player.state.senseUsed ||
          !command.targetIds.length)
      )
        throw new GameError("ability");
      if (command.gun && window !== "gunman") throw new GameError("invalid");
      if (
        window === "gunman" &&
        command.targetIds.length &&
        (command.gun ?? "real") === "real" &&
        player.state.gunSupply === 0
      )
        throw new GameError("ability");
      const action = addAction(game, player, command, now);
      if (window === "nostradamus") {
        if (command.targetIds.length) {
          player.state.predictionCount = command.targetIds.filter((id) => {
            const target = findPlayer(game, id);
            return factionOf(target) === "mafia" && target.role !== "godfather";
          }).length;
          action.outcome = "success";
          tell(
            game,
            player,
            "prediction",
            command.targetIds,
            player.state.predictionCount,
          );
        } else {
          player.state.alignment = "citizen";
          tell(game, player, "alignment", [], "citizen");
        }
      }
      break;
    }
    case "align":
      if (
        currentWindow(game) !== "nostradamus" ||
        game.day !== command.day ||
        self!.role !== "nostradamus" ||
        self!.state.predictionCount === null ||
        self!.state.alignment ||
        !self!.alive
      )
        throw new GameError("ability");
      if (self!.state.predictionCount === 3 && command.side !== "mafia")
        throw new GameError("ability");
      self!.state.alignment = command.side;
      tell(game, self!, "alignment", [], command.side);
      break;
    case "openVoting":
      openVoting(game, now);
      break;
    case "closeVoting":
      closeVoting(game, command.skipMissing, now);
      break;
    case "vote": {
      const ballot = game.data.ballot;
      if (game.phase !== "voting" || !ballot || ballot.id !== command.ballotId)
        throw new GameError("stale", 409);
      if (!self!.alive || !ballot.eligibleIds.includes(self!.id))
        throw new GameError("forbidden", 403);
      if (
        command.targetId &&
        (!ballot.candidates.includes(command.targetId) ||
          command.targetId === self!.id)
      )
        throw new GameError("target");
      const previous = game.votes.find(
        (v) => v.ballotId === ballot.id && v.voterId === self!.id,
      );
      if (previous) previous.targetId = command.targetId;
      else
        game.votes.push({
          ballotId: ballot.id,
          day: game.day,
          round: ballot.round,
          voterId: self!.id,
          targetId: command.targetId,
        });
      break;
    }
    case "shoot": {
      if (
        game.phase !== "day" ||
        game.day !== command.day ||
        !self!.alive ||
        !self!.state.gun
      )
        throw new GameError("ability");
      const target = findPlayer(game, command.targetId);
      if (!target.alive || target.state.left || target.id === self!.id)
        throw new GameError("target");
      let result: Outcome = "no_effect";
      if (self!.state.gun === "real") {
        if (target.role === "nostradamus") result = "protected";
        else if (target.state.vest > 0) {
          target.state.vest--;
          result = "protected";
        } else {
          eliminate(game, target, "shot");
          result = "hit";
        }
      }
      self!.state.gun = null;
      publish(game, "shot", now, [self!.id, target.id], result);
      checkVictory(game, now);
      break;
    }
    case "revenge":
      if (game.data.revengeId !== self!.id)
        throw new GameError("forbidden", 403);
      revenge(game, command.targetId, now);
      break;
    case "skipRevenge":
      revenge(game, null, now);
      break;
    case "remove": {
      if (game.phase !== "lobby") throw new GameError("phase");
      const player = findPlayer(game, command.playerId);
      player.state.left = true;
      player.alive = false;
      publish(game, "removed", now, [player.id]);
      break;
    }
    case "leave":
      if (game.phase === "voting" || game.phase === "defense")
        throw new GameError("phase");
      self!.state.left = true;
      eliminate(game, self!, "leave");
      publish(game, "left", now, [self!.id]);
      if (game.data.revengeId === self!.id) revenge(game, null, now);
      checkVictory(game, now);
      break;
    case "abandon":
      finishGame(game, "cancelled", now);
      break;
    case "timer":
      if (!["day", "defense"].includes(game.phase))
        throw new GameError("phase");
      game.timer =
        command.kind === "stop"
          ? null
          : {
              kind: command.kind,
              endsAt: now + (command.kind === "speaking" ? 60_000 : 30_000),
            };
      publish(game, "timer", now, [], command.kind);
      break;
  }
}
