import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ErrorCode,
  GameSummary,
  GameView,
  Identity,
} from "../shared/game";
import { normalizeDigits } from "../shared/input";
import { errorCode, initialize, replaceIdentity, request } from "./client";
import {
  languages,
  supportedLanguage,
  translations,
  type Translation,
} from "./i18n";
import {
  Account,
  RecoveryDialog,
  ResetPassword,
  type AccountMode,
  type Recovery,
} from "./Account";
import { Emblem, Icon } from "./Art";
import { GameTable } from "./GameTable";
import { MatchReport, Reports } from "./Reports";
import { FactionPreview, Rulebook, type LearningSection } from "./Rulebook";
import { ErrorNotice } from "./ui";
import { useGame } from "./useGame";
import { useRemote } from "./useRemote";
import "./styles.css";

type Route =
  | { page: "home" | "account" | "reports" | "reset" }
  | { page: "rules"; section?: LearningSection }
  | { page: "game" | "report"; code: string };
function currentRoute(): Route {
  const params = new URLSearchParams(location.search);
  const code = params.get("game")?.toUpperCase();
  if (code && /^[A-HJ-NP-Z2-9]{6}$/.test(code))
    return { page: params.get("view") === "report" ? "report" : "game", code };
  const page = params.get("view");
  if (page === "rules")
    return {
      page: "rules",
      section: params.get("section") === "characters" ? "characters" : "rules",
    };
  return {
    page:
      page === "account" || page === "reports" || page === "reset"
        ? page
        : "home",
  };
}
function currentResetToken() {
  if (new URLSearchParams(location.search).get("view") !== "reset") return null;
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function routeUrl(route: Route) {
  return route.page === "home"
    ? location.pathname
    : route.page === "game"
      ? `?game=${route.code}`
      : route.page === "report"
        ? `?view=report&game=${route.code}`
        : route.page === "rules" && route.section === "characters"
          ? "?view=rules&section=characters"
          : `?view=${route.page}`;
}
function readPreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn("Browser preferences are unavailable", error);
    return null;
  }
}

