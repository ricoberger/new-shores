// Orthographic camera at a fixed azimuth (45°) and elevation (30°): pan by
// moving the target on the ground plane, zoom by changing the ortho extent.
import { Camera } from "@babylonjs/core/Cameras/camera";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

const AZIMUTH = Math.PI / 4;
const ELEVATION = Math.PI / 6;
const DISTANCE = 200;
const MIN_HALF_HEIGHT = 4;
const MAX_HALF_HEIGHT = 40;
const MARGIN = 6;

export class CameraRig {
  readonly camera: TargetCamera;
  private target = new Vector3(0, 0, 0);
  private halfHeight = 18;
  private bounds = { width: 0, height: 0 };
  private readonly offset: Vector3;

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
    this.bounds = { width, height };
    if (centre) this.target.set(width / 2, 0, -height / 2);
    this.update();
  }

  /** Centres the view on a world point. */
  focus(p: Vector3): void {
    this.target.set(p.x, 0, p.z);
    this.update();
  }

  update(): void {
    const { width, height } = this.bounds;
    this.target.x = Math.min(width + MARGIN, Math.max(-MARGIN, this.target.x));
    this.target.z = Math.min(MARGIN, Math.max(-(height + MARGIN), this.target.z));
    this.camera.position.copyFrom(this.target.add(this.offset));
    this.camera.setTarget(this.target);
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
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
    const a = this.groundAt(from.x, from.y);
    const b = this.groundAt(to.x, to.y);
    if (!a || !b) return;
    this.target.addInPlace(a.subtract(b));
    this.update();
  }

  /** Zooms by a factor towards a render-pixel position. */
  zoom(factor: number, at: { x: number; y: number }): void {
    const before = this.groundAt(at.x, at.y);
    this.halfHeight = Math.min(MAX_HALF_HEIGHT, Math.max(MIN_HALF_HEIGHT, this.halfHeight * factor));
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
