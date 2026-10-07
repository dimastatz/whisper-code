import * as assert from "assert";
import {
  checkReady,
  compareVersions,
  endpointUrl,
  errorMessage,
  isInsecureRemote,
  isLocalServer,
  parseServerUrl,
  supportsControlFrames,
  toWebSocketUrl,
  type Fetch,
} from "../whisperflow/server";

const respond =
  (body: unknown, status = 200): Fetch =>
  () =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const READY = { version: "1.2.0", protocol_version: 1, models: ["tiny.en.pt"], model_loaded: true };

suite("whisper-flow server", () => {
  test("parseServerUrl rejects non-http URLs", () => {
    assert.throws(() => parseServerUrl("not a url"), /Invalid whisper-flow server URL/);
    assert.throws(() => parseServerUrl("ws://localhost:8181"), /must start with http/);
    assert.strictEqual(parseServerUrl(" http://localhost:8181 ").port, "8181");
  });

  test("toWebSocketUrl derives the /ws URL (CF-1)", () => {
    assert.strictEqual(toWebSocketUrl("http://localhost:8181"), "ws://localhost:8181/ws");
    assert.strictEqual(toWebSocketUrl("https://gpu.example.com/"), "wss://gpu.example.com/ws");
    assert.strictEqual(
      toWebSocketUrl("https://example.com/whisper/?x=1#y"),
      "wss://example.com/whisper/ws",
    );
  });

  test("endpointUrl appends to the server path", () => {
    assert.strictEqual(endpointUrl("http://h:1/base/", "/ready"), "http://h:1/base/ready");
    assert.strictEqual(endpointUrl("http://h:1?q", "/ready"), "http://h:1/ready");
  });

  test("local and insecure remote servers (CF-4, CF-5)", () => {
    for (const url of ["http://localhost:8181", "http://127.0.0.1", "http://[::1]:8181"]) {
      assert.ok(isLocalServer(url), url);
      assert.ok(!isInsecureRemote(url), url);
    }
    assert.ok(!isLocalServer("https://gpu.example.com"));
    assert.ok(!isInsecureRemote("https://gpu.example.com"));
    assert.ok(isInsecureRemote("http://192.168.1.5:8181"));
  });

  test("compareVersions compares numerically", () => {
    assert.strictEqual(compareVersions("1.10.0", "1.9.0"), 1);
    assert.strictEqual(compareVersions("1.1", "1.1.0"), 0);
    assert.strictEqual(compareVersions("1.0.9", "1.1.0"), -1);
    assert.strictEqual(compareVersions("1.1.0-rc1", "1.1.0"), 0);
    assert.strictEqual(compareVersions("x", "0.0.0"), 0);
  });

  test("checkReady returns server info and sends the API key", async () => {
    let headers: Record<string, string> = {};
    const info = await checkReady("http://localhost:8181", "k", (url, init) => {
      assert.strictEqual(url, "http://localhost:8181/ready");
      headers = init.headers;
      return respond(READY)(url, init);
    });
    assert.deepStrictEqual(headers, { "x-api-key": "k" });
    assert.deepStrictEqual(info, { version: "1.2.0", protocolVersion: 1, models: ["tiny.en.pt"] });
    assert.ok(supportsControlFrames(info));
  });

  test("checkReady accepts whisper-flow 1.1.0 without protocol_version", async () => {
    const info = await checkReady(
      "http://localhost:8181",
      undefined,
      respond({ version: "1.1.0", model_loaded: true }),
    );
    assert.strictEqual(info.protocolVersion, undefined);
    assert.deepStrictEqual(info.models, []);
    assert.ok(!supportsControlFrames(info));
  });

  test("checkReady errors name the server URL or versions (CF-3, TR-4)", async () => {
    const url = "http://localhost:8181";
    const cases: [Fetch, RegExp][] = [
      [
        () => Promise.reject(new Error("ECONNREFUSED")),
        /Can't reach .* at http:\/\/localhost:8181 \(ECONNREFUSED\)/,
      ],
      [respond({}, 503), /Can't reach .*\(HTTP 503\)/],
      [respond("ok"), /Unexpected \/ready response .*localhost:8181/],
      [respond(null), /Unexpected \/ready response/],
      [
        respond({ ...READY, version: "1.0.2" }),
        /version 1\.0\.2; whisper-code needs 1\.1\.0 or newer/,
      ],
      [respond({ ...READY, version: 3 }), /version unknown/],
      [respond({ ...READY, protocol_version: 2 }), /protocol 2; this whisper-code supports 1/],
      [respond({ ...READY, model_loaded: false }), /localhost:8181 has not loaded a model/],
    ];
    for (const [fetchFn, expected] of cases) {
      await assert.rejects(checkReady(url, undefined, fetchFn), expected);
    }
  });

  test("errorMessage handles non-errors", () => {
    assert.strictEqual(errorMessage(new Error("boom")), "boom");
    assert.strictEqual(errorMessage("text"), "text");
  });
});
