import { useMemo, useState } from "react";
import { encode } from "uqr";
import type { GameView } from "../shared/game";
import type { Translation } from "./i18n";
import { Icon } from "./Art";

function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(value, { ecc: "M", border: 4 });
    return {
      size,
      path: data
        .flatMap((row, y) =>
          row.map((dark, x) => (dark ? `M${x},${y}h1v1h-1z` : "")),
        )
        .join(""),
    };
  }, [value]);
  return (
    <svg
      className="invite-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export function InviteStrip({ game, t }: { game: GameView; t: Translation }) {
  const [status, setStatus] = useState<
    "copied" | "linkCopied" | "copyError" | null
  >(null);
  const link = `${location.origin}/?game=${game.code}`;
  const copy = async (value: string, done: "copied" | "linkCopied") => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(done);
    } catch (error) {
      console.error("Clipboard unavailable", error);
      setStatus("copyError");
    }
  };
  return (
    <section className="invite-strip" aria-label={t.text.code}>
      <div>
        <span className="small">{game.isGm ? t.text.invite : t.text.code}</span>
        <strong
          className="join-code"
          aria-label={`${t.text.code}: ${game.code.split("").join(" ")}`}
        >
          {game.code}
        </strong>
      </div>
      <div className="invite-actions">
        <button
          className="secondary"
          onClick={() => void copy(game.code, "copied")}
        >
          <Icon name="copy" />
          {t.text.copy}
        </button>
        {game.isGm && (
          <button
            className="secondary"
            onClick={() => void copy(link, "linkCopied")}
          >
            <Icon name="copy" />
            {t.text.copyLink}
          </button>
        )}
        {game.isGm && typeof navigator.share === "function" && (
          <button
            className="secondary"
            onClick={() => {
              navigator
                .share({
                  title: t.text.brand,
                  text: t.message("inviteMessage", { code: game.code }),
                  url: link,
                })
                .catch((error: unknown) => {
                  // Closing the share sheet is a choice, not a failure.
                  if (error instanceof Error && error.name === "AbortError")
                    return;
                  console.error("Sharing unavailable", error);
                  void copy(link, "linkCopied");
                });
            }}
          >
            {t.text.shareInvite}
          </button>
        )}
      </div>
      <span className="small" role="status">
        {status ? t.text[status] : ""}
      </span>
      {game.isGm && (
        <div className="invite-scan">
          <QrCode value={link} label={t.text.inviteQr} />
          <p className="small" aria-hidden="true">
            {t.text.inviteQr}
          </p>
        </div>
      )}
    </section>
  );
}
