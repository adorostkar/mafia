// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import { GameTable } from "./GameTable";
import { Timer } from "./Timer";
import { translations } from "./i18n";
import { suggestedCounts, type GameView } from "../shared/game";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function game(overrides: Partial<GameView> = {}): GameView {
  return {
    code: "ABC234",
    isGm: false,
    selfId: "doctor",
    phase: "day",
    day: 1,
    counts: null,
    players: [
      {
        id: "doctor",
        name: "Aino",
        isGuest: true,
        role: "doctor",
        originalRole: "doctor",
        alive: true,
        left: false,
        revealed: false,
      },
      {
        id: "target",
        name: "Matti",
        isGuest: false,
        role: null,
        originalRole: null,
        alive: true,
        left: false,
        revealed: false,
      },
    ],
    window: null,
    canAct: false,
    eligibleTargetIds: ["doctor", "target"],
    neededTargets: 1,
    missingActorIds: [],
    nightProgress: { current: 1, total: 3 },
    submitted: null,
    actions: [],
    teammates: [],
    timer: null,
    winner: null,
    endReason: null,
    votingMode: "twoRound",
    rulesVersion: "mafia-table-1",
    ballot: null,
    lastVote: null,
    votedToday: false,
    revengeId: null,
    abilities: {
      sniperShots: 0,
      selfHeals: 1,
      recruitAvailable: false,
      reviveAvailable: false,
      senseAvailable: false,
      gunSupply: 0,
      hasGun: false,
      alignment: null,
      predictionCount: null,
      needsAlignment: false,
    },
    notices: [],
    events: [],
    mafiaChoices: [],
    revision: 1,
    serverNow: Date.now(),
    ...overrides,
  };
}
const t = translations("en");
const controls = {
  t,
  disabled: false,
  send: vi.fn(async () => true),
  showReports: vi.fn(),
  leaveTable: vi.fn(),
};

it("reveals roles only on request and preserves reveal state when switching language", () => {
  const state = game();
  const { rerender } = render(<GameTable {...controls} game={state} />);
  expect(screen.queryByText("Doctor · Citizen")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reveal my role" }));
  expect(screen.getByText("Doctor · Citizen")).toBeVisible();
  rerender(<GameTable {...controls} game={state} t={translations("fi")} />);
  expect(screen.getByText("Lääkäri · Kansalaiset")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Piilota roolini" }));
  expect(screen.queryByText("Lääkäri · Kansalaiset")).not.toBeInTheDocument();
});

it("conceals private role details on focus loss, backgrounding, and role changes", () => {
  const state = game();
  const { rerender } = render(<GameTable {...controls} game={state} />);
  fireEvent.click(screen.getByRole("button", { name: t.text.reveal }));
  expect(screen.getByText(t.roleDescription.doctor)).toBeVisible();
  fireEvent.blur(window);
  expect(screen.queryByText(t.roleDescription.doctor)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: t.text.reveal }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.queryByText(t.roleDescription.doctor)).not.toBeInTheDocument();

  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByRole("button", { name: t.text.reveal })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: t.text.reveal }));
  rerender(
    <GameTable
      {...controls}
      game={game({
        players: state.players.map((player) =>
          player.id === state.selfId ? { ...player, role: "mafia" } : player,
        ),
      })}
    />,
  );
  expect(screen.queryByText(t.roleDescription.mafia)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t.text.reveal }));
  expect(screen.getByText(t.roleDescription.mafia)).toBeVisible();
});

it("distinguishes guest and account seats with translated labels, not hidden roles", () => {
  const state = game();
  const { rerender } = render(<GameTable {...controls} game={state} />);
  const roster = within(screen.getByRole("region", { name: "Players" }));
  const seats = roster.getAllByRole("listitem");
  expect(seats[0]).toHaveTextContent("Aino");
  expect(seats[0]).toHaveTextContent("Guest");
  expect(seats[1]).toHaveTextContent("Matti");
  expect(seats[1]).toHaveTextContent("Registered player");
  expect(roster.queryByText("Doctor · Citizen")).not.toBeInTheDocument();
  rerender(<GameTable {...controls} game={state} t={translations("fi")} />);
  expect(seats[0]).toHaveTextContent("Vieras");
  expect(seats[1]).toHaveTextContent("Rekisteröity pelaaja");
});

