// Fields (D-049): flat tinted tiles with a simple procedural pattern per
// field type, drawn with thin instances — one mesh per field type and
// island (FieldTiles, near LOD) — and a per-type decoration on top
// (FieldDecor: fence posts and tufts on pastures, rows on wheat and hemp,
// small trees on orchards; one merged mesh per island, near LOD),
// and in world coordinates the outlines of a farm's chain (FootprintMarks).
// Nothing here is pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import type { TilePos } from "../display/geometry";
import { setInstances } from "./instances";
import { cone, prism, type Tri, TriBuilder } from "./meshdata";
import { BUILDINGS, FIELDS, UI } from "../theme/palette";
import { buildingColor, c3, FIELD_HOVER, FIELD_OUT_OF_RANGE, FIELD_RING, FIELD_VALID } from "./palette";
import { addJitter, MODEL_VPT } from "./jitter";
import { skyFill } from "./lighting";

const TEX = 64;
const FIELD_Y = 0.015;

type Pattern = "plain" | "stripes" | "dots";

/** Placeholder look per field type (visual only; unknown types get stripes in their stable colour). */
const LOOKS: Record<string, { color: string; mark: string; pattern: Pattern }> = {
  pasture: { color: FIELDS.pasture, mark: FIELDS.pasture_mark, pattern: "plain" },
  wheat_field: { color: FIELDS.wheat, mark: FIELDS.wheat_mark, pattern: "stripes" },
  hemp_field: { color: FIELDS.hemp, mark: FIELDS.hemp_mark, pattern: "stripes" },
  orchard_plot: { color: FIELDS.orchard, mark: FIELDS.orchard_mark, pattern: "dots" },
};

function lookOf(id: string): { color: string; mark: string; pattern: Pattern } {
  const known = LOOKS[id];
  if (known) return known;
  const c = buildingColor(id);
  const hex = new Color3(c.r, c.g, c.b).toHexString();
  return { color: hex, mark: new Color3(c.r * 0.7, c.g * 0.7, c.b * 0.7).toHexString(), pattern: "stripes" };
}

function patternTexture(scene: Scene, id: string): DynamicTexture {
  const look = lookOf(id);
  const tex = new DynamicTexture(`field_${id}`, { width: TEX, height: TEX }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = look.color;
  ctx.fillRect(0, 0, TEX, TEX);
  ctx.fillStyle = look.mark;
  if (look.pattern === "stripes") {
    for (let x = 4; x < TEX; x += 12) ctx.fillRect(x, 2, 4, TEX - 4);
  } else if (look.pattern === "dots") {
    for (let y = 10; y < TEX; y += 22) {
      for (let x = 10; x < TEX; x += 22) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.fillRect(TEX / 2 - 3, TEX / 2 - 3, 6, 6);
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, TEX - 3, TEX - 3);
  ctx.globalAlpha = 1;
  tex.update();
  return tex;
}

function slabs(tiles: readonly TilePos[], y: number): Float32Array | null {
  if (tiles.length === 0) return null;
  const out = new Float32Array(tiles.length * 16);
  tiles.forEach((t, i) => out.set(Matrix.Translation(t.x + 0.5, y, -(t.y + 0.5)).asArray(), i * 16));
  return out;
}

function flat(scene: Scene, name: string, size: number, height: number, color: Color3, alpha: number, parent: TransformNode | null): Mesh {
  const mesh = CreateBox(name, { width: size, height, depth: size }, scene);
  const mat = skyFill(new StandardMaterial(name, scene));
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.35);
  mat.specularColor = Color3.Black();
  mat.alpha = alpha;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.parent = parent;
  setInstances(mesh, null);
  return mesh;
}

/** The fields of one island (under the island's node, local tiles). */
export class FieldTiles {
  private readonly meshes = new Map<string, Mesh>();

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
    /** Materials per field type, shared by an island's chunks. */
    private readonly materials = new Map<string, StandardMaterial>(),
  ) {}

  /** Disposes the meshes (the materials may be shared and stay). */
  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
    this.meshes.clear();
  }

  /** Draws the fields among the buildings (buildings with a field block). */
  update(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    const byType = new Map<string, TilePos[]>();
    for (const b of buildings) {
      if (!defs.get(b.type)?.field) continue;
      let arr = byType.get(b.type);
      if (!arr) byType.set(b.type, (arr = []));
      arr.push({ x: b.x, y: b.y });
    }
    for (const [id, mesh] of this.meshes) if (!byType.has(id)) setInstances(mesh, null);
    for (const [id, tiles] of byType) {
      let mesh = this.meshes.get(id);
      if (!mesh) {
        mesh = CreateBox(`field_${id}`, { width: 0.96, height: 0.03, depth: 0.96 }, this.scene);
        let mat = this.materials.get(id);
        if (!mat) {
          mat = addJitter(skyFill(new StandardMaterial(`field_${id}`, this.scene)), MODEL_VPT);
          mat.diffuseTexture = patternTexture(this.scene, id);
          mat.specularColor = Color3.Black();
          this.materials.set(id, mat);
        }
        mesh.material = mat;
        mesh.isPickable = false;
        mesh.parent = this.parent;
        this.meshes.set(id, mesh);
      }
      setInstances(mesh, slabs(tiles, FIELD_Y));
    }
  }
}

