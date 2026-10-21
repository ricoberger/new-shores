// Screen layout of the HUD (UI only): a pure function of the viewport size
// and the primary pointer, so that the breakpoints are testable. The React
// layer re-evaluates it on resize and orientation changes.

export type LayoutMode = "desktop" | "tablet" | "phone-portrait" | "phone-landscape";

/** Widest phone in portrait (CSS px). */
export const PHONE_PORTRAIT_MAX_WIDTH = 480;
/** Landscape phones: at most this wide and this tall. */
export const PHONE_LANDSCAPE_MAX_WIDTH = 900;
export const PHONE_LANDSCAPE_MAX_HEIGHT = 500;
/** A landscape phone at least this wide shows panels at the side instead of bottom sheets. */
export const SIDE_PANEL_MIN_WIDTH = 640;

/**
 * phone-portrait: ≤ 480 wide and taller than wide; phone-landscape: ≤ 900
 * wide and ≤ 500 tall; tablet: a coarse (touch) pointer otherwise (the
 * desktop layout plus touch affordances); desktop: everything else.
 */
export function layoutMode(width: number, height: number, coarsePointer: boolean): LayoutMode {
  if (width <= PHONE_PORTRAIT_MAX_WIDTH && height > width) return "phone-portrait";
  if (width <= PHONE_LANDSCAPE_MAX_WIDTH && height <= PHONE_LANDSCAPE_MAX_HEIGHT) return "phone-landscape";
  return coarsePointer ? "tablet" : "desktop";
}

/** Touch layouts get the placement bar, the demolish bar and ≥ 44 px targets. */
export function isTouchLayout(mode: LayoutMode): boolean {
  return mode !== "desktop";
}

/** Phone layouts compact the top bar and the build menu. */
export function isPhoneLayout(mode: LayoutMode): boolean {
  return mode === "phone-portrait" || mode === "phone-landscape";
}

/** Side panels become bottom sheets on portrait phones and on landscape phones narrower than 640 px. */
export function usesSheets(mode: LayoutMode, width: number): boolean {
  return mode === "phone-portrait" || (mode === "phone-landscape" && width < SIDE_PANEL_MIN_WIDTH);
}

export type SheetSnap = "peek" | "half" | "full";

/** Sheet heights as fractions of the area below the top bar (peek shows the header only). */
export const SHEET_SNAPS: Readonly<Record<SheetSnap, number>> = { peek: 0.2, half: 0.5, full: 0.9 };
/** Released this far below the peek height, a dragged sheet closes. */
export const SHEET_CLOSE_MARGIN = 0.06;

/** The snap point nearest to a released sheet height (fraction), or "closed" below peek. */
export function snapFor(fraction: number): SheetSnap | "closed" {
  if (!Number.isFinite(fraction) || fraction < SHEET_SNAPS.peek - SHEET_CLOSE_MARGIN) return "closed";
  let best: SheetSnap = "peek";
  for (const s of ["peek", "half", "full"] as const) {
    if (Math.abs(SHEET_SNAPS[s] - fraction) < Math.abs(SHEET_SNAPS[best] - fraction)) best = s;
  }
  return best;
}

/** Next snap point when the handle is activated without dragging (keyboard or tap). */
export function nextSnap(s: SheetSnap): SheetSnap {
  return s === "peek" ? "half" : s === "half" ? "full" : "peek";
}

/** A landscape side panel should keep at least this height (CSS px). */
export const LANDSCAPE_PANEL_MIN_PX = 240;
/**
 * Heights (CSS px, measured at 851 × 393 including margins) of the
 * landscape chrome: the top bar, the one-row build bar (always shown in
 * the continuous world), the insolvency banner (at most two lines, a 44 px target) and the hint bar.
 */
export const LANDSCAPE_TOP_PX = 73;
export const LANDSCAPE_BUILD_BAR_PX = 55;
export const LANDSCAPE_BANNER_PX = 50;
export const LANDSCAPE_HINT_PX = 30;

export interface LandscapeChrome {
  mode: LayoutMode;
  /** Panels are bottom sheets (narrow landscape phones). */
  sheets: boolean;
  /** A side panel is open. */
  panelOpen: boolean;
  /** Viewport height (CSS px). */
  height: number;
  banner: boolean;
  hint: boolean;
}

/**
 * Landscape phones with a side panel open: true when the panel would be
 * shorter than LANDSCAPE_PANEL_MIN_PX with the hint bar and the
 * insolvency banner shown; the HUD then hides the hint and keeps the
 * banner to one line.
 */
export function collapseLandscapeChrome(c: LandscapeChrome): boolean {
  if (c.mode !== "phone-landscape" || c.sheets || !c.panelOpen || (!c.banner && !c.hint)) return false;
  const panel =
    c.height -
    LANDSCAPE_TOP_PX -
    LANDSCAPE_BUILD_BAR_PX -
    (c.banner ? LANDSCAPE_BANNER_PX : 0) -
    (c.hint ? LANDSCAPE_HINT_PX : 0);
  return panel < LANDSCAPE_PANEL_MIN_PX;
}
