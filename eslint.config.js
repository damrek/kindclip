import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

/** TS is already gated by svelte-check (`strict`, noUnusedLocals); ESLint adds
 * the cross-file rules the compiler does not cover. */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src-tauri/**", "odd/**", "target/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ["**/*.svelte.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    rules: {
      // svelte-check already enforces unused locals; the ESLint copy only
      // duplicates it and cannot see runes used in markup.
      "@typescript-eslint/no-unused-vars": "off",
      // The data layer receives plugin-sql rows with untyped columns and
      // narrows them explicitly at the mapper boundary.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
