import * as assert from "assert";
import {
  commentContinuation,
  detectTarget,
  isInComment,
  type InsertionContext,
} from "../text/context";
import { formatFinal, formatPartial, normalize, separatorBefore, wrap } from "../text/format";
import { parseServerMessage, describeClose } from "../whisperflow/messages";
import {
  buildPrompt,
  countIdentifiers,
  createVocabulary,
  isCompoundIdentifier,
  rankIdentifiers,
  splitIdentifier,
} from "../text/vocabulary";

const context = (overrides: Partial<InsertionContext>): InsertionContext => ({
  languageId: "typescript",
  uriScheme: "file",
  fileName: "/w/a.ts",
  linePrefix: "",
  ...overrides,
});

suite("Server messages", () => {
  test("parses transcripts (RS-1) and server errors", () => {
    assert.deepStrictEqual(
      parseServerMessage('{"is_partial":true,"data":{"text":" hi","segments":[]},"time":3}'),
      { kind: "transcript", isPartial: true, text: " hi" },
    );
    assert.deepStrictEqual(parseServerMessage('{"type":"error","message":"invalid control"}'), {
      kind: "error",
      message: "invalid control",
    });
    assert.deepStrictEqual(parseServerMessage('{"type":"error"}'), {
      kind: "error",
      message: "unknown error",
    });
  });

  test("ignores anything else", () => {
    for (const raw of [
      "nope",
      "3",
      "null",
      '{"is_partial":"yes","data":{}}',
      '{"is_partial":true}',
      '{"is_partial":true,"data":{"text":1}}',
    ]) {
      assert.strictEqual(parseServerMessage(raw), undefined, raw);
    }
  });

  test("describes close codes (ER-1, ER-2)", () => {
    assert.strictEqual(describeClose(1000, ""), undefined);
    assert.deepStrictEqual(describeClose(1008, ""), {
      message: "Invalid or missing API key",
      retry: false,
    });
    assert.deepStrictEqual(describeClose(1013, ""), {
      message: "Server is at capacity",
      retry: false,
    });
    assert.match(
      describeClose(4000, "unknown language: xx")?.message ?? "",
      /unknown language: xx/,
    );
    assert.match(describeClose(4000, "")?.message ?? "", /invalid options/);
    assert.deepStrictEqual(describeClose(1006, ""), {
      message: "Lost connection to the whisper-flow server (code 1006)",
      retry: true,
    });
    assert.match(describeClose(1011, "oops")?.message ?? "", /code 1011: oops/);
  });
});

suite("Vocabulary", () => {
  test("splits identifiers", () => {
    assert.deepStrictEqual(splitIdentifier("getHTTPServer_v2"), ["get", "http", "server", "v2"]);
    assert.deepStrictEqual(splitIdentifier("useMemo"), ["use", "memo"]);
    assert.deepStrictEqual(splitIdentifier("MAX_PROMPT_CHARS"), ["max", "prompt", "chars"]);
    assert.ok(isCompoundIdentifier("getUserById"));
    assert.ok(!isCompoundIdentifier("Promise"));
    assert.ok(!isCompoundIdentifier("x2"));
  });

  test("counts and ranks compound identifiers", () => {
    const counts = new Map<string, number>();
    countIdentifiers("const value = useMemo(() => getUserById(id)); useMemo", counts);
    countIdentifiers("getUserById", counts, 3);
    assert.deepStrictEqual(rankIdentifiers(counts), ["getUserById", "useMemo"]);
    assert.deepStrictEqual(rankIdentifiers(counts, 1), ["getUserById"]);
  });

  test("builds a prompt with the best identifiers last, within the limit", () => {
    assert.strictEqual(buildPrompt(["aaBb", "ccDd", "eeFf"]), "eeFf, ccDd, aaBb");
    assert.strictEqual(buildPrompt(["aaBb", "ccDd", "eeFf"], 10), "ccDd, aaBb");
    assert.strictEqual(buildPrompt([]), "");
  });

  test("respells spoken identifiers in text", () => {
    const vocabulary = createVocabulary(["getUserById", "useMemo", "get_user_by_id", "userBy"]);
    assert.strictEqual(vocabulary.prompt, "userBy, get_user_by_id, useMemo, getUserById");
    assert.strictEqual(
      vocabulary.apply("Wrap it in use memo and call Get user by ID, then use-memo again."),
      "Wrap it in useMemo and call getUserById, then useMemo again.",
    );
    assert.strictEqual(vocabulary.apply("reuse memory"), "reuse memory");
  });
});

