// Merged static decoration meshes: flat-shaded, vertex-coloured
// triangles accumulated from small templates (trees, ground scatter,
// field decoration) and uploaded as one mesh — one draw call per layer
// and no thin instances, which software renderers pay per instance (the
// phone perf budget, see shadows.ts).
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export type Vec3 = readonly [number, number, number];

/** A template triangle (model space, y up) with its colour. */
export interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  color: Color3;
}

/** Accumulates triangles (flat normals per face) and vertex colours. */
export class TriBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];

  /** Adds a template triangle scaled by s, turned by yaw about y and moved to (x, y, z). */
  add(t: Tri, x: number, y: number, z: number, s: number, yaw: number, shade = 1, alpha = 1): void {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const p = (v: Vec3): [number, number, number] => [x + (v[0] * cos + v[2] * sin) * s, y + v[1] * s, z + (-v[0] * sin + v[2] * cos) * s];
    const a = p(t.a);
    const b = p(t.b);
    const c = p(t.c);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Outward from the template's vertical axis (side faces), else upward
    // (flat faces of the double-sided decoration are seen from above).
    const cx = (a[0] + b[0] + c[0]) / 3 - x;
    const cz = (a[2] + b[2] + c[2]) / 3 - z;
    const radial = nx * cx + nz * cz;
    if (Math.abs(radial) > 1e-6 * s ? radial < 0 : ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const v of [a, b, c]) {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(nx, ny, nz);
      this.colors.push(t.color.r * shade, t.color.g * shade, t.color.b * shade, alpha);
    }
  }

  /** Adds a raw triangle in final coordinates with an explicit normal and per-vertex alpha. */
  raw(a: Vec3, b: Vec3, c: Vec3, color: Color3, alphas: Vec3, normal: Vec3 = [0, 1, 0]): void {
    [a, b, c].forEach((v, i) => {
      this.positions.push(v[0], v[1], v[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color.r, color.g, color.b, alphas[i] as number);
    });
  }

  get triangles(): number {
    return this.positions.length / 9;
  }

  /** The mesh of the accumulated triangles (null when empty). */
  build(name: string, scene: Scene, material: StandardMaterial, parent: TransformNode | null, vertexAlpha = false): Mesh | null {
    if (this.positions.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.normals = this.normals;
    data.colors = this.colors;
    data.indices = Array.from({ length: this.positions.length / 3 }, (_, i) => i);
    data.applyToMesh(mesh);
    mesh.hasVertexAlpha = vertexAlpha;
    mesh.material = material;
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    return mesh;
  }
}

/** Triangles of a prism with n sides from y0 to y1 (radius r, no caps). */
export function prism(n: number, r: number, y0: number, y1: number, color: Color3, phase = 0): Tri[] {
  const out: Tri[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = phase + (i / n) * Math.PI * 2;
    const a1 = phase + ((i + 1) / n) * Math.PI * 2;
    const p0: Vec3 = [Math.cos(a0) * r, y0, Math.sin(a0) * r];
    const p1: Vec3 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
    const q0: Vec3 = [Math.cos(a0) * r, y1, Math.sin(a0) * r];
    const q1: Vec3 = [Math.cos(a1) * r, y1, Math.sin(a1) * r];
    out.push({ a: p0, b: q0, c: p1, color }, { a: p1, b: q0, c: q1, color });
  }
  return out;
}

/** Triangles of a cone with n sides: base radius r at y0, apex at y1 (no base cap). */
export function cone(n: number, r: number, y0: number, y1: number, color: Color3, phase = 0, apexShade = 1): Tri[] {
  const out: Tri[] = [];
  const top = color.scale(apexShade);
  for (let i = 0; i < n; i++) {
    const a0 = phase + (i / n) * Math.PI * 2;
    const a1 = phase + ((i + 1) / n) * Math.PI * 2;
    out.push({ a: [Math.cos(a0) * r, y0, Math.sin(a0) * r], b: [0, y1, 0], c: [Math.cos(a1) * r, y0, Math.sin(a1) * r], color: i % 2 ? color : top });
  }
  return out;
}

/** Triangles of a double cone (bipyramid) with n sides: widest radius r at ym between y0 and y1. */
export function bipyramid(n: number, r: number, y0: number, ym: number, y1: number, color: Color3, phase = 0): Tri[] {
  return [...cone(n, r, ym, y1, color, phase), ...cone(n, r, ym, y0, color.scale(0.9), phase)];
}