/** A footprint outlined in world coordinates (the scene's x, z of its centre and size in tiles). */
export interface Mark {
  cx: number;
  cz: number;
  w: number;
  h: number;
  /** `farm`: the farm of the chain; `active` / `inactive`: its fields; `hover`: the row the list hovers. */
  kind: "farm" | "active" | "inactive" | "hover";
}

const MARK_COLORS: Record<Mark["kind"], { color: Color3; alpha: number; y: number }> = {
  farm: { color: FIELD_RING, alpha: 0.5, y: 0.05 },
  active: { color: FIELD_VALID, alpha: 0.45, y: 0.055 },
  inactive: { color: FIELD_OUT_OF_RANGE, alpha: 0.55, y: 0.055 },
  hover: { color: FIELD_HOVER, alpha: 0.65, y: 0.06 },
};

/**
 * The outlines of a farm's chain (D-051 part 4): flat translucent boxes, one
 * thin-instance mesh per kind, scaled to each footprint. Nothing here is
 * pickable.
 */
export class FootprintMarks {
  private readonly meshes = new Map<Mark["kind"], Mesh>();
  private shown: Record<Mark["kind"], number> = { farm: 0, active: 0, inactive: 0, hover: 0 };

  constructor(scene: Scene) {
    for (const [kind, look] of Object.entries(MARK_COLORS) as [Mark["kind"], (typeof MARK_COLORS)[Mark["kind"]]][]) {
      this.meshes.set(kind, flat(scene, `field_mark_${kind}`, 1, 0.04, look.color, look.alpha, null));
    }
  }

  /** Draws the marks (replacing the previous ones). */
  set(marks: readonly Mark[]): void {
    this.shown = { farm: 0, active: 0, inactive: 0, hover: 0 };
    for (const [kind, mesh] of this.meshes) {
      const of = marks.filter((m) => m.kind === kind);
      this.shown[kind] = of.length;
      if (of.length === 0) {
        setInstances(mesh, null);
        continue;
      }
      const out = new Float32Array(of.length * 16);
      of.forEach((m, i) => {
        const t = Matrix.Scaling(m.w + 0.04, 1, m.h + 0.04).multiply(Matrix.Translation(m.cx, MARK_COLORS[kind].y, m.cz));
        out.set(t.asArray(), i * 16);
      });
      setInstances(mesh, out);
    }
  }

  /** How many marks of each kind are drawn. */
  counts(): Record<Mark["kind"], number> {
    return { ...this.shown };
  }
}

const POST = prism(4, 0.035, 0, 0.2, c3(BUILDINGS.timber), Math.PI / 4);
const RAIL_COLOR = c3(BUILDINGS.timber).scale(1.15);

/** A ridge along x (length 0.9) with a triangular cross-section (2 sloped faces). */
function ridge(height: number, half: number, color: Color3): Tri[] {
  const l = 0.45;
  return [
    { a: [-l, 0, -half], b: [l, 0, -half], c: [l, height, 0], color },
    { a: [-l, 0, -half], b: [l, height, 0], c: [-l, height, 0], color },
    { a: [-l, 0, half], b: [l, height, 0], c: [l, 0, half], color: color.scale(0.85) },
    { a: [-l, 0, half], b: [-l, height, 0], c: [l, height, 0], color: color.scale(0.85) },
  ];
}

