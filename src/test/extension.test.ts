import * as assert from "assert";
import * as vscode from "vscode";
import { deactivate, isRecording } from "../extension";

const TOGGLE = "whisperCode.toggleDictation";

suite("Extension", () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("dimastatz.whisper-code");
    assert.ok(extension, "extension not found");
    await extension.activate();
  });

  teardown(async () => {
    if (isRecording()) {
      await vscode.commands.executeCommand(TOGGLE);
    }
  });

  test("toggleDictation command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(TOGGLE));
  });

  test("toggleDictation starts and stops recording", async () => {
    assert.strictEqual(isRecording(), false);
    await vscode.commands.executeCommand(TOGGLE);
    assert.strictEqual(isRecording(), true);
    await vscode.commands.executeCommand(TOGGLE);
    assert.strictEqual(isRecording(), false);
  });

  test("deactivate does not throw", () => {
    assert.doesNotThrow(() => {
      deactivate();
    });
  });
});
