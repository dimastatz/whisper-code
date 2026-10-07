// A fake whisper-flow server for tests (spec 0002, TS-2). It mimics whisper-flow 1.2.0 over
// real HTTP and WebSocket, including uvicorn's HTTP 403 for rejected handshakes.
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

export interface WhisperFlowEvent {
  is_partial: boolean;
  data: { text: string; segments?: unknown[]; language?: string };
  time: number;
}

export const partial = (text: string): WhisperFlowEvent => ({
  is_partial: true,
  data: { text, segments: [], language: "en" },
  time: 300,
});
export const final = (text: string): WhisperFlowEvent => ({
  is_partial: false,
  data: { text, segments: [], language: "en" },
  time: 300,
});

/**
 * Events recorded from whisper-flow 1.2.0 (tiny.en) for "Call use memo here. Then fetch the
 * user with get user by id." Partials are not monotonic ("your support" → "useMemo").
 */
export const RECORDED_EVENTS: WhisperFlowEvent[] = [
  partial(" Call you"),
  partial(" Call your support"),
  partial(" Call useMemo"),
  partial(" Call useMemo here."),
  final(" Call useMemo here."),
  partial(" with"),
  partial(" with getUser"),
  final(" with getUser by ID."),
];

export interface FakeServerOptions {
  ready?: Record<string, unknown> | "error";
  apiKey?: string;
  full?: boolean;
  /** Events sent after the first audio frame. */
  events?: (WhisperFlowEvent | { type: "error"; message: string })[];
  /** Sent in reply to a `stop` frame, before closing with 1000. */
  finalOnStop?: WhisperFlowEvent;
  /** Ignore `stop` frames (to test the client's timeout). */
  ignoreStop?: boolean;
  /** Close with this code after sending the events. */
  closeAfterEvents?: { code: number; reason?: string };
}

export const READY_1_2 = {
  status: "ok",
  version: "1.2.0",
  protocol_version: 1,
  models: ["tiny.en.pt", "base.en.pt"],
  model_loaded: true,
  active_sessions: 0,
};

export class FakeWhisperFlow {
  readonly controls: Record<string, unknown>[] = [];
  audioBytes = 0;
  connections = 0;
  private readonly http: http.Server;
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sockets = new Set<WebSocket>();

  constructor(public options: FakeServerOptions = {}) {
    this.http = http.createServer((request, response) => {
      const key = request.headers["x-api-key"];
      if (request.url?.endsWith("/ready")) {
        if (this.options.ready === "error") {
          response.writeHead(500).end();
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(this.options.ready ?? READY_1_2));
      } else if (request.url === "/transcribe_pcm_chunk" && request.method === "POST") {
        const authorized = !this.options.apiKey || key === this.options.apiKey;
        response.writeHead(authorized ? 422 : 401).end();
      } else {
        response.writeHead(404).end();
      }
    });
    this.http.on("upgrade", (request: http.IncomingMessage, socket, head) => {
      const key = request.headers["x-api-key"];
      if ((this.options.apiKey && key !== this.options.apiKey) || this.options.full) {
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      if (request.url !== "/ws") {
        socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.accept(ws);
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${String((this.http.address() as AddressInfo).port)}`;
  }

  listen(): Promise<this> {
    return new Promise((resolve) =>
      this.http.listen(0, "127.0.0.1", () => {
        resolve(this);
      }),
    );
  }

  /** Sends an event to every open session. */
  send(event: WhisperFlowEvent): void {
    for (const socket of this.sockets) {
      socket.send(JSON.stringify(event));
    }
  }

  /** Server-side close of every open session. */
  closeSessions(code: number, reason = ""): void {
    for (const socket of this.sockets) {
      socket.close(code, reason);
    }
  }

  close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.terminate();
    }
    return new Promise((resolve) =>
      this.http.close(() => {
        resolve();
      }),
    );
  }

  private accept(ws: WebSocket): void {
    this.connections++;
    this.sockets.add(ws);
    ws.on("close", () => this.sockets.delete(ws));
    let replayed = false;
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.audioBytes += (data as Buffer).length;
        if (!replayed) {
          replayed = true;
          void this.replay(ws);
        }
        return;
      }
      const control = JSON.parse((data as Buffer).toString("utf8")) as Record<string, unknown>;
      this.controls.push(control);
      if (control.type === "stop" && !this.options.ignoreStop) {
        if (this.options.finalOnStop) {
          ws.send(JSON.stringify(this.options.finalOnStop));
        }
        ws.close(1000);
      }
    });
  }

  private async replay(ws: WebSocket): Promise<void> {
    for (const event of this.options.events ?? []) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      ws.send(JSON.stringify(event));
    }
    // Something whisper-flow never sends; clients must ignore it.
    ws.send(Buffer.from([1, 2, 3]));
    if (this.options.closeAfterEvents) {
      ws.close(this.options.closeAfterEvents.code, this.options.closeAfterEvents.reason);
    }
  }
}

/** Waits until `check` returns true, polling every 10 ms. */
export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
