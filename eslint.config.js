// lintskill:js-ts template v0.2 — opinionated config for AI-assisted projects
// Security: strict, Style: auto-fix only, Complexity: relaxed
// Do not remove the "lintskill:js-ts template" marker — it lets future runs of
// lintskill recognize this config as managed and offer to refresh it.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  {
    rules: {
      // Security
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",

      // Correctness
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "error",
      "no-constant-condition": "warn",
      "no-unreachable": "error",

      // Style — keep lenient, don't overwhelm beginners
      "no-console": "off",
      semi: "off",
      quotes: "off",
    },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "out/",
      ".next/",
      ".turbo/",
      ".vercel/",
      ".cache/",
      "coverage/",
      ".git/",
    ],
  },
];
