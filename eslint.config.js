import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  AbortController: "readonly",
  Buffer: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
  global: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      ".claude/",
      ".git/",
      ".sheal/",
      "coverage/",
      "dist/",
      "node_modules/",
      "packages/*/dist/",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: nodeGlobals,
      sourceType: "module",
    },
    plugins: {
      "react-hooks": reactHooks,
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "off",
      "no-useless-assignment": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);