/** Decoration of one field tile per type (island-local tile x, y). */
function decorate(b: TriBuilder, type: string, x: number, y: number): void {
  const cx = x + 0.5;
  const cz = -(y + 0.5);
  switch (type) {
    case "pasture": {
      for (const [dx, dz] of [
        [0.08, -0.08],
        [0.92, -0.08],
        [0.08, -0.92],
        [0.92, -0.92],
      ] as const) {
        for (const t of POST) b.add(t, x + dx, FIELD_Y, -y + dz, 1, 0);
      }
      // Two rails along the north and west edges (the neighbours draw the others).
      for (const h of [0.09, 0.16]) {
        b.raw([x + 0.08, FIELD_Y + h, -y - 0.08], [x + 0.92, FIELD_Y + h, -y - 0.08], [x + 0.92, FIELD_Y + h + 0.025, -y - 0.08], RAIL_COLOR, [1, 1, 1], [0, 0, 1]);
        b.raw([x + 0.08, FIELD_Y + h, -y - 0.08], [x + 0.92, FIELD_Y + h + 0.025, -y - 0.08], [x + 0.08, FIELD_Y + h + 0.025, -y - 0.08], RAIL_COLOR, [1, 1, 1], [0, 0, 1]);
      }
      for (const [dx, dz, yaw] of [
        [0.35, -0.4, 0.3],
        [0.66, -0.65, 1.9],
      ] as const) {
        for (const t of PASTURE_TUFT) b.add(t, x + dx, FIELD_Y, -y + dz, 1, yaw);
      }
      return;
    }
    case "wheat_field":
      for (let r = 0; r < 4; r++) for (const t of WHEAT_ROW) b.add(t, cx, FIELD_Y, cz - 0.375 + r * 0.25, 1, 0);
      return;
    case "hemp_field":
      for (let r = 0; r < 3; r++) for (const t of HEMP_ROW) b.add(t, cx, FIELD_Y, cz - 0.3 + r * 0.3, 1, 0);
      return;
    case "orchard_plot":
      for (const [dx, dz] of [
        [0.28, -0.28],
        [0.72, -0.28],
        [0.28, -0.72],
        [0.72, -0.72],
      ] as const) {
        for (const t of ORCHARD_TREE) b.add(t, x + dx, FIELD_Y, -y + dz, 1, 0);
      }
      return;
    default:
    // Unknown field types keep their stable-colour stripes only.
  }
}

const PASTURE_TUFT: Tri[] = [
  { a: [-0.05, 0, 0], b: [0.05, 0, 0], c: [-0.02, 0.14, 0.01], color: c3(FIELDS.pasture_mark).scale(0.8) },
  { a: [0, 0, -0.05], b: [0, 0, 0.05], c: [0.04, 0.12, 0.02], color: c3(FIELDS.pasture_mark).scale(0.9) },
];
const WHEAT_ROW = ridge(0.1, 0.08, c3(FIELDS.wheat_mark).scale(1.15));
const HEMP_ROW = ridge(0.17, 0.09, c3(FIELDS.hemp_mark).scale(1.1));
const ORCHARD_TREE: Tri[] = [...prism(3, 0.03, 0, 0.12, c3(BUILDINGS.timber)), ...cone(5, 0.16, 0.1, 0.38, c3(FIELDS.orchard).scale(0.85), 0, 0.8)];

/** Per-type decoration of the fields of one island (near LOD): one merged static mesh. */
export class FieldDecor {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
    material: StandardMaterial | null = null,
  ) {
    this.material = material ?? fieldDecorMaterial(scene);
  }

  /** Disposes the mesh (the material may be shared and stays). */
  dispose(): void {
    this.mesh?.dispose();
    this.mesh = null;
  }

  update(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    this.mesh?.dispose();
    const b = new TriBuilder();
    for (const f of buildings) {
      const type = defs.get(f.type)?.field?.type;
      if (type) decorate(b, type, f.x, f.y);
    }
    this.mesh = b.build("field_decor", this.scene, this.material, this.parent);
  }
}

/** The field decoration's material (one per island, shared by its chunks). */
export function fieldDecorMaterial(scene: Scene): StandardMaterial {
  const m = addJitter(skyFill(new StandardMaterial("field_decor", scene)), MODEL_VPT);
  m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  return m;
}
