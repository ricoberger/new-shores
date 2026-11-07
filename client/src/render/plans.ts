// Plans (D-071 §5, UI.md §3 "Planning"): planned buildings and fields in
// the ghost material — the building's real model, translucent and
// untinted (render/ghost.ts without a validity colour) — with a thin gold
// outline of the footprint (no slab or box under it: while a model loads, or
// for a content ID without one, only the outline shows), and planned road
// tiles as translucent ground slabs with the gold outline of the planned
// road's edge. No construction
// stage, smoke, status badge or life-layer figure: plans are not in the
// island's buildings, so no other layer sees them. Drawn on the islands
// with detail at near and mid LOD only, never in the far mesh or the far
// road layer. Thin instances per model file; one mesh for all
// outlines and one for all road slabs. Rebuilt only when the key (server
// state, detailed islands, model loads) changes. Purely visual, never
// pickable: the scene picks plans by tile (display/plans.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding } from "../api/client";
import { rotatedFootprint } from "../display/geometry";
import type { ArchPoint } from "../display/ships";
import { GHOST_LIFT } from "./ghost";
import { setInstances } from "./instances";
import { ghostOffset, previewOffset, skyFill } from "./lighting";
import { modelFileFor, modelMesh, type ModelRegistry, placement, worldData } from "./models";
import { OUTLINE_INSET, OUTLINE_WIDTH, OUTLINE_Y, type OutlineBand, outlineQuads, rectOutline } from "./outline";
import { GHOST, GOLD } from "./palette";

/** Opacity of a planned model and of a planned road slab. */
const MODEL_ALPHA = 0.6;
const ROAD_ALPHA = 0.45;
/** Emissive lift of the planned model (the untinted ghost's, render/ghost.ts LIFT.neutral). */
const LIFT = 0.12;
/** Height of a planned road slab above the ground (tiles). */
const ROAD_Y = 0.03;

/** A planned building or field: its content definition, the island's position, its tile, rotation and ground. */
export interface PlanSpec {
  id: number;
  def: ContentBuilding;
  island: ArchPoint;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  /** The ground under the footprint (tiles; the highest terrace level). */
  base: number;
}

/** A planned road tile: the island's position, the tile and its ground. */
export interface PlanRoadTile {
  island: ArchPoint;
  x: number;
  y: number;
  base: number;
}

/**
 * The bands outlining a set of tiles (a planned road): on every tile side
 * that does not border another tile of the set, so a planned road reads as
 * one outlined strip. Tiles are island tiles offset by the island position.
 */
export function tilesOutline(tiles: readonly PlanRoadTile[]): OutlineBand[] {
  const key = (t: { island: ArchPoint; x: number; y: number }) => `${t.island.x},${t.island.y},${t.x},${t.y}`;
  const set = new Set(tiles.map(key));
  const has = (t: PlanRoadTile, dx: number, dy: number) => set.has(key({ island: t.island, x: t.x + dx, y: t.y + dy }));
  const i = OUTLINE_INSET;
  const d = OUTLINE_WIDTH;
  const out: OutlineBand[] = [];
  for (const t of tiles) {
    const x = t.island.x + t.x;
    const y = t.island.y + t.y;
    const yy = t.base + OUTLINE_Y;
    const [l, r, top, bot] = [x + i, x + 1 - i, -(y + i), -(y + 1 - i)];
    // Bands run the full tile length where the neighbour continues the strip.
    const [lx, rx] = [has(t, -1, 0) ? x : l, has(t, 1, 0) ? x + 1 : r];
    const [tz, bz] = [has(t, 0, -1) ? -y : top, has(t, 0, 1) ? -(y + 1) : bot];
    if (!has(t, 0, -1)) out.push({ x0: lx, z0: top, x1: rx, z1: top - d, y: yy });
    if (!has(t, 0, 1)) out.push({ x0: lx, z0: bot + d, x1: rx, z1: bot, y: yy });
    if (!has(t, -1, 0)) out.push({ x0: l, z0: tz, x1: l + d, z1: bz, y: yy });
    if (!has(t, 1, 0)) out.push({ x0: r - d, z0: tz, x1: r, z1: bz, y: yy });
  }
  return out;
}

export class PlanLayer {
  private readonly modelMaterial: StandardMaterial;
  /** Plan meshes per model file path (thin instances; built once). */
  private readonly models = new Map<string, Mesh>();
  private readonly outline: Mesh;
  private readonly roads: Mesh;
  private key = "";
  private count = 0;

