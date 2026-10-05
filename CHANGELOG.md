# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/dimastatz/whisper-code/releases/tag/v0.1.0
