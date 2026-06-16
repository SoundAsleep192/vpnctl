import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "scripts/gen-tray-icons.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      // Fake `Exec` implementations satisfy an async interface without needing `await`,
      // and bun:test's `expect(...).rejects.toThrow(...)` isn't typed as a Promise in bun-types.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
    },
  },
  eslintConfigPrettier,
);
