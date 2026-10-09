import * as vscode from "vscode";
import { defaultRecorderCommands } from "./audio/recorder";
import { EditorSink } from "./dictation/editorSink";
import { TypingSink } from "./dictation/typingSink";
import { DictationSession, type SessionError, type SessionState } from "./dictation/session";
import { collectWorkspaceVocabulary } from "./dictation/workspaceVocabulary";
import {
  errorMessage,
  isInsecureRemote,
  isLocalServer,
  parseServerUrl,
} from "./whisperflow/server";

const API_KEY_SECRET = "whisperCode.apiKey";
const APPROVED_SERVERS = "whisperCode.approvedServers";

let context: vscode.ExtensionContext;
let statusItem: vscode.StatusBarItem;
let state: SessionState = "idle";
let session: DictationSession | undefined;
let sink: EditorSink | TypingSink | undefined;
/** The target of the last session, reused by Retry. */
let lastTarget: "editor" | "focused" = "editor";

/**
 * Where text goes. "editor" (the default) inserts at the cursor with live partials. "focused"
 * types final text into whatever has focus; the keybinding uses it in the chat input, which
 * VS Code doesn't expose to extensions as a text editor.
 */
export interface ToggleOptions {
  target?: "editor" | "focused";
}
/** Set while a toggle is being handled, so a double press doesn't start two sessions. */
let busy = false;

export function activate(extensionContext: vscode.ExtensionContext) {
  context = extensionContext;
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "whisperCode.toggleDictation";
  setState("idle");
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("whisperCode.toggleDictation", toggleDictation),
    vscode.commands.registerCommand("whisperCode.setApiKey", setApiKey),
    vscode.commands.registerCommand("whisperCode.clearApiKey", clearApiKey),
    { dispose: endSession },
  );
}

export function deactivate() {
  // No sidecar may outlive the extension (ER-3).
  endSession();
}

/** True while connecting or recording. */
export function isRecording(): boolean {
  return state === "connecting" || state === "recording";
}

export function getState(): SessionState {
  return state;
}

async function toggleDictation(options?: ToggleOptions): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;
  try {
    if (session && isRecording()) {
      await session.stop();
    } else {
      await startDictation(options?.target ?? "editor");
    }
  } finally {
    busy = false;
  }
}

async function startDictation(target: "editor" | "focused"): Promise<void> {
  lastTarget = target;
  const config = vscode.workspace.getConfiguration("whisperCode");
  const serverUrl = config.get<string>("serverUrl", "http://localhost:8181");
  try {
    parseServerUrl(serverUrl);
  } catch (error) {
    showError({ message: errorMessage(error), retry: false });
    return;
  }
  if (!(await confirmServer(serverUrl))) {
    return;
  }

  endSession();
  const useVocabulary = config.get<boolean>("vocabulary.enabled", true);
  const vocabulary = useVocabulary
    ? await collectWorkspaceVocabulary({
        scanWorkspace: config.get<boolean>("vocabulary.scanWorkspace", true),
        maxFiles: config.get<number>("vocabulary.maxFiles", 500),
      })
    : undefined;
  const recorderCommand = config.get<string[]>("recorderCommand", []);
  const currentSink =
    target === "focused"
      ? new TypingSink(vocabulary)
      : new EditorSink(vocabulary, {
          comment: config.get<number>("wrap.comments", 80),
          commitBody: config.get<number>("wrap.commitBody", 72),
        });
  sink = currentSink;

  const current: DictationSession = new DictationSession({
    serverUrl,
    apiKey: await context.secrets.get(API_KEY_SECRET),
    model: emptyToUndefined(config.get<string>("model")),
    prompt: emptyToUndefined(vocabulary?.prompt),
    recorderCommands: recorderCommand.length
      ? [recorderCommand]
      : defaultRecorderCommands(process.platform),
    sink: currentSink,
    onState: (next, error) => {
      if (session !== current) {
        return;
      }
      setState(next, error);
      if (next === "idle" || next === "error") {
        currentSink.dispose();
      }
      if (error) {
        showError(error);
      }
    },
  });
  session = current;
  // Not awaited, so pressing the toggle again while connecting cancels the session.
  void current.start();
}

/** Ends any session immediately, without waiting for the server. */
function endSession(): void {
  session?.dispose();
  session = undefined;
  sink?.dispose();
  sink = undefined;
  setState("idle");
}

/**
 * Asks once per URL before sending audio to a non-local host (CF-4), and warns about a
 * non-local server without TLS (CF-5).
 */
async function confirmServer(serverUrl: string): Promise<boolean> {
  if (isLocalServer(serverUrl)) {
    return true;
  }
  const host = parseServerUrl(serverUrl).host;
  const approved = context.globalState.get<string[]>(APPROVED_SERVERS, []);
  if (!approved.includes(serverUrl)) {
    const allow = "Send Audio";
    const answer = await vscode.window.showWarningMessage(
      `Whisper Code will send your microphone audio to ${host} (${serverUrl}). Continue?`,
      { modal: true },
      allow,
    );
    if (answer !== allow) {
      return false;
    }
    await context.globalState.update(APPROVED_SERVERS, [...approved, serverUrl]);
  }
  if (isInsecureRemote(serverUrl)) {
    void vscode.window.showWarningMessage(
      `The connection to ${host} isn't encrypted. Audio and your API key are sent in clear text; use https:// if the server supports it.`,
    );
  }
  return true;
}

async function setApiKey(): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: "whisper-flow API key",
    prompt: "Stored in VS Code's secret storage and sent as the x-api-key header.",
    password: true,
    ignoreFocusOut: true,
  });
  if (key !== undefined) {
    await (key
      ? context.secrets.store(API_KEY_SECRET, key)
      : context.secrets.delete(API_KEY_SECRET));
  }
}

async function clearApiKey(): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET);
}

function showError(error: SessionError): void {
  const retry = "Retry";
  const actions = error.retry ? [retry] : [];
  void vscode.window
    .showErrorMessage(`Whisper Code: ${error.message}`, ...actions)
    .then((choice) => {
      if (choice === retry) {
        void toggleDictation({ target: lastTarget });
      }
    });
}

const STATUS: Record<SessionState, { text: string; tooltip: string }> = {
  idle: { text: "$(mic) Dictate", tooltip: "Start dictation" },
  connecting: { text: "$(sync~spin) Connecting", tooltip: "Connecting to whisper-flow…" },
  recording: { text: "$(record) Dictating", tooltip: "Stop dictation" },
  error: {
    text: "$(error) Dictate",
    tooltip: "Dictation stopped with an error. Click to start again.",
  },
};

function setState(next: SessionState, error?: SessionError): void {
  state = next;
  statusItem.text = STATUS[next].text;
  statusItem.tooltip = error ? `${STATUS[next].tooltip}\n${error.message}` : STATUS[next].tooltip;
  statusItem.backgroundColor =
    next === "error" ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}
