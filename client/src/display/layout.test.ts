import { describe, expect, it } from "vitest";
import {
  collapseLandscapeChrome,
  isTouchLayout,
  type LandscapeChrome,
  layoutMode,
  nextSnap,
  SHEET_CLOSE_MARGIN,
  SHEET_SNAPS,
  snapFor,
  usesSheets,
} from "./layout";

describe("layoutMode", () => {
  it.each([
    // [width, height, coarse, expected]
    [360, 640, true, "phone-portrait"],
    [360, 640, false, "phone-portrait"],
    [412, 915, true, "phone-portrait"],
    [480, 800, true, "phone-portrait"],
    [481, 800, true, "tablet"],
    [481, 800, false, "desktop"],
    [640, 360, true, "phone-landscape"],
    [851, 393, true, "phone-landscape"],
    [900, 500, true, "phone-landscape"],
    [900, 500, false, "phone-landscape"],
    [901, 500, true, "tablet"],
    [900, 501, false, "desktop"],
    [915, 412, true, "tablet"],
    [915, 412, false, "desktop"],
    [1024, 768, true, "tablet"],
    [1024, 768, false, "desktop"],
    [1280, 800, false, "desktop"],
    [1280, 800, true, "tablet"],
  ] as const)("%i × %i coarse=%s → %s", (w, h, coarse, expected) => {
    expect(layoutMode(w, h, coarse)).toBe(expected);
  });

  it("a square phone-sized viewport is landscape (not taller than wide)", () => {
    expect(layoutMode(480, 480, true)).toBe("phone-landscape");
  });

  it("touch affordances on every layout but the desktop", () => {
    expect(isTouchLayout("desktop")).toBe(false);
    expect(isTouchLayout("tablet")).toBe(true);
    expect(isTouchLayout("phone-portrait")).toBe(true);
  });

  it("bottom sheets on portrait phones and narrow landscape phones only", () => {
    expect(usesSheets("phone-portrait", 360)).toBe(true);
    expect(usesSheets("phone-landscape", 639)).toBe(true);
    expect(usesSheets("phone-landscape", 640)).toBe(false);
    expect(usesSheets("tablet", 1024)).toBe(false);
    expect(usesSheets("desktop", 1280)).toBe(false);
  });
});

describe("sheet snap points", () => {
  it("snaps to the nearest point", () => {
    expect(snapFor(SHEET_SNAPS.peek)).toBe("peek");
    expect(snapFor(0.3)).toBe("peek");
    expect(snapFor(0.36)).toBe("half");
    expect(snapFor(0.5)).toBe("half");
    expect(snapFor(0.69)).toBe("half");
    expect(snapFor(0.71)).toBe("full");
    expect(snapFor(1)).toBe("full");
  });

  it("closes below peek (with a margin)", () => {
    expect(snapFor(SHEET_SNAPS.peek - SHEET_CLOSE_MARGIN + 0.001)).toBe("peek");
    expect(snapFor(SHEET_SNAPS.peek - SHEET_CLOSE_MARGIN - 0.001)).toBe("closed");
    expect(snapFor(0)).toBe("closed");
    expect(snapFor(Number.NaN)).toBe("closed");
  });

  it("the handle cycles peek → half → full → peek", () => {
    expect(nextSnap("peek")).toBe("half");
    expect(nextSnap("half")).toBe("full");
    expect(nextSnap("full")).toBe("peek");
  });
});

describe("landscape chrome collapse", () => {
  // Archipelago view (no build bar) with the banner and the hint: 73 + 50 + 30 = 153 px of chrome.
  const base: LandscapeChrome = { mode: "phone-landscape", sheets: false, panelOpen: true, height: 393, buildBar: false, banner: true, hint: true };

  it("collapses when the side panel would be shorter than 240 px", () => {
    expect(collapseLandscapeChrome(base)).toBe(false); // 393 − 153 = 240
    expect(collapseLandscapeChrome({ ...base, height: 392 })).toBe(true);
    expect(collapseLandscapeChrome({ ...base, height: 360 })).toBe(true);
    // Island view: the build bar takes 55 px more.
    expect(collapseLandscapeChrome({ ...base, buildBar: true })).toBe(true);
    expect(collapseLandscapeChrome({ ...base, buildBar: true, height: 448 })).toBe(false);
  });

  it("counts only the chrome that is shown", () => {
    expect(collapseLandscapeChrome({ ...base, height: 340, banner: false })).toBe(true); // 340 − 73 − 30 = 237
    expect(collapseLandscapeChrome({ ...base, height: 343, banner: false })).toBe(false);
    expect(collapseLandscapeChrome({ ...base, height: 300, banner: false, hint: false })).toBe(false); // nothing to collapse
  });

  it("never collapses without a side panel or outside landscape phones", () => {
    const tight = { ...base, height: 360 };
    expect(collapseLandscapeChrome({ ...tight, panelOpen: false })).toBe(false);
    expect(collapseLandscapeChrome({ ...tight, sheets: true })).toBe(false);
    expect(collapseLandscapeChrome({ ...tight, mode: "phone-portrait" })).toBe(false);
    expect(collapseLandscapeChrome({ ...tight, mode: "tablet" })).toBe(false);
  });
});
