import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { LanguageSwitch } from "./LanguageSwitch";
import { StartScreen } from "./StartScreen";

afterEach(() => setLanguage("en", false));

describe("language switch (D-061)", () => {
  it("names each language in itself and marks the current one", () => {
    const html = renderToStaticMarkup(createElement(LanguageSwitch));
    expect(html).toContain('aria-label="Language"');
    expect(html).toMatch(/<button[^>]*lang="en"[^>]*aria-pressed="true"[^>]*>English</);
    expect(html).toMatch(/<button[^>]*lang="de"[^>]*aria-pressed="false"[^>]*>Deutsch</);
  });

  it("follows the current language", () => {
    setLanguage("de", false);
    const html = renderToStaticMarkup(createElement(LanguageSwitch));
    expect(html).toContain('aria-label="Sprache"');
    expect(html).toMatch(/lang="de"[^>]*aria-pressed="true"/);
  });

  it("is on the start screen, in the user's language", () => {
    setLanguage("de", false);
    const html = renderToStaticMarkup(createElement(StartScreen, { onPlayer: () => undefined }));
    expect(html).toContain('data-testid="language-switch"');
    expect(html).toContain("Als Gast spielen");
  });
});
