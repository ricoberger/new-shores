// Buildings: the voxel models of the manifest (render/models.ts) and,
// for content IDs without a model or until it has loaded, one procedural
// low-poly placeholder per content ID drawn with thin instances sized to
// the rotated footprint, with a door marker in the middle of the front
// edge (purely visual; rotation has no gameplay effect, D-042). Also the
// selection frame.
//
// Models are merged per island chunk (display/chunks.ts) into static
// meshes — one draw call per chunk without thin instances, which software
// renderers pay per vertex (the phone perf budget; ART_DIRECTION §2), and
// chunks outside the view are culled. The paused tint is baked into the
// chunk's vertex colours. Newly placed buildings rise in as thin instances
// of their model over RISE_MS (renderer animation clock) and then join
// their chunk. At the near-LOD default zoom the lite models are drawn,
// zoomed in the full ones (setDetail). The chunks of every detail in use
// are built together, once per layout change, and a detail change only
// toggles which set is enabled — a zoom never rebuilds geometry (the
// swap stutter). Fields with a model are drawn here too; the field layers
// keep the others.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { footprintBox } from "./coords";
import { setInstances } from "./instances";
import { type Detail, type ModelData, type ModelEntry, type ModelFile, type ModelRegistry, atDetail, lifeModel, modelFileFor, placement, worldData } from "./models";
import { rotatedFootprint } from "../display/geometry";
import { buildingColor, DOOR, INACTIVE_TINT, PAUSED_TINT, roofColor, SELECTION } from "./palette";
import { skyFill } from "./lighting";
import { addSway } from "./sway";
import { ColoredInstances } from "./shipmesh";
import { chunkAt } from "../display/chunks";

/** Duration of the rise-in of a newly placed building (ms of the animation clock). */
export const RISE_MS = 350;

/**
 * Construction stages (LIFE_LAYER §6): a newly placed building shows the
 * voxel stages A → B → C, a third of VISUAL_BUILD_MS each, then appears.
 * A visual only (D-006: no construction timers; the building already
 * works). Fields and ?life=0 keep the rise-in.
 */
export const VISUAL_BUILD_MS = 2400;
export const STAGES = 3;
/** Footprint side (tiles, both sides) from which scaffolding stands beside the stages. */
export const SCAFFOLD_MIN = 3;
/** Width of the stage models (tiles at scale 1: the voxel stages, life_stage). */
export const STAGE_SIZE = 1.4;
const SCAFFOLD_SIZE = 2.6;
const STAGE_MAX_Y = 1.6;
const WHITE = [1, 1, 1, 1] as const;
const NONE: ReadonlySet<number> = new Set();

/** Multiplied onto the colours of the selected building (and of the fields and farm of its chain) (it turns green). */
const SELECTED_TINT = [0.5, 1, 0.5, 1] as const;

/** Instance colour of a building: paused and unpaid ones are tinted cool grey, inactive fields (not_adjacent) neutral grey. */
function tintOf(b: BuildingDisplay, selected: ReadonlySet<number> = NONE): readonly number[] {
  const base = b.paused ? PAUSED_TINT : b.active === false ? INACTIVE_TINT : WHITE;
  return selected.has(b.id) ? base.map((v, i) => v * (SELECTED_TINT[i] as number)) : base;
}

function faces(c: Color4, n: number): Color4[] {
  return Array.from({ length: n }, () => c);
}

