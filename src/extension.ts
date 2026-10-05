import * as vscode from "vscode";

let recording = false;
let statusItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "whisperCode.toggleDictation";
  updateStatus();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("whisperCode.toggleDictation", toggleDictation),
  );
}

export function deactivate() {
  // Nothing to clean up yet; disposables are released via context.subscriptions.
}

export function isRecording(): boolean {
  return recording;
}

function toggleDictation() {
  recording = !recording;
  updateStatus();
  // TODO: start/stop audio capture and the local Whisper runner (see docs/specs/0001-overview.md).
}

function updateStatus() {
  statusItem.text = recording ? "$(record) Dictating" : "$(mic) Dictate";
  statusItem.tooltip = recording ? "Stop dictation" : "Start dictation";
}
