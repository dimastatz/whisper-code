import * as assert from "assert";
import {
  DictationSession,
  type SessionError,
  type SessionState,
  type TranscriptSink,
} from "../dictation/session";
import {
  classifyRejectedHandshake,
  HandshakeError,
  WhisperFlowConnection,
} from "../whisperflow/client";
import { fakeSpawn } from "./fakeRecorder";
import {
  FakeWhisperFlow,
  final,
  partial,
  RECORDED_EVENTS,
  waitFor,
  type FakeServerOptions,
} from "./fakeServer";

class RecordingSink implements TranscriptSink {
  readonly calls: string[] = [];
  partial(text: string) {
    this.calls.push(`partial:${text}`);
    return Promise.resolve();
  }
  final(text: string) {
    this.calls.push(`final:${text}`);
    return Promise.resolve();
  }
  finish() {
    this.calls.push("finish");
    return Promise.resolve();
  }
}

interface Harness {
  server: FakeWhisperFlow;
  session: DictationSession;
  sink: RecordingSink;
  states: SessionState[];
  errors: SessionError[];
  recorder: ReturnType<typeof fakeSpawn>;
}

let servers: FakeWhisperFlow[] = [];

async function harness(
  serverOptions: FakeServerOptions,
  sessionOptions: { apiKey?: string; model?: string; prompt?: string; serverUrl?: string } = {},
): Promise<Harness> {
  const server = await new FakeWhisperFlow(serverOptions).listen();
  servers.push(server);
  const sink = new RecordingSink();
  const states: SessionState[] = [];
  const errors: SessionError[] = [];
  const recorder = fakeSpawn();
  const session = new DictationSession({
    serverUrl: sessionOptions.serverUrl ?? server.url,
    apiKey: sessionOptions.apiKey,
    model: sessionOptions.model,
    prompt: sessionOptions.prompt,
    recorderCommands: [["rec"]],
    sink,
    spawn: recorder.spawn,
    onState: (state, error) => {
      states.push(state);
      if (error) {
        errors.push(error);
      }
    },
  });
  return { server, session, sink, states, errors, recorder };
}

