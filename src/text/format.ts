// Post-processor (spec 0001, goal 3; spec 0002, RS-6): formats a segment for its target.
import type { Target } from "./context";

export interface FormatContext {
  target: Target;
  /** Text on the line before the insertion point. */
  linePrefix: string;
  /** The insertion point is on the first line of the document (a commit subject). */
  firstLine: boolean;
  /** Respells identifiers; see vocabulary.ts. */
  applyVocabulary?: (text: string) => string;
}

/** Collapses whitespace; Whisper results start with a space and may contain doubles. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A separator so the segment doesn't run into the text before it. */
export function separatorBefore(linePrefix: string): string {
  return linePrefix === "" || /[\s([{"'`]$/.test(linePrefix) ? "" : " ";
}

/** Raw partial text, shown while the user speaks; never reformatted (RS-6). */
export function formatPartial(text: string, linePrefix: string): string {
  const normalized = normalize(text);
  return normalized ? separatorBefore(linePrefix) + normalized : "";
}

/** Formats a final segment for insertion after `linePrefix`. Empty when nothing was said. */
export function formatFinal(text: string, context: FormatContext): string {
  let result = normalize(text);
  if (!result || /^[.,!?…\s-]+$/.test(result)) {
    return "";
  }
  if (startsSentence(context.linePrefix, context.target)) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  if (context.applyVocabulary) {
    result = context.applyVocabulary(result);
  }
  if (context.target === "commit" && context.firstLine) {
    // Commit subjects don't end with a period.
    result = result.replace(/\.+$/, "");
  }
  return separatorBefore(context.linePrefix) + result;
}

const COMMENT_MARKER_END = /(?:\/\/+|\/\*+|#+|--|;+|%+|<!--)$|^\s*\*$/;

function startsSentence(linePrefix: string, target: Target): boolean {
  const before = linePrefix.trimEnd();
  if (before === "" || /[.!?:]$/.test(before)) {
    return true;
  }
  return target === "comment" && COMMENT_MARKER_END.test(before);
}
