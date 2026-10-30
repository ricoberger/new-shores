import { afterEach, describe, expect, it } from "vitest";
import type { ErrorCode } from "../api/client";
import type { components } from "../api/schema";
import { de } from "./de";
import { en } from "./en";
import { currentLanguage, format, inSentence, resolveLanguage, setLanguage, t, tOr, tRich, type MessageKey } from "./index";

afterEach(() => setLanguage("en", false));

describe("catalogue", () => {
  it("has a German text for every English key and no other keys", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("never leaves a German text empty or identical to a longer English sentence", () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(de[key].trim(), key).not.toBe("");
      if (en[key].length > 40) expect(de[key], key).not.toBe(en[key]);
    }
  });

  it("uses the same placeholders in both languages", () => {
    const names = (s: string) => [...s.matchAll(/(?<!one|other|zero|two|few|many)\{(\w+)(?:,|\})/g)].map((m) => (m[1] ?? "").toLowerCase()).sort();
    for (const key of Object.keys(en) as MessageKey[]) {
      // German may leave a parameter out (a plural noun it does not need) but never invent one;
      // {Name} next to {name} is the capitalised noun (the caller passes both).
      const english = new Set(names(en[key]));
      for (const name of names(de[key])) expect(english.has(name), `${key}: {${name}}`).toBe(true);
    }
  });

  it("has a text for every API error code and need reason", () => {
    // Compile-time: a code added to the OpenAPI enum without a key fails the type check.
    type MissingError = Exclude<`error.${ErrorCode}`, MessageKey>;
    type Reason = components["schemas"]["NeedDisplay"]["reason"];
    type MissingReason = Exclude<Reason extends "ok" ? never : `reason.${Reason}`, MessageKey>;
    const none: [MissingError, MissingReason] extends [never, never] ? true : never = true;
    expect(none).toBe(true);
  });
});

describe("t", () => {
  it("fills placeholders and chooses plural forms", () => {
    expect(format("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
    expect(format("{count} {count, one{ship} other{ships}}", { count: 1 })).toBe("1 ship");
    expect(format("{count} {count, one{ship} other{ships}}", { count: 2 })).toBe("2 ships");
    expect(format("{count} {count, one{Schiff} other{Schiffe}}", { count: 0 }, "de")).toBe("0 Schiffe");
    expect(format("{missing}", {})).toBe("{missing}");
  });

  it("follows the current language and falls back for unknown keys", () => {
    expect(t("common.close")).toBe("Close");
    setLanguage("de", false);
    expect(currentLanguage()).toBe("de");
    expect(t("common.close")).toBe("Schließen");
    expect(tOr("nope.nothing", "fallback")).toBe("fallback");
    expect(inSentence("Food")).toBe("Food");
    setLanguage("en", false);
    expect(inSentence("Food")).toBe("food");
  });

  it("puts elements into placeholders", () => {
    const parts = tRich("shipPanel.noRoutes", { link: "LINK" });
    expect(parts).toHaveLength(3);
  });
});

describe("resolveLanguage", () => {
  it("prefers ?lang=, then the stored choice, then the browser, then English", () => {
    expect(resolveLanguage({ search: "?lang=de", stored: "en", browser: ["en"] })).toBe("de");
    expect(resolveLanguage({ stored: "de", browser: ["en"] })).toBe("de");
    expect(resolveLanguage({ browser: ["fr-FR", "de-AT", "en"] })).toBe("de");
    expect(resolveLanguage({ browser: ["fr"] })).toBe("en");
    expect(resolveLanguage({ search: "?lang=xx", stored: "yy" })).toBe("en");
    expect(resolveLanguage({})).toBe("en");
  });
});
