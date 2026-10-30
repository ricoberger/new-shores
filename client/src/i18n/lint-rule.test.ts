import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import rule from "../../eslint/no-hardcoded-strings.js";

Object.assign(RuleTester, { afterAll, describe, it });

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-hardcoded-strings", rule, {
  valid: [
    'const a = t("common.close");',
    "const a = tOr(`x.${k}`, fb);",
    '<button className="primary big" data-testid="close-button" aria-hidden="true">{t("common.close")}</button>',
    'const x = { kind: "paused" }; if (x.kind === "paused") {}',
    'switch (k) { case "a b": break; }',
    'import x from "some thing";',
    'throw new Error("internal failure");',
    'const s = `rotate(${a}deg)`; const u = "10px";',
    '// i18n-ignore: the game name\nconst name = "New Shores";',
    'const n = "New Shores"; // i18n-ignore: title',
  ],
  invalid: [
    { code: "const x = <b>Save</b>;", errors: 1 },
    { code: 'const x = "Save game";', errors: 1 },
    { code: "const x = `${n} gold`;", errors: 1 },
    { code: 'const x = <input placeholder="search" />;', errors: 1 },
    { code: 'const x = <button title="Close" aria-label={"Close"} />;', errors: 2 },
    { code: 'const x = cond ? "Yes please" : "No";', errors: 2 },
  ],
});
