// Symbol index (spec 0001, goal 2): collects identifiers from the open workspace.
import * as vscode from "vscode";
import {
  countIdentifiers,
  createVocabulary,
  rankIdentifiers,
  type Vocabulary,
} from "../text/vocabulary";

const MAX_DOCUMENT_CHARS = 1_000_000;
const SYMBOL_TIMEOUT_MS = 1500;

/**
 * Ranks identifiers from the active editor (highest weight), its document symbols, other
 * visible editors and other open documents.
 */
export async function collectWorkspaceVocabulary(): Promise<Vocabulary> {
  const counts = new Map<string, number>();
  const active = vscode.window.activeTextEditor?.document;
  const visible = new Set(vscode.window.visibleTextEditors.map((editor) => editor.document));

  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme === "output" || document.getText().length > MAX_DOCUMENT_CHARS) {
      continue;
    }
    const weight = document === active ? 3 : visible.has(document) ? 2 : 1;
    countIdentifiers(document.getText(), counts, weight);
  }

  if (active) {
    for (const name of await documentSymbolNames(active.uri)) {
      countIdentifiers(name, counts, 5);
    }
  }
  return createVocabulary(rankIdentifiers(counts));
}

async function documentSymbolNames(uri: vscode.Uri): Promise<string[]> {
  const symbols = await withTimeout(
    vscode.commands.executeCommand<
      (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
    >("vscode.executeDocumentSymbolProvider", uri),
    SYMBOL_TIMEOUT_MS,
  ).catch(() => undefined);
  const names: string[] = [];
  const visit = (items: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]) => {
    for (const item of items) {
      names.push(item.name);
      if ("children" in item) {
        visit(item.children);
      }
    }
  };
  visit(symbols ?? []);
  return names;
}

function withTimeout<T>(promise: Thenable<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<undefined>((resolve) =>
      setTimeout(() => {
        resolve(undefined);
      }, ms),
    ),
  ]);
}
