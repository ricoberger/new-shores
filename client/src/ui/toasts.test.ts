import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { unlockText } from "../display/tiers";
import { TOAST_MS, toastDuration, Toasts, UNLOCK_TOAST_MS } from "./Toasts";

afterEach(() => setLanguage("en", false));

const render = () =>
  renderToStaticMarkup(
    createElement(Toasts, {
      toasts: [
        { id: 1, text: "Save failed", kind: undefined },
        { id: 2, text: unlockText("Citizens", 15), kind: "unlock" },
      ],
      onDismiss: () => {},
    }),
  );

describe("tier unlock toasts (D-056)", () => {
  it("draws an unlock as a titled brass slip (a status, not an alert) beside the plain notices", () => {
    const html = render();
    const [notice, unlock] = html.split('data-testid="toast"').slice(1);
    expect(html).toMatch(/role="alert"[^>]*data-testid="toast"/);
    expect(notice).not.toContain("New tier");
    expect(html).toMatch(/class="[^"]*toastUnlock[^"]*" role="status" data-testid="toast" data-kind="unlock"/);
    expect(unlock).toContain("<svg");
    expect(unlock).toContain("New tier");
    expect(unlock).toContain("Citizens unlocked — 15 new buildings");
  });

  it("speaks German", () => {
    setLanguage("de", false);
    const html = render();
    expect(html).toContain("Neue Stufe");
    expect(html).toContain("Citizens freigeschaltet – 15 neue Gebäude");
  });

  it("stays twice as long as a notice", () => {
    expect(toastDuration(undefined)).toBe(TOAST_MS);
    expect(toastDuration("unlock")).toBe(UNLOCK_TOAST_MS);
    expect(UNLOCK_TOAST_MS).toBe(2 * TOAST_MS);
  });
});
