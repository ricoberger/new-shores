// Orthographic camera at a fixed azimuth (45°) and elevation (30°): pan by
// moving the target on the ground plane, zoom by changing the ortho extent.
// The island and archipelago views use the same rig with their own bounds
// and zoom range; view switches animate target and extent.
import { Camera } from "@babylonjs/core/Cameras/camera";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

const AZIMUTH = Math.PI / 4;
const ELEVATION = Math.PI / 6;
const DISTANCE = 400;
export const ISLAND_MIN_HALF_HEIGHT = 4;
export const ISLAND_MAX_HALF_HEIGHT = 40;
export const ISLAND_DEFAULT_HALF_HEIGHT = 18;
const MARGIN = 6;

/** Camera target (ground plane) and vertical half extent. */
export interface CameraState {
  x: number;
  z: number;
  half: number;
}

/** Ground-plane rectangle the target is clamped to. */
export interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Animation {
  from: CameraState;
  to: CameraState;
  startMs: number;
  durationMs: number;
  done: () => void;
}

/**
 * Vertical half extent at which a ground rectangle of w × h tiles fits the
 * viewport (with 10 % margin) under the fixed iso projection.
 */
export function fitHalfHeight(w: number, h: number, aspect: number): number {
  const across = (w + h) / Math.SQRT2; // screen width of the rectangle
  const tall = across * Math.sin(ELEVATION); // screen height of the rectangle
  return Math.max(tall / 2, across / 2 / Math.max(0.1, aspect)) * 1.1;
}

export class CameraRig {
  readonly camera: TargetCamera;
  private target = new Vector3(0, 0, 0);
  private halfHeight = ISLAND_DEFAULT_HALF_HEIGHT;
  private bounds: CameraBounds = { minX: -MARGIN, maxX: MARGIN, minZ: -MARGIN, maxZ: MARGIN };
  private minHalf = ISLAND_MIN_HALF_HEIGHT;
  private maxHalf = ISLAND_MAX_HALF_HEIGHT;
  private readonly offset: Vector3;
  private anim: Animation | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly engine: AbstractEngine,
  ) {
    this.offset = new Vector3(
      -Math.cos(ELEVATION) * Math.sin(AZIMUTH),
      Math.sin(ELEVATION),
      -Math.cos(ELEVATION) * Math.cos(AZIMUTH),
    ).scale(DISTANCE);
    this.camera = new TargetCamera("camera", this.offset.clone(), scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = DISTANCE * 3;
    this.update();
  }

  /** Island size in tiles; the target is clamped to it plus a margin. */
  setBounds(width: number, height: number, centre: boolean): void {
    this.setLimits({ minX: -MARGIN, maxX: width + MARGIN, minZ: -(height + MARGIN), maxZ: MARGIN }, ISLAND_MIN_HALF_HEIGHT, ISLAND_MAX_HALF_HEIGHT);
    if (centre) this.target.set(width / 2, 0, -height / 2);
    this.update();
  }

  /** Target bounds and zoom range (vertical half extents). */
  setLimits(bounds: CameraBounds, minHalf: number, maxHalf: number): void {
    this.bounds = bounds;
    this.minHalf = minHalf;
    this.maxHalf = Math.max(minHalf, maxHalf);
    this.update();
  }

  aspect(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
  }

  state(): CameraState {
    return { x: this.target.x, z: this.target.z, half: this.halfHeight };
  }

  setState(s: CameraState): void {
    this.anim = null;
    this.target.set(s.x, 0, s.z);
    this.halfHeight = s.half;
    this.update();
  }

  /**
   * Moves the camera (and a running animation) by a ground offset, for a
   * scene that moves by the same offset: nothing visibly changes. The target
   * is not clamped (the bounds belong to the old coordinates); the caller
   * sets new limits or starts a transition next.
   */
  shift(dx: number, dz: number): void {
    this.target.x += dx;
    this.target.z += dz;
    if (this.anim) {
      this.anim.from = { ...this.anim.from, x: this.anim.from.x + dx, z: this.anim.from.z + dz };
      this.anim.to = { ...this.anim.to, x: this.anim.to.x + dx, z: this.anim.to.z + dz };
    }
    this.update(false);
  }

  /**
   * Animates to a state (ease in-out); `done` runs after the last frame. A
   * new animation replaces a running one from the current state (the
   * replaced one's `done` never runs).
   */
  animateTo(to: CameraState, durationMs: number, nowMs: number, done: () => void): void {
    this.anim = { from: this.state(), to, startMs: nowMs, durationMs, done };
  }

  animating(): boolean {
    return this.anim !== null;
  }

  /** Advances a running animation (called every frame). */
  tick(nowMs: number): void {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, Math.max(0, (nowMs - a.startMs) / Math.max(1, a.durationMs)));
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    this.target.set(a.from.x + (a.to.x - a.from.x) * k, 0, a.from.z + (a.to.z - a.from.z) * k);
    // Zoom interpolates in log space so that the scale change looks even.
    this.halfHeight = Math.exp(Math.log(a.from.half) + (Math.log(a.to.half) - Math.log(a.from.half)) * k);
    this.update();
    if (t >= 1) {
      this.anim = null;
      a.done();
      this.update();
    }
  }

  /** Centres the view on a world point. */
  focus(p: Vector3): void {
    if (this.anim) {
      this.anim.to = { ...this.anim.to, x: p.x, z: p.z };
      return;
    }
    this.target.set(p.x, 0, p.z);
    this.update();
  }

  /** The zoom is at the maximum extent (fully zoomed out). */
  atMaxZoom(): boolean {
    return this.halfHeight >= this.maxHalf - 1e-6;
  }

  /** Applies target and zoom to the camera; the target is clamped to the bounds unless animating or `clamp` is false. */
  update(clamp = true): void {
    if (clamp && !this.anim) {
      const b = this.bounds;
      this.target.x = Math.min(b.maxX, Math.max(b.minX, this.target.x));
      this.target.z = Math.min(b.maxZ, Math.max(b.minZ, this.target.z));
    }
    this.camera.position.copyFrom(this.target.add(this.offset));
    this.camera.setTarget(this.target);
    const aspect = this.aspect();
    this.camera.orthoTop = this.halfHeight;
    this.camera.orthoBottom = -this.halfHeight;
    this.camera.orthoLeft = -this.halfHeight * aspect;
    this.camera.orthoRight = this.halfHeight * aspect;
  }

  /** Ground point (Y = 0) under a render-pixel position, or null. */
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

  /** Zooms by a factor towards a render-pixel position. */
  zoom(factor: number, at: { x: number; y: number }): void {
    if (this.anim) return;
    const before = this.groundAt(at.x, at.y);
    this.halfHeight = Math.min(this.maxHalf, Math.max(this.minHalf, this.halfHeight * factor));
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
