// Model registry (ART_DIRECTION §7): the asset manifest
// (/models/manifest.json, fetched once) and the kit-bashed GLBs it lists,
// loaded lazily the first time a model file is drawn — through the glTF
// 2.0 loader of @babylonjs/loaders — and kept as plain vertex data
// (positions, normals, palette vertex colours, indices). The layers build
// their own meshes from it with the renderer's material family, so the
// loader's PBR material never reaches the scene. A failed fetch or parse
// keeps the procedural placeholder for that model (warned once).
//
// Coordinates: the GLBs are in tiles, y up, buildings with their front
// (the door at rotation 0) toward −z, ships with the bow toward +x. The
// scene is left-handed: buildings map glTF (x, y, z) to world (−x, y, z)
// — the glTF loader's own handedness conversion — and ships to (x, y, −z)
// (the same conversion turned 180°, so that the bow stays at +X as
// shipMatrix expects). The mirror keeps glTF's counter-clockwise front
// faces front-facing in the left-handed scene (the loader gets the same
// effect from its negative-scale root node), so the indices stay as they
// are.
//
// Pure helpers (variant choice, transforms, anchors) are exported for tests.
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { rotatedFootprint } from "../display/geometry";
import { skyFill } from "./lighting";

/** Manifest file entry (one GLB). */
export interface ModelFile {
  path: string;
  triangles: number;
  bytes: number;
  sha256: string;
  budget?: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** The lite detail level of this model (drawn at the near-LOD default zoom). */
  lite?: ModelFile;
}

/** Manifest model entry (one content ID). */
export interface ModelEntry {
  kind: "building" | "field" | "ship";
  footprint?: { w: number; h: number };
  file?: ModelFile;
  variants?: ModelFile[];
  levels?: Record<string, ModelFile>;
  attachments?: Record<string, ModelFile>;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  anchors: { door?: [number, number, number]; status: [number, number, number]; chimney?: [number, number, number]; smoke?: [number, number, number] };
  ship?: { length_tiles: number; masts: number; sail_scale: number };
  budget_exception?: { reason: string };
}