  constructor(
    private readonly scene: Scene,
    private readonly registry: ModelRegistry | null,
  ) {
    // The untinted ghost material (render/ghost.ts): white diffuse keeps the model's colours, a small emissive lift.
    this.modelMaterial = ghostOffset(skyFill(new StandardMaterial("plan_model", scene)));
    this.modelMaterial.specularColor = Color3.Black();
    this.modelMaterial.diffuseColor = Color3.White();
    this.modelMaterial.emissiveColor = GHOST.scale(LIFT);
    this.modelMaterial.alpha = MODEL_ALPHA;
    this.modelMaterial.needDepthPrePass = true;
    this.outline = this.flat("plan_outline", GOLD, 1, true);
    this.roads = this.flat("plan_road", GHOST, ROAD_ALPHA, false);
  }

  private flat(name: string, color: Color3, alpha: number, unlit: boolean): Mesh {
    const mesh = new Mesh(name, this.scene);
    const mat = previewOffset(new StandardMaterial(name, this.scene));
    if (unlit) {
      mat.disableLighting = true;
      mat.emissiveColor = color;
      mat.diffuseColor = Color3.Black();
    } else {
      skyFill(mat);
      mat.diffuseColor = color;
      mat.emissiveColor = color.scale(LIFT);
    }
    mat.specularColor = Color3.Black();
    mat.alpha = alpha;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    return mesh;
  }

  /**
   * Draws the plans and planned road tiles (key: rebuilt only when it
   * changes; an empty key hides everything).
   */
  set(key: string, plans: readonly PlanSpec[], roads: readonly PlanRoadTile[]): void {
    if (key === this.key) return;
    this.key = key;
    const byMesh = new Map<Mesh, number[]>();
    const add = (mesh: Mesh, m: Matrix) => {
      let list = byMesh.get(mesh);
      if (!list) byMesh.set(mesh, (list = []));
      list.push(...m.asArray());
    };
    const bands: OutlineBand[] = [];
    for (const p of plans) {
      const [w, h] = rotatedFootprint(p.def.width, p.def.height, p.rotation);
      bands.push(...rectOutline(p.island.x + p.x, p.island.y + p.y, w, h, p.base));
      const entry = this.registry?.entry(p.def.id);
      const mesh = this.modelFor(p);
      if (mesh && entry) {
        const pl = placement(entry, p.def, p);
        add(mesh, Matrix.Compose(new Vector3(pl.sx, 1, pl.sz), Quaternion.RotationYawPitchRoll(pl.yaw, 0, 0), new Vector3(p.island.x + pl.cx, p.base + GHOST_LIFT, -p.island.y + pl.cz)));
      }
    }
    for (const mesh of this.models.values()) {
      const list = byMesh.get(mesh);
      setInstances(mesh, list ? new Float32Array(list) : null);
      mesh.setEnabled(list !== undefined);
    }
    bands.push(...tilesOutline(roads));
    this.apply(this.outline, outlineQuads(bands));
    this.apply(
      this.roads,
      outlineQuads(roads.map((t) => ({ x0: t.island.x + t.x, z0: -(t.island.y + t.y), x1: t.island.x + t.x + 1, z1: -(t.island.y + t.y + 1), y: t.base + ROAD_Y }))),
    );
    this.count = plans.length + roads.length;
  }

  private apply(mesh: Mesh, vd: VertexData | null): void {
    if (!vd) {
      mesh.setEnabled(false);
      return;
    }
    vd.applyToMesh(mesh);
    mesh.setEnabled(true);
  }

  /** How many plans and planned road tiles are drawn (tests and shots). */
  shown(): number {
    return this.count;
  }

  /** The plan mesh of a plan's model file, or null (no model, or still loading: the request starts it). */
  private modelFor(p: PlanSpec): Mesh | null {
    const entry = this.registry?.entry(p.def.id);
    if (!entry || entry.kind === "ship" || !this.registry) return null;
    const file = modelFileFor(entry, { id: p.id, level: 1 });
    if (!file) return null;
    let mesh = this.models.get(file.path);
    if (mesh) return mesh;
    const data = this.registry.request(file);
    if (!data) return null;
    mesh = modelMesh(this.scene, `plan_${file.path}`, worldData(entry.kind, data), this.modelMaterial);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    this.models.set(file.path, mesh);
    return mesh;
  }
}
