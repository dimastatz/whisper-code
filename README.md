<div align="center">
<h1 align="center"> Whisper Code </h1>
<h3>Real-Time Voice Dictation for VS Code, Powered by Whisper Flow<br></h3>
<a href="https://github.com/dimastatz/whisper-code/actions/workflows/ci.yml"><img src="https://github.com/dimastatz/whisper-code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://github.com/dimastatz/whisper-code/releases"><img src="https://img.shields.io/github/v/release/dimastatz/whisper-code?include_prereleases" alt="Release"></a>
<img src="https://img.shields.io/badge/VS%20Code-1.95%2B-007ACC" alt="VS Code 1.95+">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="MIT license"></a>
<br>
<br>
<kbd>
<img src="docs/images/whisper-code.png" width="256px" alt="Whisper Code logo: the Whisper Flow surfer with a VS Code badge">
</kbd>
</div>

Real-time voice dictation for VS Code, powered by self-hosted Whisper through [whisper-flow](https://github.com/dimastatz/whisper-flow). Biases transcription with your workspace symbols so it spells useMemo right, and adapts to whether you're dictating a comment, a commit message, or a prompt.

> **Status: preview.** Dictation works end to end against a whisper-flow server. Expect rough
> edges; see [docs/specs](docs/specs) for the design.

## Usage

| Action                 | How                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Start / stop dictation | Press <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (macOS) or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (Windows/Linux) |
|                        | Or click the microphone **Dictate** item in the status bar                                                              |
|                        | Or run **Whisper Code: Toggle Dictation** from the Command Palette                                                      |

The status bar shows **Connecting**, then **Dictating** while it records. Text appears dimmed as
you speak and settles when each phrase is final; toggle again to stop. Each phrase is one undo
step.

Output adapts to where the cursor is:

- **Code comment:** sentences start with a capital letter after the comment marker, and long
  comments wrap at column 80, continuing with the same marker (`// `, `*`, `# `…).
- **Commit message** (`COMMIT_EDITMSG`, git commit editor): the subject line has no trailing
  period and isn't wrapped; the body wraps at column 72.
- **AI chat input** (Copilot Chat and similar): press the same shortcut while the chat input has
  focus. Each finished phrase is typed into it; partial text isn't shown there.
- **Anything else** (prose, prompts): inserted as spoken.

Identifiers from your workspace (such as `useMemo` or `getUserById`) are sent to the server as a
vocabulary hint and respelled in the text, so "use memo" comes out as `useMemo`. Open editors
count most, then other source files in the workspace.

## Requirements

- A [whisper-flow](https://github.com/dimastatz/whisper-flow) server, 1.1.0 or newer (1.2.0+
  for the vocabulary hint and model choice). Run it yourself, for example with
  `./run.sh -run-server` or Docker. No third-party cloud speech service is used.
- A command-line audio recorder: [SoX](https://sourceforge.net/projects/sox/) (`brew install sox`,
  `apt install sox`), or `arecord` on Linux, or `ffmpeg` on macOS and Linux.

## Settings

| Setting                                | Default                 | Description                                                                                             |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `whisperCode.serverUrl`                | `http://localhost:8181` | whisper-flow server. A non-local server asks for your confirmation once, and warns without `https`.     |
| `whisperCode.model`                    | (server default)        | Model from the server's `/ready` list, such as `base.en.pt`.                                            |
| `whisperCode.vocabulary.enabled`       | `true`                  | Bias transcription toward identifiers from your workspace.                                              |
| `whisperCode.vocabulary.scanWorkspace` | `true`                  | Also read source files that aren't open (skips `node_modules`, build output and similar).               |
| `whisperCode.vocabulary.maxFiles`      | `500`                   | Most workspace files to read for the vocabulary.                                                        |
| `whisperCode.wrap.comments`            | `80`                    | Column to wrap dictated comments at; `0` turns it off.                                                  |
| `whisperCode.wrap.commitBody`          | `72`                    | Column to wrap commit message bodies at; `0` turns it off.                                              |
| `whisperCode.recorderCommand`          | (auto)                  | Command that writes raw 16 kHz mono 16-bit little-endian PCM to stdout, if the defaults don't suit you. |

If the server sets `WF_API_KEY`, run **Whisper Code: Set API Key**. The key is kept in VS Code's
secret storage, not in `settings.json`.

## Running from source

Requirements: [Node.js](https://nodejs.org/) 20+ and VS Code 1.95+.

```sh
git clone https://github.com/dimastatz/whisper-code
cd whisper-code
npm install
```

Then open the folder in VS Code and press **F5**. A new **Extension Development Host**
window opens with the extension loaded; try the shortcut there.

### Install a release

Download the `.vsix` from the [latest release](https://github.com/dimastatz/whisper-code/releases)
and run `code --install-extension whisper-code-<version>.vsix`.

### Build and install a VSIX

```sh
npx @vscode/vsce package          # produces whisper-code-<version>.vsix
code --install-extension whisper-code-*.vsix
```

## Development

```sh
npm run compile        # build to out/
npm run watch          # rebuild on change
npm run format         # format with Prettier
npm run check          # format check, lint, typecheck, tests with 95% coverage gate
```

Every pull request runs the same checks in GitHub Actions, plus CodeQL security analysis.

Design docs live in [docs/specs](docs/specs). See [CLAUDE.md](CLAUDE.md) for contributor
and agent conventions.

## License

[MIT](LICENSE)
