import { useEffect, useState } from "react";
import type { ErrorCode } from "../shared/game";
import { errorCode, request } from "./client";

export function useRemote<T>(path: string) {
  const [result, setResult] = useState<{ path: string; value: T } | null>(null);
  const [failure, setFailure] = useState<{
    path: string;
    code: ErrorCode;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void request<T>(path, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult({ path, value });
          setFailure(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setFailure({ path, code: errorCode(error) });
      });
    return () => controller.abort();
  }, [path, attempt]);
  return {
    data: result?.path === path ? result.value : null,
    error: failure?.path === path ? failure.code : null,
    reload: () => {
      setFailure(null);
      setAttempt((value) => value + 1);
    },
  };
}
