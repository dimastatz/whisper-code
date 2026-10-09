import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  // A small workspace for the vocabulary scan; tests otherwise use untitled documents.
  workspaceFolder: "test-fixtures/workspace",
});
