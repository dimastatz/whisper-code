# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.
See [README.md](README.md) for end-user/usage detail; this file is the agent-facing reference.

## Project overview

**whisper-code** is a VS Code extension for real-time voice dictation, powered by a
self-hosted [whisper-flow](https://github.com/dimastatz/whisper-flow) streaming server. Two features distinguish it from generic dictation:

- **Workspace-aware vocabulary** — transcription is biased with symbols from the open
  workspace (functions, classes, variables), so identifiers like `useMemo` come out
  spelled correctly.
- **Context-aware output** — formatting adapts to where the user is dictating: a code
  comment, a commit message, or an AI prompt.

## Stack

- TypeScript VS Code extension (Node), compiled with `tsc` to `out/`.
- Lint: ESLint 9 flat config with type-aware `typescript-eslint` `strictTypeChecked` +
  `stylisticTypeChecked` (`eslint.config.mjs`). Format: Prettier (`.prettierrc.json`).
- Tests: Mocha via `@vscode/test-cli` / `@vscode/test-electron`; they run inside a
  downloaded VS Code instance (cached in `.vscode-test/`, git-ignored).
- Transcription goes through **whisper-flow** only (see `docs/specs/0002-*`). Do not
  bundle a Whisper model or add any other STT engine, and never add third-party cloud STT.
  Audio goes only to the user-configured whisper-flow server (default `localhost`).

## Commands

```sh
npm install            # install dependencies
npm run compile        # build to out/
npm run watch          # incremental build
npm run format         # prettier --write
npm run lint           # type-aware eslint
npm run typecheck      # tsc --noEmit
npm test               # compile + run tests in VS Code
npm run test:coverage  # tests + coverage gate (95% lines/statements/functions/branches)
npm run check          # everything CI runs
```

Press **F5** in VS Code ("Run Extension") to launch the Extension Development Host.

## Layout

- `src/extension.ts` — entry point (`activate`/`deactivate`): commands, settings, consent
  prompts for non-local servers, the four-state status bar item.
- `src/dictation/session.ts` — one dictation session (`/ready` → socket → recorder → sink).
  No `vscode` import; `editorSink.ts` (pending range, decorations) and
  `workspaceVocabulary.ts` (symbol index) are the `vscode` side.
- `src/whisperflow/` — whisper-flow protocol: URLs and `/ready` (`server.ts`), server
  messages and close codes (`messages.ts`), the WebSocket client (`client.ts`).
- `src/audio/recorder.ts` — microphone sidecar process (sox / arecord / ffmpeg) and framing.
- `src/text/` — context detector, post-processor, vocabulary. Plain functions.
- `src/dictation/typingSink.ts` — output for inputs that aren't text editors (chat input):
  types final text with the `type` command.
- `scripts/e2e.mjs` — end-to-end test against a real whisper-flow (`npm run e2e`, and the
  manual **E2E** workflow); `scripts/play-wav.mjs` plays `test-fixtures/e2e/*.wav` as a fake mic.
- `test-fixtures/workspace/` — the workspace the integration tests open (vocabulary scan).
- `src/test/*.test.ts` — tests (Mocha `suite`/`test`). `fakeServer.ts` is a fake whisper-flow
  (real HTTP + WebSocket) and `fakeRecorder.ts` a fake recorder process; no real server or
  microphone is needed.
- `docs/specs/` — design specs; start with `0001-overview.md`.
- `docs/images/` — images referenced from docs.

## Working conventions

- Keep the README user-facing; put contributor/agent detail here.
- Run `npm run check` before opening a PR. CI (`.github/workflows/ci.yml`) runs the
  same gates on every PR; CodeQL (`codeql.yml`) runs security analysis.
- Keep coverage at or above 95%: add tests with new code rather than excluding files. Coverage
  measures `src/` without `src/test/` (tests and fakes don't count), and includes source files
  that no test loads (`.vscode-test.mjs`). `npm run test:coverage` fails below 95% on lines,
  statements, functions or branches.
- Logic that doesn't need the `vscode` API should live in plain modules so it can be
  tested directly.
- whisper-flow (uvicorn) rejects a handshake with HTTP 403 for both a bad API key and a full
  server, never close codes 1008/1013; `classifyRejectedHandshake` tells them apart.
- The `undo` and `type` commands are no-ops in the test window (it never has OS focus), so undo
  grouping can't be asserted in tests. To test typed text, register a `type` command in the test
  (as Vim-style extensions do) and capture its argument.
- The chat input (`chatSessionInput` documents) is synced to extensions but never becomes
  `activeTextEditor`; the keybinding's `inChatInput` `when` clause selects the typing mode.
- Commit on a feature branch and open a PR against `main`; don't push directly to `main`.
