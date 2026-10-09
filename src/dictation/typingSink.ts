// Output for inputs that aren't text editors, such as the chat input box: VS Code doesn't
// expose them as `activeTextEditor`, so final text is typed into whatever has focus.
import * as vscode from "vscode";
import { formatFinal } from "../text/format";
import type { Vocabulary } from "../text/vocabulary";
import type { TranscriptSink } from "./session";

export class TypingSink implements TranscriptSink {
  /** Whether anything was typed yet, to separate phrases with a space. */
  private typed = false;

  constructor(private readonly vocabulary: Vocabulary | undefined) {}

  /** Partials can't be replaced in place in a focused input, so only finals are typed. */
  partial(): Promise<void> {
    return Promise.resolve();
  }

  async final(text: string): Promise<void> {
    const formatted = formatFinal(text, {
      target: "prompt",
      linePrefix: this.typed ? "x" : "",
      firstLine: false,
      applyVocabulary: (value) => this.vocabulary?.apply(value) ?? value,
    });
    if (formatted) {
      await vscode.commands.executeCommand("type", { text: formatted });
      this.typed = true;
    }
  }

  finish(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    // Nothing to clean up: typed text is already committed.
  }
}
