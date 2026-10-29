// The ghost of a painted field rectangle (D-054): one flat translucent box per
// field anchor, coloured from the client hint (display/fieldpaint.ts) —
// green where a field is expected, red where a rule rejects it, a fainter
// red beyond the farm's maximum — and the fields a removal rectangle
// covers. After the server's answer the rejected anchors flash red and
// fade. Thin instances, one mesh per kind, world coordinates; nothing here
// is pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { setInstances } from "./instances";
import { previewOffset, skyFill } from "./lighting";
import { FIELD_VALID, GHOST_INVALID } from "./palette";

/** A field footprint in world coordinates (the scene's x, z of its centre and its size in tiles). */
export interface PaintMark {
  cx: number;
  cz: number;
  w: number;
  h: number;
  /** `ok`: a field is expected; `bad`: a rule rejects it; `max`: beyond the farm's maximum; `remove`: a field a removal takes. */
  kind: "ok" | "bad" | "max" | "remove";
  /** The ground under the mark (tiles; terraces, D-058). */
  base?: number;
}

const LOOKS: Record<PaintMark["kind"] | "flash", { color: Color3; alpha: number; y: number; inset: number }> = {
  ok: { color: FIELD_VALID, alpha: 0.6, y: 0.07, inset: 0.08 },
  bad: { color: GHOST_INVALID, alpha: 0.6, y: 0.07, inset: 0.08 },
  max: { color: GHOST_INVALID, alpha: 0.42, y: 0.065, inset: 0.16 },
  remove: { color: GHOST_INVALID, alpha: 0.55, y: 0.075, inset: 0.04 },
  flash: { color: GHOST_INVALID, alpha: 0.75, y: 0.08, inset: 0.04 },
};

/** How long rejected anchors flash after the server's answer (ms). */
export const FLASH_MS = 1400;

function matrices(marks: readonly PaintMark[], y: number, inset: number): Float32Array | null {
  if (marks.length === 0) return null;
  const out = new Float32Array(marks.length * 16);
  marks.forEach((m, i) => {
    const t = Matrix.Scaling(Math.max(0.2, m.w - inset), 1, Math.max(0.2, m.h - inset)).multiply(Matrix.Translation(m.cx, y + (m.base ?? 0), m.cz));
    out.set(t.asArray(), i * 16);
  });
  return out;
}

export class PaintPreview {
  private readonly meshes = new Map<PaintMark["kind"] | "flash", Mesh>();
  private readonly mats = new Map<PaintMark["kind"] | "flash", StandardMaterial>();
  private shown: Record<PaintMark["kind"], number> = { ok: 0, bad: 0, max: 0, remove: 0 };
  private flashUntil = 0;
  private flashCount = 0;

  constructor(scene: Scene) {
    for (const [kind, look] of Object.entries(LOOKS) as [PaintMark["kind"] | "flash", (typeof LOOKS)[PaintMark["kind"]]][]) {
      const mesh = CreateBox(`paint_${kind}`, { width: 1, height: 0.04, depth: 1 }, scene);
      const mat = previewOffset(skyFill(new StandardMaterial(`paint_${kind}`, scene)));
      mat.diffuseColor = look.color;
      mat.emissiveColor = look.color.scale(0.45);
      mat.specularColor = Color3.Black();
      mat.alpha = look.alpha;
      mesh.material = mat;
      mesh.isPickable = false;
      setInstances(mesh, null);
      this.meshes.set(kind, mesh);
      this.mats.set(kind, mat);
    }
  }

  /** Draws the rectangle's marks (replacing the previous ones; empty clears). */
  set(marks: readonly PaintMark[]): void {
    this.shown = { ok: 0, bad: 0, max: 0, remove: 0 };
    for (const kind of ["ok", "bad", "max", "remove"] as const) {
      const of = marks.filter((m) => m.kind === kind);
      this.shown[kind] = of.length;
      setInstances(this.meshes.get(kind)!, matrices(of, LOOKS[kind].y, LOOKS[kind].inset));
    }
  }

  /** The rejected anchors of the server's answer flash red from `now` (performance.now() ms) and fade. */
  flash(marks: readonly Omit<PaintMark, "kind">[], now: number): void {
    this.flashCount = marks.length;
    this.flashUntil = marks.length > 0 ? now + FLASH_MS : 0;
    setInstances(this.meshes.get("flash")!, matrices(marks.map((m) => ({ ...m, kind: "bad" as const })), LOOKS.flash.y, LOOKS.flash.inset));
  }

  /** Per frame: the flash pulses twice and fades out (`hold`: it stays at full strength, for pinned-clock shots). */
  tick(now: number, hold = false): void {
    if (this.flashUntil === 0) return;
    const mat = this.mats.get("flash")!;
    if (hold) {
      this.flashUntil = Math.max(this.flashUntil, now + FLASH_MS);
      mat.alpha = LOOKS.flash.alpha;
      return;
    }
    const left = this.flashUntil - now;
    if (left <= 0) {
      this.flashUntil = 0;
      this.flashCount = 0;
      setInstances(this.meshes.get("flash")!, null);
      return;
    }
    const t = 1 - left / FLASH_MS;
    const pulse = 0.55 + 0.45 * Math.cos(t * Math.PI * 4);
    mat.alpha = LOOKS.flash.alpha * pulse * Math.min(1, left / (FLASH_MS * 0.35));
  }

  /** How many marks of each kind are drawn, and the anchors flashing. */
  counts(): Record<PaintMark["kind"] | "flash", number> {
    return { ...this.shown, flash: this.flashCount };
  }
}
