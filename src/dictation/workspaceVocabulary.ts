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

const SOURCE_FILES =
  "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,kts,cs,c,cc,cpp,h,hpp,rb,php,swift,scala,vue,svelte,dart,sql,sh,lua,ex,exs}";
const EXCLUDED_DIRS =
  "**/{node_modules,.git,out,dist,build,coverage,.venv,venv,__pycache__,target,vendor,.next}/**";
const MAX_FILE_BYTES = 200_000;
/** Scanning stops after this long; what was read so far is used. */
const SCAN_BUDGET_MS = 2000;
const CACHE_TTL_MS = 60_000;

export interface VocabularyOptions {
  /** Also read source files that aren't open (up to `maxFiles`). */
  scanWorkspace: boolean;
  maxFiles: number;
}

let cache: { key: string; at: number; counts: Map<string, number> } | undefined;

/** Forgets the scanned workspace files, e.g. after a test changed them. */
export function clearVocabularyCache(): void {
  cache = undefined;
}

/**
 * Identifier counts from source files in the workspace folders, cached for a minute so that
 * starting dictation repeatedly doesn't rescan.
 */
export async function scanWorkspaceFiles(maxFiles: number): Promise<Map<string, number>> {
  const key = `${String(maxFiles)}:${(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()).join(",")}`;
  if (cache?.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.counts;
  }
  const counts = new Map<string, number>();
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const decoder = new TextDecoder();
  const files = await vscode.workspace.findFiles(SOURCE_FILES, EXCLUDED_DIRS, maxFiles);
  for (const file of files) {
    if (Date.now() > deadline) {
      break;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(file);
      if (bytes.byteLength <= MAX_FILE_BYTES) {
        countIdentifiers(decoder.decode(bytes), counts);
      }
    } catch {
      // Deleted or unreadable since findFiles; skip it.
    }
  }
  cache = { key, at: Date.now(), counts };
  return counts;
}

/**
 * Ranks identifiers from the active editor (highest weight), its document symbols, other
 * visible editors, other open documents and, optionally, the workspace's source files.
 */
export async function collectWorkspaceVocabulary(
  options: VocabularyOptions = { scanWorkspace: false, maxFiles: 0 },
): Promise<Vocabulary> {
  const counts = new Map<string, number>(
    options.scanWorkspace && options.maxFiles > 0 ? await scanWorkspaceFiles(options.maxFiles) : [],
  );
  const active = vscode.window.activeTextEditor?.document;
  const visible = new Set(vscode.window.visibleTextEditors.map((editor) => editor.document));

  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme === "output" || document.getText().length > MAX_DOCUMENT_CHARS) {
      continue;
    }
    const weight = document === active ? 4 : visible.has(document) ? 3 : 2;
    countIdentifiers(document.getText(), counts, weight);
  }

  if (active) {
    for (const name of await documentSymbolNames(active.uri)) {
      countIdentifiers(name, counts, 6);
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
