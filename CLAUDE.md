# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.
See [README.md](README.md) for end-user/usage detail; this file is the agent-facing reference.

## Project overview

**whisper-code** is a VS Code extension for real-time voice dictation, powered by a
locally running Whisper model. Two features distinguish it from generic dictation:

- **Workspace-aware vocabulary** — transcription is biased with symbols from the open
  workspace (functions, classes, variables), so identifiers like `useMemo` come out
  spelled correctly.
- **Context-aware output** — formatting adapts to where the user is dictating: a code
  comment, a commit message, or an AI prompt.

## Current status

The repository is in its initial stage: only `README.md`, `LICENSE` (MIT), `.gitignore`
(Node template), and this file exist. There is no source code, build setup, or test
suite yet. When scaffolding, update this file with the real commands and layout.

## Expected stack

- TypeScript VS Code extension (Node), per the `.gitignore` template.
- Whisper inference runs **locally** — do not introduce cloud speech-to-text services
  or send audio/workspace content off the machine.

## Working conventions

- Keep the README user-facing; put contributor/agent detail here.
- Once a build exists, document here: install, build, lint, test, and how to launch the
  Extension Development Host (F5).
- Commit on a feature branch and open a PR against `main`; don't push directly to `main`.