/** Manifest decoration entry (trees, bushes, rocks, tufts, stumps, outcrops; IDs decor_*). */
export interface DecorEntry {
  kind: "decor";
  file: ModelFile;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface ModelManifest {
  version: number;
  palette_sha256: string;
  missing_recipes: string[];
  models: Record<string, ModelEntry>;
  decor?: Record<string, DecorEntry>;
}

/** Vertex data of a loaded model (glTF space as in the file). */
export interface ModelData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Which detail level to draw: the full model, or the lite one at the near default zoom. */
export type Detail = "full" | "lite";

/** Default status icon height (tiles) without a model anchor. */
export const DEFAULT_STATUS_Y = 1.6;
/** Default building height (tiles) the contact shadows lean for without a model. */
export const DEFAULT_MODEL_HEIGHT = 0.7;

/** 32-bit FNV-1a hash of a building ID (stable across sessions; no Math.random). */
export function stableHash(id: number | string): number {
  let h = 0x811c9dc5;
  for (const ch of String(id)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Final avalanche so that consecutive IDs spread over the variants.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** Variant of a building: stableHash(buildingId) mod n. */
export function variantIndex(buildingId: number, n: number): number {
  return n > 0 ? stableHash(buildingId) % n : 0;
}

/** The model file of a building (variant by ID, warehouse level from the payload; above the highest available → highest). */
export function modelFileFor(entry: ModelEntry, b: Pick<BuildingDisplay, "id" | "level">): ModelFile | undefined {
  if (entry.variants && entry.variants.length > 0) return entry.variants[variantIndex(b.id, entry.variants.length)];
  if (entry.levels) {
    const levels = Object.keys(entry.levels)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, c) => a - c);
    if (levels.length === 0) return entry.file;
    const want = Math.max(1, Math.floor(b.level ?? 1));
    const pick = [...levels].reverse().find((l) => l <= want) ?? levels[0];
    return entry.levels[String(pick)];
  }
  return entry.file;
}

/** The file to draw at a detail level (the lite file when asked for and present). */
export function atDetail(file: ModelFile, detail: Detail): ModelFile {
  return detail === "lite" && file.lite ? file.lite : file;
}

/** Cache-busting URL of a model file: /models/<path>?v=<first 8 hex of its sha256>. */
export function modelUrl(base: string, file: ModelFile): string {
  return `${base}${file.path}?v=${file.sha256.slice(0, 8)}`;
}

/** World point of a model-space point for a model kind (see the header). */
export function toWorld(kind: ModelEntry["kind"], p: readonly [number, number, number]): [number, number, number] {
  return kind === "ship" ? [p[0], p[1], -p[2]] : [-p[0], p[1], p[2]];
}

/**
 * Vertex data in world orientation (buildings: x → −x; ships: z → −z);
 * ships additionally scaled to unit length (the ship layers scale
 * instances by the LOD's ship scale, like the placeholder).
 */
export function worldData(kind: ModelEntry["kind"], data: ModelData, scale = 1): ModelData {
  const axis = kind === "ship" ? 2 : 0;
  const positions = new Float32Array(data.positions.length);
  const normals = new Float32Array(data.normals.length);
  for (let i = 0; i < positions.length; i++) {
    const s = i % 3 === axis ? -1 : 1;
    positions[i] = (data.positions[i] as number) * s * scale;
    normals[i] = (data.normals[i] as number) * s;
  }
  return { positions, normals, colors: data.colors, indices: data.indices };
}

/** Yaw (radians, Babylon RotationY) that turns a building's front to frontOffset(rotation). */
export function rotationYaw(rotation: number): number {
  return ((((rotation % 360) + 360) % 360) * Math.PI) / 180;
}

/**
 * XZ scale of a model in a footprint: 1 unless the content footprint
 * differs from the manifest's (robustness against content edits), then
 * the model stretches to the content footprint.
 */
export function footprintScale(entry: ModelEntry, def: Pick<ContentBuilding, "width" | "height">): { sx: number; sz: number } {
  const fp = entry.footprint;
  if (!fp || (fp.w === def.width && fp.h === def.height)) return { sx: 1, sz: 1 };
  return { sx: def.width / fp.w, sz: def.height / fp.h };
}

/** Rotates a world-oriented model offset (x, z) about y like Babylon's RotationY(yaw). */
export function rotateXZ(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/**
 * World (island-local) placement of a building model: footprint centre,
 * yaw and XZ scale; and the rotated world-space bounds (x, z rectangle and
 * height) used by the contact shadow and the selection frame.
 */
export function placement(entry: ModelEntry, def: ContentBuilding, b: Pick<BuildingDisplay, "x" | "y" | "rotation">) {
  const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
  const cx = b.x + w / 2;
  const cz = -(b.y + h / 2);
  const yaw = rotationYaw(b.rotation);
  const { sx, sz } = footprintScale(entry, def);
  const lo = toWorld(entry.kind, entry.bounds.min);
  const hi = toWorld(entry.kind, entry.bounds.max);
  const xs: number[] = [];
  const zs: number[] = [];
  for (const x of [lo[0], hi[0]]) {
    for (const z of [lo[2], hi[2]]) {
      const [rx, rz] = rotateXZ(x * sx, z * sz, yaw);
      xs.push(rx);
      zs.push(rz);
    }
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    cx,
    cz,
    yaw,
    sx,
    sz,
    rect: { cx: cx + (minX + maxX) / 2, cz: cz + (minZ + maxZ) / 2, w: maxX - minX, h: maxZ - minZ },
    height: Math.max(0.1, entry.bounds.max[1]),
  };
}

/** World offset (from the footprint centre) of a model anchor at a rotation, or null without one. */
export function anchorOffset(entry: ModelEntry, name: "door" | "status" | "chimney" | "smoke", rotation: number): [number, number, number] | null {
  const a = entry.anchors[name];
  if (!a) return null;
  const w = toWorld(entry.kind, a);
  const [x, z] = rotateXZ(w[0], w[2], rotationYaw(rotation));
  return [x, w[1], z];
}

/** Status icon height of a building (the model's status anchor, else the default). */
export function statusHeight(entry: ModelEntry | undefined): number {
  return entry?.anchors.status[1] ?? DEFAULT_STATUS_Y;
}

/** Every model file of an entry (main files, their lite levels and attachments). */
export function entryFiles(entry: ModelEntry): ModelFile[] {
  const main = [entry.file, ...(entry.variants ?? []), ...Object.values(entry.levels ?? {})].filter((f): f is ModelFile => !!f);
  const out: ModelFile[] = [];
  for (const f of main) {
    out.push(f);
    if (f.lite) out.push(f.lite);
  }
  out.push(...Object.values(entry.attachments ?? {}));
  return out;
}

/** Parses GLB bytes into model data (the glTF 2.0 loader of @babylonjs/loaders; one mesh, as the export profile guarantees). */
export async function parseGlb(bytes: Uint8Array, scene: Scene): Promise<ModelData> {
  // skipMaterials: the layers draw with their own material, so the loader never creates (or lazily imports) a PBR material.
  const container = await LoadAssetContainerAsync(bytes, scene, { pluginExtension: ".glb", pluginOptions: { gltf: { skipMaterials: true } } });
  try {
    const meshes = container.meshes.filter((m) => m.getTotalVertices() > 0);
    const mesh = meshes[0];
    if (meshes.length !== 1 || !mesh) throw new Error(`expected one mesh, got ${meshes.length}`);
    const positions = mesh.getVerticesData("position");
    const normals = mesh.getVerticesData("normal");
    const colors = mesh.getVerticesData("color");
    const indices = mesh.getIndices();
    if (!positions || !normals || !colors || !indices) throw new Error("missing POSITION, NORMAL, COLOR_0 or indices");
    const vertices = positions.length / 3;
    // COLOR_0 may come as RGB or RGBA; the layers use RGBA.
    const rgba = colors.length === vertices * 4 ? Float32Array.from(colors) : expandRgb(colors, vertices);
    return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), colors: rgba, indices: Uint32Array.from(indices) };
  } finally {
    container.dispose();
  }
}

