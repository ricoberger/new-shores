// Camera math of the continuous world (D-048), framework-free: the fixed
// elevation, the free azimuth (D-051: continuous, snapping to 45°), the
// zoom range, target clamping and
// the camera's ground footprint (the viewport corners on the ground plane).
// Scene coordinates are archipelago coordinates: archipelago tile (x, y)
// is world (x, 0, −y). The Babylon rig (render/camera.ts) uses these
// helpers; the minimap and the island culling use the footprint.
import { FAR_ENTER_HALF } from "./lod";
import type { ArchPoint } from "./ships";

/** The smallest maximum zoom: 10 % past the far-LOD threshold. */
export const FAR_REACH_HALF = FAR_ENTER_HALF * 1.1;

/** Elevation of the camera above the ground plane (30°). */
export const ELEVATION = Math.PI / 6;
/** Azimuth of rotation 0 (45°, the iso view of PR #10): the default heading ("north" of the compass). */
export const BASE_AZIMUTH = Math.PI / 4;
/** Rotation is measured in quarter turns (90°); a full turn is this many. */
export const ROTATION_STEPS = 4;
/** Rotations snap to multiples of this (quarter turns): 45° (D-051). */
export const ROTATION_SNAP = 0.5;
/** Longest ease (ms) of the camera to the nearest 45° after a free rotation, and of a Q/E step. */
export const ROTATION_EASE_MS = 250;

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

/**
 * Camera target (archipelago tiles), vertical half extent and rotation in
 * quarter turns, continuous in [0, 4): 0 is the default heading (azimuth
 * 45°), 0.5 one 45° step, 2 the opposite view.
 */
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

/** Tolerance (quarter turns) within which a rotation counts as on a 45° step. */
const SNAP_EPS = 1e-6;

/** Rotation normalised to [0, 4) (values within SNAP_EPS of a 45° step land exactly on it). */
export function normRotation(r: number): number {
  if (!Number.isFinite(r)) return 0;
  const snapped = Math.round(r / ROTATION_SNAP) * ROTATION_SNAP;
  const v = Math.abs(r - snapped) < SNAP_EPS ? snapped : r;
  const n = ((v % ROTATION_STEPS) + ROTATION_STEPS) % ROTATION_STEPS;
  return n >= ROTATION_STEPS - SNAP_EPS / 2 ? 0 : n;
}

/** The nearest 45° step of a rotation (normalised). */
export function snapRotation(r: number): number {
  return normRotation(Math.round(r / ROTATION_SNAP) * ROTATION_SNAP);
}

/** Whether a rotation lies on a 45° step. */
export function isSnapped(r: number): boolean {
  return Math.abs(r / ROTATION_SNAP - Math.round(r / ROTATION_SNAP)) < SNAP_EPS / ROTATION_SNAP;
}

/** Signed shortest difference to - from (quarter turns, in (−2, 2]). */
export function rotationDelta(from: number, to: number): number {
  let d = (to - from) % ROTATION_STEPS;
  if (d > ROTATION_STEPS / 2) d -= ROTATION_STEPS;
  if (d <= -ROTATION_STEPS / 2) d += ROTATION_STEPS;
  return d;
}

/** Azimuth (radians) of a rotation: 45° at 0, +90° per quarter turn, continuous. */
export function azimuthOf(r: number): number {
  return BASE_AZIMUTH + normRotation(r) * (Math.PI / 2);
}

/**
 * Vertical half extent at which a ground rectangle of w × h tiles fits the
 * viewport (with 10 % margin) at every azimuth: the rectangle's screen
 * width w·|cos a| + h·|sin a| is at most its diagonal, so the zoom range
 * does not change while the camera turns (at the 45° diagonal headings of
 * a square it is exact).
 */
export function fitHalfHeight(w: number, h: number, aspect: number): number {
  const across = Math.hypot(w, h); // widest screen extent of the rectangle over all azimuths
  const tall = across * Math.sin(ELEVATION); // tallest screen extent
  return Math.max(tall / 2, across / 2 / Math.max(0.1, aspect)) * 1.1;
}

/**
 * Zoom range: the minimum is fixed, the maximum fits the whole archipelago
 * (the near default without islands) up to the region's cap
 * (`region.camera.max_half_extent`, null while the content loads), never
 * below FAR_REACH_HALF (a small world can still be zoomed out to its
 * far-LOD overview, and a cap below it is lifted to it). A large
 * archipelago is overviewed on the minimap.
 */
export function zoomRange(bounds: Rect | null, aspect: number, cap: number | null = null): { min: number; max: number } {
  if (!bounds) return { min: MIN_HALF_HEIGHT, max: NEAR_DEFAULT_HALF_HEIGHT };
  const fit = fitHalfHeight(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, aspect);
  const capped = cap !== null && Number.isFinite(cap) && cap > 0 ? Math.min(fit, cap) : fit;
  return { min: MIN_HALF_HEIGHT, max: Math.max(NEAR_DEFAULT_HALF_HEIGHT, FAR_REACH_HALF, capped) };
}

/** The archipelago's bounding box of the display (D-053), null while it has no extent. */
export function archipelagoRect(a: { bounds: { x: number; y: number; width: number; height: number } } | undefined): Rect | null {
  if (!a || a.bounds.width <= 0 || a.bounds.height <= 0) return null;
  const b = a.bounds;
  return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
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

/** A camera view with the target inside the target bounds, the zoom inside the range (with the region's cap) and the rotation normalised. */
export function clampView(v: CameraView, bounds: Rect | null, aspect: number, cap: number | null = null): CameraView {
  const r = zoomRange(bounds, aspect, cap);
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
 * The camera for founding on an island (D-058 round 4): null — keep the
 * camera — when the island's rectangle lies wholly in view below the far
 * zoom; else a view centred on the island, at the current rotation, at
 * the half extent that fits the rectangle (10 % margin) so that the player
 * can pick a coast and zoom in to place.
 */
export function frameIslandView(v: CameraView, aspect: number, rect: Rect): CameraView | null {
  const { right, up } = screenAxes(v.rotation);
  const k = 1 / Math.sin(ELEVATION);
  // Screen offsets (ortho units: u across, w up) of a ground point from a centre.
  const screen = (p: ArchPoint, c: ArchPoint) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { u: dx * right.x + dy * right.y, w: (dx * up.x + dy * up.y) / (k * k) };
  };
  const corners: ArchPoint[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  const inView = corners.every((p) => {
    const s = screen(p, v);
    return Math.abs(s.u) <= v.half * aspect && Math.abs(s.w) <= v.half;
  });
  if (inView && v.half < FAR_ENTER_HALF) return null;
  const c = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  let half = 0;
  for (const p of corners) {
    const s = screen(p, c);
    half = Math.max(half, Math.abs(s.u) / aspect, Math.abs(s.w));
  }
  return { x: c.x, y: c.y, half: Math.max(MIN_HALF_HEIGHT, half * 1.1), rotation: v.rotation };
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
 * zoom at the default heading: its diagonal extent across the screen, 2√2
 * tiles for a 2 × 2 building (the widest it gets at any azimuth).
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
export function seaMargin(bounds: Rect | null, aspect: number, cap: number | null = null): number {
  const max = zoomRange(bounds, aspect, cap).max;
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