function Tables({ t, open }: { t: Translation; open: (code: string) => void }) {
  const { data, error, reload } = useRemote<GameSummary[]>("/games");
  return (
    <section className="active-tables" aria-labelledby="tables-title">
      <h2 id="tables-title">{t.text.myTables}</h2>
      {error && <ErrorNotice code={error} t={t} retry={reload} />}
      {!data && !error && <p role="status">{t.text.loading}</p>}
      {data &&
        (data.length ? (
          <ul>
            {data.map((game) => (
              <li key={game.code}>
                <button className="table-link" onClick={() => open(game.code)}>
                  <span className="table-symbol" aria-hidden="true">
                    <Icon name={game.phase === "night" ? "moon" : "users"} />
                  </span>
                  <span>
                    <strong>{game.code}</strong>
                    <small>
                      {game.isGm ? t.text.gm : t.text.player} ·{" "}
                      {t.phase[game.phase]} ·{" "}
                      {t.message("playersCount", { count: game.playerCount })}
                    </small>
                  </span>
                  <Icon name="arrow" />
                  <span className="sr-only">{t.text.resume}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{t.text.noTables}</p>
        ))}
    </section>
  );
}

function Home({
  t,
  disabled,
  identity,
  create,
  join,
  open,
  account,
  learn,
  initialCode = "",
}: {
  t: Translation;
  disabled: boolean;
  identity: Identity | null;
  create: () => void;
  join: (code: string, name: string) => void;
  open: (code: string) => void;
  account: () => void;
  learn: () => void;
  initialCode?: string;
}) {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow hero-eyebrow">
            <span aria-hidden="true" />
            {t.text.eyebrow}
          </p>
          <h1 id="hero-title">{t.text.title}</h1>
          <p className="hero-description">{t.text.intro}</p>
          <p className="hero-meta">
            <Icon name="users" />
            {t.text.heroMeta}
          </p>
        </div>
        <div className="table-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <span className="art-star star-one">✦</span>
          <span className="art-star star-two">✧</span>
          <div className="card-art third-art">
            <span>
              III<span>✦</span>
            </span>
            <Emblem faction="third" />
            <span>{t.faction.third}</span>
          </div>
          <div className="card-art citizen-art">
            <span>
              II<span>✦</span>
            </span>
            <Emblem faction="citizen" />
            <span>{t.faction.citizen}</span>
          </div>
          <div className="card-art mafia-art">
            <span>
              I<span>✦</span>
            </span>
            <Emblem faction="mafia" />
            <span>{t.faction.mafia}</span>
          </div>
          <div className="art-token">
            <span>?</span>
          </div>
          <span className="art-caption">{t.text.afterDark}</span>
        </div>
      </section>
      <div className="home-grid">
        <section className="panel host-card" aria-labelledby="host-title">
          <div className="card-top">
            <span className="step">01</span>
            <Icon name="users" />
          </div>
          <h2 id="host-title">{t.text.hostTitle}</h2>
          <p>{t.text.hostText}</p>
          <div className="host-decoration" aria-hidden="true">
            <span>✦</span>
            <span />
            <span>✦</span>
          </div>
          <button className="primary full" disabled={disabled} onClick={create}>
            {t.text.create}
            <Icon name="arrow" />
          </button>
          <p className="small">{t.text.startHelp}</p>
        </section>
        <section className="panel join-card" aria-labelledby="join-title">
          <div className="card-top">
            <span className="step">02</span>
            <Icon name="lock" />
          </div>
          <h2 id="join-title">{t.text.joinTitle}</h2>
          <p className="muted">{t.text.joinText}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              join(
                String(data.get("code")).trim().toUpperCase(),
                String(data.get("name")).trim(),
              );
            }}
          >
            <fieldset disabled={disabled}>
              <legend className="sr-only">{t.text.join}</legend>
              <div className="join-fields">
                <div>
                  <label htmlFor="name">{t.text.name}</label>
                  <input
                    id="name"
                    name="name"
                    autoComplete="nickname"
                    maxLength={40}
                    defaultValue={identity?.username ?? ""}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="code">{t.text.code}</label>
                  <input
                    id="code"
                    name="code"
                    className="code-input"
                    dir="ltr"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    pattern="[A-HJ-NP-Za-hj-np-z2-9]{6}"
                    minLength={6}
                    maxLength={6}
                    placeholder="ABC234"
                    aria-describedby="code-help"
                    defaultValue={initialCode}
                    onChange={(event) => {
                      event.currentTarget.value = normalizeDigits(
                        event.currentTarget.value,
                      );
                    }}
                    required
                  />
                </div>
              </div>
              <p className="small muted" id="code-help">
                {t.text.codeHelp}
              </p>
              <button className="secondary full">
                {t.text.join}
                <Icon name="arrow" />
              </button>
              <p className="small muted join-privacy">{t.text.joinPrivacy}</p>
            </fieldset>
          </form>
        </section>
      </div>
      {identity && <Tables t={t} open={open} />}
      <section className="features" aria-label={t.text.accessibleTitle}>
        {(
          [
            ["accessibleTitle", "accessibleText", "eye"],
            ["liveTitle", "liveText", "lock"],
            ["historyTitle", "historyText", "history"],
          ] as const
        ).map(([title, text, icon]) => (
          <div key={title}>
            <span className="feature-icon">
              <Icon name={icon} />
            </span>
            <h2>{t.text[title]}</h2>
            <p>{t.text[text]}</p>
          </div>
        ))}
      </section>
      <FactionPreview t={t} onLearn={learn} />
      {identity?.isGuest && (
        <section className="account-invite panel">
          <div>
            <h2>{t.text.keepStory}</h2>
            <p>{t.text.keepStoryText}</p>
          </div>
          <button className="secondary" onClick={account}>
            {t.text.register}
            <Icon name="arrow" />
          </button>
        </section>
      )}
    </>
  );
}