it.each([true, false])(
  "returns home only after a confirmed, accepted leave command (accepted: %s)",
  async (accepted) => {
    const send = vi.fn(async () => accepted);
    const leaveTable = vi.fn();
    render(
      <GameTable
        {...controls}
        game={game({ phase: "lobby" })}
        send={send}
        leaveTable={leaveTable}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t.text.leaveGame }));
    expect(send).not.toHaveBeenCalled();
    expect(leaveTable).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.text.confirm }));
    });
    expect(send).toHaveBeenCalledWith({ type: "leave" });
    expect(leaveTable).toHaveBeenCalledTimes(accepted ? 1 : 0);
    if (!accepted)
      expect(
        screen.getByRole("button", { name: t.text.confirm }),
      ).toBeVisible();
  },
);

it("lets another tab leave the waiting screen when its lobby seat was removed", () => {
  const leaveTable = vi.fn();
  render(
    <GameTable
      {...controls}
      game={game({ phase: "lobby", selfId: null, players: [] })}
      leaveTable={leaveTable}
    />,
  );
  expect(screen.getByText(t.text.leftGame)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: t.text.leaveGame }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t.text.back }));
  expect(leaveTable).toHaveBeenCalledOnce();
});

it("sends a private choice with the prompt identity and locks disconnected controls", async () => {
  const state = game({ phase: "night", window: "doctor", canAct: true });
  const send = vi.fn(async () => true);
  const { rerender } = render(
    <GameTable {...controls} send={send} game={state} />,
  );
  fireEvent.change(screen.getByLabelText("Choose a player"), {
    target: { value: "target" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send privately to GM" }));
  expect(send).toHaveBeenCalledWith({
    type: "action",
    targetIds: ["target"],
    window: "doctor",
    day: 1,
  });
  rerender(<GameTable {...controls} send={send} game={state} disabled />);
  expect(
    screen.getByRole("button", { name: "Send privately to GM" }),
  ).toBeDisabled();
  rerender(
    <GameTable
      {...controls}
      game={{
        ...state,
        canAct: false,
        submitted: {
          id: "action",
          actorId: "doctor",
          targetIds: ["target"],
          window: "doctor",
          day: 1,
          outcome: "pending",
          guess: null,
          gun: null,
        },
      }}
    />,
  );
  expect(screen.getByText("Choice sent to the Game Master.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Send privately to GM" }),
  ).not.toBeInTheDocument();
});

it("uses server time and announces timer start, ten seconds and completion without per-second chatter", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01"));
  const serverNow = 1_000;
  render(
    <Timer
      timer={{ kind: "speaking", endsAt: serverNow + 60_000 }}
      serverNow={serverNow}
      t={t}
    />,
  );
  expect(screen.getByRole("timer")).toHaveTextContent("1:00");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Speaking turn: 60 seconds.",
  );
  act(() => {
    vi.advanceTimersByTime(5_000);
  });

  expect(screen.getByRole("timer")).toHaveTextContent("0:55");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Speaking turn: 60 seconds.",
  );
  act(() => {
    vi.advanceTimersByTime(45_000);
  });
  expect(screen.getByRole("status")).toHaveTextContent("10 seconds remaining");
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  expect(screen.getByRole("status")).toHaveTextContent("Time is up.");
});

it("updates an existing live region when a private night prompt appears", () => {
  const { rerender } = render(<GameTable {...controls} game={game()} />);
  const announcement = screen
    .getAllByRole("status")
    .find((node) => node.textContent?.includes("Game state:"))!;
  rerender(
    <GameTable
      {...controls}
      game={game({ phase: "night", window: "doctor", canAct: true })}
    />,
  );
  expect(announcement).toHaveTextContent(t.prompt.doctor);
  expect(announcement).toBeInTheDocument();
});

