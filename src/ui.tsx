import { useId, useRef, useState } from "react";
import {
  roles,
  type ActionView,
  type ErrorCode,
  type PublicEvent,
  type Role,
} from "../shared/game";
import { actionText, eventText } from "./gameText";
import type { Translation } from "./i18n";

export function RoleBadge({ role, t }: { role: Role; t: Translation }) {
  return (
    <span className={`badge ${roles[role].faction}`}>
      {t.role[role]} · {t.faction[roles[role].faction]}
    </span>
  );
}

export function ErrorNotice({
  code,
  t,
  retry,
  dismiss,
}: {
  code: ErrorCode;
  t: Translation;
  retry?: () => void;
  dismiss?: () => void;
}) {
  return (
    <div className="error" role="alert">
      <strong>{t.text.errorTitle}</strong>
      <p>{t.error[code]}</p>
      <div className="button-row">
        {retry && (
          <button className="secondary" onClick={retry}>
            {t.text.refresh}
          </button>
        )}
        {dismiss && (
          <button className="quiet" onClick={dismiss}>
            {t.text.dismiss}
          </button>
        )}
      </div>
    </div>
  );
}

export function ConfirmAction({
  label,
  ariaLabel,
  description,
  confirmLabel,
  disabled,
  onConfirm,
  t,
}: {
  label: string;
  ariaLabel?: string;
  description: string;
  confirmLabel?: string;
  disabled: boolean;
  onConfirm: () => Promise<boolean>;
  t: Translation;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const cancel = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="confirm-action">
      <button
        className="quiet danger-text"
        type="button"
        ref={trigger}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      <div id={id} hidden={!open}>
        <p>{description}</p>
        <div className="button-row">
          <button
            className="danger"
            type="button"
            disabled={disabled}
            onClick={async () => {
              if (await onConfirm()) cancel();
            }}
          >
            {confirmLabel ?? t.text.confirm}
          </button>
          <button className="secondary" type="button" onClick={cancel}>
            {t.text.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EventLog({
  events,
  players,
  t,
}: {
  events: PublicEvent[];
  players: { id: string; name: string }[];
  t: Translation;
}) {
  return events.length ? (
    <ol className="timeline">
      {[...events].reverse().map((event) => (
        <li key={event.id}>
          <p>{eventText(event, players, t)}</p>
          <time dateTime={new Date(event.createdAt).toISOString()}>
            {t.date(event.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  ) : (
    <p className="empty">{t.text.noEvents}</p>
  );
}

export function ActionList({
  actions,
  players,
  t,
}: {
  actions: ActionView[];
  players: { id: string; name: string }[];
  t: Translation;
}) {
  return actions.length ? (
    <ol className="action-list">
      {actions.map((action) => (
        <li key={action.id}>
          <p>{actionText(action, players, t)}</p>
          {action.guess && (
            <p className="small muted">
              {t.text.guessRole}: {t.role[action.guess]}
            </p>
          )}
          {action.gun && (
            <p className="small muted">
              {action.gun === "real" ? t.text.realGun : t.text.blankGun}
            </p>
          )}
        </li>
      ))}
    </ol>
  ) : (
    <p className="empty">{t.text.noReportActions}</p>
  );
}
