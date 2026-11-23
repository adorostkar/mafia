import { useEffect, useId, useRef, useState } from "react";
import {
  factions,
  roleIds,
  roles,
  suggestedCounts,
  RULES_VERSION,
  type Command,
  type GameView,
  type Role,
  type RoleCounts,
  type VotingMode,
} from "../shared/game";
import { isolate } from "../shared/input";
import type { Translation } from "./i18n";
import { Icon } from "./Art";
import { FlipCard } from "./FlipCard";
import { InviteStrip } from "./Invite";
import {
  actionText,
  eventText,
  names,
  noticeText,
  playerName,
  winnerText,
} from "./gameText";
import { ActionList, ConfirmAction, EventLog, RoleBadge } from "./ui";
import { Timer } from "./Timer";

type Controls = {
  game: GameView;
  t: Translation;
  disabled: boolean;
  send: (command: Command) => Promise<boolean>;
};

type MobilePanel = "now" | "players" | "role" | "actions" | "log" | "more";

function RoleSetup({ game, t, disabled, send }: Controls) {
  const [counts, setCounts] = useState<RoleCounts>(game.counts!);
  const [votingMode, setVotingMode] = useState<VotingMode>(game.votingMode);
  const [reviewed, setReviewed] = useState(false);
  const total = roleIds.reduce((sum, role) => sum + counts[role], 0);
  const mafia = roleIds.reduce(
    (sum, role) => sum + (roles[role].faction === "mafia" ? counts[role] : 0),
    0,
  );
  const citizens = roleIds.reduce(
    (sum, role) => sum + (roles[role].faction === "citizen" ? counts[role] : 0),
    0,
  );
  const dirty =
    votingMode !== game.votingMode ||
    roleIds.some((role) => counts[role] !== game.counts![role]);
  const valid =
    total >= 4 && total <= 30 && mafia > 0 && mafia * 2 < total && citizens > 0;
  return (
    <section className="panel" aria-labelledby="role-setup-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t.text.gm}</p>
          <h2 id="role-setup-title">{t.text.roleSetup}</h2>
        </div>
        <span
          className="count"
          aria-label={t.message("roleCount", {
            selected: total,
            players: game.players.length,
          })}
        >
          {t.number(total)}/{t.number(game.players.length)}
        </span>
      </div>
      <p className="muted" id="setup-help">
        {t.text.setupHelp}
      </p>
      <button
        className="secondary full"
        disabled={disabled || game.players.length < 4}
        onClick={() => setCounts(suggestedCounts(game.players.length))}
      >
        {t.text.suggest}
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send({ type: "configure", counts, votingMode });
        }}
      >
        <fieldset disabled={disabled} aria-describedby="setup-help">
          <legend className="sr-only">{t.text.roleSetup}</legend>
          {factions.map((faction) => (
            <div className="role-group" key={faction}>
              <h3 className={`faction-heading ${faction}`}>
                <span className="faction-dot" aria-hidden="true" />
                {t.faction[faction]}
              </h3>
              {roleIds
                .filter((role) => roles[role].faction === faction)
                .map((role) => (
                  <div className="role-count" key={role}>
                    <label htmlFor={`count-${role}`}>
                      {t.role[role]}
                      <small>
                        {roles[role].unique ? t.text.unique : t.text.unlimited}
                      </small>
                    </label>
                    <input
                      id={`count-${role}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={roles[role].unique ? 1 : 30}
                      required
                      value={counts[role]}
                      onChange={(event) =>
                        setCounts({
                          ...counts,
                          [role]: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                ))}
            </div>
          ))}
          <div className="form-field">
            <label htmlFor="voting-mode">{t.text.votingMode}</label>
            <select
              id="voting-mode"
              value={votingMode}
              aria-describedby="voting-help"
              onChange={(event) =>
                setVotingMode(
                  event.target.value === "single" ? "single" : "twoRound",
                )
              }
            >
              <option value="twoRound">{t.text.twoRound}</option>
              <option value="single">{t.text.single}</option>
            </select>
            <p className="small muted" id="voting-help">
              {t.text.votingModeHelp}
            </p>
          </div>
          <p role="status">
            {t.message("roleCount", {
              selected: total,
              players: game.players.length,
            })}
          </p>
          {!valid && <p className="small danger-text">{t.error.counts}</p>}
          <button className="secondary full" disabled={!dirty || !valid}>
            {t.text.saveRoles}
          </button>
        </fieldset>
      </form>
      <label className="check rules-check">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        {t.text.rulesAccepted}
      </label>
      <button
        className="primary full"
        disabled={
          disabled ||
          dirty ||
          !reviewed ||
          !valid ||
          total !== game.players.length
        }
        onClick={() => void send({ type: "start" })}
      >
        {t.text.start}
        <Icon name="arrow" />
      </button>
      <p className="small muted">
        {dirty ? t.text.saveFirst : t.text.startHelp}
      </p>
    </section>
  );
}

function Players({ game, t, disabled, send }: Controls) {
  return (
    <section className="panel" aria-labelledby="players-title">
      <div className="section-heading">
        <h2 id="players-title">{t.text.players}</h2>
        <span className="count">{t.number(game.players.length)}</span>
      </div>
      <p className="small muted">{t.text.playerIdentityHelp}</p>
      {game.players.length === 0 ? (
        <div className="empty-state">
          <Icon name="users" />
          <p>{t.text.noPlayers}</p>
        </div>
      ) : (
        <ul className="player-list">
          {game.players.map((player, index) => (
            <li key={player.id} className={!player.alive ? "out" : ""}>
              <div className="player-info">
                <span className="avatar" aria-hidden="true">
                  {t.number(index + 1).padStart(2, t.number(0))}
                </span>
                <div>
                  <strong>
                    <bdi>{player.name || t.text.deletedPlayer}</bdi>
                  </strong>
                  {player.id === game.selfId && (
                    <span className="you"> · {t.text.you}</span>
                  )}
                  <small className="player-status">
                    <span className="identity-badge">
                      {player.isGuest ? t.text.guest : t.text.registeredPlayer}
                    </span>
                    {game.phase !== "lobby" && (
                      <span>
                        {player.left
                          ? t.text.leftGame
                          : player.alive
                            ? t.text.alive
                            : t.text.eliminated}
                      </span>
                    )}
                  </small>
                  {player.role &&
                    (game.isGm ||
                      game.phase === "finished" ||
                      player.revealed) && (
                      <RoleBadge role={player.role} t={t} />
                    )}
                </div>
              </div>
              {game.isGm && game.phase === "lobby" && (
                <ConfirmAction
                  t={t}
                  disabled={disabled}
                  label={t.text.removePlayer}
                  ariaLabel={t.message("playerAction", {
                    action: t.text.removePlayer,
                    name: isolate(player.name),
                  })}
                  description={t.message("playerAction", {
                    action: t.text.removePlayer,
                    name: isolate(player.name),
                  })}
                  onConfirm={() =>
                    send({ type: "remove", playerId: player.id })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PrivateRole({ game, t }: Pick<Controls, "game" | "t">) {
  const [revealed, setRevealed] = useState(false);
  const [messages, setMessages] = useState(false);
  const self = game.players.find((player) => player.id === game.selfId);
  useEffect(() => {
    const conceal = () => {
      setRevealed(false);
      setMessages(false);
    };
    const visibilityChanged = () => {
      if (document.visibilityState !== "visible") conceal();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("blur", conceal);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("blur", conceal);
    };
  }, []);
  if (!self?.role) return null;
  return (
    <section
      className="panel private-card"
      aria-labelledby="private-role-title"
    >
      <div className="section-heading">
        <p className="eyebrow">{t.text.private}</p>
        <Icon name="lock" />
      </div>
      <h2 id="private-role-title">{t.text.yourRole}</h2>
      <p className="muted">{t.text.hidden}</p>
      <FlipCard
        className="private-role-flip"
        revealed={revealed}
        onToggle={() => setRevealed(!revealed)}
        label={revealed ? t.text.hide : t.text.reveal}
        announcement={t.message("roleDetails", { role: t.role[self.role] })}
        front={
          <div className="role-sleeve">
            <Icon name="lock" />
            <p>{t.text.roleReady}</p>
          </div>
        }
      >
        <div className="revealed-role">
          <RoleBadge role={self.role} t={t} />
          {game.rulesVersion === RULES_VERSION && (
            <p>{t.roleDescription[self.role]}</p>
          )}
          {game.abilities?.alignment && (
            <p className="notice">
              {t.message("alignment", {
                faction: t.faction[game.abilities.alignment],
              })}
            </p>
          )}
          {self.role === "sniper" && (
            <p>
              {t.message("remainingShots", {
                count: game.abilities?.sniperShots ?? 0,
              })}
            </p>
          )}
          {self.role === "doctor" && (
            <p>
              {t.message("remainingHeals", {
                count: game.abilities?.selfHeals ?? 0,
              })}
            </p>
          )}
          {self.role === "gunman" && (
            <p>
              {t.message("remainingGuns", {
                count: game.abilities?.gunSupply ?? 0,
              })}
            </p>
          )}
        </div>
      </FlipCard>
      <div className="private-messages">
        <h3>{t.text.privateInbox}</h3>
        <p className="small" role="status">
          {game.notices.length
            ? t.message("privateResults", { count: game.notices.length })
            : t.text.noMessages}
        </p>
        {game.notices.length > 0 && (
          <button
            className="quiet"
            aria-expanded={messages}
            aria-controls="private-results"
            onClick={() => setMessages(!messages)}
          >
            {messages ? t.text.hideMessages : t.text.revealMessages}
          </button>
        )}
        <div id="private-results" role="status" aria-atomic="true">
          {messages && (
            <ul className="notice-list">
              {[...game.notices].reverse().map((notice) => (
                <li key={notice.id}>{noticeText(notice, game.players, t)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="small muted privacy-help">{t.text.privacy}</p>
    </section>
  );
}

function TargetSelect({
  players,
  value,
  onChange,
  disabled,
  t,
  label = t.text.target,
  abstain = false,
}: {
  players: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  t: Translation;
  label?: string;
  abstain?: boolean;
}) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        required
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t.text.select}</option>
        {abstain && <option value="abstain">{t.text.abstain}</option>}
        {players.map((player) => (
          <option key={player.id} value={player.id}>
            {player.name || t.text.deletedPlayer}
          </option>
        ))}
      </select>
    </div>
  );
}

function NightTurn({ game, t, disabled, send }: Controls) {
  const [targets, setTargets] = useState<string[]>([]);
  const [sense, setSense] = useState(false);
  const [guess, setGuess] = useState<Role>("citizen");
  const [gun, setGun] = useState<"real" | "blank">(
    (game.abilities?.gunSupply ?? 0) > 0 ? "real" : "blank",
  );
  const [side, setSide] = useState<"citizen" | "mafia">(
    game.abilities?.predictionCount === 3 ? "mafia" : "citizen",
  );
  const self = game.players.find((player) => player.id === game.selfId);
  const eligible = game.players.filter((player) =>
    game.eligibleTargetIds.includes(player.id),
  );
  const introduction = game.day === 0 && game.window === "mafia";
  const yourTurn = game.canAct || !!game.abilities?.needsAlignment;
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    // On a phone the card can sit below the edge of the screen when the turn starts.
    if (yourTurn) card.current?.scrollIntoView?.({ block: "nearest" });
  }, [yourTurn]);
  const submit = (targetIds: string[]) =>
    game.window &&
    send({
      type: "action",
      day: game.day,
      window: game.window,
      targetIds,
      ...(targetIds.length && sense ? { guess } : {}),
      ...(targetIds.length && game.window === "gunman" ? { gun } : {}),
    });
  return (
    <section
      className={`panel night-card ${yourTurn ? "your-turn" : ""}`}
      aria-labelledby="night-turn-title"
      ref={card}
    >
      <div className="section-heading">
        <p className="eyebrow">{t.text.private}</p>
        <Icon name="moon" />
      </div>
      <h2 id="night-turn-title">{yourTurn ? t.text.yourTurn : t.text.night}</h2>
      <p>
        {!self?.alive
          ? t.text.deadText
          : game.submitted
            ? t.text.submitted
            : game.canAct && game.window
              ? introduction
                ? t.text.introMafia
                : t.prompt[game.window]
              : t.text.nightText}
      </p>
      {game.teammates.length > 0 && (
        <div className="team-box">
          <h3>{t.text.teammates}</h3>
          <p className="small">{t.text.teammatesHelp}</p>
          <ul className="team-list">
            {game.teammates.map((player) => (
              <li key={player.id}>
                {player.name}
                {player.id === game.selfId ? ` · ${t.text.you}` : ""}
              </li>
            ))}
          </ul>
          {game.mafiaChoices.length > 0 && (
            <ul className="small">
              {game.mafiaChoices.map((choice) => (
                <li key={choice.actorId}>
                  {playerName(game.players, choice.actorId, t)}:{" "}
                  {choice.targetIds.length
                    ? names(game.players, choice.targetIds, t)
                    : t.text.pass}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {game.abilities?.needsAlignment && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send({
              type: "align",
              day: game.day,
              side: game.abilities?.predictionCount === 3 ? "mafia" : side,
            });
          }}
        >
          <fieldset disabled={disabled}>
            <legend>{t.text.chooseSide}</legend>
            <p className="notice" role="status">
              {t.message("prediction", {
                count: game.abilities.predictionCount ?? 0,
              })}
            </p>
            <p className="small">{t.text.alignmentHelp}</p>
            <label className="check">
              <input
                type="radio"
                name="side"
                value="citizen"
                disabled={game.abilities.predictionCount === 3}
                checked={
                  side === "citizen" && game.abilities.predictionCount !== 3
                }
                onChange={() => setSide("citizen")}
              />
              {t.faction.citizen}
            </label>
            <label className="check">
              <input
                type="radio"
                name="side"
                value="mafia"
                checked={
                  side === "mafia" || game.abilities.predictionCount === 3
                }
                onChange={() => setSide("mafia")}
              />
              {t.faction.mafia}
            </label>
            <button className="primary full">{t.text.saveSide}</button>
          </fieldset>
        </form>
      )}
      {game.canAct &&
        (introduction ? (
          <button
            className="primary full"
            disabled={disabled}
            onClick={() => void submit([])}
          >
            {t.text.acknowledge}
            <Icon name="check" />
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(targets);
            }}
          >
            <fieldset disabled={disabled}>
              <legend className="sr-only">{t.text.yourTurn}</legend>
              {game.neededTargets === 3 ? (
                <fieldset className="target-grid">
                  <legend>{t.text.target}</legend>
                  {eligible.map((player) => (
                    <label className="check target-option" key={player.id}>
                      <input
                        type="checkbox"
                        checked={targets.includes(player.id)}
                        disabled={
                          targets.length === 3 && !targets.includes(player.id)
                        }
                        onChange={(event) =>
                          setTargets(
                            event.target.checked
                              ? [...targets, player.id]
                              : targets.filter((id) => id !== player.id),
                          )
                        }
                      />
                      {player.name}
                    </label>
                  ))}
                  <p className="small" role="status">
                    {t.message("targetSelection", {
                      count: targets.length,
                      total: 3,
                    })}
                  </p>
                </fieldset>
              ) : (
                <TargetSelect
                  players={eligible}
                  value={targets[0] ?? ""}
                  onChange={(value) => setTargets(value ? [value] : [])}
                  disabled={disabled}
                  t={t}
                />
              )}
              {!eligible.length && <p>{t.text.noTargets}</p>}
              {self?.role === "godfather" &&
                game.window === "mafia" &&
                game.abilities?.senseAvailable && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={sense}
                        onChange={(event) => setSense(event.target.checked)}
                      />
                      {t.text.useSense}
                    </label>
                    {sense && (
                      <div className="form-field">
                        <label htmlFor="sense-guess">{t.text.guessRole}</label>
                        <select
                          id="sense-guess"
                          value={guess}
                          onChange={(event) => {
                            const role = roleIds.find(
                              (role) => role === event.target.value,
                            );
                            if (role) setGuess(role);
                          }}
                        >
                          {roleIds.map((role) => (
                            <option key={role} value={role}>
                              {t.role[role]}
                            </option>
                          ))}
                        </select>
                        <p className="small muted">{t.text.senseHelp}</p>
                      </div>
                    )}
                  </>
                )}
              {game.window === "gunman" && (
                <div className="form-field">
                  <label htmlFor="gun-type">{t.text.gunType}</label>
                  <select
                    id="gun-type"
                    value={gun}
                    onChange={(event) =>
                      setGun(event.target.value === "real" ? "real" : "blank")
                    }
                  >
                    <option
                      value="real"
                      disabled={game.abilities?.gunSupply === 0}
                    >
                      {t.text.realGun}
                    </option>
                    <option value="blank">{t.text.blankGun}</option>
                  </select>
                  <p className="small muted">
                    {t.message("remainingGuns", {
                      count: game.abilities?.gunSupply ?? 0,
                    })}
                  </p>
                </div>
              )}
              <button
                className="primary full"
                disabled={
                  targets.length !== game.neededTargets ||
                  targets.some((id) => !game.eligibleTargetIds.includes(id))
                }
              >
                {t.text.submit}
                <Icon name="lock" />
              </button>
              <button
                className="quiet full"
                type="button"
                onClick={() => void submit([])}
              >
                {t.text.pass}
              </button>
            </fieldset>
          </form>
        ))}
    </section>
  );
}

function Voting({ game, t, disabled, send }: Controls) {
  const ballot = game.ballot!;
  const [target, setTarget] = useState(
    ballot.myVote ? (ballot.myVote.targetId ?? "abstain") : "",
  );
  const canVote = !!game.selfId && ballot.eligibleIds.includes(game.selfId);
  return (
    <section className="panel voting-card">
      <p className="eyebrow">{t.phase.voting}</p>
      <h2>
        {ballot.round === 1 && game.votingMode === "twoRound"
          ? t.text.openVoting
          : t.text.openFinalVote}
      </h2>
      <p>{t.text.votePrivacy}</p>
      <p className="notice" role="status">
        {t.message("responses", { count: ballot.submittedIds.length })} /{" "}
        {t.message("playersCount", { count: ballot.eligibleIds.length })}
      </p>
      <progress
        max={ballot.eligibleIds.length}
        value={ballot.submittedIds.length}
        aria-label={t.text.progress}
      />
      {canVote && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send({
              type: "vote",
              ballotId: ballot.id,
              targetId: target === "abstain" ? null : target,
            });
          }}
        >
          <TargetSelect
            players={game.players.filter(
              (player) =>
                ballot.candidates.includes(player.id) &&
                player.id !== game.selfId,
            )}
            t={t}
            value={target}
            onChange={setTarget}
            disabled={disabled}
            abstain
          />
          <button className="primary full" disabled={disabled || !target}>
            {ballot.myVote ? t.text.updateVote : t.text.castVote}
          </button>
        </form>
      )}
      {ballot.myVote && (
        <p className="small" role="status">
          {t.text.voteSaved}{" "}
          {t.message("myVote", {
            target: ballot.myVote.targetId
              ? playerName(game.players, ballot.myVote.targetId, t)
              : t.text.abstain,
          })}
        </p>
      )}
    </section>
  );
}

function VoteSummary({ game, t }: Pick<Controls, "game" | "t">) {
  if (!game.lastVote) return null;
  const vote = game.lastVote;
  return (
    <section className="panel">
      <h2>{game.phase === "defense" ? t.text.nominees : t.text.voteResult}</h2>
      {game.phase === "defense" && (
        <p className="notice">{names(game.players, vote.candidateIds, t)}</p>
      )}
      <ul className="tally-list">
        {Object.entries(vote.tally).map(([id, count]) => (
          <li key={id}>
            {t.message("votesFor", {
              name: playerName(game.players, id, t),
              count,
            })}
          </li>
        ))}
      </ul>
      <p className="small muted">
        {t.text.abstentions}: {t.number(vote.abstentions)}
      </p>
      <p>
        {game.phase === "defense"
          ? t.text.defenseHelp
          : vote.eliminatedId
            ? t.message("playerAction", {
                action: t.text.eliminated,
                name: playerName(game.players, vote.eliminatedId, t),
              })
            : t.text.noElimination}
      </p>
    </section>
  );
}

function DayGun({ game, t, disabled, send }: Controls) {
  const [target, setTarget] = useState("");
  return (
    <section className="panel">
      <p className="eyebrow">{t.text.private}</p>
      <h2>{t.text.dayGun}</h2>
      <p>{t.text.dayGunHelp}</p>
      <TargetSelect
        players={game.players.filter(
          (player) => player.alive && !player.left && player.id !== game.selfId,
        )}
        value={target}
        onChange={setTarget}
        disabled={disabled}
        t={t}
      />
      <ConfirmAction
        key={target}
        t={t}
        disabled={disabled || !target}
        label={t.text.shoot}
        description={t.message("playerAction", {
          action: t.text.confirmShot,
          name: target ? playerName(game.players, target, t) : t.text.select,
        })}
        confirmLabel={t.text.confirmShot}
        onConfirm={() =>
          send({ type: "shoot", targetId: target, day: game.day })
        }
      />
    </section>
  );
}

function Revenge({ game, t, disabled, send }: Controls) {
  const [target, setTarget] = useState("");
  return (
    <section className="panel">
      <h2>{t.text.lastMove}</h2>
      <p>{t.text.lastMoveHelp}</p>
      <p className="notice">
        {names(game.players, game.revengeId ? [game.revengeId] : [], t)}
      </p>
      {game.selfId === game.revengeId && (
        <>
          <TargetSelect
            players={game.players.filter(
              (player) => player.alive && !player.left,
            )}
            value={target}
            onChange={setTarget}
            disabled={disabled}
            t={t}
            label={t.text.revengeChoice}
          />
          <ConfirmAction
            key={target}
            t={t}
            disabled={disabled || !target}
            label={t.text.confirmRevenge}
            description={t.message("playerAction", {
              action: t.text.confirmRevenge,
              name: target
                ? playerName(game.players, target, t)
                : t.text.select,
            })}
            onConfirm={() => send({ type: "revenge", targetId: target })}
          />
          <ConfirmAction
            t={t}
            disabled={disabled}
            label={t.text.skipRevenge}
            description={t.text.skipRevenge}
            onConfirm={() => send({ type: "revenge", targetId: null })}
          />
        </>
      )}
      {game.isGm && (
        <ConfirmAction
          t={t}
          disabled={disabled}
          label={t.text.skipRevenge}
          description={t.text.skipMissingHelp}
          onConfirm={() => send({ type: "skipRevenge" })}
        />
      )}
    </section>
  );
}

function GmRound({ game, t, disabled, send }: Controls) {
  const [skip, setSkip] = useState(false);
  const missing =
    game.phase === "voting" && game.ballot
      ? game.ballot.eligibleIds.filter(
          (id) => !game.ballot!.submittedIds.includes(id),
        )
      : game.missingActorIds;
  return (
    <section className="panel gm-controls">
      <p className="eyebrow">{t.text.gm}</p>
      <h2>{t.text.phaseControls}</h2>
      {game.phase === "night" && (
        <>
          <p className="muted">{t.text.nightGuide}</p>
          <div className="wake-card">
            <Icon name="moon" />
            <span className="eyebrow">{t.text.awake}</span>
            <strong>
              {game.window === "mafia"
                ? t.faction.mafia
                : game.window
                  ? t.role[game.window]
                  : t.text.sleeping}
            </strong>
            <p>
              {t.message("nightProgress", {
                current: game.nightProgress.current,
                total: game.nightProgress.total,
              })}
            </p>
          </div>
          <progress
            max={game.nightProgress.total || 1}
            value={game.nightProgress.current}
            aria-label={t.text.progress}
          />
        </>
      )}
      {["night", "voting"].includes(game.phase) && (
        <>
          <p className="small" role="status">
            {t.message("waitingFor", {
              names: names(game.players, missing, t),
            })}
          </p>
          {missing.length > 0 && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={skip}
                  disabled={disabled}
                  aria-describedby="skip-help"
                  onChange={(event) => setSkip(event.target.checked)}
                />
                {t.text.skipMissing}
              </label>
              <p className="small muted" id="skip-help">
                {t.text.skipMissingHelp}
              </p>
            </>
          )}
          <button
            className="primary full"
            disabled={disabled || (missing.length > 0 && !skip)}
            onClick={() =>
              void send(
                game.phase === "night"
                  ? { type: "nextNight", skipMissing: skip }
                  : { type: "closeVoting", skipMissing: skip },
              )
            }
          >
            {game.phase === "voting"
              ? t.text.closeVoting
              : game.nightProgress.current >= game.nightProgress.total
                ? t.text.resolveNight
                : t.text.nextRole}
            <Icon name="arrow" />
          </button>
        </>
      )}
      {(game.phase === "day" || game.phase === "defense") && (
        <>
          <Timer timer={game.timer} serverNow={game.serverNow} t={t} />
          <div className="button-row timer-buttons">
            {(["speaking", "challenge"] as const).map((kind) => (
              <button
                className="secondary"
                key={kind}
                disabled={disabled}
                onClick={() => void send({ type: "timer", kind })}
              >
                {t.message("timerButton", {
                  timer: t.text[kind],
                  seconds: kind === "speaking" ? 60 : 30,
                })}
              </button>
            ))}
            {game.timer && (
              <button
                className="quiet"
                disabled={disabled}
                onClick={() => void send({ type: "timer", kind: "stop" })}
              >
                {t.text.stop}
              </button>
            )}
          </div>
          {game.votedToday ? (
            <>
              <p className="notice">{t.text.votingDone}</p>
              <button
                className="primary full"
                disabled={disabled}
                onClick={() => void send({ type: "beginNight" })}
              >
                {t.text.startNight}
                <Icon name="moon" />
              </button>
            </>
          ) : (
            <button
              className="primary full"
              disabled={disabled}
              onClick={() => void send({ type: "openVoting" })}
            >
              {game.phase === "defense" || game.votingMode === "single"
                ? t.text.openFinalVote
                : t.text.openVoting}
              <Icon name="arrow" />
            </button>
          )}
        </>
      )}
      <p className="small muted">{t.text.automaticRules}</p>
    </section>
  );
}

export function GameTable({
  game,
  t,
  disabled,
  send,
  showReports,
  leaveTable,
}: Controls & { showReports: () => void; leaveTable: () => void }) {
  const [selectedMobilePanel, setSelectedMobilePanel] =
    useState<MobilePanel>("now");
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const controls = { game, t, disabled, send };
  const title =
    game.day === 0 && game.phase === "night"
      ? t.text.introNight
      : game.phase === "lobby"
        ? t.text.lobby
        : game.phase === "finished"
          ? t.text.result
          : game.phase === "day" || game.phase === "night"
            ? t.message("phaseTitle", {
                phase: t.phase[game.phase],
                day: game.day,
              })
            : t.message("phaseOnDay", {
                phase: t.phase[game.phase],
                day: t.message("phaseTitle", {
                  phase: t.phase.day,
                  day: game.day,
                }),
              });
  const self = game.players.find((player) => player.id === game.selfId);
  const mobilePanel =
    (selectedMobilePanel === "role" && (game.isGm || game.phase === "lobby")) ||
    (selectedMobilePanel === "actions" &&
      (!game.isGm || game.phase === "lobby")) ||
    (selectedMobilePanel === "more" && game.phase === "finished")
      ? "now"
      : selectedMobilePanel;
  const latest = game.events.at(-1);
  const roundEvents = game.events
    .filter(
      (event) =>
        ![
          "joined",
          "left",
          "removed",
          "configured",
          "awake",
          "timer",
          "voteOpened",
        ].includes(event.kind),
    )
    .slice(-3)
    .reverse();
  const currentRules = game.rulesVersion === RULES_VERSION;
  const actionDay = game.phase === "night" ? game.day : game.day - 1;
  const heading = useRef<HTMLHeadingElement>(null);
  const lastPhase = useRef(game.phase);
  const sheetLabel =
    mobilePanel === "players"
      ? t.text.players
      : mobilePanel === "role"
        ? t.text.yourRole
        : mobilePanel === "actions"
          ? t.text.actions
          : mobilePanel === "log"
            ? t.text.history
            : t.text.more;
  useEffect(() => {
    if (lastPhase.current !== game.phase) {
      lastPhase.current = game.phase;
      heading.current?.focus();
    }
  }, [game.phase]);
  useEffect(() => {
    if (mobilePanel === "now") {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
      return;
    }

    const sheet = sheetRef.current;
    sheet?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedMobilePanel("now");
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        sheet.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === sheet)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === sheet)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobilePanel]);

  function openMobilePanel(panel: MobilePanel, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setSelectedMobilePanel(panel);
  }

  function closeMobilePanel() {
    setSelectedMobilePanel("now");
  }
  function showNow(trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setSelectedMobilePanel("now");
  }
  return (
    <>
      <header className="page-intro game-intro">
        <p className="eyebrow">
          {game.isGm ? t.text.gm : t.text.player}{" "}
          <span aria-hidden="true">/</span> {game.code}
        </p>
        <h1 tabIndex={-1} ref={heading}>
          {title}
        </h1>
        <p className="muted">
          {game.isGm
            ? t.text.gmPrivate
            : self && !self.alive
              ? t.text.deadText
              : game.phase === "day"
                ? t.text.dayText
                : t.text.privacy}
        </p>
      </header>
      <div className="sr-only" role="status" aria-atomic="true">
        {t.text.phaseChanged}:{" "}
        {t.message("gameStatus", {
          phase: title,
          count: game.players.length,
          alive: game.players.filter((player) => player.alive).length,
        })}
        {game.winner
          ? winnerText(game.winner, t)
          : latest
            ? eventText(latest, game.players, t)
            : ""}
        {!game.isGm && game.phase !== "lobby" && self?.role
          ? t.text.roleReady
          : ""}
        {!game.isGm &&
          game.phase === "night" &&
          (game.submitted
            ? t.text.submitted
            : game.canAct && game.window
              ? game.day === 0 && game.window === "mafia"
                ? t.text.introMafia
                : t.prompt[game.window]
              : t.text.nightText)}
      </div>
      {game.phase === "lobby" && <InviteStrip game={game} t={t} />}
      {game.winner && (
        <section className={`panel result-card ${game.winner}`}>
          <span className="star-mark" aria-hidden="true">
            ✦
          </span>
          <p className="eyebrow">{t.text.result}</p>
          <h2>{winnerText(game.winner, t)}</h2>
          {game.winner === "cancelled" && <p>{t.text.cancelledNoStats}</p>}
          <button className="primary" onClick={showReports}>
            {t.text.viewReports}
            <Icon name="arrow" />
          </button>
        </section>
      )}
      {!currentRules && game.phase !== "finished" && (
        <p className="notice">{t.error.legacyRules}</p>
      )}
      <div className="table-grid">
        <div className="stack game-primary-stack">
          {game.isGm && game.phase === "lobby" && (
            <RoleSetup
              key={`${JSON.stringify(game.counts)}-${game.votingMode}`}
              {...controls}
            />
          )}
          {game.isGm &&
            currentRules &&
            ["day", "night", "voting", "defense"].includes(game.phase) && (
              <GmRound
                key={`${game.day}-${game.phase}-${game.window}`}
                {...controls}
              />
            )}
          {!game.isGm && game.phase === "lobby" && (
            <section className="panel waiting-card">
              <Icon name="check" />
              <h2>{self ? t.text.joinTitle : t.text.leftGame}</h2>
              {self ? (
                <>
                  <p>{t.text.waiting}</p>
                  <p className="small muted">{t.text.joinPrivacy}</p>
                </>
              ) : (
                <button className="secondary" onClick={leaveTable}>
                  {t.text.back}
                </button>
              )}
            </section>
          )}
          {!game.isGm && currentRules && game.phase === "night" && (
            <NightTurn key={`${game.day}-${game.window}`} {...controls} />
          )}
          {!game.isGm && ["day", "defense"].includes(game.phase) && (
            <section className="panel">
              <Timer timer={game.timer} serverNow={game.serverNow} t={t} />
            </section>
          )}
          {currentRules && game.phase === "voting" && game.ballot && (
            <Voting key={game.ballot.id} {...controls} />
          )}
          {currentRules && game.phase === "revenge" && (
            <Revenge {...controls} />
          )}
          {!game.isGm &&
            currentRules &&
            game.phase === "day" &&
            self?.alive &&
            game.abilities?.hasGun && <DayGun {...controls} />}
          {game.lastVote && <VoteSummary game={game} t={t} />}
        </div>
        <div
          className={`stack game-secondary-stack ${mobilePanel !== "now" ? "mobile-sheet-open" : ""}`}
          id="game-mobile-sheet"
          data-mobile-panel={mobilePanel}
          role={mobilePanel !== "now" ? "dialog" : undefined}
          aria-modal={mobilePanel !== "now" ? true : undefined}
          aria-label={mobilePanel !== "now" ? sheetLabel : undefined}
          tabIndex={mobilePanel !== "now" ? -1 : undefined}
          ref={sheetRef}
        >
          <button
            className="mobile-sheet-close secondary"
            onClick={closeMobilePanel}
          >
            {t.text.close}
          </button>
          <div data-mobile-section="players">
            <Players {...controls} />
          </div>
          {!game.isGm && game.phase !== "lobby" && (
            <div data-mobile-section="role">
              <PrivateRole
                key={`${game.code}:${game.selfId}:${self?.role}`}
                game={game}
                t={t}
              />
            </div>
          )}
          {game.isGm && game.phase !== "lobby" && (
            <details
              className="panel"
              data-mobile-section="actions"
              open={game.phase === "night" || mobilePanel === "actions"}
            >
              <summary>{t.text.actions}</summary>
              <p className="sr-only" role="status">
                {t.message("responses", {
                  count: game.actions.filter(
                    (action) => action.day === actionDay,
                  ).length,
                })}
                {game.phase === "night" && game.actions.at(-1)
                  ? actionText(game.actions.at(-1)!, game.players, t)
                  : ""}
              </p>
              <ActionList
                actions={game.actions.filter(
                  (action) =>
                    action.day === actionDay || game.phase === "finished",
                )}
                players={game.players}
                t={t}
              />
            </details>
          )}
          <details
            className="panel"
            data-mobile-section="log"
            open={mobilePanel === "log"}
          >
            <summary>{t.text.history}</summary>
            <EventLog events={game.events} players={game.players} t={t} />
          </details>
          {game.phase !== "finished" && (
            <section
              className="panel table-settings"
              data-mobile-section="more"
            >
              <h2>{t.text.privacyControls}</h2>
              <p className="small muted">
                {t.message("rulesVersion", { version: game.rulesVersion })}
              </p>
              {game.isGm ? (
                <ConfirmAction
                  t={t}
                  disabled={disabled}
                  label={t.text.abandonGame}
                  description={t.text.abandonHelp}
                  onConfirm={() => send({ type: "abandon" })}
                />
              ) : (
                self &&
                !self.left && (
                  <ConfirmAction
                    t={t}
                    disabled={
                      disabled ||
                      !currentRules ||
                      game.phase === "voting" ||
                      game.phase === "defense"
                    }
                    label={t.text.leaveGame}
                    description={t.text.leaveHelp}
                    onConfirm={async () => {
                      if (!(await send({ type: "leave" }))) return false;
                      leaveTable();
                      return true;
                    }}
                  />
                )
              )}
            </section>
          )}
        </div>
      </div>
      <section
        className="panel round-summary"
        aria-labelledby="round-summary-title"
      >
        <h2 id="round-summary-title">{t.text.roundSummary}</h2>
        {roundEvents.length ? (
          <ol className="round-summary-list">
            {roundEvents.map((event) => (
              <li key={event.id}>
                {t.message("roundEvent", {
                  day: event.day,
                  event: eventText(event, game.players, t),
                })}
              </li>
            ))}
          </ol>
        ) : (
          <p className="small muted">{t.text.noEvents}</p>
        )}
      </section>
      <nav className="game-mobile-nav" aria-label={t.text.tableNavigation}>
        <button
          className={mobilePanel === "now" ? "active" : ""}
          aria-current={mobilePanel === "now" ? "page" : undefined}
          onClick={(event) => showNow(event.currentTarget)}
        >
          {t.text.now}
        </button>
        <button
          className={mobilePanel === "players" ? "active" : ""}
          aria-controls="game-mobile-sheet"
          aria-expanded={mobilePanel === "players"}
          onClick={(event) => openMobilePanel("players", event.currentTarget)}
        >
          {t.text.players}
        </button>
        {!game.isGm && game.phase !== "lobby" && (
          <button
            className={mobilePanel === "role" ? "active" : ""}
            aria-controls="game-mobile-sheet"
            aria-expanded={mobilePanel === "role"}
            onClick={(event) => openMobilePanel("role", event.currentTarget)}
          >
            {t.text.yourRole}
          </button>
        )}
        {game.isGm && game.phase !== "lobby" && (
          <button
            className={mobilePanel === "actions" ? "active" : ""}
            aria-controls="game-mobile-sheet"
            aria-expanded={mobilePanel === "actions"}
            onClick={(event) => openMobilePanel("actions", event.currentTarget)}
          >
            {t.text.actions}
          </button>
        )}
        <button
          className={mobilePanel === "log" ? "active" : ""}
          aria-controls="game-mobile-sheet"
          aria-expanded={mobilePanel === "log"}
          onClick={(event) => openMobilePanel("log", event.currentTarget)}
        >
          {t.text.history}
        </button>
        {game.phase !== "finished" && (
          <button
            className={mobilePanel === "more" ? "active" : ""}
            aria-controls="game-mobile-sheet"
            aria-expanded={mobilePanel === "more"}
            onClick={(event) => openMobilePanel("more", event.currentTarget)}
          >
            {t.text.more}
          </button>
        )}
      </nav>
    </>
  );
}
