import { errorCodes, type ErrorCode, type Identity } from "../shared/game";

export class RequestError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}
export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      ...(body !== undefined
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Mafia-Client": "1",
            },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new RequestError("network");
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const code =
      data && typeof data === "object" && "error" in data ? data.error : null;
    throw new RequestError(
      errorCodes.find((value) => value === code) ?? "server",
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new RequestError("server");
  }
}
export const errorCode = (error: unknown): ErrorCode => {
  if (error instanceof RequestError) return error.code;
  console.error("Unexpected client error", error);
  return "server";
};

// Reuse bootstrap across StrictMode mounts so two responses cannot overwrite the session cookie.
let bootstrap: Promise<Identity> | undefined;
export function initialize() {
  bootstrap ??= request<Identity>("/me").catch((error: unknown) => {
    bootstrap = undefined;
    throw error;
  });
  return bootstrap;
}
export function replaceIdentity(identity: Identity) {
  bootstrap = Promise.resolve(identity);
}

export function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
