import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import noHardcodedStrings from "./eslint/no-hardcoded-strings.js";

export default tseslint.config(
  { ignores: ["dist", "test-results", "src/api/schema.d.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^(mousedown|mouseup|mousemove|touchstart|touchmove|touchend)$/]",
          message: "Use pointer events (pointerdown/move/up) only.",
        },
      ],
    },
  },
  {
    // D-061: player-facing text lives in the catalogue (src/i18n), not in components.
    // Escape a justified exception with `// i18n-ignore: <why>`.
    files: ["src/ui/**/*.{ts,tsx}", "src/almanac/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { i18n: { rules: { "no-hardcoded-strings": noHardcodedStrings } } },
    rules: { "i18n/no-hardcoded-strings": "error" },
  },
);
