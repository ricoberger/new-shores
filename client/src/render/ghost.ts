// Placement ghost of the build, move and found tools (UI.md §3): the
// building's real model (the full tier; the moved building's own variant
// or level) drawn translucent and tinted by validity — neutral, yellow
// ("not connected") or red (the server would reject it) — at the tool's
// rotation. A depth pre-pass keeps the translucent model clean (only its
// front surface shows). Fields use their model too. Content IDs without a
// model, and models still loading, keep the box ghost of the footprint.
// Roads have their own preview. Purely visual, never pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding } from "../api/client";
import type { ArchPoint } from "../display/ships";
import { type Rotation, rotatedFootprint, type WaterEdgeTile } from "../display/geometry";
import { ghostOffset, previewOffset, skyFill } from "./lighting";
import { GHOST, GHOST_INVALID } from "./palette";
import { modelFileFor, modelMesh, type ModelRegistry, placement, worldData } from "./models";
import { LEVEL_HEIGHT, LEVEL_STEPS } from "./terraces";
import { BUILDINGS } from "../theme/palette";

/** Opacity of the box ghost and of the model ghost. */
const BOX_ALPHA = 0.45;
const MODEL_ALPHA = 0.7;
/**
 * Share of the validity colour in the model ghost's diffuse (multiplies
 * the vertex colours) and its emissive lift: light for the neutral ghost
 * (the model keeps its own colours), strong for yellow and red so the
 * warning reads at a glance.
 */
const TINT = { neutral: 0.25, warn: 0.75 };
const LIFT = { neutral: 0.12, warn: 0.42 };

/** Opacity and height (above the ground plane) of the water-rows strip of a water-edge ghost. */
const WATER_ROWS_ALPHA = 0.55;
const WATER_ROWS_Y = 0.03;
/** The ghost stands this much above its ground (tiles): its plinth never shares a plane with a terrace top (height bias beside the polygon offset). */
export const GHOST_LIFT = 0.012;

/** What the ghost shows: the building at a tile of an island, its rotation and (move tool) the building ID. */
export interface GhostSpec {
  /** Per-tile water-edge hints (D-062, island tiles); only mismatches are red. */
  waterTiles?: readonly WaterEdgeTile[];
  def: ContentBuilding;
  /** The ground under the footprint (tiles; the highest terrace level, D-058). */
  base?: number;
  /** The ground height (tiles) of an island tile, the terrace renderer's tile level: lower tiles of the footprint get plinth walls up to `base`. */
  ground?: (x: number, y: number) => number;
  /** Archipelago position of the island's tile (0, 0). */
  island: ArchPoint;
  x: number;
  y: number;
  rotation: Rotation;
  /** The moved building (its variant or level); undefined: a new one (a fixed variant, level 1). */
  buildingId?: number;
  level?: number;
}

/** The plinth's stone, shaded by course like the built plinths (terraces.ts). */
const PLINTH_STONE = Color3.FromHexString(BUILDINGS.stone);

