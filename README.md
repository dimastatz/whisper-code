# whisper-code

Real-time voice dictation for VS Code, powered by self-hosted Whisper through [whisper-flow](https://github.com/dimastatz/whisper-flow). Biases transcription with your workspace symbols so it spells useMemo right, and adapts to whether you're dictating a comment, a commit message, or a prompt.

> **Status: early development.** The extension installs and the dictation command and
> status bar toggle work, but audio capture and transcription are not implemented yet.
> See [docs/specs/0001-overview.md](docs/specs/0001-overview.md) for the plan.

## Usage

| Action                 | How                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Start / stop dictation | Press <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (macOS) or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> (Windows/Linux) |
|                        | Or click the microphone **Dictate** item in the status bar                                                              |
|                        | Or run **Whisper Code: Toggle Dictation** from the Command Palette                                                      |

While dictating, the status bar item changes to **Dictating**. Toggle again to stop.

Transcription runs on a [whisper-flow](https://github.com/dimastatz/whisper-flow) server that you
run yourself, on `localhost` by default. No third-party cloud speech service is used.

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
