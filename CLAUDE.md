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

## Stack

- TypeScript VS Code extension (Node), compiled with `tsc` to `out/`.
- Lint: ESLint 9 flat config with `typescript-eslint` (`eslint.config.mjs`).
- Tests: Mocha via `@vscode/test-cli` / `@vscode/test-electron`; they run inside a
  downloaded VS Code instance (cached in `.vscode-test/`, git-ignored).
- Whisper inference runs **locally** — do not introduce cloud speech-to-text services
  or send audio/workspace content off the machine.

## Commands

```sh
npm install        # install dependencies
npm run compile    # build to out/
npm run watch      # incremental build
npm run lint       # eslint src
npm test           # compile + lint + run tests in VS Code
```

Press **F5** in VS Code ("Run Extension") to launch the Extension Development Host.

## Layout

- `src/extension.ts` — entry point (`activate`/`deactivate`); registers
  `whisperCode.toggleDictation` and the status bar item. Dictation itself is still a stub.
- `src/test/*.test.ts` — integration tests (Mocha `suite`/`test`).
- `docs/specs/` — design specs; start with `0001-overview.md`.
- `docs/images/` — images referenced from docs.

## Working conventions

- Keep the README user-facing; put contributor/agent detail here.
- Run `npm test` before opening a PR.
- Commit on a feature branch and open a PR against `main`; don't push directly to `main`.