suite("Dictation session", () => {
  teardown(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  test("streams audio and forwards recorded partials and finals in order (TS-2)", async () => {
    const h = await harness(
      {
        events: [...RECORDED_EVENTS, { type: "error", message: "invalid control" }],
        finalOnStop: final(" Then stop."),
      },
      { prompt: "useMemo, getUserById", model: "base.en.pt" },
    );
    await h.session.start();
    assert.deepStrictEqual(h.states, ["connecting", "recording"]);
    h.recorder.children[0]?.writeFrames(2);
    await waitFor(() => h.sink.calls.length === RECORDED_EVENTS.length);
    assert.deepStrictEqual(h.server.controls[0], {
      type: "start",
      prompt: "useMemo, getUserById",
      model: "base.en.pt",
    });
    assert.strictEqual(h.server.audioBytes, 4096);
    assert.deepStrictEqual(h.sink.calls.slice(0, 5), [
      "partial: Call you",
      "partial: Call your support",
      "partial: Call useMemo",
      "partial: Call useMemo here.",
      "final: Call useMemo here.",
    ]);

    await h.session.stop();
    await h.session.stop();
    assert.deepStrictEqual(h.server.controls.at(-1), { type: "stop" });
    assert.deepStrictEqual(h.sink.calls.slice(-2), ["final: Then stop.", "finish"]);
    assert.deepStrictEqual(h.states, ["connecting", "recording", "idle"]);
    assert.deepStrictEqual(h.recorder.children[0]?.signals, ["SIGTERM"]);
  });

  test("whisper-flow 1.1.0: no control frames, stop closes the socket", async () => {
    const h = await harness(
      { ready: { version: "1.1.0", model_loaded: true }, events: [partial(" hi")] },
      { prompt: "useMemo" },
    );
    await h.session.start();
    h.recorder.children[0]?.writeFrames(1);
    await waitFor(() => h.sink.calls.length === 1);
    await h.session.stop();
    assert.deepStrictEqual(h.server.controls, []);
    assert.deepStrictEqual(h.sink.calls, ["partial: hi", "finish"]);
  });

  test("sends no start frame when there is nothing to configure", async () => {
    const h = await harness({ events: [] });
    await h.session.start();
    h.recorder.children[0]?.writeFrames(1);
    await waitFor(() => h.server.audioBytes > 0);
    await h.session.stop();
    assert.deepStrictEqual(h.server.controls, [{ type: "stop" }]);
  });

  test("refuses to start when /ready fails (CF-3)", async () => {
    const h = await harness({ ready: "error" });
    await h.session.start();
    assert.deepStrictEqual(h.states, ["connecting", "error"]);
    assert.match(h.errors[0]?.message ?? "", /Can't reach .*HTTP 500/);
    assert.strictEqual(h.errors[0]?.retry, true);
    assert.strictEqual(h.server.connections, 0);
    assert.strictEqual(h.recorder.children.length, 0);
  });

  test("rejects a model the server doesn't have", async () => {
    const h = await harness({}, { model: "large.pt" });
    await h.session.start();
    assert.match(
      h.errors[0]?.message ?? "",
      /Model large\.pt isn't available .*tiny\.en\.pt, base\.en\.pt/,
    );
    const none = await harness({ ready: { version: "1.1.0", model_loaded: true } }, { model: "x" });
    await none.session.start();
    assert.match(none.errors[0]?.message ?? "", /available: none/);
  });

  test("invalid or missing API key (ER-1)", async () => {
    const h = await harness({ apiKey: "secret" }, { apiKey: "wrong" });
    await h.session.start();
    assert.deepStrictEqual(h.errors, [{ message: "Invalid or missing API key", retry: false }]);
    assert.deepStrictEqual(h.sink.calls, ["finish"]);
  });

  test("server at capacity (ER-1)", async () => {
    const h = await harness({ apiKey: "secret", full: true }, { apiKey: "secret" });
    await h.session.start();
    assert.deepStrictEqual(h.errors, [{ message: "Server is at capacity", retry: false }]);
  });

  test("a failed handshake offers Retry", async () => {
    const h = await harness({});
    const bad = await harness({}, { serverUrl: `${h.server.url}/nope` });
    await bad.session.start();
    assert.match(bad.errors[0]?.message ?? "", /Can't connect .*\(HTTP 404\)/);
    assert.strictEqual(bad.errors[0]?.retry, true);
  });

  test("server close codes stop recording (ER-1, ER-2)", async () => {
    const cases: [number, string, SessionError][] = [
      [1013, "", { message: "Server is at capacity", retry: false }],
      [
        4000,
        "unknown language: xx",
        { message: "Server rejected the session options: unknown language: xx", retry: false },
      ],
      [
        1011,
        "",
        { message: "Lost connection to the whisper-flow server (code 1011)", retry: true },
      ],
      [1000, "", { message: "The whisper-flow server ended the session.", retry: true }],
    ];
    for (const [code, reason, expected] of cases) {
      const h = await harness({ events: [partial(" kept")], closeAfterEvents: { code, reason } });
      await h.session.start();
      h.recorder.children[0]?.writeFrames(1);
      await waitFor(() => h.states.includes("error"));
      assert.deepStrictEqual(h.errors, [expected]);
      assert.deepStrictEqual(h.sink.calls, ["partial: kept", "finish"]);
      assert.deepStrictEqual(h.recorder.children[0]?.signals, ["SIGTERM"]);
    }
  });

  test("a recorder failure ends the session with Retry", async () => {
    const h = await harness({});
    await h.session.start();
    h.recorder.children[0]?.exit(1);
    await waitFor(() => h.states.includes("error"));
    assert.deepStrictEqual(h.errors, [
      { message: "Audio recorder rec stopped: exit code 1", retry: true },
    ]);
    await h.session.stop();
    assert.deepStrictEqual(h.states, ["connecting", "recording", "error"]);
  });

  test("stopping while connecting cancels the session", async () => {
    const h = await harness({});
    const starting = h.session.start();
    await h.session.stop();
    await starting;
    assert.deepStrictEqual(h.states, ["connecting", "idle"]);
    assert.strictEqual(h.recorder.children.length, 0);
  });

  test("dispose ends a recording session immediately (ER-3)", async () => {
    const h = await harness({});
    await h.session.start();
    h.session.dispose();
    assert.deepStrictEqual(h.recorder.children[0]?.signals, ["SIGTERM"]);
    await h.session.stop();
    assert.deepStrictEqual(h.states, ["connecting", "recording"]);
  });
});

suite("whisper-flow connection", () => {
  teardown(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  test("stop times out when the server ignores it", async () => {
    const server = await new FakeWhisperFlow({ ignoreStop: true }).listen();
    servers.push(server);
    const closes: number[] = [];
    const connection = new WhisperFlowConnection(server.url, undefined, {
      onMessage: () => undefined,
      onClose: (code) => closes.push(code),
    });
    await connection.open();
    const started = Date.now();
    await connection.stop(true, 100);
    assert.ok(Date.now() - started < 1000);
    await waitFor(() => closes.length === 1);
    await connection.stop(true);
    connection.dispose();
    connection.sendAudio(Buffer.alloc(2));
  });

  test("stop without control frames closes normally", async () => {
    const server = await new FakeWhisperFlow().listen();
    servers.push(server);
    const closes: number[] = [];
    const connection = new WhisperFlowConnection(server.url, "k", {
      onMessage: () => undefined,
      onClose: (code) => closes.push(code),
    });
    await connection.open();
    connection.sendStart({});
    await connection.stop(false);
    assert.deepStrictEqual(closes, [1000]);
    assert.deepStrictEqual(server.controls, [{ type: "start" }]);
    await new WhisperFlowConnection(server.url, undefined, {
      onMessage: () => undefined,
      onClose: () => undefined,
    }).stop(true);
  });

  test("connection errors reject open()", async () => {
    const server = await new FakeWhisperFlow().listen();
    const url = server.url;
    await server.close();
    const connection = new WhisperFlowConnection(url, undefined, {
      onMessage: () => undefined,
      onClose: () => undefined,
    });
    await assert.rejects(
      connection.open(),
      (error: unknown) => error instanceof HandshakeError && error.closeCode === 0,
    );
  });

  test("classifyRejectedHandshake treats probe failures as capacity", async () => {
    assert.strictEqual(
      await classifyRejectedHandshake("http://localhost:1", "k", () =>
        Promise.reject(new Error("down")),
      ),
      1013,
    );
  });
});