/** The plinth walls of a ghost footprint over lower terrace tiles (island tiles; y = tiles above the sea, GHOST_LIFT included). */
export interface PlinthMesh {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

/**
 * The stepped plinth under a ghost: every footprint tile below the
 * footprint's base (the highest tile level, where the model stands) is
 * filled up to it, as the built plinths are (D-058). Each tile's column
 * starts at that tile's own level; walls stand only on the sides toward
 * tiles outside the footprint, from the higher of the two grounds to the
 * base, in courses of one terrace step with every other course darker.
 * A footprint on one level has none. Coordinates: x, z = island tile
 * units with z = −y (the mesh sits at the island's position).
 */
export function ghostPlinth(foot: { x: number; y: number; w: number; h: number }, base: number, ground: (x: number, y: number) => number): PlinthMesh | null {
  const out: PlinthMesh = { positions: [], normals: [], colors: [], indices: [] };
  const step = LEVEL_HEIGHT / LEVEL_STEPS;
  const inside = (x: number, y: number) => x >= foot.x && y >= foot.y && x < foot.x + foot.w && y < foot.y + foot.h;
  // Wall sides: [dx, dy] of the neighbour and the quad's corners (x, z offsets inside the tile, counter-clockwise seen from outside).
  const sides = [
    { d: [1, 0], n: [1, 0], c: [[1, 0], [1, -1]] },
    { d: [-1, 0], n: [-1, 0], c: [[0, -1], [0, 0]] },
    { d: [0, 1], n: [0, -1], c: [[1, -1], [0, -1]] },
    { d: [0, -1], n: [0, 1], c: [[0, 0], [1, 0]] },
  ] as const;
  for (let ty = foot.y; ty < foot.y + foot.h; ty++) {
    for (let tx = foot.x; tx < foot.x + foot.w; tx++) {
      const own = ground(tx, ty);
      if (own >= base - 1e-6) continue;
      for (const side of sides) {
        const nx = tx + side.d[0];
        const ny = ty + side.d[1];
        if (inside(nx, ny)) continue;
        const from = Math.max(own, ground(nx, ny));
        if (from >= base - 1e-6) continue;
        const courses = Math.max(1, Math.round((base - from) / step));
        for (let k = 0; k < courses; k++) {
          const y0 = base - k * step + GHOST_LIFT;
          const y1 = k === courses - 1 ? from : base - (k + 1) * step + GHOST_LIFT;
          const shade = (courses - 1 - k) % 2 === 0 ? 0.86 : 1;
          const at = out.positions.length / 3;
          const [a, b] = side.c;
          for (const [cx, cz, y] of [[a[0], a[1], y1], [b[0], b[1], y1], [b[0], b[1], y0], [a[0], a[1], y0]] as const) {
            out.positions.push(tx + cx, y, -ty + cz);
            out.normals.push(side.n[0], 0, side.n[1]);
            out.colors.push(PLINTH_STONE.r * shade, PLINTH_STONE.g * shade, PLINTH_STONE.b * shade, 1);
          }
          // Both windings: the material culls back faces, so only the outward one draws, whatever the winding convention.
          out.indices.push(at, at + 1, at + 2, at, at + 2, at + 3, at, at + 2, at + 1, at, at + 3, at + 2);
        }
      }
    }
  }
  return out.indices.length > 0 ? out : null;
}

/** Diffuse multiplier and emissive lift of a validity colour on a model ghost (GHOST is the neutral one). */
export function ghostTint(color: Color3): { diffuse: Color3; emissive: Color3 } {
  const k = color.equals(GHOST) ? "neutral" : "warn";
  return { diffuse: Color3.White().scale(1 - TINT[k]).add(color.scale(TINT[k])), emissive: color.scale(LIFT[k]) };
}

export class PlacementGhost {
  private readonly box: Mesh;
  private readonly boxMaterial: StandardMaterial;
  private readonly modelMaterial: StandardMaterial;
  /** Ghost meshes per model file path (built once, enabled while shown). */
  private readonly models = new Map<string, Mesh>();
  private shown: Mesh | null = null;
  private color: Color3 | null = null;
  private readonly water: Mesh;
  /** The plinth under the shown model ghost (terrace edges) and the key of what it was built for. */
  private plinth: Mesh | null = null;
  private plinthKey = "";
  private waterKey = "";

  constructor(
    private readonly scene: Scene,
    private readonly registry: ModelRegistry | null,
  ) {
    this.box = CreateBox("ghost", { size: 1 }, scene);
    this.boxMaterial = ghostOffset(skyFill(new StandardMaterial("ghost", scene)));
    this.boxMaterial.alpha = BOX_ALPHA;
    this.box.material = this.boxMaterial;
    this.box.isPickable = false;
    this.box.setEnabled(false);
    this.modelMaterial = ghostOffset(skyFill(new StandardMaterial("ghost_model", scene)));
    this.modelMaterial.specularColor = Color3.Black();
    this.modelMaterial.alpha = MODEL_ALPHA;
    this.modelMaterial.needDepthPrePass = true;
    this.water = new Mesh("ghost_water_rows", scene);
    const wm = previewOffset(skyFill(new StandardMaterial("ghost_water_rows", scene)));
    wm.diffuseColor = Color3.White();
    wm.emissiveColor = Color3.White().scale(0.5);
    wm.alpha = WATER_ROWS_ALPHA;
    wm.backFaceCulling = false;
    this.water.material = wm;
    this.water.isPickable = false;
    this.water.setEnabled(false);
  }

  /** Shows the ghost of a building at a tile, tinted by a validity colour. */
  show(spec: GhostSpec, color: Color3): void {
    const mesh = this.modelFor(spec);
    if (this.shown && this.shown !== mesh) this.shown.setEnabled(false);
    this.shown = mesh ?? this.box;
    if (color !== this.color) {
      this.color = color;
      this.boxMaterial.diffuseColor = color;
      const t = ghostTint(color);
      this.modelMaterial.diffuseColor = t.diffuse;
      this.modelMaterial.emissiveColor = t.emissive;
    }
    if (mesh) {
      const entry = this.registry?.entry(spec.def.id);
      if (!entry) return;
      const p = placement(entry, spec.def, { x: spec.x, y: spec.y, rotation: spec.rotation });
      mesh.position.set(spec.island.x + p.cx, (spec.base ?? 0) + GHOST_LIFT, -spec.island.y + p.cz);
      mesh.rotation.y = p.yaw;
      mesh.scaling.set(p.sx, 1, p.sz);
      this.showPlinth(spec, entry.kind);
    } else {
      this.plinth?.setEnabled(false);
      const [w, h] = rotatedFootprint(spec.def.width, spec.def.height, spec.rotation);
      this.box.scaling.set(w, 0.6, h);
      this.box.position.set(spec.island.x + spec.x + w / 2, (spec.base ?? 0) + 0.3 + GHOST_LIFT, -(spec.island.y + spec.y + h / 2));
    }
    this.shown.setEnabled(true);
    this.showWaterTiles(spec, color);
  }

