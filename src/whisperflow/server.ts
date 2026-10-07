// whisper-flow HTTP side: server URLs and the /ready check (spec 0002: TR-4, CF-1, CF-3, CF-4, CF-5).

export const MIN_SERVER_VERSION = "1.1.0";
/** Highest wire protocol this client understands (whisper-flow docs/protocol.md). */
export const SUPPORTED_PROTOCOL_VERSION = 1;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Parses a server URL setting; throws with a readable message when it isn't http(s). */
export function parseServerUrl(serverUrl: string): URL {
  let url: URL;
  try {
    url = new URL(serverUrl.trim());
  } catch {
    throw new Error(`Invalid whisper-flow server URL: ${serverUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`whisper-flow server URL must start with http:// or https://: ${serverUrl}`);
  }
  return url;
}

/** `http` becomes `ws`, `https` becomes `wss`, and `/ws` is appended to the path (CF-1). */
export function toWebSocketUrl(serverUrl: string): string {
  const url = parseServerUrl(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = url.pathname.replace(/\/+$/, "") + "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** URL of an HTTP endpoint such as `/ready` under the server URL's path. */
export function endpointUrl(serverUrl: string, endpoint: string): string {
  const url = parseServerUrl(serverUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + endpoint;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isLocalServer(serverUrl: string): boolean {
  return LOCAL_HOSTS.has(parseServerUrl(serverUrl).hostname);
}

/** A non-local server reached without TLS (CF-5). */
export function isInsecureRemote(serverUrl: string): boolean {
  return !isLocalServer(serverUrl) && parseServerUrl(serverUrl).protocol === "http:";
}

/** Compares dotted versions numerically; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  return 0;
}

export interface ServerInfo {
  version: string;
  /** Absent on whisper-flow 1.1.0, which also lacks control frames. */
  protocolVersion: number | undefined;
  models: string[];
}

/** Control frames (`start` with a vocabulary prompt, `flush`, `stop`) arrived with protocol 1. */
export function supportsControlFrames(info: ServerInfo): boolean {
  return info.protocolVersion !== undefined;
}

export type Fetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Calls `GET /ready` and validates it (CF-3, TR-4). Throws an error whose message names the
 * server URL, or both versions when the server is too old.
 */
export async function checkReady(
  serverUrl: string,
  apiKey: string | undefined,
  fetchFn: Fetch,
  timeoutMs = 5000,
): Promise<ServerInfo> {
  const headers: Record<string, string> = apiKey ? { "x-api-key": apiKey } : {};
  let body: unknown;
  try {
    const response = await fetchFn(endpointUrl(serverUrl, "/ready"), {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)}`);
    }
    body = await response.json();
  } catch (error) {
    throw new Error(
      `Can't reach the whisper-flow server at ${serverUrl} (${errorMessage(error)}).`,
    );
  }

  if (typeof body !== "object" || body === null) {
    throw new Error(`Unexpected /ready response from the whisper-flow server at ${serverUrl}.`);
  }
  const ready = body as Record<string, unknown>;
  const version = typeof ready.version === "string" ? ready.version : "unknown";
  if (version === "unknown" || compareVersions(version, MIN_SERVER_VERSION) < 0) {
    throw new Error(
      `whisper-flow at ${serverUrl} is version ${version}; whisper-code needs ${MIN_SERVER_VERSION} or newer.`,
    );
  }
  const protocolVersion =
    typeof ready.protocol_version === "number" ? ready.protocol_version : undefined;
  if (protocolVersion !== undefined && protocolVersion > SUPPORTED_PROTOCOL_VERSION) {
    throw new Error(
      `whisper-flow at ${serverUrl} speaks protocol ${String(protocolVersion)}; this whisper-code supports ${String(SUPPORTED_PROTOCOL_VERSION)}. Update the extension.`,
    );
  }
  if (ready.model_loaded !== true) {
    throw new Error(`The whisper-flow server at ${serverUrl} has not loaded a model yet.`);
  }
  const models = Array.isArray(ready.models)
    ? ready.models.filter((model): model is string => typeof model === "string")
    : [];
  return { version, protocolVersion, models };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
