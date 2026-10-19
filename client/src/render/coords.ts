// Tile <-> world mapping: tile (x, y) covers world X in [x, x+1] and
// Z in [-(y+1), -y] on the ground plane Y = 0, so that tile rows run
// "down" the screen. Footprints come from the content and the rotation.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { rotatedFootprint } from "../display/geometry";

export function tileCenter(x: number, y: number, height = 0): Vector3 {
  return new Vector3(x + 0.5, height, -(y + 0.5));
}

/** World tile of a ground point. */
export function worldToTile(p: Vector3): { x: number; y: number } {
  return { x: Math.floor(p.x), y: Math.floor(-p.z) };
}

/** Centre and rotated size of a footprint placed at (x, y). */
export function footprintBox(x: number, y: number, width: number, height: number, rotation: number) {
  const [w, h] = rotatedFootprint(width, height, rotation);
  return { cx: x + w / 2, cz: -(y + h / 2), w, h };
}