/** Builds the unit-footprint placeholder of a building (scaled per instance). */
function template(scene: Scene, def: ContentBuilding): Mesh {
  const body = buildingColor(def.id);
  const roofC = roofColor(def.id, def.category);
  const parts: Mesh[] = [];
  const box = (w: number, h: number, d: number, y: number, c: Color4, x = 0, z = 0) => {
    const m = CreateBox(`${def.id}_part`, { width: w, height: h, depth: d, faceColors: faces(c, 6) }, scene);
    m.position.set(x, y, z);
    parts.push(m);
  };
  const cyl = (top: number, bottom: number, h: number, tess: number, y: number, c: Color4, x = 0, z = 0) => {
    const m = CreateCylinder(
      `${def.id}_part`,
      { diameterTop: top, diameterBottom: bottom, height: h, tessellation: tess, faceColors: faces(c, 3) },
      scene,
    );
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };
  switch (def.category) {
    case "houses": {
      box(0.8, 0.45, 0.8, 0.225, body);
      // A hip roof covering the whole body (a 4-sided cone, base 0.8 × 0.8).
      const roof = cyl(0, 0.8 * Math.SQRT2, 0.5, 4, 0.7, roofC);
      roof.rotation.y = Math.PI / 4;
      break;
    }
    case "production":
      box(0.85, 0.4, 0.85, 0.2, body);
      cyl(0.12, 0.15, 0.5, 6, 0.55, roofC, 0.25, 0.25);
      break;
    case "public":
      box(0.85, 0.35, 0.85, 0.175, body);
      cyl(0, 0.5, 0.7, 6, 0.7, roofC);
      break;
    case "harbour":
      box(0.92, 0.5, 0.92, 0.25, body);
      box(0.95, 0.06, 0.95, 0.53, roofC);
      break;
    default:
      box(0.8, 0.4, 0.8, 0.2, body);
  }
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (!merged) throw new Error(`cannot build mesh for ${def.id}`);
  merged.name = `building_${def.id}`;
  merged.isPickable = false;
  return merged;
}

/** World-oriented vertex data of a building model file (cached per loaded data). */
const worldCache = new WeakMap<ModelData, ModelData>();
export function buildingData(data: ModelData): ModelData {
  let w = worldCache.get(data);
  if (!w) worldCache.set(data, (w = worldData("building", data)));
  return w;
}

/** A model instance of a building in a chunk. */
interface Item {
  b: BuildingDisplay;
  entry: ModelEntry;
  def: ContentBuilding;
  file: ModelFile;
  data: ModelData;
}

/**
 * Merges model instances into one vertex buffer (island-local): rotated
 * by their yaw, stretched by the footprint scale, moved to the footprint
 * centre, colours × the paused tint.
 */
export function mergeItems(items: readonly { data: ModelData; cx: number; cz: number; yaw: number; sx: number; sz: number; tint: readonly number[] }[]): VertexData {
  let nv = 0;
  let ni = 0;
  for (const it of items) {
    nv += it.data.positions.length / 3;
    ni += it.data.indices.length;
  }
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 4);
  const indices = new Uint32Array(ni);
  let v = 0;
  let k = 0;
  for (const it of items) {
    const c = Math.cos(it.yaw);
    const s = Math.sin(it.yaw);
    const d = it.data;
    const n = d.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const x = (d.positions[i * 3] as number) * it.sx;
      const y = d.positions[i * 3 + 1] as number;
      const z = (d.positions[i * 3 + 2] as number) * it.sz;
      positions[(v + i) * 3] = x * c + z * s + it.cx;
      positions[(v + i) * 3 + 1] = y;
      positions[(v + i) * 3 + 2] = -x * s + z * c + it.cz;
      const nx = d.normals[i * 3] as number;
      const nz = d.normals[i * 3 + 2] as number;
      normals[(v + i) * 3] = nx * c + nz * s;
      normals[(v + i) * 3 + 1] = d.normals[i * 3 + 1] as number;
      normals[(v + i) * 3 + 2] = -nx * s + nz * c;
      for (let j = 0; j < 4; j++) colors[(v + i) * 4 + j] = (d.colors[i * 4 + j] as number) * (it.tint[j] as number);
    }
    for (let i = 0; i < d.indices.length; i++) indices[k + i] = (d.indices[i] as number) + v;
    v += n;
    k += d.indices.length;
  }
  const out = new VertexData();
  out.positions = positions;
  out.normals = normals;
  out.colors = colors;
  out.indices = indices;
  return out;
}

