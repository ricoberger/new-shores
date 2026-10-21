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
export const NEAR_EXIT_HALF = 26;
/** mid (or far) → near when the half extent falls below this. */
export const MID_TO_NEAR_HALF = 23;
/** near or mid → far when the half extent exceeds this. */
export const FAR_ENTER_HALF = 48;
/** far → mid (or near) when the half extent falls below this. */
export const FAR_EXIT_HALF = 42;

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
