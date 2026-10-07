// whisper-flow server → client messages (spec 0002: RS-1, ER-1).

export interface TranscriptMessage {
  kind: "transcript";
  isPartial: boolean;
  text: string;
}

export interface ServerErrorMessage {
  kind: "error";
  message: string;
}

export type ServerMessage = TranscriptMessage | ServerErrorMessage;

/** Parses one text frame. Returns undefined for anything that isn't a known message. */
export function parseServerMessage(raw: string): ServerMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  if (message.type === "error") {
    return {
      kind: "error",
      message: typeof message.message === "string" ? message.message : "unknown error",
    };
  }
  const data = message.data;
  if (typeof message.is_partial !== "boolean" || typeof data !== "object" || data === null) {
    return undefined;
  }
  const text = (data as Record<string, unknown>).text;
  if (typeof text !== "string") {
    return undefined;
  }
  return { kind: "transcript", isPartial: message.is_partial, text };
}

export const CLOSE_NORMAL = 1000;
export const CLOSE_POLICY = 1008;
export const CLOSE_TRY_AGAIN = 1013;
export const CLOSE_INVALID_OPTIONS = 4000;

/**
 * User-facing reason for a close that ended a session, or undefined for a normal close.
 * `retry` is true when retrying might help (ER-2); the 1008/1013 cases (ER-1) don't offer it.
 */
export function describeClose(
  code: number,
  reason: string,
): { message: string; retry: boolean } | undefined {
  switch (code) {
    case CLOSE_NORMAL:
      return undefined;
    case CLOSE_POLICY:
      return { message: "Invalid or missing API key", retry: false };
    case CLOSE_TRY_AGAIN:
      return { message: "Server is at capacity", retry: false };
    case CLOSE_INVALID_OPTIONS:
      return {
        message: `Server rejected the session options: ${reason || "invalid options"}`,
        retry: false,
      };
    default:
      return {
        message: `Lost connection to the whisper-flow server (code ${String(code)}${reason ? `: ${reason}` : ""})`,
        retry: true,
      };
  }
}
