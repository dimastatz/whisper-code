// Microphone capture in a sidecar process (spec 0002: AU-1, AU-2, AU-3, AU-4, ER-3).
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

export const SAMPLE_RATE = 16000;
/** 1024 samples of 16-bit mono PCM, whisper-flow's default WF_CHUNK_SIZE (AU-2). */
export const FRAME_BYTES = 2048;

/** Cuts a byte stream into fixed-size frames, keeping the remainder for the next push. */
export class FrameSplitter {
  private rest = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    const data = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    const frames: Buffer[] = [];
    let offset = 0;
    for (; offset + FRAME_BYTES <= data.length; offset += FRAME_BYTES) {
      frames.push(data.subarray(offset, offset + FRAME_BYTES));
    }
    this.rest = Buffer.from(data.subarray(offset));
    return frames;
  }
}

/**
 * Recorders tried in order when `whisperCode.recorderCommand` is empty. Each writes raw
 * 16 kHz mono s16le PCM to stdout and needs no Python (AU-4).
 */
export function defaultRecorderCommands(platform: NodeJS.Platform): string[][] {
  const rate = String(SAMPLE_RATE);
  const sox = [
    "sox",
    "-q",
    "-d",
    "-t",
    "raw",
    "-r",
    rate,
    "-e",
    "signed-integer",
    "-b",
    "16",
    "-c",
    "1",
    "-L",
    "-",
  ];
  const ffmpegOut = ["-ac", "1", "-ar", rate, "-f", "s16le", "-"];
  const ffmpegQuiet = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"];
  switch (platform) {
    case "darwin":
      return [sox, [...ffmpegQuiet, "-f", "avfoundation", "-i", ":default", ...ffmpegOut]];
    case "linux":
      return [
        sox,
        ["arecord", "-q", "-f", "S16_LE", "-r", rate, "-c", "1", "-t", "raw"],
        [...ffmpegQuiet, "-f", "pulse", "-i", "default", ...ffmpegOut],
      ];
    default:
      return [sox];
  }
}

export interface RecorderHandlers {
  onFrame(frame: Buffer): void;
  /** The recorder failed to start or exited on its own. Not called after `stop()`. */
  onError(message: string): void;
}

export type Spawn = (command: string, args: string[]) => ChildProcess;

export interface Recorder {
  stop(): void;
}

/**
 * Starts the first recorder command that exists. A command that is not installed (ENOENT)
 * falls through to the next one.
 */
export function startRecorder(
  commands: string[][],
  handlers: RecorderHandlers,
  spawn: Spawn = (command, args) => nodeSpawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }),
): Recorder {
  let child: ChildProcess | undefined;
  let stopped = false;
  const missing: string[] = [];

  const tryStart = (index: number) => {
    if (index >= commands.length || commands[index]?.length === 0) {
      handlers.onError(
        missing.length
          ? `No audio recorder found (tried ${missing.join(", ")}). Install sox, or set whisperCode.recorderCommand.`
          : "No audio recorder configured.",
      );
      return;
    }
    const [program, ...args] = commands[index] as [string, ...string[]];
    const splitter = new FrameSplitter();
    let stderr = "";
    const current = spawn(program, args);
    child = current;

    current.stdout?.on("data", (chunk: Buffer) => {
      if (stopped) {
        return;
      }
      for (const frame of splitter.push(chunk)) {
        handlers.onFrame(frame);
      }
    });
    current.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-500);
    });
    current.once("error", (error: NodeJS.ErrnoException) => {
      if (stopped) {
        return;
      }
      if (error.code === "ENOENT") {
        missing.push(program);
        tryStart(index + 1);
      } else {
        handlers.onError(`Audio recorder ${program} failed: ${error.message}`);
      }
    });
    current.once("exit", (code, signal) => {
      // ENOENT also emits exit on some platforms; the error handler moved on already.
      if (stopped || child !== current || missing.includes(program)) {
        return;
      }
      const detail = stderr.trim() || (signal ? `signal ${signal}` : `exit code ${String(code)}`);
      handlers.onError(`Audio recorder ${program} stopped: ${detail}`);
    });
  };

  tryStart(0);

  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      const current = child;
      if (current?.exitCode === null && current.signalCode === null) {
        current.kill("SIGTERM");
        const force = setTimeout(() => current.kill("SIGKILL"), 1000);
        force.unref();
        current.once("exit", () => {
          clearTimeout(force);
        });
      }
    },
  };
}
