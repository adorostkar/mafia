import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, ErrorCode, GameView } from "../shared/game";
import { errorCode, request, requestId } from "./client";

export function useGame(code: string | null, identity: string | null) {
  const [state, setState] = useState<{ owner: string; game: GameView } | null>(
    null,
  );
  const [connection, setConnection] = useState<"live" | "polling" | "offline">(
    "offline",
  );
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const generation = useRef(0);
  const accept = useCallback((next: GameView, owner: string) => {
    setState((previous) =>
      previous?.owner === owner &&
      previous.game.code === next.code &&
      previous.game.revision > next.revision
        ? previous
        : { owner, game: next },
    );
  }, []);

  useEffect(() => {
    generation.current++;
    if (!code || !identity) return;
    let active = true;
    let streaming = false;
    let fetching = false;
    let again = false;
    let expired = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (expired || !active) return;
      if (fetching) {
        again = true;
        return;
      }
      fetching = true;
      try {
        const next = await request<GameView>(
          `/games/${code}`,
          undefined,
          controller.signal,
        );
        if (active && !expired) {
          accept(next, identity);
          setConnection(streaming ? "live" : "polling");
          setError((previous) =>
            previous === "network" || previous === "authentication"
              ? null
              : previous,
          );
        }
      } catch (error) {
        if (active && !expired) {
          const failure = errorCode(error);
          setError(failure);
          setConnection("offline");
          if (failure === "authentication" || failure === "forbidden") {
            expired = true;
            stream.close();
            setState(null);
          }
        }
      } finally {
        fetching = false;
        if (again && active) {
          again = false;
          void refresh();
        }
      }
    };
    refreshRef.current = refresh;
    const stream = new EventSource(`/api/games/${code}/events`);
    stream.onopen = () => {
      streaming = true;
      void refresh();
    };
    stream.addEventListener("update", () => void refresh());
    stream.addEventListener("session", () => {
      expired = true;
      stream.close();
      setState(null);
      setError("authentication");
      setConnection("offline");
    });
    stream.onerror = () => {
      if (active) {
        streaming = false;
        setConnection("offline");
      }
    };
    const online = () => void refresh();
    const offline = () => {
      streaming = false;
      setConnection("offline");
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
      if (!streaming || ticks % 6 === 0) void refresh();
    }, 10_000);
    void refresh();
    return () => {
      active = false;
      controller.abort();
      stream.close();
      clearInterval(interval);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [code, identity, accept]);

  const game =
    state?.owner === identity && state.game.code === code ? state.game : null;
  const command = async (command: Command): Promise<boolean> => {
    if (!game || !identity || sending.current) return false;
    sending.current = true;
    setBusy(true);
    setError(null);
    const epoch = generation.current;
    const payload = JSON.stringify({ code, identity, command });
    if (retry.current?.payload !== payload)
      retry.current = { payload, id: requestId() };
    try {
      const next = await request<GameView>(`/games/${code}/commands`, {
        command,
        revision: game.revision,
        requestId: retry.current.id,
      });
      if (generation.current === epoch) accept(next, identity);
      retry.current = null;
      return true;
    } catch (error) {
      const failure = errorCode(error);
      if (failure !== "network" && failure !== "server") retry.current = null;
      if (generation.current === epoch) {
        setError(failure);
        await refreshRef.current();
      }
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return {
    game,
    connection,
    error,
    busy,
    command,
    refresh: () => void refreshRef.current(),
    dismiss: () => setError(null),
  };
}