  /** One vertex-coloured mesh for all footprint tiles, rebuilt only when the hint changes. */
  private showWaterTiles(spec: GhostSpec, color: Color3): void {
    const tiles = spec.waterTiles ?? [];
    if (tiles.length === 0) {
      this.water.setEnabled(false);
      return;
    }
    const key = tiles.map((p) => `${p.x},${p.y},${p.problem},${spec.ground?.(p.x, p.y) ?? 0}`).join("|") + color.toHexString();
    if (key !== this.waterKey) {
      const data = new VertexData();
      data.positions = [];
      data.normals = [];
      data.colors = [];
      data.indices = [];
      for (const p of tiles) {
        const at = data.positions.length / 3;
        const c = p.problem ? GHOST_INVALID : color;
        const y = (spec.ground?.(p.x, p.y) ?? 0) + WATER_ROWS_Y;
        for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
          data.positions.push(p.x + dx, y, -p.y - dy);
          data.normals.push(0, 1, 0);
          data.colors.push(c.r, c.g, c.b, 1);
        }
        data.indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
      }
      data.applyToMesh(this.water);
      this.waterKey = key;
    }
    this.water.position.set(spec.island.x, 0, -spec.island.y);
    this.water.setEnabled(true);
  }

  /** The stepped plinth of a building ghost across a terrace edge (fields and flat ground have none). */
  private showPlinth(spec: GhostSpec, kind: string): void {
    const [w, h] = rotatedFootprint(spec.def.width, spec.def.height, spec.rotation);
    const base = spec.base ?? 0;
    const ground = spec.ground;
    let data: PlinthMesh | null = null;
    let key = "";
    if (kind === "building" && ground && base > 0) {
      const levels: number[] = [];
      for (let y = spec.y - 1; y <= spec.y + h; y++) for (let x = spec.x - 1; x <= spec.x + w; x++) levels.push(ground(x, y));
      key = `${spec.x},${spec.y},${w},${h},${base}|${levels.join(",")}`;
      if (key !== this.plinthKey) data = ghostPlinth({ x: spec.x, y: spec.y, w, h }, base, ground);
    }
    if (key !== this.plinthKey) {
      this.plinth?.dispose();
      this.plinth = null;
      this.plinthKey = key;
      if (data) {
        const mesh = new Mesh("ghost_plinth", this.scene);
        const vd = new VertexData();
        vd.positions = data.positions;
        vd.normals = data.normals;
        vd.colors = data.colors;
        vd.indices = data.indices;
        vd.applyToMesh(mesh);
        mesh.material = this.modelMaterial;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        this.plinth = mesh;
      }
    }
    if (this.plinth) {
      this.plinth.position.set(spec.island.x, 0, -spec.island.y);
      this.plinth.setEnabled(true);
    }
  }

  hide(): void {
    this.plinth?.setEnabled(false);
    this.shown?.setEnabled(false);
    this.shown = null;
    this.water.setEnabled(false);
  }

  /** What is drawn: "model", "box" or null (hidden; tests). */
  kind(): "model" | "box" | null {
    if (!this.shown) return null;
    return this.shown === this.box ? "box" : "model";
  }

  /** The ghost mesh of a building's full model, or null (no model, or still loading: the request starts it). */
  private modelFor(spec: GhostSpec): Mesh | null {
    const entry = this.registry?.entry(spec.def.id);
    if (!entry || entry.kind === "ship" || !this.registry) return null;
    const file = modelFileFor(entry, { id: spec.buildingId ?? 0, level: spec.level ?? 1 });
    if (!file) return null;
    let mesh = this.models.get(file.path);
    if (mesh) return mesh;
    const data = this.registry.request(file);
    if (!data) return null;
    mesh = modelMesh(this.scene, `ghost_${file.path}`, worldData(entry.kind, data), this.modelMaterial);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    this.models.set(file.path, mesh);
    return mesh;
  }
}
