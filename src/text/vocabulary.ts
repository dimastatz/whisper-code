// Workspace-aware vocabulary (spec 0001, goal 2): collects identifiers, builds the Whisper
// prompt, and respells spoken identifiers ("use memo" → "useMemo") in final text.

const IDENTIFIER = /\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g;

/** Whisper's initial_prompt limit in whisper-flow (WF_MAX_PROMPT_CHARS default). */
export const MAX_PROMPT_CHARS = 800;

/** Splits `getHTTPServer_v2` into ["get", "http", "server", "v2"]. */
export function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_$]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

/**
 * Identifiers worth biasing toward: made of two or more words (camelCase, PascalCase,
 * snake_case). Single words are already spelled well by Whisper.
 */
export function isCompoundIdentifier(identifier: string): boolean {
  return splitIdentifier(identifier).filter((part) => /[a-z]/.test(part)).length >= 2;
}

/** Adds the compound identifiers in `text` to `counts`, weighted by `weight`. */
export function countIdentifiers(text: string, counts: Map<string, number>, weight = 1): void {
  for (const match of text.matchAll(IDENTIFIER)) {
    const identifier = match[0];
    if (isCompoundIdentifier(identifier)) {
      counts.set(identifier, (counts.get(identifier) ?? 0) + weight);
    }
  }
}

/** Most frequent first; ties keep first-seen order. */
export function rankIdentifiers(counts: Map<string, number>, limit = 500): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([identifier]) => identifier);
}

/**
 * The vocabulary prompt sent in whisper-flow's `start` frame. Whisper keeps only the end of a
 * long prompt, so the highest-ranked identifiers go last.
 */
export function buildPrompt(ranked: string[], maxChars = MAX_PROMPT_CHARS): string {
  const kept: string[] = [];
  let length = 0;
  for (const identifier of ranked) {
    const added = identifier.length + (kept.length ? 2 : 0);
    if (length + added > maxChars) {
      break;
    }
    kept.push(identifier);
    length += added;
  }
  return kept.reverse().join(", ");
}

export interface Vocabulary {
  readonly identifiers: readonly string[];
  readonly prompt: string;
  /** Replaces spoken forms of known identifiers with their exact spelling. */
  readonly apply: (text: string) => string;
}

export function createVocabulary(ranked: string[]): Vocabulary {
  // One spelling per word sequence (the best-ranked one), longest sequences first so
  // "get user by id" wins over "user by".
  const byWords = new Map<string, string>();
  for (const identifier of ranked) {
    const key = splitIdentifier(identifier).join(" ");
    if (!byWords.has(key)) {
      byWords.set(key, identifier);
    }
  }
  const patterns = [...byWords.entries()]
    .sort((a, b) => b[0].split(" ").length - a[0].split(" ").length)
    .map(([words, identifier]) => ({
      regex: new RegExp(
        `(?<![\\w$])${words.split(" ").map(escapeRegExp).join("[\\s_-]*")}(?![\\w$])`,
        "gi",
      ),
      identifier,
    }));

  return {
    identifiers: ranked,
    prompt: buildPrompt(ranked),
    apply(text: string) {
      let result = text;
      for (const { regex, identifier } of patterns) {
        result = result.replace(regex, identifier);
      }
      return result;
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
