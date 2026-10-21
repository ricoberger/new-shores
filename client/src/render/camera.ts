// Orthographic camera of the continuous world (D-048): fixed elevation
// (30°), four azimuth steps of 90° starting at 45°, pan by moving the
// target on the ground plane, continuous zoom by changing the ortho
// extent. Scene coordinates are archipelago coordinates (tile (x, y) is
// world (x, 0, −y)); the target is clamped to the archipelago bounds plus
// a margin and the zoom to the range of display/camera.ts. Jumps animate
// target and extent with an ease-in-out.
import { Camera } from "@babylonjs/core/Cameras/camera";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import {
  azimuthOf,
  type CameraView,
  clampView,
  ELEVATION,
  groundFootprint,
  NEAR_DEFAULT_HALF_HEIGHT,
  normRotation,
  type Rect,
  zoomRange,
} from "../display/camera";
import type { ArchPoint } from "../display/ships";

const DISTANCE = 400;

interface Animation {
  from: { x: number; y: number; half: number };
  to: { x: number; y: number; half: number };
  startMs: number;
  durationMs: number;
}

/** Ease in-out (quadratic) of t in 0..1. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export class CameraRig {
  readonly camera: TargetCamera;
  /** Target in world coordinates (y = 0). */
  private readonly target = new Vector3(0, 0, 0);
  private halfHeight = NEAR_DEFAULT_HALF_HEIGHT;
  private rotation = 0;
  private bounds: Rect | null = null;
  private readonly offset = new Vector3();
  private anim: Animation | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly engine: AbstractEngine,
  ) {
    this.camera = new TargetCamera("camera", new Vector3(0, DISTANCE, 0), scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = DISTANCE * 3;
    this.setOffset();
    this.update();
  }

  private setOffset(): void {
    const a = azimuthOf(this.rotation);
    this.offset.set(-Math.cos(ELEVATION) * Math.sin(a), Math.sin(ELEVATION), -Math.cos(ELEVATION) * Math.cos(a)).scaleInPlace(DISTANCE);
  }

  /** Bounding box of the islands (archipelago tiles): target bounds and the maximum zoom follow it. */
  setIslandBounds(b: Rect | null): void {
    this.bounds = b;
    this.update();
  }

  aspect(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
  }

  /** Zoom range (vertical half extents) for the current bounds and aspect. */
  zoomRange(): { min: number; max: number } {
    return zoomRange(this.bounds, this.aspect());
  }

  /** Target (archipelago tiles), zoom and rotation step. */
  view(): CameraView {
    return { x: this.target.x, y: -this.target.z, half: this.halfHeight, rotation: this.rotation };
  }

  /** Sets (parts of) the view at once, clamped like user input; stops a running animation. */
  setCamera(v: Partial<CameraView>): void {
    this.anim = null;
    const cur = this.view();
    const next = clampView({ ...cur, ...v }, this.bounds, this.aspect());
    this.target.set(next.x, 0, -next.y);
    this.halfHeight = next.half;
    if (next.rotation !== this.rotation) {
      this.rotation = next.rotation;
      this.setOffset();
    }
    this.update();
  }

  /** Turns the camera by 90° steps about the target (positive: azimuth +90°, the camera orbits clockwise seen from above). */
  rotate(steps: number): void {
    const r = normRotation(this.rotation + steps);
    if (r === this.rotation) return;
    this.rotation = r;
    this.setOffset();
    this.update(false);
  }

  /**
   * Animates target and zoom to a view (ease in-out, zoom in log space).
   * A new animation replaces a running one from the current state. The
   * destination is clamped first.
   */
  animateTo(to: { x: number; y: number; half: number }, durationMs: number, nowMs: number): void {
    const dest = clampView({ ...to, rotation: this.rotation }, this.bounds, this.aspect());
    this.anim = { from: { x: this.target.x, y: -this.target.z, half: this.halfHeight }, to: { x: dest.x, y: dest.y, half: dest.half }, startMs: nowMs, durationMs };
  }

  animating(): boolean {
    return this.anim !== null;
  }

  /** Advances a running animation (called every frame). */
  tick(nowMs: number): void {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, Math.max(0, (nowMs - a.startMs) / Math.max(1, a.durationMs)));
    const k = easeInOut(t);
    this.target.set(a.from.x + (a.to.x - a.from.x) * k, 0, -(a.from.y + (a.to.y - a.from.y) * k));
    this.halfHeight = Math.exp(Math.log(a.from.half) + (Math.log(a.to.half) - Math.log(a.from.half)) * k);
    if (t >= 1) this.anim = null;
    this.update();
  }

  /** Applies target, rotation and zoom to the camera; the target and zoom are clamped unless animating or `clamp` is false. */
  update(clamp = true): void {
    if (clamp && !this.anim) {
      const v = clampView(this.view(), this.bounds, this.aspect());
      this.target.set(v.x, 0, -v.y);
      this.halfHeight = v.half;
    }
    this.camera.position.set(this.target.x + this.offset.x, this.offset.y, this.target.z + this.offset.z);
    this.camera.setTarget(this.target);
    const aspect = this.aspect();
    this.camera.orthoTop = this.halfHeight;
    this.camera.orthoBottom = -this.halfHeight;
    this.camera.orthoLeft = -this.halfHeight * aspect;
    this.camera.orthoRight = this.halfHeight * aspect;
  }

  /** The viewport corners on the ground (archipelago tiles; top-left, top-right, bottom-right, bottom-left). */
  footprint(): [ArchPoint, ArchPoint, ArchPoint, ArchPoint] {
    return groundFootprint(this.view(), this.aspect());
  }

  /** Ground point (Y = 0, world coordinates) under a render-pixel position, or null. */
  groundAt(px: number, py: number): Vector3 | null {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    this.scene.updateTransformMatrix();
    const view = this.camera.getViewMatrix();
    const proj = this.camera.getProjectionMatrix();
    const near = Vector3.Unproject(new Vector3(px, py, 0), w, h, Matrix.IdentityReadOnly, view, proj);
    const far = Vector3.Unproject(new Vector3(px, py, 1), w, h, Matrix.IdentityReadOnly, view, proj);
    const dy = far.y - near.y;
    if (Math.abs(dy) < 1e-9) return null;
    const t = -near.y / dy;
    return near.add(far.subtract(near).scale(t));
  }

  /** Moves the target so that the ground point under `from` ends under `to`. */
  pan(from: { x: number; y: number }, to: { x: number; y: number }): void {
    if (this.anim) return;
    const a = this.groundAt(from.x, from.y);
    const b = this.groundAt(to.x, to.y);
    if (!a || !b) return;
    this.target.addInPlace(a.subtract(b));
    this.update();
  }

  /** Zooms by a factor towards a render-pixel position (the ground point under it stays). */
  zoom(factor: number, at: { x: number; y: number }): void {
    if (this.anim) return;
    const before = this.groundAt(at.x, at.y);
    const r = this.zoomRange();
    this.halfHeight = Math.min(r.max, Math.max(r.min, this.halfHeight * factor));
    this.update();
    const after = this.groundAt(at.x, at.y);
    if (before && after) {
      this.target.addInPlace(before.subtract(after));
      this.update();
    }
  }

  /** Render-pixel position of a world point. */
  project(p: Vector3): Vector3 {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    this.scene.updateTransformMatrix();
    return Vector3.Project(p, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(w, h));
  }
}
