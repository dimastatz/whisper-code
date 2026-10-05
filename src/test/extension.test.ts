import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension", () => {
  test("toggleDictation command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("whisperCode.toggleDictation"));
  });
});
