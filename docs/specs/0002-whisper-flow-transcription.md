# Spec 0002: whisper-flow as the Transcription Engine

- **Status:** Draft
- **Author:** Dima Statz
- **Created:** 2026-10-06
- **Updates:** [0001: Overview](0001-overview.md). Answers its "which Whisper runtime" open
  question and changes goal 1 (local-only).

## Summary

whisper-code uses [whisper-flow](https://github.com/dimastatz/whisper-flow) for all streaming
transcription. whisper-flow is a Python (FastAPI) server that receives a continuous stream of
PCM audio over a WebSocket and returns partial and final transcripts as JSON events. The
extension does not run Whisper itself. It captures audio, streams it to a whisper-flow server,
and turns the returned events into editor edits.

This spec is based on whisper-flow **1.1.0**. The server-side plan for this integration is in
whisper-flow's [docs/vscode.md](https://github.com/dimastatz/whisper-flow/blob/main/docs/vscode.md).

## Motivation

- **Streaming is already solved.** whisper-flow handles chunk windowing, partial results, and
  segment finalization. In the published benchmark on an M1 MacBook Air, latency between
  partials is 275 ms mean and under 500 ms max. Building our own streaming layer on whisper.cpp
  or Node bindings would duplicate that work.
- **Self-hosted and remote GPU.** The same protocol works for a server on `localhost` and for a
  self-hosted server with a large model on a GPU machine.
- **One owner.** Both projects are maintained by the same author, so protocol changes can be
  coordinated.

## Requirements

Each requirement is **must** (needed for the MVP) or **should** (wanted, but can come later).

### Transcription engine

| ID   | Level | Requirement                                                                                                                                                                                                       |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR-1 | must  | All speech-to-text goes through a whisper-flow server. The extension does not bundle or run a Whisper model, whisper.cpp, or any other STT engine.                                                                |
| TR-2 | must  | The extension connects to whisper-flow's streaming endpoint (`ws://<host>:<port>/ws`).                                                                                                                            |
| TR-3 | must  | The extension does not use third-party cloud STT services (OpenAI API, Google, Azure, and so on), even as a fallback.                                                                                             |
| TR-4 | must  | The minimum supported whisper-flow version is **1.1.0**. The extension reads `version` from `GET /ready` before streaming and refuses to start if the server is older, showing an error that names both versions. |

### Connection and configuration

| ID   | Level  | Requirement                                                                                                                                                                        |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF-1 | must   | Setting `whisperCode.serverUrl`, default `http://localhost:8181`. The WebSocket URL is derived from it (`http` becomes `ws`, `https` becomes `wss`, and `/ws` is appended).        |
| CF-2 | must   | Optional API key, sent as the `x-api-key` header on HTTP requests and on the WebSocket upgrade. It is stored with VS Code `SecretStorage`, not in `settings.json`.                 |
| CF-3 | must   | Before each dictation session, call `GET /ready`. If the server can't be reached, or `model_loaded` is `false`, don't start recording; show an error that includes the server URL. |
| CF-4 | must   | A server URL whose host is not `localhost`, `127.0.0.1`, or `::1` is allowed only after the user confirms once per URL that audio will be sent to that host.                       |
| CF-5 | should | A non-local URL with `ws://` / `http://` (no TLS) shows a warning. The user can still continue.                                                                                    |

### Audio streaming

| ID   | Level  | Requirement                                                                                                                                                       |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AU-1 | must   | Audio is sent as binary WebSocket frames of raw PCM: **16 kHz, mono, 16-bit signed little-endian**, with no header. This is the only format whisper-flow accepts. |
| AU-2 | must   | Frames are 1024 samples (2048 bytes), matching whisper-flow's default `WF_CHUNK_SIZE`, and are sent as they are captured, not buffered.                           |
| AU-3 | must   | The microphone is captured by a sidecar process spawned by the extension host, not a webview. A webview takes focus, which moves the cursor out of the editor.    |
| AU-4 | should | The sidecar has no Python dependency on the client. Prefer a Node or native recorder so the extension works when the server runs on another machine.              |

### Results and editor insertion

| ID   | Level  | Requirement                                                                                                                                                                                                     |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RS-1 | must   | Parse each server message as `{ is_partial: boolean, data: { text: string, ... }, time: number }`.                                                                                                              |
| RS-2 | must   | Partial results are **not monotonic**: a later partial can rewrite words from an earlier one. The extension keeps a pending range and **replaces** its contents on each partial. It never appends partial text. |
| RS-3 | must   | When `is_partial` is `false`, the pending text is committed and the next segment starts a new pending range after it.                                                                                           |
| RS-4 | must   | Pending text is visibly different from committed text (for example, dimmed with a decoration). If the user stops dictation or edits outside the range, the range is committed or removed.                       |
| RS-5 | must   | Text inserted from one segment is undone in a single step.                                                                                                                                                      |
| RS-6 | should | Context-aware formatting (spec 0001, goal 3) is applied only to committed text, so partials don't change format while the user is speaking.                                                                     |

### Errors and lifecycle

| ID   | Level | Requirement                                                                                                                           |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ER-1 | must  | WebSocket close code `1008` shows "Invalid or missing API key". Close code `1013` shows "Server is at capacity". Both stop recording. |
| ER-2 | must  | Any other unexpected disconnect stops recording, keeps already-committed text, and shows an error with a **Retry** action.            |
| ER-3 | must  | Stopping dictation stops the sidecar and closes the socket. No sidecar process outlives the session or the extension.                 |
| ER-4 | must  | The status bar shows four states: idle, connecting, recording, error.                                                                 |

### Testing

| ID   | Level  | Requirement                                                                                                                                                                                                      |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-1 | must   | The whisper-flow client (URL derivation, `/ready` check, message parsing, pending-range logic) is in modules that don't import `vscode`, so they can be unit tested. The 95% coverage gate applies to them.      |
| TS-2 | must   | CI does not need a running whisper-flow server or a microphone. Tests use a fake WebSocket server that replays recorded whisper-flow events, including non-monotonic partials and close codes `1008` and `1013`. |
| TS-3 | should | An optional, manually triggered CI job runs end to end against a whisper-flow Docker container using a recorded WAV file.                                                                                        |

## Change to spec 0001

Goal 1 in 0001 says audio and workspace content never leave the machine. With whisper-flow it
becomes:

> **Self-hosted transcription.** Audio goes only to a whisper-flow server the user configures.
> The default is `localhost`, and sending audio to any other host requires explicit consent
> (CF-4). No third-party cloud STT is used (TR-3).

## Dependencies on whisper-flow

These are gaps in whisper-flow 1.1.0 that affect this integration. Most are prerequisites in
whisper-flow's [docs/vscode.md §4](https://github.com/dimastatz/whisper-flow/blob/main/docs/vscode.md#4-server-side-prerequisites).

| Gap in 1.1.0                                                                                                      | Impact on whisper-code                                                                                | Blocks         |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| **No finalize-on-stop.** When the socket closes, queued audio is dropped and the last partial is never finalized. | The last words of a dictation are lost. Until this is fixed, stop must commit the last partial as-is. | MVP quality    |
| **No `protocol_version`** on `/ready`, and no written protocol.                                                   | TR-4 can only compare the server's package `version`.                                                 | Nothing yet    |
| **No vocabulary prompt.** `transcribe_pcm_chunks` doesn't pass Whisper's `initial_prompt`.                        | Workspace-symbol biasing (spec 0001, goal 2) can't work until the server accepts a prompt.            | Goal 2         |
| **Fixed model per server** (`WF_MODEL`, default `tiny.en.pt`).                                                    | No per-session model choice; `tiny.en` is weak on code identifiers.                                   | Accuracy       |
| **Window cap.** `WF_MAX_WINDOW_CHUNKS = 1000` (about 64 s).                                                       | A single segment longer than about 64 s loses its beginning.                                          | Long dictation |
| **Text-based endpointing.** A segment closes when the text is unchanged for two cycles, not on silence.           | Finals can arrive late, so committed text lags behind speech.                                         | Latency        |

## Out of scope

- Starting, installing, or managing the whisper-flow server from the extension. The user runs
  it, for example with `./run.sh -run-server` or Docker. Managed server lifecycle is a later spec.
- The batch endpoint `POST /transcribe_pcm_chunk` (for transcribing audio files).
- whisper-flow's `chat_room` features.

## Open questions

- **Sidecar recorder:** sox via `node-record-lpcm16`, a small native binary, or whisper-flow's
  `audio/microphone.py` for the first spike?
- **Vocabulary protocol:** should whisper-flow accept the vocabulary prompt in a JSON control
  frame at session start (together with `start` / `stop` from whisper-flow prerequisite 1), or as
  a WebSocket query parameter?
- **Before finalize-on-stop lands:** commit the last partial on stop, or send a few hundred
  milliseconds of silence and wait briefly for a final?
