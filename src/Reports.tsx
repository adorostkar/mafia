import { useState } from "react";
import { roleIds, type Report, type ReportsView } from "../shared/game";
import type { Translation } from "./i18n";
import { playerName, winnerText } from "./gameText";
import { ActionList, ErrorNotice, EventLog, RoleBadge } from "./ui";
import { Icon } from "./Art";
import { useRemote } from "./useRemote";

export function Reports({
  t,
  openReport,
}: {
  t: Translation;
  openReport: (code: string) => void;
}) {
  const [page, setPage] = useState(0);
  const { data, error, reload } = useRemote<ReportsView>(
    `/reports?page=${page}`,
  );
  return (
    <>
      <header className="page-intro">
        <p className="eyebrow">{t.text.reports}</p>
        <h1>{t.text.reportsTitle}</h1>
        <p className="muted">{t.text.reportsIntro}</p>
      </header>
      {error && <ErrorNotice code={error} t={t} retry={reload} />}
      {!data && !error && <p role="status">{t.text.loading}</p>}
      {data && (
        <>
          <div className="stats-grid">
            {[
              [t.text.matches, t.number(data.stats.matches)],
              [t.text.wins, t.number(data.stats.wins)],
              [
                t.text.winRate,
                new Intl.NumberFormat(t.language, {
                  style: "percent",
                  maximumFractionDigits: 0,
                }).format(
                  data.stats.matches ? data.stats.wins / data.stats.matches : 0,
                ),
              ],
              [t.text.firstDay, t.number(data.stats.firstDay)],
              [
                t.text.sniperHits,
                `${t.number(data.stats.sniperHits)} / ${t.number(data.stats.sniperShots)}`,
              ],
            ].map(([label, value]) => (
              <section className="stat panel" key={label}>
                <h2>{label}</h2>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <section className="panel" aria-labelledby="role-history-title">
            <h2 id="role-history-title">{t.text.roleHistory}</h2>
            {Object.keys(data.stats.roleHistory).length ? (
              <ul className="role-history">
                {roleIds
                  .filter((role) => data.stats.roleHistory[role])
                  .map((role) => (
                    <li key={role}>
                      <RoleBadge role={role} t={t} />
                      <strong>{t.number(data.stats.roleHistory[role]!)}</strong>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="muted">{t.text.noRoles}</p>
            )}
          </section>
          <section
            className="match-history"
            aria-labelledby="match-history-title"
          >
            <h2 id="match-history-title">{t.text.matchHistory}</h2>
            {data.matches.length ? (
              <ul className="match-list">
                {data.matches.map((match) => (
                  <li key={match.code} className="panel match">
                    <div className="section-heading">
                      <div>
                        <h3>
                          {t.message("reportTitle", { code: match.code })}
                        </h3>
                        <time
                          dateTime={new Date(match.finishedAt).toISOString()}
                          className="small muted"
                        >
                          {t.date(match.finishedAt)}
                        </time>
                      </div>
                      <span className={`badge ${match.winner}`}>
                        {winnerText(match.winner, t)}
                      </span>
                    </div>
                    <p>
                      {match.role ? (
                        <RoleBadge role={match.role} t={t} />
                      ) : (
                        t.text.gm
                      )}{" "}
                      {match.result && (
                        <span className="small"> · {t.text[match.result]}</span>
                      )}
                    </p>
                    <div className="section-heading">
                      <span className="small muted">
                        {t.message("playersCount", {
                          count: match.playerCount,
                        })}
                      </span>
                      <button
                        className="secondary"
                        onClick={() => openReport(match.code)}
                        aria-label={`${t.text.viewDetails}: ${match.code}`}
                      >
                        {t.text.viewDetails}
                        <Icon name="arrow" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="panel empty-state">
                <Icon name="history" />
                <p>{t.text.noHistory}</p>
              </div>
            )}
            <div className="pagination">
              <button
                className="secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t.text.previous}
              </button>
              <span className="count">{t.number(page + 1)}</span>
              <button
                className="secondary"
                disabled={data.nextPage === null}
                onClick={() => {
                  if (data.nextPage !== null) setPage(data.nextPage);
                }}
              >
                {t.text.next}
              </button>
            </div>
          </section>
          <p className="small muted">{t.text.reportNote}</p>
        </>
      )}
    </>
  );
}

export function MatchReport({ code, t }: { code: string; t: Translation }) {
  const { data, error, reload } = useRemote<Report>(`/games/${code}/report`);
  return (
    <>
      <header className="page-intro">
        <p className="eyebrow">{t.text.matchHistory}</p>
        <h1>{t.message("reportTitle", { code })}</h1>
        {data && (
          <p className="muted">
            {t.date(data.finishedAt)} ·{" "}
            {t.message("rulesVersion", { version: data.rulesVersion })}
          </p>
        )}
      </header>
      {error && <ErrorNotice code={error} t={t} retry={reload} />}
      {!data && !error && <p role="status">{t.text.loading}</p>}
      {data && (
        <>
          <section className={`panel result-card ${data.winner}`}>
            <span className="star-mark" aria-hidden="true">
              ✦
            </span>
            <h2>{winnerText(data.winner, t)}</h2>
            {data.winner === "cancelled" && <p>{t.text.cancelledNoStats}</p>}
          </section>
          <section className="panel" aria-labelledby="report-players">
            <h2 id="report-players">{t.text.players}</h2>
            <ul className="report-players">
              {data.players.map((player) => (
                <li key={player.id}>
                  <div>
                    <strong>{player.name || t.text.deletedPlayer}</strong>
                    <p className="small muted">
                      {data.winner === "draw" || data.winner === "cancelled"
                        ? t.text[data.winner]
                        : player.won
                          ? t.text.won
                          : t.text.lost}
                      {player.firstDay ? ` · ${t.text.dayOne}` : ""}
                    </p>
                  </div>
                  <div>
                    <RoleBadge role={player.role} t={t} />
                    {player.originalRole !== player.role && (
                      <p className="small">
                        {t.text.originalRole}: {t.role[player.originalRole]}
                      </p>
                    )}
                    {player.alignment && (
                      <p className="small">
                        {t.message("alignment", {
                          faction: t.faction[player.alignment],
                        })}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <div className="report-grid">
            <section className="panel">
              <h2>{t.text.outcomes}</h2>
              <ActionList actions={data.actions} players={data.players} t={t} />
            </section>
            <section className="panel">
              <h2>{t.text.votes}</h2>
              {data.votes.length ? (
                <ol className="action-list">
                  {data.votes.map((vote, index) => (
                    <li key={index}>
                      {t.message("voteRecord", {
                        day: vote.day,
                        round: vote.round,
                        voter: playerName(data.players, vote.voterId, t),
                        target: vote.targetId
                          ? playerName(data.players, vote.targetId, t)
                          : t.text.abstain,
                      })}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">{t.text.noVotes}</p>
              )}
            </section>
          </div>
          <details className="panel">
            <summary>{t.text.history}</summary>
            <EventLog events={data.events} players={data.players} t={t} />
          </details>
          <p className="small muted">{t.text.reportNote}</p>
        </>
      )}
    </>
  );
}
