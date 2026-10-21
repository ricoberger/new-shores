// Fields (D-049): flat tinted tiles with a simple procedural pattern per
// field type (placeholders until the asset task), drawn with thin
// instances — one mesh per field type and island (FieldTiles, near LOD) —,
// and in world coordinates the green/yellow preview of the field tool's
// rectangle and the work-radius rings of farms with their "n / required"
// labels (labels are HTML, see FieldRingLabels). Nothing here is pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import type { TilePos } from "../display/geometry";
import { footprintBox } from "./coords";
import { setInstances } from "./instances";
import { FIELDS, UI } from "../theme/palette";
import { buildingColor, FIELD_OUT_OF_RANGE, FIELD_RING, FIELD_VALID } from "./palette";
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

/** A farm whose work radius is drawn as a ring. */
export interface FieldRing {
  farmId: number;
  /** Footprint centre in scene (world) coordinates (x, z). */
  cx: number;
  cz: number;
  radius: number;
  /** The server's fields counts of the farm. */
  assigned: number;
  required: number;
}

/** The fields of one island (under the island's node, local tiles). */
export class FieldTiles {
  private readonly meshes = new Map<string, Mesh>();

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
  ) {}

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
        const mat = skyFill(new StandardMaterial(`field_${id}`, this.scene));
        mat.diffuseTexture = patternTexture(this.scene, id);
        mat.specularColor = Color3.Black();
        mesh.material = mat;
        mesh.isPickable = false;
        mesh.parent = this.parent;
        this.meshes.set(id, mesh);
      }
      setInstances(mesh, slabs(tiles, FIELD_Y));
    }
  }
}

/** Field tool preview and farm rings, in world coordinates. */
export class FieldLayer {
  private readonly valid: Mesh;
  private readonly outOfRange: Mesh;
  private readonly rings = new Map<number, Mesh>();
  private ringList: FieldRing[] = [];

  constructor(private readonly scene: Scene) {
    this.valid = flat(scene, "field_preview_valid", 0.9, 0.05, FIELD_VALID, 0.7, null);
    this.outOfRange = flat(scene, "field_preview_out", 0.9, 0.05, FIELD_OUT_OF_RANGE, 0.6, null);
  }

  /** Field tool preview: green tiles are sent, yellow ones are outside every accepting farm's ring. */
  setPreview(valid: readonly TilePos[], outOfRange: readonly TilePos[]): void {
    setInstances(this.valid, slabs(valid, 0.04));
    setInstances(this.outOfRange, slabs(outOfRange, 0.04));
  }

  /** Work-radius rings (one torus template per radius, thin instances). */
  setRings(rings: readonly FieldRing[]): void {
    this.ringList = [...rings];
    const byRadius = new Map<number, number[]>();
    for (const r of rings) {
      let arr = byRadius.get(r.radius);
      if (!arr) byRadius.set(r.radius, (arr = []));
      for (const v of Matrix.Translation(r.cx, 0.06, r.cz).asArray()) arr.push(v);
    }
    for (const [radius, mesh] of this.rings) if (!byRadius.has(radius)) setInstances(mesh, null);
    for (const [radius, arr] of byRadius) {
      let mesh = this.rings.get(radius);
      if (!mesh) {
        mesh = CreateTorus(`field_ring_${radius}`, { diameter: 2 * radius, thickness: 0.08, tessellation: 64 }, this.scene);
        const mat = new StandardMaterial(`field_ring_${radius}`, this.scene);
        mat.emissiveColor = FIELD_RING;
        mat.disableLighting = true;
        mesh.material = mat;
        mesh.isPickable = false;
        this.rings.set(radius, mesh);
      }
      setInstances(mesh, new Float32Array(arr));
    }
  }

  /** The rings drawn (for the HTML labels). */
  ringsShown(): readonly FieldRing[] {
    return this.ringList;
  }
}

/** Ring of a farm with fields (null for any other building); `origin` is its island's position. */
export function farmRing(b: BuildingDisplay, def: ContentBuilding | undefined, origin: { x: number; y: number } = { x: 0, y: 0 }): FieldRing | null {
  if (!def?.fields || !def.work_area) return null;
  const { cx, cz } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
  return { farmId: b.id, cx: cx + origin.x, cz: cz - origin.y, radius: def.work_area.radius, assigned: b.fields?.assigned ?? 0, required: b.fields?.required ?? def.fields.required };
}
