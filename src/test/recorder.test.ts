import * as assert from "assert";
import {
  defaultRecorderCommands,
  FrameSplitter,
  FRAME_BYTES,
  startRecorder,
} from "../audio/recorder";
import { fakeSpawn } from "./fakeRecorder";

function collect() {
  const frames: Buffer[] = [];
  const errors: string[] = [];
  return {
    frames,
    errors,
    handlers: {
      onFrame: (frame: Buffer) => frames.push(frame),
      onError: (message: string) => errors.push(message),
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

suite("Recorder", () => {
  test("FrameSplitter emits 2048-byte frames and keeps the rest (AU-2)", () => {
    const splitter = new FrameSplitter();
    assert.strictEqual(splitter.push(Buffer.alloc(1000)).length, 0);
    const frames = splitter.push(Buffer.alloc(3200));
    assert.deepStrictEqual(
      frames.map((frame) => frame.length),
      [FRAME_BYTES, FRAME_BYTES],
    );
    assert.strictEqual(splitter.push(Buffer.alloc(1944)).length, 1);
  });

  test("default commands record 16 kHz mono s16le without Python (AU-1, AU-4)", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const commands = defaultRecorderCommands(platform);
      assert.strictEqual(commands[0]?.[0], "sox");
      for (const command of commands) {
        assert.ok(command.includes("16000"), command.join(" "));
        assert.ok(!command.some((part) => part.includes("python")));
      }
    }
    assert.deepStrictEqual(
      defaultRecorderCommands("linux").map((command) => command[0]),
      ["sox", "arecord", "ffmpeg"],
    );
  });

  test("streams frames from the sidecar's stdout (AU-3)", async () => {
    const { spawn, children } = fakeSpawn();
    const { frames, errors, handlers } = collect();
    const recorder = startRecorder([["rec", "-x"]], handlers, spawn);
    children[0]?.writeFrames(3);
    await tick();
    assert.strictEqual(frames.length, 3);
    recorder.stop();
    recorder.stop();
    children[0]?.writeFrames(1);
    await tick();
    assert.strictEqual(frames.length, 3);
    assert.deepStrictEqual(children[0]?.signals, ["SIGTERM"]);
    assert.deepStrictEqual(errors, []);
  });

  test("falls through to the next command when one isn't installed", async () => {
    const { spawn, commands } = fakeSpawn(["sox"]);
    const { errors, handlers } = collect();
    startRecorder([["sox"], ["ffmpeg", "-i"]], handlers, spawn).stop();
    await tick();
    assert.deepStrictEqual(commands, [["sox"]]);

    const second = fakeSpawn(["sox"]);
    const recorder = startRecorder([["sox"], ["ffmpeg", "-i"]], handlers, second.spawn);
    await tick();
    assert.deepStrictEqual(second.commands, [["sox"], ["ffmpeg", "-i"]]);
    recorder.stop();
    assert.deepStrictEqual(errors, []);
  });

  test("reports when no recorder is installed", async () => {
    const { spawn } = fakeSpawn(["sox", "arecord"]);
    const { errors, handlers } = collect();
    startRecorder([["sox"], ["arecord"]], handlers, spawn);
    await tick();
    await tick();
    assert.deepStrictEqual(errors, [
      "No audio recorder found (tried sox, arecord). Install sox, or set whisperCode.recorderCommand.",
    ]);

    const empty = collect();
    startRecorder([], empty.handlers, spawn);
    startRecorder([[]], empty.handlers, spawn);
    assert.deepStrictEqual(empty.errors, [
      "No audio recorder configured.",
      "No audio recorder configured.",
    ]);
  });

  test("uses the real spawn by default", async () => {
    const { errors, handlers } = collect();
    startRecorder([["whisper-code-no-such-recorder"]], handlers);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(errors[0] ?? "", /tried whisper-code-no-such-recorder/);
  });

  test("reports spawn errors and unexpected exits", async () => {
    const { spawn, children } = fakeSpawn();
    const { errors, handlers } = collect();
    startRecorder([["rec"]], handlers, spawn);
    children[0]?.emit("error", Object.assign(new Error("EACCES"), { code: "EACCES" }));
    startRecorder([["rec"]], handlers, spawn);
    children[1]?.stderr.write("rec: no default audio device");
    await tick();
    children[1]?.exit(2);
    startRecorder([["rec"]], handlers, spawn);
    children[2]?.exit(null, "SIGSEGV");
    startRecorder([["rec"]], handlers, spawn);
    children[3]?.exit(1);
    assert.deepStrictEqual(errors, [
      "Audio recorder rec failed: EACCES",
      "Audio recorder rec stopped: rec: no default audio device",
      "Audio recorder rec stopped: signal SIGSEGV",
      "Audio recorder rec stopped: exit code 1",
    ]);
  });

  test("ignores errors after stop and force-kills a stuck recorder", async function () {
    this.timeout(3000);
    const { spawn, children } = fakeSpawn();
    const { errors, handlers } = collect();
    const recorder = startRecorder([["rec"]], handlers, spawn);
    const child = children[0];
    assert.ok(child);
    child.exitOnTerm = false;
    recorder.stop();
    child.emit("error", new Error("late"));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepStrictEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.deepStrictEqual(errors, []);

    const exited = startRecorder([["rec"]], handlers, spawn);
    children[1]?.exit(0);
    exited.stop();
    assert.deepStrictEqual(children[1]?.signals, []);
  });
});
