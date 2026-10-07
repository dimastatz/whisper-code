// Streaming connection to whisper-flow's /ws endpoint (spec 0002: TR-2, CF-2, AU-1, ER-1).
import WebSocket from "ws";
import { CLOSE_POLICY, CLOSE_TRY_AGAIN, parseServerMessage, type ServerMessage } from "./messages";
import { endpointUrl, toWebSocketUrl, type Fetch } from "./server";

export interface StartOptions {
  prompt?: string;
  model?: string;
}

export interface ConnectionHandlers {
  onMessage(message: ServerMessage): void;
  /** Called once when the socket closes, whoever closed it. */
  onClose(code: number, reason: string): void;
}

/**
 * Turns a rejected WebSocket handshake into a close code. whisper-flow closes before accepting
 * on a bad API key (1008) and when full (1013), which uvicorn sends as HTTP 403 for both. A
 * request to an API-key-protected endpoint tells them apart: 401 means the key is wrong.
 */
export async function classifyRejectedHandshake(
  serverUrl: string,
  apiKey: string | undefined,
  fetchFn: (
    url: string,
    init: { method: string; headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<{ status: number }>,
): Promise<number> {
  try {
    const response = await fetchFn(endpointUrl(serverUrl, "/transcribe_pcm_chunk"), {
      method: "POST",
      headers: apiKey ? { "x-api-key": apiKey } : {},
      signal: AbortSignal.timeout(3000),
    });
    return response.status === 401 ? CLOSE_POLICY : CLOSE_TRY_AGAIN;
  } catch {
    return CLOSE_TRY_AGAIN;
  }
}

export class WhisperFlowConnection {
  private socket: WebSocket | undefined;
  private closed = false;

  constructor(
    private readonly serverUrl: string,
    private readonly apiKey: string | undefined,
    private readonly handlers: ConnectionHandlers,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  /** Opens the socket. Rejects with an error carrying `closeCode` when the server refuses it. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = this.apiKey ? { "x-api-key": this.apiKey } : {};
      const socket = new WebSocket(toWebSocketUrl(this.serverUrl), { headers });
      this.socket = socket;
      let opened = false;

      socket.on("open", () => {
        opened = true;
        resolve();
      });
      socket.on("unexpected-response", (_request, response) => {
        const status = response.statusCode ?? 0;
        socket.terminate();
        this.closed = true;
        if (status === 403) {
          void classifyRejectedHandshake(this.serverUrl, this.apiKey, this.fetchFn).then((code) => {
            reject(new HandshakeError(code));
          });
        } else {
          reject(new HandshakeError(0, `HTTP ${String(status)}`));
        }
      });
      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          return;
        }
        const message = parseServerMessage(rawToString(data));
        if (message) {
          this.handlers.onMessage(message);
        }
      });
      socket.on("error", (error) => {
        if (!opened && !this.closed) {
          this.closed = true;
          reject(new HandshakeError(0, error.message));
        }
      });
      socket.on("close", (code, reason) => {
        if (!opened) {
          return;
        }
        this.closed = true;
        this.handlers.onClose(code, reason.toString());
      });
    });
  }

  /** Session options; whisper-flow 1.2+ only, sent before any audio. */
  sendStart(options: StartOptions): void {
    const start: Record<string, string> = { type: "start" };
    if (options.prompt) {
      start.prompt = options.prompt;
    }
    if (options.model) {
      start.model = options.model;
    }
    this.send(JSON.stringify(start));
  }

  /** One frame of 16 kHz mono s16le PCM, sent as a binary frame (AU-1). */
  sendAudio(frame: Buffer): void {
    this.send(frame);
  }

  /**
   * Asks the server to finalize the remaining audio and close (`stop`, whisper-flow 1.2+).
   * Resolves when the socket has closed, or force-closes it after `timeoutMs`.
   */
  async stop(useStopFrame: boolean, timeoutMs = 3000): Promise<void> {
    const socket = this.socket;
    if (!socket || this.closed || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => {
        resolve();
      }),
    );
    if (useStopFrame) {
      socket.send(JSON.stringify({ type: "stop" }));
    } else {
      socket.close(1000);
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, timeoutMs);
    });
    await Promise.race([closed, timeout]);
    clearTimeout(timer);
  }

  /** Drops the connection immediately. */
  dispose(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      this.socket.terminate();
    }
  }

  private send(data: string | Buffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }
}

export class HandshakeError extends Error {
  constructor(
    readonly closeCode: number,
    detail?: string,
  ) {
    super(detail ?? `closed with code ${String(closeCode)}`);
  }
}

function rawToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}