/** Rise-in scale at progress t (0..1): ease-out with a slight overshoot. */
export function riseScale(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = t - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
}

/**
 * World matrix of construction stage k (0..STAGES-1; STAGES: the
 * scaffolding) of a building: like the final model, scaled in model space
 * to the unrotated footprint, turned by the building's rotation and
 * placed at the footprint centre, so a stage faces where the building
 * will face.
 */
export function stageMatrix(k: number, entry: ModelEntry, def: ContentBuilding, b: Pick<BuildingDisplay, "x" | "y" | "rotation">): Matrix {
  const p = placement(entry, def, b);
  const side = Math.min(def.width, def.height);
  const scale =
    k < STAGES
      ? Matrix.Scaling(def.width / STAGE_SIZE, Math.min(STAGE_MAX_Y, side / STAGE_SIZE), def.height / STAGE_SIZE)
      : Matrix.Scaling(side / SCAFFOLD_SIZE, side / SCAFFOLD_SIZE, side / SCAFFOLD_SIZE);
  return scale.multiply(Matrix.RotationY(p.yaw)).multiply(Matrix.Translation(p.cx, 0, p.cz));
}

export class BuildingLayer {
  private readonly templates = new Map<string, Mesh>();
  private readonly material: StandardMaterial;
  private readonly doors: Mesh;
  private readonly selection: Mesh;
  /** The selected building drawn as a model: tinted instead of framed. */
  private selectedId: number | null = null;
  /** The selected building and the farm and fields of its chain: tinted green. */
  private tinted: ReadonlySet<number> = NONE;
  /** The island chunks in view (null: all). */
  private visibleChunks: ReadonlySet<string> | null = null;
  /** Merged model chunks per detail level in use (chunk key → signature and mesh). */
  private readonly chunks = new Map<Detail, Map<string, { key: string; mesh: Mesh | null }>>();
  /** Detail levels whose chunks are built (both, or only full when the lite tier is off: then full is drawn at every zoom). */
  private details: readonly Detail[] = ["lite", "full"];
  private readonly risingMeshes = new Map<string, ColoredInstances>();
  /** Newly placed buildings rising in: building ID → start time (null: starts with the next frame). */
  private readonly rising = new Map<number, number | null>();
  /** Building IDs of the previous payload (null: nothing shown yet, the first payload never animates). */
  private known: Set<number> | null = null;
  private last: { buildings: readonly BuildingDisplay[]; defs: ReadonlyMap<string, ContentBuilding> } | null = null;
  private detail: Detail = "lite";
  /** Content IDs drawn with a placeholder, and building IDs drawn as a model, in the last update. */
  private placeholderIds = new Set<string>();
  private modelIds = new Set<number>();
  /** Buildings drawn with the other detail's file while the wanted one loads (last update). */
  private bridgedCount = 0;
  private risingItems: Item[] = [];
  /** Construction-stage instances: stages 0..2, then scaffolding (null until the models load). */
  private stageMeshes: (ColoredInstances | null)[] = [null, null, null, null];
  /** Shows construction stages instead of the rise-in (the life layer; off with ?life=0). */
  stages = true;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.material = addSway(skyFill(new StandardMaterial("buildings", scene)));
    this.material.specularColor = Color3.Black();
    this.doors = CreateBox("doors", { width: 0.35, height: 0.3, depth: 0.12 }, scene);
    const doorMat = skyFill(new StandardMaterial("doors", scene));
    doorMat.diffuseColor = DOOR;
    doorMat.specularColor = Color3.Black();
    this.doors.material = doorMat;
    this.doors.isPickable = false;
    this.doors.parent = parent;
    setInstances(this.doors, null);
    this.selection = CreateBox("selection", { size: 1 }, scene);
    const selMat = new StandardMaterial("selection", scene);
    selMat.emissiveColor = SELECTION;
    selMat.disableLighting = true;
    selMat.wireframe = true;
    this.selection.material = selMat;
    this.selection.isPickable = false;
    this.selection.parent = parent;
    this.selection.setEnabled(false);
  }

  /** Detail level of the models (lite at the near default zoom, full zoomed in): toggles the prebuilt chunk sets. */
  setDetail(detail: Detail): void {
    if (detail === this.detail) return;
    const before = this.drawn();
    this.detail = detail;
    if (this.drawn() !== before && this.risingItems.length > 0) this.refresh();
    this.applyDetail();
  }

  /** The detail actually drawn: the wanted one when its chunks are built, else full. */
  private drawn(): Detail {
    return this.details.includes(this.detail) ? this.detail : "full";
  }

  /**
   * The detail levels to build chunks for: ["lite", "full"] (default) or
   * ["full"] (the lite tier off). Rebuilds when it changes.
   */
  setDetails(details: readonly Detail[]): void {
    if (details.join() === this.details.join()) return;
    for (const [d, set] of this.chunks) {
      if (details.includes(d)) continue;
      for (const c of set.values()) c.mesh?.dispose();
      this.chunks.delete(d);
    }
    this.details = details;
    this.refresh();
    this.applyDetail();
  }

  private applyDetail(): void {
    const drawn = this.drawn();
    for (const [d, set] of this.chunks) for (const [k, c] of set) c.mesh?.setEnabled(d === drawn && this.chunkShown(k));
  }

  /** The island chunks in view (null: all): the merged model meshes of the others are not drawn. */
  setVisibleChunks(keys: ReadonlySet<string> | null): void {
    this.visibleChunks = keys;
    this.applyDetail();
  }

  private chunkShown(key: string): boolean {
    return this.visibleChunks === null || this.visibleChunks.has(key);
  }

  /** Redraws the last payload (a model finished loading or the detail changed). */
  refresh(): void {
    if (this.last) this.draw(this.last.buildings, this.last.defs);
  }

  update(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    const ids = new Set(buildings.map((b) => b.id));
    if (this.known) for (const id of ids) if (!this.known.has(id)) this.rising.set(id, null);
    for (const id of this.rising.keys()) if (!ids.has(id)) this.rising.delete(id);
    this.known = ids;
    this.last = { buildings, defs };
    this.draw(buildings, defs);
  }

  /** The model file and data to draw for a building (wanted detail, else the other one), or null (placeholder). */
  private modelOf(b: BuildingDisplay, def: ContentBuilding, detail: Detail): Item | null {
    const entry = this.registry?.entry(b.type);
    if (!entry || !this.registry) return null;
    const main = modelFileFor(entry, b);
    if (!main) return null;
    const want = atDetail(main, detail);
    const other = want === main ? (main.lite ?? main) : main;
    // Only the wanted detail is loaded; the other one bridges the time until it arrives if it is already there.
    // `file` is the file actually drawn, so chunk signatures and rising meshes change when the wanted one arrives.
    const wanted = this.registry.request(want);
    if (wanted) return { b, entry, def, file: want, data: buildingData(wanted) };
    const bridge = other !== want ? this.registry.peek(other) : null;
    if (!bridge) return null;
    this.bridgedCount++;
    return { b, entry, def, file: other, data: buildingData(bridge) };
  }

  private draw(buildings: readonly BuildingDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    const byType = new Map<string, number[]>();
    const doors: number[] = [];
    const byChunk = new Map<Detail, Map<string, Item[]>>(this.details.map((d) => [d, new Map()]));
    const rising: Item[] = [];
    this.placeholderIds = new Set();
    this.modelIds = new Set();
    this.bridgedCount = 0;
    for (const b of buildings) {
      const def = defs.get(b.type);
      // Roads are strips of their own; fields without a model stay in the field layers.
      if (!def || def.category === "roads") continue;
      const items = this.details.map((d) => [d, this.modelOf(b, def, d)] as const);
      const item = items.find(([d]) => d === this.drawn())?.[1] ?? null;
      if (item) {
        this.modelIds.add(b.id);
        if (this.rising.has(b.id)) {
          rising.push(item);
          continue;
        }
        const p = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
        const key = chunkAt(p.cx, -p.cz);
        for (const [d, it] of items) {
          if (!it) continue;
          const set = byChunk.get(d) as Map<string, Item[]>;
          let list = set.get(key);
          if (!list) set.set(key, (list = []));
          list.push(it);
        }
        continue;
      }
      if (def.field) continue;
      this.placeholderIds.add(b.type);
      const { cx, cz, w, h } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
      const m = Matrix.Scaling(w, 1, h).multiply(Matrix.Translation(cx, 0, cz));
      let arr = byType.get(b.type);
      if (!arr) byType.set(b.type, (arr = []));
      for (const v of m.asArray()) arr.push(v);
      // Door: in the middle of the front edge of the footprint.
      const [dx, dz, rot] = frontOffset(b.rotation);
      const ex = cx + dx * (w / 2 - 0.05);
      const ez = cz + dz * (h / 2 - 0.05);
      const dm = Matrix.RotationY(rot).multiply(Matrix.Translation(ex, 0.15, ez));
      for (const v of dm.asArray()) doors.push(v);
    }
    for (const [id, mesh] of this.templates) {
      if (!byType.has(id)) setInstances(mesh, null);
    }
    for (const [id, arr] of byType) {
      let mesh = this.templates.get(id);
      if (!mesh) {
        const def = defs.get(id);
        if (!def) continue;
        mesh = template(this.scene, def);
        mesh.material = this.material;
        mesh.parent = this.parent;
        this.templates.set(id, mesh);
      }
      setInstances(mesh, new Float32Array(arr));
    }
    setInstances(this.doors, doors.length ? new Float32Array(doors) : null);
    this.drawChunks(byChunk);
    this.risingItems = rising;
    if (rising.length === 0) for (const inst of this.risingMeshes.values()) inst.resize(0);
  }

  private drawChunks(byDetail: Map<Detail, Map<string, Item[]>>): void {
    for (const [detail, byChunk] of byDetail) {
      let chunks = this.chunks.get(detail);
      if (!chunks) this.chunks.set(detail, (chunks = new Map()));
      this.drawChunkSet(chunks, byChunk, detail === this.drawn());
    }
  }

  private drawChunkSet(chunks: Map<string, { key: string; mesh: Mesh | null }>, byChunk: Map<string, Item[]>, enabled: boolean): void {
    for (const [key, chunk] of chunks) {
      if (byChunk.has(key)) continue;
      chunk.mesh?.dispose();
      chunks.delete(key);
    }
    for (const [key, items] of byChunk) {
      const sig = items.map((it) => `${it.b.id}:${it.file.path}:${it.b.x},${it.b.y},${it.b.rotation}:${it.b.paused ? 1 : 0}${it.b.active === false ? "i" : ""}${this.tinted.has(it.b.id) ? "s" : ""}:${it.def.width}x${it.def.height}`).join(";");
      const old = chunks.get(key);
      if (old?.key === sig) continue;
      old?.mesh?.dispose();
      const data = mergeItems(
        items.map((it) => {
          const p = placement(it.entry, it.def, it.b);
          return { data: it.data, cx: p.cx, cz: p.cz, yaw: p.yaw, sx: p.sx, sz: p.sz, tint: tintOf(it.b, this.tinted) };
        }),
      );
      const mesh = new Mesh(`models_${key}`, this.scene);
      data.applyToMesh(mesh);
      mesh.material = this.material;
      mesh.parent = this.parent;
      mesh.isPickable = false;
      mesh.setEnabled(enabled && this.chunkShown(key));
      chunks.set(key, { key: sig, mesh });
    }
  }

  /**
   * Advances the rise-in of newly placed buildings (every frame while shown
   * at near LOD). Returns true when finished buildings joined their chunks,
   * i.e. the chunk meshes (shadow casters) were replaced.
   */
  frame(nowMs: number): boolean {
    if (this.risingItems.length === 0) {
      for (const m of this.stageMeshes) m?.resize(0);
      return false;
    }
    const byFile = new Map<string, Item[]>();
    const staged: Item[][] = [[], [], [], []];
    const stagesReady = this.stages && this.stageModels();
    let finished = false;
    for (const it of this.risingItems) {
      let start = this.rising.get(it.b.id);
      if (start === undefined) continue;
      // A clock that went back (a server-offset correction, an unfrozen test clock) restarts it.
      if (start === null || nowMs < start) this.rising.set(it.b.id, (start = nowMs));
      const stage = stagesReady && !it.def.field;
      if (nowMs - start >= (stage ? VISUAL_BUILD_MS : RISE_MS)) {
        this.rising.delete(it.b.id);
        finished = true;
        continue;
      }
      if (stage) {
        const k = Math.min(STAGES - 1, Math.floor(((nowMs - start) / VISUAL_BUILD_MS) * STAGES));
        (staged[k] as Item[]).push(it);
        const [w, h] = rotatedFootprint(it.def.width, it.def.height, it.b.rotation);
        if (w >= SCAFFOLD_MIN && h >= SCAFFOLD_MIN) (staged[STAGES] as Item[]).push(it);
        continue;
      }
      let list = byFile.get(it.file.path);
      if (!list) byFile.set(it.file.path, (list = []));
      list.push(it);
    }
    for (const [path, inst] of this.risingMeshes) if (!byFile.has(path)) inst.resize(0);
    for (const [path, items] of byFile) {
      let inst = this.risingMeshes.get(path);
      if (!inst) {
        const mesh = new Mesh(`rising_${path}`, this.scene);
        mergeItems([{ data: (items[0] as Item).data, cx: 0, cz: 0, yaw: 0, sx: 1, sz: 1, tint: WHITE }]).applyToMesh(mesh);
        mesh.material = this.material;
        mesh.parent = this.parent;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        inst = new ColoredInstances(mesh);
        this.risingMeshes.set(path, inst);
      }
      inst.resize(items.length);
      items.forEach((it, i) => {
        const p = placement(it.entry, it.def, it.b);
        const s = riseScale((nowMs - (this.rising.get(it.b.id) ?? nowMs)) / RISE_MS);
        Matrix.Scaling(s * p.sx, s, s * p.sz)
          .multiply(Matrix.RotationY(p.yaw))
          .multiply(Matrix.Translation(p.cx, 0, p.cz))
          .copyToArray(inst.matrices, i * 16);
        inst.setColor(i, tintOf(it.b, this.tinted));
      });
      inst.commit();
    }
    this.drawStages(staged);
    // Finished buildings join their chunk.
    if (finished) this.refresh();
    return finished;
  }

  /** Whether the stage models are loaded (creates their instance meshes once). */
  private stageModels(): boolean {
    let ready = true;
    for (let k = 0; k <= STAGES; k++) {
      if (this.stageMeshes[k]) continue;
      // Every missing model is requested in the same frame.
      const data = k < STAGES ? lifeModel(this.registry, "life_stage", k) : lifeModel(this.registry, "life_stage_scaffolding");
      if (!data) {
        ready = false;
        continue;
      }
      const mesh = new Mesh(k < STAGES ? `stage_${"abc"[k]}` : "stage_scaffolding", this.scene);
      mergeItems([{ data, cx: 0, cz: 0, yaw: 0, sx: 1, sz: 1, tint: WHITE }]).applyToMesh(mesh);
      mesh.material = this.material;
      mesh.parent = this.parent;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      this.stageMeshes[k] = new ColoredInstances(mesh);
    }
    return ready;
  }

  /** Stage (and scaffolding) instances stretched to each building's footprint. */
  private drawStages(staged: Item[][]): void {
    staged.forEach((items, k) => {
      const inst = this.stageMeshes[k];
      if (!inst) return;
      inst.resize(items.length);
      items.forEach((it, i) => {
        stageMatrix(k, it.entry, it.def, it.b).copyToArray(inst.matrices, i * 16);
        inst.setColor(i, tintOf(it.b, this.tinted));
      });
      inst.commit();
    });
  }

  /** Construction-stage instances drawn in the last frame per stage (stage_a, stage_b, stage_c, stage_scaffolding; e2e). */
  stageCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    this.stageMeshes.forEach((m, k) => {
      if (m && m.size() > 0) out[k < STAGES ? `stage_${"abc"[k]}` : "stage_scaffolding"] = m.size();
    });
    return out;
  }

  /** The chunks of the current detail. */
  private current(): Map<string, { key: string; mesh: Mesh | null }> {
    return this.chunks.get(this.drawn()) ?? new Map();
  }

  /** Triangles drawn by the model chunks of the current detail (tests). */
  chunkTriangles(): number {
    let n = 0;
    for (const c of this.current().values()) n += (c.mesh?.getTotalIndices() ?? 0) / 3;
    return n;
  }

  /** The building meshes drawn (shadow casters). */
  meshes(): Mesh[] {
    const out = [...this.templates.values()].filter((m) => m.isVisible);
    for (const c of this.current().values()) if (c.mesh) out.push(c.mesh);
    return out;
  }

  /** Content IDs drawn with a placeholder in the last update. */
  placeholders(): ReadonlySet<string> {
    return this.placeholderIds;
  }

  /** Buildings drawn with the other detail's file until the wanted one has loaded (last update). */
  bridged(): number {
    return this.bridgedCount;
  }

  /** Building IDs drawn as a model (fields among them leave the field layers). */
  modelled(): ReadonlySet<number> {
    return this.modelIds;
  }

  /** Model chunks drawn at the current detail (tests). */
  chunkCount(): number {
    return this.current().size;
  }

  /** `chain`: the other buildings tinted with the selected one (a farm's fields, a field's farm and siblings). */
  select(b: BuildingDisplay | undefined, def: ContentBuilding | undefined, chain: readonly number[] = []): void {
    const id = b && def ? b.id : null;
    const key = (ids: ReadonlySet<number>) => [...ids].sort((x, y) => x - y).join(",");
    const tinted = id === null ? NONE : new Set([id, ...chain]);
    if (id !== this.selectedId || key(tinted) !== key(this.tinted)) {
      this.selectedId = id;
      this.tinted = tinted;
      this.refresh();
    }
    if (!b || !def || this.modelIds.has(b.id)) {
      this.selection.setEnabled(false);
      return;
    }
    const entry = this.registry?.entry(b.type);
    if (entry && entry.kind !== "ship") {
      const p = placement(entry, def, b);
      this.selection.scaling.set(p.rect.w + 0.1, p.height + 0.1, p.rect.h + 0.1);
      this.selection.position.set(p.rect.cx, p.height / 2, p.rect.cz);
    } else {
      const { cx, cz, w, h } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
      this.selection.scaling.set(w + 0.1, 1.1, h + 0.1);
      this.selection.position.set(cx, 0.5, cz);
    }
    this.selection.setEnabled(true);
  }
}

/** Unit direction (world x, z) of a building's front and the door rotation. */
export function frontOffset(rotation: number): [number, number, number] {
  switch (rotation) {
    case 90:
      return [-1, 0, Math.PI / 2];
    case 180:
      return [0, 1, 0];
    case 270:
      return [1, 0, Math.PI / 2];
    default:
      return [0, -1, 0];
  }
}
