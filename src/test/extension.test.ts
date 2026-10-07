import * as assert from "assert";
import * as vscode from "vscode";
import { deactivate, getState, isRecording } from "../extension";
import { FakeWhisperFlow, final, partial, waitFor, type FakeServerOptions } from "./fakeServer";

const TOGGLE = "whisperCode.toggleDictation";

/** A recorder that writes a frame of silence every 20 ms, run by the extension host's Node. */
const FAKE_RECORDER = [
  process.execPath,
  "-e",
  "setInterval(() => process.stdout.write(Buffer.alloc(2048)), 20)",
];

type Window = typeof vscode.window;
const stubs: (() => void)[] = [];

/** Replaces a `vscode.window` function until the end of the test. */
function stub<K extends keyof Window>(name: K, replacement: Window[K]): void {
  const original = vscode.window[name];
  (vscode.window as Record<K, Window[K]>)[name] = replacement;
  stubs.push(() => {
    (vscode.window as Record<K, Window[K]>)[name] = original;
  });
}

function config() {
  return vscode.workspace.getConfiguration("whisperCode");
}

let server: FakeWhisperFlow | undefined;

async function useServer(options: FakeServerOptions): Promise<FakeWhisperFlow> {
  server = await new FakeWhisperFlow(options).listen();
  await config().update("serverUrl", server.url, vscode.ConfigurationTarget.Global);
  return server;
}

async function openEditor(content: string, language = "typescript"): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ language, content });
  const editor = await vscode.window.showTextDocument(document);
  const end = document.positionAt(content.length);
  editor.selection = new vscode.Selection(end, end);
  return editor;
}

async function startDictation(): Promise<void> {
  await vscode.commands.executeCommand(TOGGLE);
  await waitFor(() => getState() === "recording" || getState() === "error");
}

async function stopDictation(): Promise<void> {
  await vscode.commands.executeCommand(TOGGLE);
  await waitFor(() => !isRecording());
}

