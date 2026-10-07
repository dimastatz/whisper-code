# whisper-code

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

- **Code comment:** sentences start with a capital letter after the comment marker.
- **Commit message** (`COMMIT_EDITMSG`, git commit editor): the subject line has no trailing
  period.
- **Anything else** (prose, prompts): inserted as spoken.

Identifiers from your open editors (such as `useMemo` or `getUserById`) are sent to the server
as a vocabulary hint and respelled in the text, so "use memo" comes out as `useMemo`.

## Requirements

- A [whisper-flow](https://github.com/dimastatz/whisper-flow) server, 1.1.0 or newer (1.2.0+
  for the vocabulary hint and model choice). Run it yourself, for example with
  `./run.sh -run-server` or Docker. No third-party cloud speech service is used.
- A command-line audio recorder: [SoX](https://sourceforge.net/projects/sox/) (`brew install sox`,
  `apt install sox`), or `arecord` on Linux, or `ffmpeg` on macOS and Linux.

## Settings

| Setting                          | Default                 | Description                                                                                             |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `whisperCode.serverUrl`          | `http://localhost:8181` | whisper-flow server. A non-local server asks for your confirmation once, and warns without `https`.     |
| `whisperCode.model`              | (server default)        | Model from the server's `/ready` list, such as `base.en.pt`.                                            |
| `whisperCode.vocabulary.enabled` | `true`                  | Bias transcription toward identifiers from open editors.                                                |
| `whisperCode.recorderCommand`    | (auto)                  | Command that writes raw 16 kHz mono 16-bit little-endian PCM to stdout, if the defaults don't suit you. |

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
