import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "coverage/**", ".vscode-test/**", "test-fixtures/**", "**/*.mjs"] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      curly: "error",
      eqeqeq: "error",
      "no-throw-literal": "error",
    },
  },
);