function expandRgb(colors: ArrayLike<number>, vertices: number): Float32Array {
  const out = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) {
    out[i * 4] = colors[i * 3] as number;
    out[i * 4 + 1] = colors[i * 3 + 1] as number;
    out[i * 4 + 2] = colors[i * 3 + 2] as number;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** A mesh of world-oriented model data with the renderer's material family (flat sky-filled StandardMaterial, vertex colours). */
export function modelMesh(scene: Scene, name: string, data: ModelData, material?: StandardMaterial): Mesh {
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = data.positions;
  vd.normals = data.normals;
  vd.colors = data.colors;
  vd.indices = data.indices;
  vd.applyToMesh(mesh);
  if (material) mesh.material = material;
  else {
    const mat = skyFill(new StandardMaterial(name, scene));
    mat.specularColor = Color3.Black();
    mesh.material = mat;
  }
  mesh.isPickable = false;
  return mesh;
}

/**
 * The loaded model of a ship type in world orientation, scaled to unit
 * length (the ship layers scale instances like the placeholder), with its
 * cargo attachment; null while loading or without a model (requests the
 * files). A failed cargo attachment leaves the hull without crates.
 */
export function shipModel(registry: ModelRegistry, type: string): { hull: ModelData; cargo: ModelData | null } | null {
  const entry = registry.entry(type);
  if (!entry || entry.kind !== "ship" || !entry.file) return null;
  const length = entry.ship?.length_tiles ?? 1;
  const hull = registry.request(entry.file);
  const cargoFile = entry.attachments?.cargo;
  const cargo = cargoFile ? registry.request(cargoFile) : null;
  if (!hull || (cargoFile && !cargo && !registry.failed(cargoFile))) return null;
  return { hull: worldData("ship", hull, 1 / length), cargo: cargo ? worldData("ship", cargo, 1 / length) : null };
}

/**
 * World-oriented vertex data of a decoration piece (x → −x like the
 * buildings), or null while loading or without one (requests the file).
 */
const worldDecor = new WeakMap<ModelData, ModelData>();
export function decorModel(registry: ModelRegistry | null, id: string): ModelData | null {
  const entry = registry?.decor(id);
  if (!registry || !entry) return null;
  const data = registry.request(entry.file);
  if (!data) return null;
  let w = worldDecor.get(data);
  if (!w) worldDecor.set(data, (w = worldData("building", data)));
  return w;
}

/** Meshes of a ship model (thin-instanced by the caller; always active, the instances move). */
export function shipMeshes(scene: Scene, name: string, model: { hull: ModelData; cargo: ModelData | null }): { hull: Mesh; cargo: Mesh | null } {
  const hull = modelMesh(scene, name, model.hull);
  hull.alwaysSelectAsActiveMesh = true;
  let cargo: Mesh | null = null;
  if (model.cargo) {
    cargo = modelMesh(scene, `${name}_cargo`, model.cargo, hull.material as StandardMaterial);
    cargo.alwaysSelectAsActiveMesh = true;
  }
  return { hull, cargo };
}

/** Loading state of the registry (test hook). */
export interface AssetsStatus {
  manifest: boolean;
  /** Model files loaded, pending and failed (paths). */
  loaded: string[];
  pending: string[];
  failed: string[];
  /** GLB bytes fetched. */
  bytes: number;
  /** performance.now() of the first rendered frame that drew a model (null: none yet; markRendered). */
  firstModelMs: number | null;
}

export interface RegistryOptions {
  /** URL prefix of the models (default "/models/"). */
  base?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  parse?: (bytes: Uint8Array, scene: Scene) => Promise<ModelData>;
  now?: () => number;
  warn?: (msg: string) => void;
}

/**
 * The manifest and the lazily loaded model files of one scene. request()
 * returns the data of a file once loaded (null before, starting the load
 * on the first call); listeners hear about every finished load so the
 * layers can swap placeholders on their next update.
 */
export class ModelRegistry {
  private manifestData: ModelManifest | null = null;
  private manifestState: "idle" | "loading" | "ready" | "failed" = "idle";
  private readonly data = new Map<string, ModelData>();
  private readonly pendingFiles = new Set<string>();
  private readonly failedFiles = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private fetched = 0;
  private first: number | null = null;
  private readonly base: string;
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly parseFn: (bytes: Uint8Array, scene: Scene) => Promise<ModelData>;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;

  constructor(
    private readonly scene: Scene,
    opts: RegistryOptions = {},
  ) {
    this.base = opts.base ?? "/models/";
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.parseFn = opts.parse ?? parseGlb;
    this.now = opts.now ?? (() => performance.now());
    this.warn = opts.warn ?? ((msg) => console.warn(msg));
  }

  /** Fetches the manifest once (no-cache: it changes with every asset build); resolves when it is known or failed. */
  loadManifest(): Promise<void> {
    if (this.manifestState !== "idle") return Promise.resolve();
    this.manifestState = "loading";
    return this.fetchFn(`${this.base}manifest.json`, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ModelManifest>;
      })
      .then((m) => {
        this.manifestData = m;
        this.manifestState = "ready";
        this.notify();
      })
      .catch((e: unknown) => {
        this.manifestState = "failed";
        this.warn(`models: manifest unavailable, placeholders only (${String(e)})`);
      });
  }

  manifest(): ModelManifest | null {
    return this.manifestData;
  }

  /** The manifest entry of a content ID (undefined: no model, the placeholder stays). */
  entry(id: string): ModelEntry | undefined {
    return this.manifestData?.models[id];
  }

  /** The manifest entry of a decoration piece (undefined: none, the procedural fallback stays). */
  decor(id: string): DecorEntry | undefined {
    return this.manifestData?.decor?.[id];
  }

  /** Loaded data of a model file, or null (starts loading it on the first request). */
  request(file: ModelFile): ModelData | null {
    const d = this.data.get(file.path);
    if (d) return d;
    if (this.pendingFiles.has(file.path) || this.failedFiles.has(file.path)) return null;
    this.pendingFiles.add(file.path);
    void this.load(file);
    return null;
  }

  /** Loaded data of a model file without starting a load (null: not loaded). */
  peek(file: ModelFile): ModelData | null {
    return this.data.get(file.path) ?? null;
  }

  /** Whether a file failed to load (its content ID keeps the placeholder). */
  failed(file: ModelFile): boolean {
    return this.failedFiles.has(file.path);
  }

  private async load(file: ModelFile): Promise<void> {
    try {
      const r = await this.fetchFn(modelUrl(this.base, file));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      this.fetched += bytes.length;
      const data = await this.parseFn(bytes, this.scene);
      this.data.set(file.path, data);
    } catch (e) {
      this.failedFiles.add(file.path);
      const id = file.path.split(".")[0] ?? file.path;
      if (!this.warned.has(id)) {
        this.warned.add(id);
        this.warn(`models: ${file.path} failed (${String(e)}); ${id} keeps its placeholder`);
      }
    } finally {
      this.pendingFiles.delete(file.path);
      this.notify();
    }
  }

  /** Whether a frame with a model has been rendered (markRendered was called). */
  rendered(): boolean {
    return this.first !== null;
  }

  /** Records the first rendered frame that drew a model (firstModelMs; later calls are ignored). */
  markRendered(): void {
    this.first ??= this.now();
  }

  /** Called after every finished load (success or failure) and when the manifest arrives. */
  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  status(): AssetsStatus {
    return {
      manifest: this.manifestState === "ready",
      loaded: [...this.data.keys()].sort(),
      pending: [...this.pendingFiles].sort(),
      failed: [...this.failedFiles].sort(),
      bytes: this.fetched,
      firstModelMs: this.first,
    };
  }
}
