import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ErrorCode, Identity, SessionView } from "../shared/game";
import { download, errorCode, request } from "./client";
import type { Translation } from "./i18n";
import { Icon } from "./Art";
import { ErrorNotice } from "./ui";
import { useRemote } from "./useRemote";

export type Recovery = { code: string; username: string; recovered: boolean };
export type AccountMode = "register" | "login" | "recover";
type AccountResponse = { identity: Identity; recoveryCode?: string };

export function RecoveryDialog({
  recovery,
  t,
  onSaved,
}: {
  recovery: Recovery;
  t: Translation;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      node.close();
      window.removeEventListener("beforeunload", warn);
    };
  }, []);
  return (
    <dialog
      className="recovery-dialog panel"
      ref={dialog}
      aria-labelledby="recovery-title"
      aria-describedby="recovery-warning"
      onCancel={(event) => event.preventDefault()}
    >
      <Icon name="lock" />
      <p className="eyebrow">{t.text.private}</p>
      <h2 id="recovery-title">{t.text.recoveryTitle}</h2>
      <p id="recovery-warning">{t.text.recoveryWarning}</p>
      {recovery.recovered && <p className="notice">{t.text.recovered}</p>}
      <p>
        <strong>{t.text.username}:</strong> {recovery.username}
      </p>
      <button
        className="secondary"
        aria-expanded={visible}
        aria-controls="recovery-secret"
        onClick={() => setVisible(!visible)}
      >
        {visible ? t.text.hideRecovery : t.text.revealRecovery}
      </button>
      <div id="recovery-secret" role="status" aria-atomic="true">
        {visible && <code className="recovery-code">{recovery.code}</code>}
      </div>
      <button
        className="secondary full"
        onClick={() => {
          try {
            download(
              "mafia-table-recovery.txt",
              t.message("recoveryFile", {
                username: recovery.username,
                code: recovery.code,
              }),
              "text/plain;charset=utf-8",
            );
            setError(false);
          } catch (error) {
            console.error("Recovery download failed", error);
            setError(true);
          }
        }}
      >
        {t.text.downloadRecovery}
      </button>
      {error && <p role="alert">{t.error.server}</p>}
      <button className="primary full" onClick={onSaved}>
        {t.text.savedRecovery}
        <Icon name="check" />
      </button>
    </dialog>
  );
}

function PasswordField({
  name,
  label,
  scope,
  show,
  fresh = false,
}: {
  name: string;
  label: string;
  scope: string;
  show: boolean;
  fresh?: boolean;
}) {
  return (
    <div className="form-field">
      <label htmlFor={`${scope}-${name}`}>{label}</label>
      <input
        id={`${scope}-${name}`}
        name={name}
        type={show ? "text" : "password"}
        autoComplete={fresh ? "new-password" : "current-password"}
        minLength={fresh ? 15 : 1}
        maxLength={128}
        required
      />
    </div>
  );
}

export function ResetPassword({
  token,
  t,
  onIdentity,
  onDone,
}: {
  token: string | null;
  t: Translation;
  onIdentity: (identity: Identity) => void;
  onDone: (mode: AccountMode) => void;
}) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const pending = useRef(false);
  return (
    <>
      <header className="page-intro">
        <p className="eyebrow">{t.text.private}</p>
        <h1>{t.text.resetPasswordTitle}</h1>
        <p className="muted">{t.text.resetPasswordHelp}</p>
      </header>
      <section className="panel reset-panel">
        <Icon name="lock" />
        {done ? (
          <>
            <p className="notice" role="status">
              {t.text.emailResetComplete}
            </p>
            <button className="primary full" onClick={() => onDone("login")}>
              {t.text.login}
              <Icon name="arrow" />
            </button>
          </>
        ) : !token ? (
          <>
            <ErrorNotice code="resetLink" t={t} />
            <button className="primary full" onClick={() => onDone("recover")}>
              {t.text.sendResetLink}
            </button>
          </>
        ) : (
          <>
            {error && (
              <ErrorNotice code={error} t={t} dismiss={() => setError(null)} />
            )}
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (pending.current) return;
                pending.current = true;
                setBusy(true);
                setError(null);
                const data = new FormData(event.currentTarget);
                try {
                  const result = await request<AccountResponse>(
                    "/auth/reset-password",
                    {
                      token,
                      password: data.get("password"),
                      confirmPassword: data.get("confirmPassword"),
                    },
                  );
                  onIdentity(result.identity);
                  setDone(true);
                } catch (failure) {
                  setError(errorCode(failure));
                } finally {
                  pending.current = false;
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                <legend className="sr-only">{t.text.resetPasswordTitle}</legend>
                <PasswordField
                  name="password"
                  label={t.text.newPassword}
                  scope="reset"
                  show={show}
                  fresh
                />
                <p className="small muted">{t.text.passwordHelp}</p>
                <PasswordField
                  name="confirmPassword"
                  label={t.text.confirmPassword}
                  scope="reset"
                  show={show}
                  fresh
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(event) => setShow(event.target.checked)}
                  />
                  {t.text.showPassword}
                </label>
                <button className="primary full">
                  {busy ? t.text.working : t.text.changePassword}
                  <Icon name="check" />
                </button>
              </fieldset>
            </form>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => onDone("recover")}
            >
              {t.text.sendResetLink}
            </button>
          </>
        )}
      </section>
    </>
  );
}