suite("Context detector", () => {
  test("detects commit messages", () => {
    assert.strictEqual(detectTarget(context({ languageId: "git-commit" })), "commit");
    assert.strictEqual(detectTarget(context({ uriScheme: "vscode-scm" })), "commit");
    assert.strictEqual(
      detectTarget(context({ languageId: "plaintext", fileName: "/r/.git/COMMIT_EDITMSG" })),
      "commit",
    );
  });

  test("detects chat input as a prompt", () => {
    assert.strictEqual(
      detectTarget(context({ uriScheme: "vscode-chat-input", linePrefix: "// " })),
      "prompt",
    );
  });

  test("detects comments", () => {
    assert.strictEqual(detectTarget(context({ linePrefix: "  // " })), "comment");
    assert.strictEqual(detectTarget(context({ linePrefix: "const a = 1; // " })), "comment");
    assert.strictEqual(detectTarget(context({ linePrefix: " * " })), "comment");
    assert.strictEqual(detectTarget(context({ linePrefix: "/** " })), "comment");
    assert.strictEqual(detectTarget(context({ linePrefix: "x /* " })), "comment");
    assert.strictEqual(
      detectTarget(context({ languageId: "python", linePrefix: "x = 1  # " })),
      "comment",
    );
    assert.strictEqual(detectTarget(context({ languageId: "sql", linePrefix: "-- " })), "comment");
    assert.strictEqual(
      detectTarget(context({ languageId: "html", linePrefix: "<!-- " })),
      "comment",
    );
  });

  test("ignores comment markers inside strings and unknown languages", () => {
    assert.strictEqual(detectTarget(context({ linePrefix: 'const url = "http://' })), "prompt");
    assert.strictEqual(detectTarget(context({ linePrefix: "const s = 'it\\'s // " })), "prompt");
    assert.strictEqual(detectTarget(context({ linePrefix: "const s = `# " })), "prompt");
    assert.strictEqual(detectTarget(context({ linePrefix: "a * b" })), "prompt");
    assert.ok(!isInComment("plaintext", "// hi"));
    assert.ok(!isInComment("markdown", "# Title"));
  });
});

suite("Post-processor", () => {
  test("normalizes and separates", () => {
    assert.strictEqual(normalize("  hello   world \n"), "hello world");
    assert.strictEqual(separatorBefore(""), "");
    assert.strictEqual(separatorBefore("x "), "");
    assert.strictEqual(separatorBefore("foo("), "");
    assert.strictEqual(separatorBefore("word"), " ");
  });

  test("partials are raw text (RS-6)", () => {
    assert.strictEqual(formatPartial(" call use memo", "x"), " call use memo");
    assert.strictEqual(formatPartial("  ", "x"), "");
  });

  test("formats comments", () => {
    const comment = { target: "comment" as const, firstLine: false };
    assert.strictEqual(
      formatFinal(" fix the cache", { ...comment, linePrefix: "// " }),
      "Fix the cache",
    );
    assert.strictEqual(
      formatFinal(" fix the cache", { ...comment, linePrefix: "//" }),
      " Fix the cache",
    );
    assert.strictEqual(formatFinal(" fix it", { ...comment, linePrefix: " * " }), "Fix it");
    assert.strictEqual(
      formatFinal(" and more", { ...comment, linePrefix: "// Some text" }),
      " and more",
    );
    assert.strictEqual(formatFinal(" next.", { ...comment, linePrefix: "// Done. " }), "Next.");
  });

  test("formats commit subjects without a trailing period", () => {
    assert.strictEqual(
      formatFinal(" add retry to the client.", {
        target: "commit",
        linePrefix: "",
        firstLine: true,
      }),
      "Add retry to the client",
    );
    assert.strictEqual(
      formatFinal(" it retries twice.", { target: "commit", linePrefix: "", firstLine: false }),
      "It retries twice.",
    );
  });

  test("applies the vocabulary after capitalization", () => {
    const vocabulary = createVocabulary(["useMemo"]);
    assert.strictEqual(
      formatFinal(" use memo here.", {
        target: "prompt",
        linePrefix: "",
        firstLine: false,
        applyVocabulary: vocabulary.apply,
      }),
      "useMemo here.",
    );
  });

  test("drops empty and punctuation-only results", () => {
    for (const text of ["", "  ", " .", "...", " - "]) {
      assert.strictEqual(
        formatFinal(text, { target: "prompt", linePrefix: "", firstLine: false }),
        "",
        JSON.stringify(text),
      );
    }
  });
});

suite("Wrapping", () => {
  test("continues comments with their marker and indent", () => {
    assert.strictEqual(commentContinuation("typescript", "  // "), "  // ");
    assert.strictEqual(commentContinuation("typescript", "  const a = 1; // "), "  // ");
    assert.strictEqual(commentContinuation("typescript", "  /** "), "   * ");
    assert.strictEqual(commentContinuation("typescript", "   * "), "   * ");
    assert.strictEqual(commentContinuation("typescript", "x /* "), " * ");
    assert.strictEqual(commentContinuation("python", "    # "), "    # ");
    assert.strictEqual(commentContinuation("html", "  <!-- "), "  ");
    assert.strictEqual(commentContinuation("typescript", "const a = 1;"), undefined);
  });

  test("wraps at the column with the continuation", () => {
    assert.strictEqual(
      wrap("Fix the cache before the release", "// ", 20, "// "),
      "Fix the cache\n// before the\n// release",
    );
    assert.strictEqual(
      wrap(" and then retry it", "  // Some text", 20, "  // ", "\r\n"),
      " and\r\n  // then retry it",
    );
  });

  test("never leaves a comment marker alone on its line", () => {
    assert.strictEqual(
      wrap("averyveryverylongword next", "// ", 10, "// "),
      "averyveryverylongword\n// next",
    );
    assert.strictEqual(wrap("averylongword", "", 5, ""), "averylongword");
  });

  test("breaks after code before a trailing comment", () => {
    assert.strictEqual(wrap("explain it", "const a = 1; // ", 18, "// "), "\n// explain it");
  });

  test("is off at width 0 and keeps empty text", () => {
    assert.strictEqual(wrap(" a b c", "x", 0, ""), " a b c");
    assert.strictEqual(wrap("", "x", 10, ""), "");
  });
});
