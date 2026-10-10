# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-10

Dictation works end to end ([spec 0001](docs/specs/0001-overview.md), on
[spec 0002](docs/specs/0002-whisper-flow-transcription.md)).

### Added

- Streaming transcription through a whisper-flow server (1.1.0+): `/ready` check, version
  check, WebSocket streaming of 16 kHz PCM, and finalizing the last phrase on stop (1.2.0+).
- Microphone capture in a sidecar process: SoX, `arecord` or `ffmpeg`, or
  `whisperCode.recorderCommand`.
- Live editor insertion: partial text is dimmed and replaced as you speak, each phrase is one
  undo step, and the selection is replaced.
- Workspace vocabulary: identifiers from open editors are sent as Whisper's prompt (1.2.0+)
  and respelled in the output.
- Context-aware formatting for code comments and commit messages.
- Settings `whisperCode.serverUrl`, `whisperCode.model`, `whisperCode.vocabulary.enabled` and
  `whisperCode.recorderCommand`; commands **Set API Key** and **Clear API Key** (secret
  storage).
- Confirmation before sending audio to a non-local server, and a warning without TLS.
- Status bar states: idle, connecting, recording, error. Errors for a bad API key, a full
  server, and lost connections (with **Retry**).
- Comment wrapping (`whisperCode.wrap.comments`, default 80) with the comment marker carried to
  each line, and commit body wrapping (`whisperCode.wrap.commitBody`, default 72).
- Vocabulary from workspace source files that aren't open (`whisperCode.vocabulary.scanWorkspace`,
  `whisperCode.vocabulary.maxFiles`).
- Dictation into the AI chat input: the shortcut, pressed in the chat input, types each final
  phrase there. VS Code doesn't expose the chat input to extensions as a text editor.
- A manual **E2E** workflow that runs dictation against whisper-flow in Docker with a recorded
  WAV (`npm run e2e` locally).
- README header with the Whisper Code logo.

### Changed

- The 95% coverage gate measures extension code only; tests and fakes no longer count.

### Security

- `whisperCode.recorderCommand` can only be set in user (machine) settings, not in a
  workspace's `.vscode/settings.json`, so opening a repository can't make dictation run a
  command it chose.

## [0.1.0] - 2026-10-05

First preview release. Sets up the extension and project tooling; audio capture and
transcription are not implemented yet.

### Added

- **Whisper Code: Toggle Dictation** command, bound to <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>
  (macOS) / <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (Windows/Linux).
- Status bar item that shows whether dictation is on and toggles it when clicked.
- Design spec [0001: Overview](docs/specs/0001-overview.md).
- CI: formatting, type-aware linting, type checking, tests with a 95% coverage gate,
  VSIX packaging, and CodeQL analysis.

[1.0.0]: https://github.com/dimastatz/whisper-code/releases/tag/v1.0.0
[0.1.0]: https://github.com/dimastatz/whisper-code/releases/tag/v0.1.0
