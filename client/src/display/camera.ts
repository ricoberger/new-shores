// Camera math of the continuous world (D-048), framework-free: the fixed
// elevation, the four azimuth steps, the zoom range, target clamping and
// the camera's ground footprint (the viewport corners on the ground plane).
// Scene coordinates are archipelago coordinates: archipelago tile (x, y)
// is world (x, 0, −y). The Babylon rig (render/camera.ts) uses these
// helpers; the minimap and the island culling use the footprint.
import type { ArchPoint } from "./ships";

/** Elevation of the camera above the ground plane (30°). */
export const ELEVATION = Math.PI / 6;
/** Azimuth of rotation step 0 (45°, the iso view of PR #10). */
export const BASE_AZIMUTH = Math.PI / 4;
/** Number of 90° rotation steps. */
export const ROTATION_STEPS = 4;

/**
 * Smallest vertical ortho half extent (most zoomed in): a 2 × 2 building
 * footprint (2√2 tiles wide on screen in every rotation) spans 2√2 × 640
 * / (2 × 7) ≈ 129 px = 36 % of the 360 px short side of a 360 × 640 phone
 * ("one house ≈ ⅓ of a phone screen").
 */
export const MIN_HALF_HEIGHT = 7;
/** Default zoom near an island (the near-LOD default of jumps and the first frame). */
export const NEAR_DEFAULT_HALF_HEIGHT = 18;
/** Margin (tiles) around the islands' bounding box the camera target may reach. */
export const BOUNDS_MARGIN = 30;
/** Duration of camera jumps (tabs, island card, Enter, founding, warnings, minimap). */
export const JUMP_MS = 350;

/** Camera target (archipelago tiles), vertical half extent and rotation step 0–3. */
export interface CameraView {
  x: number;
  y: number;
  half: number;
  rotation: number;
}

/** Axis-aligned rectangle in archipelago tiles. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Rotation step normalised to 0–3. */
export function normRotation(step: number): number {
  return ((Math.round(step) % ROTATION_STEPS) + ROTATION_STEPS) % ROTATION_STEPS;
}

/** Azimuth (radians) of a rotation step: 45°, 135°, 225°, 315°. */
export function azimuthOf(step: number): number {
  return BASE_AZIMUTH + normRotation(step) * (Math.PI / 2);
}

/**
 * Vertical half extent at which a ground rectangle of w × h tiles fits the
 * viewport (with 10 % margin). The same in all four rotations (every step
 * is a 45° diagonal view).
 */
export function fitHalfHeight(w: number, h: number, aspect: number): number {
  const across = (w + h) / Math.SQRT2; // screen width of the rectangle
  const tall = across * Math.sin(ELEVATION); // screen height of the rectangle
  return Math.max(tall / 2, across / 2 / Math.max(0.1, aspect)) * 1.1;
}

/** Zoom range: the minimum is fixed, the maximum fits the whole archipelago (never below the minimum or the near default). */
export function zoomRange(bounds: Rect | null, aspect: number): { min: number; max: number } {
  const fit = bounds ? fitHalfHeight(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, aspect) : NEAR_DEFAULT_HALF_HEIGHT;
  return { min: MIN_HALF_HEIGHT, max: Math.max(NEAR_DEFAULT_HALF_HEIGHT, fit) };
}

/** The rectangle the camera target is clamped to: the bounds plus BOUNDS_MARGIN. */
export function targetBounds(bounds: Rect): Rect {
  return {
    minX: bounds.minX - BOUNDS_MARGIN,
    minY: bounds.minY - BOUNDS_MARGIN,
    maxX: bounds.maxX + BOUNDS_MARGIN,
    maxY: bounds.maxY + BOUNDS_MARGIN,
  };
}

