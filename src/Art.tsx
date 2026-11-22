import type { Faction } from "../shared/game";

export function Emblem({
  faction,
  className = "",
}: {
  faction: Faction;
  className?: string;
}) {
  return (
    <svg
      className={`emblem ${className}`}
      viewBox="0 0 120 140"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="60" cy="64" r="44" className="emblem-halo" />
      {faction === "mafia" ? (
        <>
          <path d="M17 58h86M31 57l8-30c13 5 29 5 42 0l8 30M36 45h48" />
          <path d="M31 72c11-9 21 10 29 0 8 10 18-9 29 0M43 92l17 15 17-15M25 119l21-16 14 20 14-20 21 16" />
          <path d="m55 121 5 8 5-8" />
        </>
      ) : faction === "citizen" ? (
        <>
          <path d="M60 22 91 37v33c0 27-31 48-31 48S29 97 29 70V37Z" />
          <path d="m42 68 13 13 23-31M60 22V10M17 50l-8-4M103 50l8-4" />
          <path d="M39 111c-14-7-22-20-25-37M81 111c14-7 22-20 25-37" />
        </>
      ) : (
        <>
          <path d="M75 22a43 43 0 1 0 29 62 38 38 0 0 1-29-62Z" />
          <path d="m87 22 4 12 12 4-12 4-4 12-4-12-12-4 12-4ZM32 111l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" />
          <path d="m54 61 7 7-7 7-7-7ZM100 108h8M104 104v8" />
        </>
      )}
    </svg>
  );
}

export function Icon({
  name,
}: {
  name:
    | "arrow"
    | "lock"
    | "copy"
    | "users"
    | "history"
    | "eye"
    | "moon"
    | "sun"
    | "check";
}) {
  const paths = {
    arrow: "M5 12h14m-6-6 6 6-6 6",
    lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3",
    copy: "M9 9h12v12H9ZM15 5V3H3v12h2",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    history: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    moon: "M20 14A9 9 0 0 1 10 2a9 9 0 1 0 10 12Z",
    sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1",
    check: "m5 12 4 4L19 6",
  };
  return (
    <svg
      className={name === "arrow" ? "icon directional-icon" : "icon"}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
