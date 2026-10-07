// One dictation session: /ready check → socket → recorder → transcript sink.
// Spec 0002: CF-3, TR-4, RS-1..3, ER-1..3. Has no vscode dependency so it can be unit tested.
import { startRecorder, type Recorder, type Spawn } from "../audio/recorder";
import { HandshakeError, WhisperFlowConnection } from "../whisperflow/client";
import { describeClose, type ServerMessage } from "../whisperflow/messages";
import { checkReady, errorMessage, supportsControlFrames, type Fetch } from "../whisperflow/server";

export type SessionState = "idle" | "connecting" | "recording" | "error";

export interface SessionError {
  message: string;
  /** Offer a Retry action (ER-2). */
  retry: boolean;
}

/** Where transcripts go; the editor implementation lives in editorSink.ts. */
export interface TranscriptSink {
  /** Replace the pending text of the current segment (RS-2). */
  partial(text: string): Promise<void>;
  /** Replace the pending text with the final text and commit it (RS-3). */
  final(text: string): Promise<void>;
  /** Session over: commit whatever is pending as-is (RS-4). */
  finish(): Promise<void>;
}

export interface SessionOptions {
  serverUrl: string;
  apiKey: string | undefined;
  model: string | undefined;
  /** Vocabulary prompt for the `start` frame (whisper-flow 1.2+). */
  prompt: string | undefined;
  recorderCommands: string[][];
  sink: TranscriptSink;
  onState(state: SessionState, error?: SessionError): void;
  fetch?: Fetch;
  spawn?: Spawn;
}

export class DictationSession {
  private connection: WhisperFlowConnection | undefined;
  private recorder: Recorder | undefined;
  private queue: Promise<void> = Promise.resolve();
  private ended = false;
  private useStopFrame = false;

  constructor(private readonly options: SessionOptions) {}

  async start(): Promise<void> {
    const { options } = this;
    options.onState("connecting");
    const fetchFn = options.fetch ?? fetch;
    try {
      const info = await checkReady(options.serverUrl, options.apiKey, fetchFn);
      if (this.isEnded()) {
        return;
      }
      this.useStopFrame = supportsControlFrames(info);
      const model =
        options.model && info.models.includes(options.model) ? options.model : undefined;
      if (options.model && !model) {
        throw new Error(
          `Model ${options.model} isn't available on ${options.serverUrl} (available: ${info.models.join(", ") || "none"}).`,
        );
      }

      const connection = new WhisperFlowConnection(
        options.serverUrl,
        options.apiKey,
        {
          onMessage: (message) => {
            this.handleMessage(message);
          },
          onClose: (code, reason) => {
            this.handleClose(code, reason);
          },
        },
        fetchFn,
      );
      this.connection = connection;
      await connection.open();
      if (this.isEnded()) {
        connection.dispose();
        return;
      }
      if (this.useStopFrame && (options.prompt || model)) {
        connection.sendStart({ prompt: options.prompt, model });
      }
    } catch (error) {
      const closed =
        error instanceof HandshakeError ? describeClose(error.closeCode, "") : undefined;
      const message =
        error instanceof HandshakeError && error.closeCode !== 0 && closed
          ? closed.message
          : error instanceof HandshakeError
            ? `Can't connect to the whisper-flow server at ${options.serverUrl} (${error.message}).`
            : errorMessage(error);
      await this.fail({
        message,
        retry: !(error instanceof HandshakeError && error.closeCode !== 0),
      });
      return;
    }

    this.recorder = startRecorder(
      options.recorderCommands,
      {
        onFrame: (frame) => this.connection?.sendAudio(frame),
        onError: (message) => {
          void this.fail({ message, retry: true });
        },
      },
      options.spawn,
    );
    if (!this.isEnded()) {
      options.onState("recording");
    }
  }

  /** Stops recording, lets the server finalize the last segment, and commits it (ER-3). */
  async stop(): Promise<void> {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.recorder?.stop();
    await this.connection?.stop(this.useStopFrame);
    this.connection?.dispose();
    await this.drain();
    this.options.onState("idle");
  }

  /** Ends the session without waiting for the server (extension shutdown). */
  dispose(): void {
    this.ended = true;
    this.recorder?.stop();
    this.connection?.dispose();
  }

  /** Read through a method: TypeScript keeps `this.ended` narrowed across awaits. */
  private isEnded(): boolean {
    return this.ended;
  }

  private handleMessage(message: ServerMessage): void {
    if (message.kind === "error") {
      // An unknown control frame; the session continues.
      return;
    }
    const { sink } = this.options;
    this.enqueue(() => (message.isPartial ? sink.partial(message.text) : sink.final(message.text)));
  }

  private handleClose(code: number, reason: string): void {
    if (this.ended) {
      return;
    }
    const error = describeClose(code, reason) ?? {
      message: "The whisper-flow server ended the session.",
      retry: true,
    };
    void this.fail(error);
  }

  private async fail(error: SessionError): Promise<void> {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.recorder?.stop();
    this.connection?.dispose();
    await this.drain();
    this.options.onState("error", error);
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch(() => undefined);
  }

  private async drain(): Promise<void> {
    this.enqueue(() => this.options.sink.finish());
    await this.queue;
  }
}