function LiveTable({
  code,
  identity,
  t,
  openReport,
  join,
  home,
}: {
  code: string;
  identity: Identity;
  t: Translation;
  openReport: () => void;
  join: (code: string, name: string) => void;
  home: () => void;
}) {
  const live = useGame(code, identity.id);
  return (
    <>
      <div className="connection-line">
        <p className={`connection ${live.connection}`} role="status">
          <span aria-hidden="true" />
          {live.connection === "offline"
            ? t.text.reconnecting
            : t.text[live.connection]}
        </p>
      </div>
      {live.error && (
        <ErrorNotice
          code={live.error}
          t={t}
          retry={
            live.error === "authentication"
              ? () => location.reload()
              : live.refresh
          }
          dismiss={live.game ? live.dismiss : undefined}
        />
      )}
      {live.game ? (
        <GameTable
          game={live.game}
          t={t}
          disabled={live.busy || live.connection === "offline"}
          send={live.command}
          showReports={openReport}
          leaveTable={home}
        />
      ) : !live.error ? (
        <p role="status">{t.text.loading}</p>
      ) : live.error === "forbidden" ? (
        <section className="panel">
          <h1>{t.text.joinTitle}</h1>
          <p>{t.text.joinPrivacy}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              join(
                code,
                String(new FormData(event.currentTarget).get("name")).trim(),
              );
            }}
          >
            <label htmlFor="invite-name">{t.text.name}</label>
            <input
              id="invite-name"
              name="name"
              maxLength={40}
              autoComplete="nickname"
              required
            />
            <button className="primary full">
              {t.text.join} · {code}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}

export default function App() {
  const [language, setLanguage] = useState(() =>
    supportedLanguage(readPreference("mafia-language") ?? navigator.language),
  );
  const [contrast, setContrast] = useState(
    () => readPreference("mafia-contrast") === "true",
  );
  const [route, setRoute] = useState<Route>(currentRoute);
  const [resetToken, setResetToken] = useState(currentResetToken);
  const [accountMode, setAccountMode] = useState<AccountMode>("register");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [entryVersion, setEntryVersion] = useState(0);
  const main = useRef<HTMLElement>(null);
  const entering = useRef(false);
  const t = translations(language);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = t.meta.direction;
    document.documentElement.dataset.contrast = String(contrast);
    document.title = t.text.brand;
  }, [language, contrast, t]);
  useEffect(() => {
    let active = true;
    void initialize()
      .then((identity) => {
        if (active) setIdentity(identity);
      })
      .catch((error: unknown) => {
        if (active) setError(errorCode(error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    main.current?.focus();
  }, [route]);
  useEffect(() => {
    if (route.page === "reset" && location.hash)
      history.replaceState(null, "", `${location.pathname}${location.search}`);
  }, [route, resetToken]);
  useEffect(() => {
    const pop = () => {
      setRoute(currentRoute());
      setResetToken(currentResetToken());
      setError(null);
    };
    const hash = () => {
      if (currentRoute().page === "reset") pop();
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  function preference(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn("Could not save browser preferences", error);
      setStorageError(true);
    }
  }
  function navigate(next: Route) {
    if (next.page !== "reset") setResetToken(null);
    history.pushState(null, "", routeUrl(next));
    setRoute(next);
    setError(null);
  }
  function changeIdentity(next: Identity) {
    replaceIdentity(next);
    setIdentity(next);
  }
  async function enter(code?: string, name?: string) {
    if (entering.current) return;
    entering.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = code
        ? await request<GameView>(`/games/${code}/join`, { name })
        : await request<{ code: string }>("/games", {});
      setEntryVersion((value) => value + 1);
      navigate({ page: "game", code: result.code });
    } catch (error) {
      setError(errorCode(error));
    } finally {
      entering.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <a className="skip-link" href="#main">
        {t.text.skip}
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href="/"
            onClick={(event) => {
              if (
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                event.button === 0
              ) {
                event.preventDefault();
                navigate({ page: "home" });
              }
            }}
          >
            <span className="brand-mark" aria-hidden="true">
              M<span>✦</span>
            </span>
            <span>
              {t.text.brand}
              <small>{t.text.tagline}</small>
            </span>
          </a>
          <nav aria-label={t.text.home}>
            {(["rules", "reports", "account"] as const).map((page) => (
              <button
                key={page}
                className="nav-link"
                aria-current={route.page === page ? "page" : undefined}
                disabled={page !== "rules" && !identity}
                onClick={() => navigate({ page })}
              >
                {t.text[page]}
              </button>
            ))}
            <label className="language">
              <span className="sr-only">{t.text.language}</span>
              <select
                value={language}
                onChange={(event) => {
                  const value = supportedLanguage(event.target.value);
                  setLanguage(value);
                  preference("mafia-language", value);
                }}
              >
                {languages.map((locale) => (
                  <option
                    key={locale.code}
                    value={locale.code}
                    lang={locale.code}
                  >
                    {locale.nativeName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="contrast-toggle"
              aria-pressed={contrast}
              aria-label={t.text.contrast}
              title={t.text.contrast}
              onClick={() => {
                setContrast(!contrast);
                preference("mafia-contrast", String(!contrast));
              }}
            >
              <span aria-hidden="true">◐</span>
            </button>
          </nav>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {route.page !== "home" && (
          <div className="breadcrumb">
            <button
              className="quiet"
              onClick={() => navigate({ page: "home" })}
            >
              <span aria-hidden="true">←</span>
              {t.text.back}
            </button>
          </div>
        )}
        {storageError && (
          <p className="notice" role="status">
            {t.text.storageUnavailable}
          </p>
        )}
        {error && (
          <ErrorNotice
            code={error}
            t={t}
            retry={!identity ? () => location.reload() : undefined}
            dismiss={identity ? () => setError(null) : undefined}
          />
        )}
        {!identity && !error && (
          <p className="boot-status" role="status">
            {t.text.loading}
          </p>
        )}
        {route.page === "home" && (
          <Home
            key={identity?.id ?? "loading"}
            t={t}
            identity={identity}
            disabled={!identity || busy}
            create={() => void enter()}
            join={(code, name) => void enter(code, name)}
            open={(code) => navigate({ page: "game", code })}
            account={() => navigate({ page: "account" })}
            learn={() => navigate({ page: "rules", section: "characters" })}
          />
        )}
        {route.page === "rules" && (
          <Rulebook
            t={t}
            section={route.section ?? "rules"}
            onSectionChange={(section) => navigate({ page: "rules", section })}
          />
        )}
        {route.page === "game" && identity && (
          <LiveTable
            key={`${route.code}-${identity.id}-${entryVersion}`}
            code={route.code}
            identity={identity}
            t={t}
            openReport={() => navigate({ page: "report", code: route.code })}
            join={(code, name) => void enter(code, name)}
            home={() => navigate({ page: "home" })}
          />
        )}
        {route.page === "reports" && identity && (
          <Reports
            key={identity.id}
            t={t}
            openReport={(code) => navigate({ page: "report", code })}
          />
        )}
        {route.page === "report" && identity && (
          <MatchReport key={identity.id} code={route.code} t={t} />
        )}
        {route.page === "account" && identity && (
          <Account
            key={identity.id}
            identity={identity}
            t={t}
            onIdentity={changeIdentity}
            onRecovery={setRecovery}
            initialMode={accountMode}
          />
        )}
        {route.page === "reset" && identity && (
          <ResetPassword
            token={resetToken}
            t={t}
            onIdentity={changeIdentity}
            onDone={(mode) => {
              setAccountMode(mode);
              navigate({ page: "account" });
            }}
          />
        )}
      </main>
      <footer className="site-footer">
        <span className="footer-brand">
          {t.text.brand}
          <span aria-hidden="true">✦</span>
        </span>
        <span>{t.text.footer}</span>
        <span>
          {languages.map((language) => language.code.toUpperCase()).join(" / ")}
        </span>
      </footer>
      {recovery && (
        <RecoveryDialog
          recovery={recovery}
          t={t}
          onSaved={() => setRecovery(null)}
        />
      )}
    </>
  );
}

export class AppBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("The application could not render", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const t = translations(document.documentElement.lang || "en");
    return (
      <main className="page-intro">
        <h1>{t.text.brand}</h1>
        <p role="alert">{t.text.unexpectedError}</p>
        <button className="primary" onClick={() => location.reload()}>
          {t.text.refresh}
        </button>
      </main>
    );
  }
}
