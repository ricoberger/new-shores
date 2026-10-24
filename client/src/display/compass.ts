// Minimap compass (D-051 part 6, UI only): the camera's heading on the
// north-up minimap. The needle points where the camera looks (its
// azimuth as a compass bearing: 0° north, 90° east); the default heading
// (rotation 0) looks north-east. Pure helpers; the Compass component
// draws with them and turns the camera by drags.
import { azimuthOf } from "./camera";
import type { ArchPoint } from "./ships";

/** Movement (CSS px) after which a press on the compass is a drag (turn), not a tap (default heading). */
export const COMPASS_DRAG_PX = 4;

const POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"] as const;

/** Bearing (degrees, 0–360, clockwise from north) the camera looks at a rotation (quarter turns). */
export function headingDegrees(rotation: number): number {
  const d = (azimuthOf(rotation) * 180) / Math.PI;
  const n = ((d % 360) + 360) % 360;
  return Math.abs(n - 360) < 1e-9 ? 0 : n;
}

/** The nearest of the eight compass points to a rotation's bearing ("north-east" at the default heading). */
export function headingName(rotation: number): (typeof POINTS)[number] {
  return POINTS[Math.round(headingDegrees(rotation) / 45) % 8] as (typeof POINTS)[number];
}

/** Screen angle (radians, clockwise from up, y down) of a point about a centre. */
export function pointerAngle(centre: ArchPoint, p: ArchPoint): number {
  return Math.atan2(p.x - centre.x, -(p.y - centre.y));
}

/** Signed angle difference (radians) normalised to (−π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Quarter turns of the camera for a drag on the compass by `radians` (clockwise positive: the needle follows the pointer). */
export function compassTurn(radians: number): number {
  return radians / (Math.PI / 2);
}
