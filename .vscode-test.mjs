import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  tests: [
    {
      files: "out/test/**/*.test.js",
      // A small workspace for the vocabulary scan; tests otherwise use untitled documents.
      workspaceFolder: "test-fixtures/workspace",
    },
  ],
  coverage: {
    // Measure the extension, not the tests and their fakes, and count source files that no
    // test loads, so the 95% gate can't be met by test code or by skipping a module.
    exclude: ["**/test/**"],
    includeAll: true,
  },
});
