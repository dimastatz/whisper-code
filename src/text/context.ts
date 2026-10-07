// Context detector (spec 0001, goal 3): decides what the user is dictating into.

export type Target = "comment" | "commit" | "prompt";

export interface InsertionContext {
  languageId: string;
  uriScheme: string;
  fileName: string;
  /** Text on the current line before the cursor. */
  linePrefix: string;
}

const LINE_COMMENT: Record<string, string[]> = {
  "//": [
    "c",
    "cpp",
    "csharp",
    "java",
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
    "go",
    "rust",
    "swift",
    "kotlin",
    "scala",
    "dart",
    "php",
    "jsonc",
    "groovy",
    "objective-c",
    "objective-cpp",
    "fsharp",
    "zig",
    "proto3",
    "vue",
    "svelte",
  ],
  "#": [
    "python",
    "ruby",
    "shellscript",
    "perl",
    "r",
    "yaml",
    "toml",
    "dockerfile",
    "makefile",
    "powershell",
    "elixir",
    "coffeescript",
    "julia",
    "nim",
    "properties",
    "cmake",
    "terraform",
  ],
  "--": ["sql", "lua", "haskell", "elm", "ada"],
  ";": ["clojure", "lisp", "scheme", "ini", "asm"],
  "%": ["latex", "tex", "erlang", "matlab"],
};

const BLOCK_COMMENT_LANGUAGES = new Set([...(LINE_COMMENT["//"] ?? []), "css", "scss", "less"]);

/** Chat input boxes (Copilot Chat and similar) use these URI schemes. */
const CHAT_SCHEMES = ["vscode-chat", "chatSessionInput", "comment"];

export function detectTarget(context: InsertionContext): Target {
  if (
    context.languageId === "git-commit" ||
    context.uriScheme === "vscode-scm" ||
    /(^|[\\/])(COMMIT_EDITMSG|MERGE_MSG|TAG_EDITMSG)$/.test(context.fileName)
  ) {
    return "commit";
  }
  if (CHAT_SCHEMES.some((scheme) => context.uriScheme.startsWith(scheme))) {
    return "prompt";
  }
  if (isInComment(context.languageId, context.linePrefix)) {
    return "comment";
  }
  return "prompt";
}

/** True when the cursor at the end of `linePrefix` is inside a comment. */
export function isInComment(languageId: string, linePrefix: string): boolean {
  if (BLOCK_COMMENT_LANGUAGES.has(languageId) && /^\s*(\/\*\*?|\*)(\s|$)/.test(linePrefix)) {
    return true;
  }
  const markers = Object.entries(LINE_COMMENT)
    .filter(([, languages]) => languages.includes(languageId))
    .map(([marker]) => marker);
  if (BLOCK_COMMENT_LANGUAGES.has(languageId)) {
    markers.push("/*");
  }
  if (languageId === "html" || languageId === "xml" || languageId === "markdown") {
    markers.push("<!--");
  }
  return markers.length > 0 && findOutsideStrings(linePrefix, markers);
}

/** Finds any marker that isn't inside a '...', "..." or `...` string literal. */
function findOutsideStrings(text: string, markers: string[]): boolean {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (markers.some((marker) => text.startsWith(marker, i))) {
      return true;
    }
  }
  return false;
}
