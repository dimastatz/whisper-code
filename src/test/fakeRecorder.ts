// A fake recorder process for tests: an in-memory ChildProcess look-alike.
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import type { Spawn } from "../audio/recorder";

export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: string[] = [];
  /** Exit when sent SIGTERM; when false only SIGKILL ends it. */
  exitOnTerm = true;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (signal === "SIGKILL" || this.exitOnTerm) {
      this.exit(null, signal);
    }
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  /** Writes `frames` frames of silence. */
  writeFrames(frames: number): void {
    this.stdout.write(Buffer.alloc(2048 * frames));
  }
}

/** A spawn that fails with ENOENT for commands in `missing` and returns FakeChilds otherwise. */
export function fakeSpawn(missing: string[] = []): {
  spawn: Spawn;
  children: FakeChild[];
  commands: string[][];
} {
  const children: FakeChild[] = [];
  const commands: string[][] = [];
  const spawn: Spawn = (command, args) => {
    commands.push([command, ...args]);
    const child = new FakeChild();
    children.push(child);
    if (missing.includes(command)) {
      setImmediate(() => {
        child.emit(
          "error",
          Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" }),
        );
        child.exit(-2);
      });
    }
    return child as unknown as ChildProcess;
  };
  return { spawn, children, commands };
}
