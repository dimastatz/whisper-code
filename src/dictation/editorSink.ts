// Editor integration: pending range, decorations, undo grouping (spec 0002: RS-2..RS-6).
import * as vscode from "vscode";
import { detectTarget } from "../text/context";
import { formatFinal, formatPartial } from "../text/format";
import type { Vocabulary } from "../text/vocabulary";
import type { TranscriptSink } from "./session";

interface Segment {
  editor: vscode.TextEditor;
  /** Offset where the segment starts. */
  start: number;
  /** Length of the text in the editor that the next result replaces. */
  length: number;
  /** No edit has been made yet, so the next one starts a new undo step. */
  fresh: boolean;
}

export class EditorSink implements TranscriptSink, vscode.Disposable {
  private segment: Segment | undefined;
  private applying = false;
  /** Document version after our last edit, to tell our change events from the user's. */
  private ownVersion = -1;
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    opacity: "0.55",
    fontStyle: "italic",
  });
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly vocabulary: Vocabulary | undefined) {
    this.subscriptions = [
      this.decoration,
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          !this.applying &&
          event.document === this.segment?.editor.document &&
          event.document.version !== this.ownVersion &&
          event.contentChanges.length > 0
        ) {
          // The user edited the document: keep what's there and start over at the cursor.
          this.commit();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        const segment = this.segment;
        if (this.applying || event.textEditor !== segment?.editor) {
          return;
        }
        const offset = segment.editor.document.offsetAt(
          event.selections[0]?.active ?? new vscode.Position(0, 0),
        );
        if (offset < segment.start || offset > segment.start + segment.length) {
          this.commit();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.commit();
      }),
    ];
  }

  async partial(text: string): Promise<void> {
    const segment = this.segment ?? this.begin();
    if (!segment) {
      return;
    }
    const newText = formatPartial(text, this.linePrefix(segment));
    await this.replace(segment, newText, false);
    this.decorate(segment);
  }

  async final(text: string): Promise<void> {
    const segment = this.segment ?? this.begin();
    if (!segment) {
      // No editor: type the text into whatever has focus (e.g. a chat or commit input box).
      const typed = formatFinal(text, {
        target: "prompt",
        linePrefix: "",
        firstLine: false,
        applyVocabulary: this.applyVocabulary,
      });
      if (typed) {
        await vscode.commands.executeCommand("type", { text: typed });
      }
      return;
    }
    const { document } = segment.editor;
    const position = document.positionAt(segment.start);
    const linePrefix = this.linePrefix(segment);
    const newText = formatFinal(text, {
      target: detectTarget({
        languageId: document.languageId,
        uriScheme: document.uri.scheme,
        fileName: document.fileName,
        linePrefix,
      }),
      linePrefix,
      firstLine: position.line === 0,
      applyVocabulary: this.applyVocabulary,
    });
    await this.replace(segment, newText, true);
    // The next segment continues right after this one.
    this.segment = {
      editor: segment.editor,
      start: segment.start + newText.length,
      length: 0,
      fresh: true,
    };
    segment.editor.setDecorations(this.decoration, []);
  }

  finish(): Promise<void> {
    this.commit();
    return Promise.resolve();
  }

  dispose(): void {
    this.commit();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Leaves pending text in place as committed text. */
  private commit(): void {
    this.segment?.editor.setDecorations(this.decoration, []);
    this.segment = undefined;
  }

  /** Starts a segment at the cursor, replacing the selection if there is one. */
  private begin(): Segment | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    const { document, selection } = editor;
    const start = document.offsetAt(selection.start);
    this.segment = { editor, start, length: document.offsetAt(selection.end) - start, fresh: true };
    return this.segment;
  }

  private readonly applyVocabulary = (text: string) => this.vocabulary?.apply(text) ?? text;

  private linePrefix(segment: Segment): string {
    const position = segment.editor.document.positionAt(segment.start);
    return segment.editor.document.lineAt(position.line).text.slice(0, position.character);
  }

  /** Replaces the segment's text. Edits of one segment form a single undo step (RS-5). */
  private async replace(segment: Segment, text: string, last: boolean): Promise<void> {
    const { editor } = segment;
    const { document } = editor;
    const range = new vscode.Range(
      document.positionAt(segment.start),
      document.positionAt(segment.start + segment.length),
    );
    if (document.getText(range) === text && !last) {
      return;
    }
    this.applying = true;
    try {
      const applied = await editor.edit(
        (builder) => {
          builder.replace(range, text);
        },
        { undoStopBefore: segment.fresh, undoStopAfter: last },
      );
      if (!applied) {
        this.commit();
        return;
      }
      this.ownVersion = document.version;
      segment.fresh = false;
      segment.length = text.length;
      const end = document.positionAt(segment.start + text.length);
      editor.selection = new vscode.Selection(end, end);
    } finally {
      this.applying = false;
    }
  }

  private decorate(segment: Segment): void {
    const { document } = segment.editor;
    segment.editor.setDecorations(this.decoration, [
      new vscode.Range(
        document.positionAt(segment.start),
        document.positionAt(segment.start + segment.length),
      ),
    ]);
  }
}
