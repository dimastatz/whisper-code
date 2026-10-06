# Spec 0001: whisper-code Overview

- **Status:** Draft
- **Author:** Dima Statz
- **Created:** 2026-10-05

## Summary

whisper-code is a VS Code extension for real-time voice dictation. It runs Whisper
locally, biases transcription toward symbols in the open workspace, and formats output
for the place where the user is dictating.

## Goals

1. **Self-hosted transcription.** Audio goes only to a [whisper-flow](https://github.com/dimastatz/whisper-flow)
   server the user configures (default `localhost`). No third-party cloud STT. Updated by
   [spec 0002](0002-whisper-flow-transcription.md).
2. **Workspace-aware vocabulary.** Code identifiers (e.g. `useMemo`, `getUserById`) are
   spelled correctly by feeding workspace symbols to Whisper as a prompt/bias.
3. **Context-aware output.** Formatting adapts to the insertion target:
   - code comment
   - commit message
   - AI prompt / chat input
4. **Real-time feel.** Text appears while the user speaks, with low latency.

## Non-goals

- Cloud speech-to-text providers.
- Voice _commands_ that drive the editor (navigation, refactoring). Dictation only.
- Languages other than English (for the first version).

## User experience

1. The user starts dictation with a command or keybinding. A status bar item shows that
   recording is on.
2. Partial transcripts stream into the active target as the user speaks.
3. The user stops dictation with the same keybinding. The final transcript replaces the
   partial text.

## Architecture (proposed)

```
Microphone ─▶ Audio capture ─▶ whisper-flow    ─▶ Post-processor ─▶ Editor insert
                                   ▲                    ▲
                     Workspace symbol index      Context detector
```

| Component          | Responsibility                                                         |
| ------------------ | ---------------------------------------------------------------------- |
| Audio capture      | Records the microphone and chunks audio for streaming inference.       |
| whisper-flow       | Streams PCM to a whisper-flow server and receives partial/final text.  |
| Symbol index       | Collects identifiers from the workspace and builds the initial prompt. |
| Context detector   | Decides the target: comment, commit message, or prompt.                |
| Post-processor     | Applies target-specific formatting (casing, punctuation, wrapping).    |
| Editor integration | Inserts and updates text, and shows status.                            |

## Open questions

- ~~Which Whisper runtime?~~ Resolved: whisper-flow ([spec 0002](0002-whisper-flow-transcription.md)).
- ~~Native helper or webview for the microphone?~~ Resolved: sidecar process (spec 0002, AU-3).
- Which model should we recommend running in whisper-flow for code dictation?
- How many symbols fit in Whisper's prompt window, and how do we rank them?
- How do we detect the commit-message and chat-input targets reliably?
