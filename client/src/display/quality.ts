// Render quality (ART_DIRECTION §2 and §8), a pure function of the layout
// mode: the desktop layout renders the sun shadow map, warm grading and
// FXAA ("high"); touch layouts — phones and tablets, devices of unknown
// GPU class — render blob shadows and the vignette only ("low"). The
// ?quality=high|low URL parameter overrides it (tests and comparisons).
import type { LayoutMode } from "./layout";

export type Quality = "high" | "low";

/** The quality a layout mode selects. */
export function qualityFor(mode: LayoutMode): Quality {
  return mode === "desktop" ? "high" : "low";
}

/** The quality named by a location.search string (?quality=high|low), or null. */
export function qualityOverride(search: string): Quality | null {
  const q = new URLSearchParams(search).get("quality");
  return q === "high" || q === "low" ? q : null;
}

/**
 * Whether a WebGL renderer string names a software rasteriser
 * (SwiftShader, llvmpipe, …): there a full-screen FXAA pass costs more
 * than a whole frame, so "high" goes without it (edges stay aliased).
 */
export function softwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
}

/** The quality in force: the URL override, else the layout's. */
export function resolveQuality(mode: LayoutMode, search: string): Quality {
  return qualityOverride(search) ?? qualityFor(mode);
}