suite("Extension", () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("dimastatz.whisper-code");
    assert.ok(extension, "extension not found");
    await extension.activate();
    await config().update("recorderCommand", FAKE_RECORDER, vscode.ConfigurationTarget.Global);
  });

  teardown(async () => {
    if (isRecording()) {
      await stopDictation();
    }
    for (const restore of stubs.splice(0)) {
      restore();
    }
    await server?.close();
    server = undefined;
    // Revert first so closing an edited untitled document doesn't ask to save it.
    for (let i = 0; i < 10 && vscode.window.activeTextEditor; i++) {
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }
  });

  suiteTeardown(async () => {
    for (const key of ["serverUrl", "recorderCommand", "vocabulary.enabled", "model"]) {
      await config().update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand("whisperCode.clearApiKey");
  });

  test("commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of [TOGGLE, "whisperCode.setApiKey", "whisperCode.clearApiKey"]) {
      assert.ok(commands.includes(command), command);
    }
  });

  test("dictates into a comment with workspace vocabulary", async () => {
    const fake = await useServer({
      events: [
        partial(" fix the"),
        partial(" fix the cash"),
        final(" fix the cache in get user by id."),
      ],
    });
    const content = "const user = getUserById(1);\n// ";
    const editor = await openEditor(content);
    await startDictation();
    assert.strictEqual(getState(), "recording");
    const expected = "const user = getUserById(1);\n// Fix the cache in getUserById.";
    await waitFor(() => editor.document.getText() === expected);
    assert.match(String(fake.controls[0]?.prompt), /getUserById/);

    await stopDictation();
    assert.strictEqual(getState(), "idle");
    assert.deepStrictEqual(fake.controls.at(-1), { type: "stop" });
  });

  test("formats a commit subject", async () => {
    await useServer({ events: [final(" add retry to the client.")] });
    const editor = await openEditor("", "git-commit");
    await startDictation();
    await waitFor(() => editor.document.getText() === "Add retry to the client");
  });

  test("replaces the selection and commits pending text on stop", async () => {
    await useServer({ events: [partial(" half done")] });
    const editor = await openEditor("before REPLACE after");
    editor.selection = new vscode.Selection(0, 7, 0, 14);
    await startDictation();
    await waitFor(() => editor.document.getText() === "before half done after");
    await stopDictation();
    assert.strictEqual(editor.document.getText(), "before half done after");
  });

  test("user edits and cursor moves commit the pending text", async () => {
    const fake = await useServer({ events: [partial(" one")] });
    const editor = await openEditor("Start.");
    await startDictation();
    await waitFor(() => editor.document.getText() === "Start. one");

    // An edit elsewhere keeps "one" and the next segment starts at the cursor.
    await editor.edit((builder) => {
      builder.insert(new vscode.Position(0, 0), "> ");
    });
    fake.send(partial(" two"));
    await waitFor(() => editor.document.getText() === "> Start. one two");

    // Moving the cursor out of the pending range commits it too.
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    fake.send(final(" three"));
    await waitFor(() => editor.document.getText() === "Three> Start. one two");

    // A partial identical to what's there is a no-op.
    fake.send(partial(""));
    fake.send(partial(""));
    fake.send(final(" "));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(editor.document.getText(), "Three> Start. one two");
  });

  test("switching editors commits the pending text", async () => {
    const fake = await useServer({ events: [partial(" first")] });
    const first = await openEditor("");
    await startDictation();
    await waitFor(() => first.document.getText() === "first");
    const second = await openEditor("");
    await new Promise((resolve) => setTimeout(resolve, 50));
    fake.send(final(" second"));
    await waitFor(() => second.document.getText() === "Second");
    assert.strictEqual(first.document.getText(), "first");
  });

  test("with no editor, final text is typed into the focused input", async () => {
    const fake = await useServer({ events: [partial(" ignored")] });
    await startDictation();
    fake.send(final(" hello there"));
    fake.send(final(" "));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.strictEqual(getState(), "recording");
  });

  test("vocabulary can be disabled", async () => {
    const fake = await useServer({ events: [] });
    await config().update("vocabulary.enabled", false, vscode.ConfigurationTarget.Global);
    try {
      await openEditor("getUserById");
      await startDictation();
      await waitFor(() => fake.audioBytes > 0);
      await stopDictation();
      assert.deepStrictEqual(fake.controls, [{ type: "stop" }]);
    } finally {
      await config().update("vocabulary.enabled", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("passes the model setting to the server", async () => {
    const fake = await useServer({ events: [] });
    await config().update("model", "base.en.pt", vscode.ConfigurationTarget.Global);
    try {
      await startDictation();
      await waitFor(() => fake.controls.length > 0);
      assert.strictEqual(fake.controls[0]?.model, "base.en.pt");
    } finally {
      await config().update("model", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test("API key from secret storage (CF-2)", async () => {
    const fake = await useServer({ apiKey: "s3cret", events: [] });
    const answers = ["s3cret", "", undefined];
    stub("showInputBox", () => Promise.resolve(answers.shift()));
    await vscode.commands.executeCommand("whisperCode.setApiKey");
    await startDictation();
    assert.strictEqual(getState(), "recording");
    await stopDictation();
    assert.strictEqual(fake.connections, 1);

    await vscode.commands.executeCommand("whisperCode.setApiKey");
    await vscode.commands.executeCommand("whisperCode.setApiKey");
    const errors: string[] = [];
    stub("showErrorMessage", (message: string) => {
      errors.push(message);
      return Promise.resolve(undefined);
    });
    await startDictation();
    assert.strictEqual(getState(), "error");
    assert.deepStrictEqual(errors, ["Whisper Code: Invalid or missing API key"]);
  });

  test("errors show in the status bar and offer Retry (ER-2, ER-4)", async () => {
    const fake = await useServer({ events: [] });
    const url = fake.url;
    await fake.close();
    server = undefined;
    const errors: { message: string; actions: string[] }[] = [];
    let retried = false;
    stub("showErrorMessage", ((message: string, ...actions: string[]) => {
      errors.push({ message, actions });
      const retry = !retried && actions.includes("Retry");
      retried ||= retry;
      return Promise.resolve(retry ? "Retry" : undefined);
    }) as unknown as Window["showErrorMessage"]);
    await config().update("serverUrl", url, vscode.ConfigurationTarget.Global);
    await startDictation();
    assert.strictEqual(getState(), "error");
    await waitFor(() => errors.length === 2);
    assert.match(errors[0]?.message ?? "", /Can't reach the whisper-flow server/);
    assert.deepStrictEqual(errors[0]?.actions, ["Retry"]);
  });

  test("rejects an invalid server URL", async () => {
    const errors: string[] = [];
    stub("showErrorMessage", (message: string) => {
      errors.push(message);
      return Promise.resolve(undefined);
    });
    await config().update("serverUrl", "ftp://example.com", vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand(TOGGLE);
    assert.match(errors[0] ?? "", /must start with http/);
    assert.ok(!isRecording());
  });

  test("asks before sending audio to a non-local server (CF-4, CF-5)", async () => {
    const prompts: string[] = [];
    const reply: { answer?: string } = {};
    stub("showWarningMessage", (message: string) => {
      prompts.push(message);
      return Promise.resolve(reply.answer);
    });
    stub("showErrorMessage", () => Promise.resolve(undefined));
    await config().update(
      "serverUrl",
      "http://whisper.invalid:8181",
      vscode.ConfigurationTarget.Global,
    );

    await vscode.commands.executeCommand(TOGGLE);
    assert.ok(!isRecording());
    assert.strictEqual(prompts.length, 1);
    assert.match(prompts[0] ?? "", /send your microphone audio to whisper\.invalid:8181/);

    reply.answer = "Send Audio";
    await startDictation();
    assert.match(prompts[2] ?? "", /isn't encrypted/);

    // Approved once per URL: only the TLS warning this time.
    await startDictation();
    assert.strictEqual(prompts.length, 4);
    assert.match(prompts[3] ?? "", /isn't encrypted/);
  });

  test("a double press doesn't start two sessions", async () => {
    const fake = await useServer({ events: [] });
    await Promise.all([
      vscode.commands.executeCommand(TOGGLE),
      vscode.commands.executeCommand(TOGGLE),
    ]);
    await waitFor(() => getState() === "recording");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(fake.connections, 1);
  });

  test("deactivate ends the session (ER-3)", async () => {
    await useServer({ events: [] });
    await startDictation();
    deactivate();
    assert.strictEqual(getState(), "idle");
  });
});