function Sessions({ t }: { t: Translation }) {
  const { data, error, reload } = useRemote<SessionView[]>("/account/sessions");
  const [failure, setFailure] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <section className="panel">
      <h2>{t.text.sessions}</h2>
      {(failure ?? error) && (
        <ErrorNotice code={(failure ?? error)!} t={t} retry={reload} />
      )}
      {!data && !error && <p role="status">{t.text.loading}</p>}
      <ul className="session-list">
        {data?.map((session) => (
          <li key={session.id}>
            <div>
              <strong>
                {session.current ? t.text.thisSession : session.id.slice(0, 8)}
              </strong>
              <p className="small muted">
                {t.message("sessionDate", {
                  created: t.date(session.createdAt),
                  seen: t.date(session.lastSeenAt),
                })}
              </p>
            </div>
            {!session.current && (
              <button
                className="secondary"
                disabled={busy}
                aria-label={t.message("playerAction", {
                  action: t.text.revokeSession,
                  name: session.id.slice(0, 8),
                })}
                onClick={async () => {
                  setBusy(true);
                  setFailure(null);
                  setSaved(false);
                  try {
                    await request("/account/sessions/revoke", {
                      id: session.id,
                    });
                    reload();
                    setSaved(true);
                  } catch (error) {
                    setFailure(errorCode(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t.text.revokeSession}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p role="status" className="small">
        {saved ? t.text.sessionRevoked : ""}
      </p>
    </section>
  );
}

export function Account({
  identity,
  t,
  onIdentity,
  onRecovery,
  initialMode = "register",
}: {
  identity: Identity;
  t: Translation;
  onIdentity: (identity: Identity) => void;
  onRecovery: (recovery: Recovery) => void;
  initialMode?: AccountMode;
}) {
  const [mode, setMode] = useState<AccountMode>(initialMode);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [message, setMessage] = useState<keyof Translation["text"] | null>(
    null,
  );
  const [sessionVersion, setSessionVersion] = useState(0);
  const [deleteWord, setDeleteWord] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const verificationField = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const verifying =
    mode === "register" &&
    identity.emailEnabled &&
    !!identity.pendingEmail &&
    !editingEmail;
  const emailRecovery =
    mode === "recover" && identity.emailEnabled && !useRecoveryCode;
  useEffect(() => {
    if (verifying) verificationField.current?.focus();
  }, [verifying]);

  async function perform(
    path: string,
    body: object,
    success: keyof Translation["text"],
    username = identity.username ?? "",
  ) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (path === "/auth/request-reset") {
        await request<{ ok: true }>(path, body);
      } else {
        const result = await request<AccountResponse>(path, body);
        onIdentity(result.identity);
        if (result.recoveryCode)
          onRecovery({
            code: result.recoveryCode,
            username,
            recovered: path === "/auth/recover",
          });
      }
      setMessage(success);
      setSessionVersion((value) => value + 1);
      if (path === "/auth/recover") setMode("login");
      return true;
    } catch (error) {
      setError(errorCode(error));
      if (path === "/auth/register" && identity.emailEnabled) {
        try {
          onIdentity(await request<Identity>("/me"));
          setEditingEmail(false);
        } catch (refreshError) {
          console.error(
            "Could not refresh email verification state",
            refreshError,
          );
        }
      }
      return false;
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  async function credentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username")).trim().toLowerCase();
    const success = await perform(
      emailRecovery ? "/auth/request-reset" : `/auth/${mode}`,
      emailRecovery
        ? { email: data.get("email"), language: t.language }
        : {
            username,
            password: data.get("password"),
            confirmPassword: data.get("confirmPassword"),
            code: data.get("code"),
            adoptGuest: data.get("adoptGuest") === "on",
            email: data.get("email"),
            language: t.language,
          },
      emailRecovery
        ? "resetRequested"
        : mode === "recover"
          ? "recovered"
          : mode === "login"
            ? "signedIn"
            : identity.emailEnabled
              ? "verificationSent"
              : "recoverySaved",
      username,
    );
    if (success) {
      form.reset();
      setEditingEmail(false);
    }
  }
  return (
    <>
      <header className="page-intro">
        <p className="eyebrow">{t.text.account}</p>
        <h1>{t.text.accountTitle}</h1>
        <p className="muted">{t.text.accountIntro}</p>
      </header>
      <div className="account-grid">
        <div className="stack">
          {error && (
            <ErrorNotice code={error} t={t} dismiss={() => setError(null)} />
          )}
          <p role="status" className={message ? "notice" : "sr-only"}>
            {message ? t.text[message] : ""}
          </p>
          {identity.isGuest ? (
            <section className="panel account-form">
              <div className="switcher" aria-label={t.text.account}>
                {(["register", "login", "recover"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    disabled={busy}
                    onClick={() => {
                      setMode(value);
                      setUseRecoveryCode(false);
                      setError(null);
                      setMessage(null);
                    }}
                  >
                    {t.text[value]}
                  </button>
                ))}
              </div>
              <h2>{verifying ? t.text.checkEmail : t.text[mode]}</h2>
              <p className="muted">
                {verifying
                  ? t.text.verificationHelp
                  : emailRecovery
                    ? t.text.emailRecoveryIntro
                    : mode === "recover"
                      ? t.text.recoveryIntro
                      : mode === "register" && identity.emailEnabled
                        ? t.text.emailRequired
                        : t.text.keepStoryText}
              </p>
              {verifying ? (
                <>
                  <p>
                    {t.text.verificationDestination}
                    <br />
                    <bdi dir="ltr">{identity.pendingEmail}</bdi>
                  </p>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      if (
                        await perform(
                          "/auth/verify-email",
                          { code: new FormData(form).get("code") },
                          "emailVerified",
                        )
                      )
                        form.reset();
                    }}
                  >
                    <fieldset disabled={busy}>
                      <legend className="sr-only">{t.text.verifyEmail}</legend>
                      <label htmlFor="verification-code">
                        {t.text.verificationCode}
                      </label>
                      <input
                        id="verification-code"
                        ref={verificationField}
                        name="code"
                        className="code-input"
                        dir="ltr"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9۰-۹٠-٩]{6}"
                        minLength={6}
                        maxLength={6}
                        required
                      />
                      <button className="primary full">
                        {busy ? t.text.working : t.text.verifyEmail}
                        <Icon name="check" />
                      </button>
                    </fieldset>
                  </form>
                  <div className="button-row">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          "/auth/resend-verification",
                          { language: t.language },
                          "verificationSent",
                        )
                      }
                    >
                      {t.text.resendVerification}
                    </button>
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => {
                        setEditingEmail(true);
                        setError(null);
                        setMessage(null);
                      }}
                    >
                      {t.text.startAgain}
                    </button>
                  </div>
                </>
              ) : (
                <form key={mode} onSubmit={(event) => void credentials(event)}>
                  <fieldset disabled={busy}>
                    <legend className="sr-only">{t.text[mode]}</legend>
                    {!emailRecovery && (
                      <div className="form-field">
                        <label htmlFor="account-username">
                          {mode === "login" && identity.emailEnabled
                            ? t.text.loginIdentifier
                            : t.text.username}
                        </label>
                        <input
                          id="account-username"
                          name="username"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          minLength={3}
                          maxLength={
                            mode === "login" && identity.emailEnabled ? 254 : 30
                          }
                          pattern={
                            mode === "login" && identity.emailEnabled
                              ? undefined
                              : "[a-zA-Z0-9_]{3,30}"
                          }
                          aria-describedby={
                            mode === "login" ? undefined : "username-help"
                          }
                          dir="ltr"
                          required
                        />
                        {mode !== "login" && (
                          <p className="small muted" id="username-help">
                            {t.text.usernameHelp}
                          </p>
                        )}
                      </div>
                    )}
                    {((mode === "register" && identity.emailEnabled) ||
                      emailRecovery) && (
                      <div className="form-field">
                        <label htmlFor="account-email">
                          {t.text.emailAddress}
                        </label>
                        <input
                          id="account-email"
                          name="email"
                          type="email"
                          dir="ltr"
                          autoComplete="email"
                          autoCapitalize="none"
                          spellCheck={false}
                          maxLength={254}
                          defaultValue={identity.pendingEmail ?? ""}
                          required
                        />
                      </div>
                    )}
                    {mode === "recover" && !emailRecovery && (
                      <div className="form-field">
                        <label htmlFor="account-code">
                          {t.text.recoveryCode}
                        </label>
                        <input
                          id="account-code"
                          name="code"
                          type={show ? "text" : "password"}
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          minLength={32}
                          maxLength={32}
                          required
                        />
                      </div>
                    )}
                    {!emailRecovery && (
                      <PasswordField
                        name="password"
                        label={
                          mode === "recover"
                            ? t.text.newPassword
                            : t.text.password
                        }
                        scope="credentials"
                        show={show}
                        fresh={mode !== "login"}
                      />
                    )}
                    {mode !== "login" && !emailRecovery && (
                      <>
                        <p className="small muted">{t.text.passwordHelp}</p>
                        <PasswordField
                          name="confirmPassword"
                          label={t.text.confirmPassword}
                          scope="credentials"
                          show={show}
                          fresh
                        />
                      </>
                    )}
                    {!emailRecovery && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={show}
                          onChange={(event) => setShow(event.target.checked)}
                        />
                        {t.text.showPassword}
                      </label>
                    )}
                    {mode === "login" && (
                      <>
                        <label className="check">
                          <input
                            type="checkbox"
                            name="adoptGuest"
                            defaultChecked
                            aria-describedby="adopt-help"
                          />
                          {t.text.adoptGuest}
                        </label>
                        <p id="adopt-help" className="small muted">
                          {t.text.adoptGuestHelp}
                        </p>
                      </>
                    )}
                    <button className="primary full">
                      {busy
                        ? t.text.working
                        : emailRecovery
                          ? t.text.sendResetLink
                          : t.text[mode]}
                      <Icon name="arrow" />
                    </button>
                  </fieldset>
                </form>
              )}
              {mode === "recover" && identity.emailEnabled && (
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    setUseRecoveryCode(!useRecoveryCode);
                    setError(null);
                    setMessage(null);
                  }}
                >
                  {useRecoveryCode
                    ? t.text.useEmailRecovery
                    : t.text.useRecoveryCode}
                </button>
              )}
            </section>
          ) : (
            <>
              <section className="panel account-summary">
                <span className="profile-avatar" aria-hidden="true">
                  {identity.username?.slice(0, 1).toUpperCase()}
                </span>
                <h2>{identity.username}</h2>
                {identity.email && (
                  <p>
                    <bdi dir="ltr">{identity.email}</bdi>
                    <br />
                    <span className="small muted">{t.text.verifiedEmail}</span>
                  </p>
                )}
                {identity.email && identity.emailEnabled && (
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        "/auth/request-reset",
                        { email: identity.email, language: t.language },
                        "resetRequested",
                      )
                    }
                  >
                    {t.text.sendResetLink}
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void perform("/auth/logout", {}, "signedOut")}
                >
                  {t.text.logout}
                </button>
              </section>
              <section className="panel">
                <h2>{t.text.changePassword}</h2>
                <p className="small muted">{t.text.passwordHelp}</p>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    if (
                      await perform(
                        "/account/password",
                        Object.fromEntries(data),
                        "passwordChanged",
                      )
                    )
                      form.reset();
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend className="sr-only">{t.text.changePassword}</legend>
                    <PasswordField
                      name="currentPassword"
                      label={t.text.currentPassword}
                      scope="change"
                      show={show}
                    />
                    <PasswordField
                      name="password"
                      label={t.text.newPassword}
                      scope="change"
                      show={show}
                      fresh
                    />
                    <PasswordField
                      name="confirmPassword"
                      label={t.text.confirmPassword}
                      scope="change"
                      show={show}
                      fresh
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={show}
                        onChange={(event) => setShow(event.target.checked)}
                      />
                      {t.text.showPassword}
                    </label>
                    <button className="secondary full">
                      {busy ? t.text.working : t.text.changePassword}
                    </button>
                  </fieldset>
                </form>
              </section>
              <section className="panel">
                <h2>
                  {identity.email ? t.text.backupCode : t.text.replaceRecovery}
                </h2>
                <p className="muted">
                  {identity.email
                    ? t.text.backupCodeHelp
                    : t.text.replaceRecoveryHelp}
                </p>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    if (
                      await perform(
                        "/account/recovery",
                        Object.fromEntries(new FormData(form)),
                        "recoverySaved",
                      )
                    )
                      form.reset();
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend className="sr-only">
                      {identity.email
                        ? t.text.backupCode
                        : t.text.replaceRecovery}
                    </legend>
                    <PasswordField
                      name="password"
                      label={t.text.currentPassword}
                      scope="rotate"
                      show={show}
                    />
                    <button className="secondary full">
                      {busy
                        ? t.text.working
                        : identity.email
                          ? t.text.backupCode
                          : t.text.replaceRecovery}
                    </button>
                  </fieldset>
                </form>
              </section>
            </>
          )}
        </div>
        <div className="stack">
          <section className="panel privacy-panel">
            <Icon name="lock" />
            <h2>{t.text.keepStory}</h2>
            <p>{t.text.privacyNote}</p>
            {identity.emailEnabled && <p>{t.text.emailPrivacy}</p>}
            <p className="small muted">{t.text.profileNote}</p>
          </section>
          {!identity.isGuest && <Sessions key={sessionVersion} t={t} />}
          <section className="panel">
            <h2>{t.text.dataPrivacy}</h2>
            <p className="muted">{t.text.exportHelp}</p>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  download(
                    "mafia-table-data.json",
                    JSON.stringify(
                      await request<unknown>("/account/export"),
                      null,
                      2,
                    ),
                    "application/json",
                  );
                } catch (error) {
                  setError(errorCode(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.text.exportData}
            </button>
            <details className="danger-zone">
              <summary>{t.text.deleteProfile}</summary>
              <p id="delete-help">{t.text.deleteHelp}</p>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (deleteWord !== t.text.deleteWord) return;
                  const password = new FormData(event.currentTarget).get(
                    "password",
                  );
                  await perform(
                    "/account/delete",
                    {
                      confirm: true,
                      ...(identity.isGuest ? {} : { password }),
                    },
                    "profileDeleted",
                  );
                }}
              >
                <fieldset disabled={busy} aria-describedby="delete-help">
                  <legend className="sr-only">{t.text.deleteProfile}</legend>
                  {!identity.isGuest && (
                    <PasswordField
                      name="password"
                      label={t.text.currentPassword}
                      scope="delete"
                      show={show}
                    />
                  )}
                  <label htmlFor="delete-word">
                    {t.message("confirmDelete", { word: t.text.deleteWord })}
                  </label>
                  <input
                    id="delete-word"
                    autoComplete="off"
                    value={deleteWord}
                    onChange={(event) => setDeleteWord(event.target.value)}
                    required
                  />
                  <button
                    className="danger full"
                    disabled={deleteWord !== t.text.deleteWord}
                  >
                    {t.text.deleteProfile}
                  </button>
                </fieldset>
              </form>
            </details>
          </section>
        </div>
      </div>
    </>
  );
}