it("collects three distinct prediction targets and forces a Mafia alignment when required", () => {
  const send = vi.fn(async () => true);
  const state = game({
    phase: "night",
    day: 0,
    window: "nostradamus",
    canAct: true,
    neededTargets: 3,
    eligibleTargetIds: ["one", "two", "three", "four"],
    players: [
      {
        id: "doctor",
        name: "Aino",
        isGuest: true,
        role: "nostradamus",
        originalRole: "nostradamus",
        alive: true,
        left: false,
        revealed: false,
      },
      ...["one", "two", "three", "four"].map((id) => ({
        id,
        name: id,
        isGuest: true,
        role: null,
        originalRole: null,
        alive: true,
        left: false,
        revealed: false,
      })),
    ],
  });
  const { rerender } = render(
    <GameTable {...controls} send={send} game={state} />,
  );
  expect(screen.getByRole("button", { name: t.text.submit })).toBeDisabled();
  for (const name of ["one", "two", "three"])
    fireEvent.click(screen.getByRole("checkbox", { name }));
  expect(screen.getByRole("checkbox", { name: "four" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: t.text.submit }));
  expect(send).toHaveBeenCalledWith({
    type: "action",
    day: 0,
    window: "nostradamus",
    targetIds: ["one", "two", "three"],
  });
  rerender(
    <GameTable
      {...controls}
      send={send}
      game={{
        ...state,
        canAct: false,
        abilities: {
          ...state.abilities!,
          predictionCount: 3,
          needsAlignment: true,
        },
      }}
    />,
  );
  expect(screen.getByRole("radio", { name: t.faction.citizen })).toBeDisabled();
  expect(screen.getByRole("radio", { name: t.faction.mafia })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: t.text.saveSide }));
  expect(send).toHaveBeenLastCalledWith({
    type: "align",
    day: 0,
    side: "mafia",
  });
});

it("submits a ballot-scoped vote and keeps other players' choices private", () => {
  const send = vi.fn(async () => true);
  render(
    <GameTable
      {...controls}
      send={send}
      game={game({
        phase: "voting",
        ballot: {
          id: "ballot",
          round: 1,
          candidates: ["doctor", "target"],
          eligibleIds: ["doctor", "target"],
          submittedIds: ["target"],
          myVote: null,
        },
      })}
    />,
  );
  fireEvent.change(screen.getByLabelText(t.text.target), {
    target: { value: "target" },
  });
  fireEvent.click(screen.getByRole("button", { name: t.text.castVote }));
  expect(send).toHaveBeenCalledWith({
    type: "vote",
    ballotId: "ballot",
    targetId: "target",
  });
  expect(screen.queryByText(t.text.voteSaved)).not.toBeInTheDocument();
});

it("does not reveal private investigation results until requested", () => {
  render(
    <GameTable
      {...controls}
      game={game({
        notices: [
          {
            id: "notice",
            kind: "investigation",
            day: 1,
            targetIds: ["target"],
            value: "mafia",
          },
        ],
      })}
    />,
  );
  expect(
    screen.queryByText("Matti appears to belong to Mafia."),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t.text.revealMessages }));
  expect(screen.getByText("Matti appears to belong to Mafia.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: t.text.hideMessages }));
  expect(
    screen.queryByText("Matti appears to belong to Mafia."),
  ).not.toBeInTheDocument();
});

it.each(["en", "fi"] as const)(
  "has accessible GM and private night controls in %s",
  async (language) => {
    const state = game({
      isGm: true,
      selfId: null,
      phase: "lobby",
      counts: suggestedCounts(6),
    });
    const { container, rerender } = render(
      <main>
        <GameTable {...controls} game={state} t={translations(language)} />
      </main>,
    );
    const options = { rules: { "color-contrast": { enabled: false } } };
    expect((await axe.run(container, options)).violations).toEqual([]);
    rerender(
      <main>
        <GameTable
          {...controls}
          game={game({ phase: "night", window: "doctor", canAct: true })}
          t={translations(language)}
        />
      </main>,
    );
    expect((await axe.run(container, options)).violations).toEqual([]);
  },
);
