import { useId, type ReactNode } from "react";
import { Icon } from "./Art";

export function FlipCard({
  front,
  children,
  revealed,
  onToggle,
  label,
  announcement,
  className = "",
}: {
  front: ReactNode;
  children: ReactNode;
  revealed: boolean;
  onToggle: () => void;
  label: string;
  announcement: string;
  className?: string;
}) {
  const details = useId();
  return (
    <div className={`flip-card ${className} ${revealed ? "is-flipped" : ""}`}>
      <div className="flip-content">
        <div
          className="flip-face flip-front"
          aria-hidden={revealed}
          inert={revealed}
        >
          {front}
        </div>
        <div
          className="flip-face flip-back"
          aria-hidden={!revealed}
          inert={!revealed}
        >
          <div id={details}>{revealed ? children : null}</div>
        </div>
      </div>
      <button
        type="button"
        className="flip-toggle"
        aria-expanded={revealed}
        aria-controls={details}
        aria-describedby={revealed ? details : undefined}
        onClick={onToggle}
      >
        {label}
        <Icon name="arrow" />
      </button>
      <div className="sr-only" role="status" aria-atomic="true">
        {revealed ? announcement : ""}
      </div>
    </div>
  );
}