/** A camera view with the target inside the target bounds, the zoom inside the range and the rotation normalised. */
export function clampView(v: CameraView, bounds: Rect | null, aspect: number): CameraView {
  const r = zoomRange(bounds, aspect);
  const half = Math.min(r.max, Math.max(r.min, Number.isFinite(v.half) ? v.half : NEAR_DEFAULT_HALF_HEIGHT));
  if (!bounds) return { x: v.x, y: v.y, half, rotation: normRotation(v.rotation) };
  const t = targetBounds(bounds);
  return {
    x: Math.min(t.maxX, Math.max(t.minX, v.x)),
    y: Math.min(t.maxY, Math.max(t.minY, v.y)),
    half,
    rotation: normRotation(v.rotation),
  };
}

/**
 * Screen axes on the ground: a step of one ortho unit to the right of the
 * screen moves the ground point by `right`, one unit up the screen by `up`
 * (archipelago tiles). Derived from the orthographic camera at the
 * rotation's azimuth and ELEVATION looking at the target: screen up tilts
 * into the ground, so it stretches by 1 / sin(ELEVATION).
 */
export function screenAxes(rotation: number): { right: ArchPoint; up: ArchPoint } {
  const a = azimuthOf(rotation);
  const k = 1 / Math.sin(ELEVATION);
  // World right = (cos a, 0, −sin a), world up-on-ground = (sin a, 0, cos a) / sin E; archipelago y = −world z.
  return { right: { x: Math.cos(a), y: Math.sin(a) }, up: { x: Math.sin(a) * k, y: -Math.cos(a) * k } };
}

/**
 * Ground point under a viewport position given in normalised device
 * coordinates (nx, ny in −1..1, ny up).
 */
export function groundAtNdc(v: CameraView, aspect: number, nx: number, ny: number): ArchPoint {
  const { right, up } = screenAxes(v.rotation);
  const u = nx * v.half * aspect;
  const w = ny * v.half;
  return { x: v.x + u * right.x + w * up.x, y: v.y + u * right.y + w * up.y };
}

/**
 * The camera's ground footprint: the four viewport corners unprojected to
 * the ground plane (top-left, top-right, bottom-right, bottom-left), a
 * parallelogram that turns with the rotation.
 */
export function groundFootprint(v: CameraView, aspect: number): [ArchPoint, ArchPoint, ArchPoint, ArchPoint] {
  return [groundAtNdc(v, aspect, -1, 1), groundAtNdc(v, aspect, 1, 1), groundAtNdc(v, aspect, 1, -1), groundAtNdc(v, aspect, -1, -1)];
}

/**
 * Screen width (fraction of the viewport width) of a w × h footprint at a
 * zoom: its diagonal extent across the screen, 2√2 tiles for a 2 × 2
 * building in every rotation.
 */
export function footprintScreenFraction(w: number, h: number, half: number, aspect: number): number {
  return (w + h) / Math.SQRT2 / (2 * half * aspect);
}

/**
 * Margin (tiles) of the sea around the islands' bounding box such that no
 * background shows at any clamped target at the maximum zoom in any
 * rotation: the target's margin plus the farthest viewport corner's ground
 * distance from the target (half × √(aspect² + 1/sin² ELEVATION)), plus a
 * little more.
 */
export function seaMargin(bounds: Rect | null, aspect: number): number {
  const max = zoomRange(bounds, aspect).max;
  return BOUNDS_MARGIN + max * Math.hypot(aspect, 1 / Math.sin(ELEVATION)) + 10;
}

/** Smallest distance of the camera from its target along the view direction (tiles). */
export const CAMERA_MIN_DISTANCE = 400;
/** Room (tiles) between the clip planes and the nearest / farthest ground point in view. */
const CLIP_MARGIN = 100;

/**
 * Camera distance and clip planes for a zoom: the ground in view lies at
 * depths distance ± half · cot(ELEVATION) (the viewport's top and bottom
 * edges), so the camera moves back and the far plane out as the view
 * grows; anything above the ground is nearer than the ground under it.
 * Orthographic: the distance changes no projected position.
 */
export function cameraClip(half: number): { distance: number; near: number; far: number } {
  const reach = half / Math.tan(ELEVATION);
  const distance = Math.max(CAMERA_MIN_DISTANCE, reach + CLIP_MARGIN);
  return { distance, near: 1, far: distance + reach + CLIP_MARGIN };
}
