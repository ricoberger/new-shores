// Zoom-based level of detail of the continuous world (D-048), a pure
// function of the camera's orthographic size (vertical half extent, in
// tiles) and the previous level — no viewport size, no clock, no
// debounce. One level applies to every island at a time.
//
// Each boundary has an enter and a leave threshold ≥ 10 % apart
// (hysteresis): zooming out past NEAR_EXIT switches near → mid, but mid
// only returns to near below MID_TO_NEAR; the same for mid ↔ far. A zoom
// oscillating inside a band therefore never flips the level back and
// forth.

export type Lod = "near" | "mid" | "far";

/** near → mid when the half extent exceeds this. */
export const NEAR_EXIT_HALF = 30;
/** mid (or far) → near when the half extent falls below this. */
export const MID_TO_NEAR_HALF = 27;
/**
 * near or mid → far when the half extent exceeds this: the full models stay
 * until a 2 × 2 footprint is about 12 px tall on a 412 × 915 phone. Its
 * ground diagonal (2√2 tiles) projects to 2√2 · sin 30° ≈ 1.41 ortho units,
 * the screen shows 2 × half of them in 915 CSS px: 1.41 · 915 / (2 · 54)
 * ≈ 12.0 px (10.5 px at 1280 × 800). The maximum zoom never stays below
 * 1.1 × this (display/camera.ts FAR_REACH_HALF), so a small world still has
 * its far-LOD overview. Was 48 / 42 with the block stand-ins.
 */
export const FAR_ENTER_HALF = 54;
/** far → mid (or near) when the half extent falls below this (54 / 47 ≈ 1.15: hysteresis). */
export const FAR_EXIT_HALF = 47;

/** The level at a half extent with no previous level (first frame, a jump). */
export function initialLod(half: number): Lod {
  return lodFor(half, "near");
}

/** The level at a half extent, given the level of the previous frame. */
export function lodFor(half: number, prev: Lod): Lod {
  switch (prev) {
    case "near":
      if (half > FAR_ENTER_HALF) return "far";
      return half > NEAR_EXIT_HALF ? "mid" : "near";
    case "mid":
      if (half > FAR_ENTER_HALF) return "far";
      return half < MID_TO_NEAR_HALF ? "near" : "mid";
    case "far":
      if (half < MID_TO_NEAR_HALF) return "near";
      return half < FAR_EXIT_HALF ? "mid" : "far";
  }
}

/**
 * Model detail per level (art restyle): the full kit-bashed models at near
 * and mid LOD, the lite ones (≈ 25 % of the triangles, covering the same
 * footprint) at far LOD. Both are built once per island and only toggled
 * at the mid/far boundary, so a zoom never rebuilds geometry.
 */
export function detailForLod(lod: Lod): "full" | "lite" {
  return lod === "far" ? "lite" : "full";
}
