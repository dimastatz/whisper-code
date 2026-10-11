# Spec 0002: whisper-flow as the Transcription Engine

- **Status:** Implemented in 1.0.0 (tested with whisper-flow 1.2.1 and 1.3.0)
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

whisper-flow 1.1.0 had gaps that affected this integration. All of them are fixed; the extension
uses the fixes when the server is 1.2.0 or newer and still works with 1.1.0 (TR-4).

| Gap in 1.1.0                                                     | Fixed in                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No finalize-on-stop: the last words of a dictation were lost.    | 1.2.0, `stop` control frame ([#39](https://github.com/dimastatz/whisper-flow/issues/39))                |
| No `protocol_version` on `/ready`, no written protocol.          | 1.2.0, `docs/protocol.md` ([#40](https://github.com/dimastatz/whisper-flow/issues/40))                  |
| No vocabulary prompt (Whisper's `initial_prompt`).               | 1.2.0, `prompt` in the `start` frame ([#41](https://github.com/dimastatz/whisper-flow/issues/41))       |
| Fixed model per server.                                          | 1.2.0, `model` in the `start` frame ([#42](https://github.com/dimastatz/whisper-flow/issues/42))        |
| Window cap dropped the start of segments longer than about 64 s. | 1.2.0, the segment is finalized at the cap ([#44](https://github.com/dimastatz/whisper-flow/issues/44)) |
| Text-based endpointing made finals arrive late.                  | 1.2.0, silence endpointing ([#43](https://github.com/dimastatz/whisper-flow/issues/43))                 |
| A client dropping mid-transcription leaked its server session.   | 1.2.1 ([#49](https://github.com/dimastatz/whisper-flow/issues/49))                                      |

## Out of scope

- Starting, installing, or managing the whisper-flow server from the extension. The user runs
  it, for example with `./run.sh -run-server` or Docker. Managed server lifecycle is a later spec.
- The batch endpoint `POST /transcribe_pcm_chunk` (for transcribing audio files).
- whisper-flow's `chat_room` features.

## Open questions

All resolved:

- ~~Sidecar recorder?~~ SoX first, then `arecord` (Linux) or `ffmpeg`, or a user-set
  `whisperCode.recorderCommand` (AU-4). No Python on the client.
- ~~Vocabulary protocol?~~ A `prompt` field in whisper-flow's JSON `start` frame (protocol 1).
- ~~Before finalize-on-stop lands?~~ It landed in whisper-flow 1.2.0: stop sends `stop` and waits
  for the final. With 1.1.0 the last partial is committed as-is.
