import {
  factions,
  roleIds,
  type ActionView,
  type PrivateNotice,
  type PublicEvent,
  type Winner,
} from "../shared/game";
import type { Translation } from "./i18n";

type NamedPlayer = { id: string; name: string };
export function playerName(players: NamedPlayer[], id: string, t: Translation) {
  return (
    players.find((player) => player.id === id)?.name || t.text.deletedPlayer
  );
}
export function names(players: NamedPlayer[], ids: string[], t: Translation) {
  return ids.length ? t.list(ids.map((id) => playerName(players, id, t))) : "—";
}
export function winnerText(winner: Winner, t: Translation) {
  return winner === "draw" || winner === "cancelled"
    ? t.text[winner]
    : t.message("winner", { faction: t.faction[winner] });
}
function translatedValue(
  value: string | number | null,
  t: Translation,
): string {
  if (typeof value === "number") return t.number(value);
  if (value === null) return "—";
  if (Object.hasOwn(t.faction, value))
    return t.faction[factions.find((key) => key === value)!];
  if (Object.hasOwn(t.role, value))
    return t.role[roleIds.find((key) => key === value)!];
  if (Object.hasOwn(t.outcome, value))
    return t.outcome[value as keyof typeof t.outcome];
  if (Object.hasOwn(t.phase, value))
    return t.phase[value as keyof typeof t.phase];
  if (["stop", "speaking", "challenge", "draw", "cancelled"].includes(value))
    return t.text[
      value as "stop" | "speaking" | "challenge" | "draw" | "cancelled"
    ];
  if (value === "final") return t.text.voteResult;
  return value;
}
export function eventText(
  event: PublicEvent,
  players: NamedPlayer[],
  t: Translation,
) {
  return t.event(event.kind, {
    names: names(players, event.playerIds, t),
    value:
      event.kind === "nightResolved"
        ? names(
            players,
            String(event.value ?? "")
              .split(",")
              .filter(Boolean),
            t,
          )
        : translatedValue(event.value, t),
  });
}
export function noticeText(
  notice: PrivateNotice,
  players: NamedPlayer[],
  t: Translation,
) {
  return t.notice(notice.kind, {
    targets: names(players, notice.targetIds, t),
    value: translatedValue(notice.value, t),
  });
}
export function actionText(
  action: ActionView,
  players: NamedPlayer[],
  t: Translation,
) {
  return t.message("actionRecord", {
    day: t.number(action.day),
    role: action.window === "mafia" ? t.faction.mafia : t.role[action.window],
    actor: playerName(players, action.actorId, t),
    targets: action.targetIds.length
      ? names(players, action.targetIds, t)
      : t.text.pass,
    outcome: t.outcome[action.outcome],
  });
}
