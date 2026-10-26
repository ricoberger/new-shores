// Per-island detail of the continuous world (D-048): terrain, buildings,
// fields, roads, status icons and construction hulls of one island
// under a node at the island's archipelago position, so local tile (x, y)
// is world (position.x + x, 0, −(position.y + y)). Built lazily (when the
// island is first shown) and rebuilt on payload changes while shown. Every
// LOD draws the same diorama: terrain (ground, slab, plateaus, outcrops),
// roads, contact shadows, the kit-bashed models of buildings and fields,
// trees and ground scatter. The level of detail only toggles pre-built
// geometry: the full models and the full slab profile at near and mid,
// the lite models and the coarser slab at far; status icons,
// construction hulls and foam at near only. The island's life plan (carts,
// walkers, …) is drawn by the renderer's life layer (render/life.ts). Buildings, fields and ships
// are kit-bashed models where the manifest has them (render/models.ts),
// placeholders otherwise. The static layers — terrain, trees and scatter,
// roads and fields, and the merged building models — are built per chunk
// (display/chunks.ts) under a node per chunk: the renderer culls them per
// chunk (setVisibleChunks) and a payload change rebuilds only the chunks
// whose inputs changed. Contact shadows, plateaus, outcrops, foam, icons
// and the harbour stay per island.
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding, Island, IslandDisplay } from "../api/client";
import { type CoastLoop, coastline } from "../display/coastline";
import type { Lod } from "../display/lod";
import { IslandLife } from "../display/lifeplan";
import { blockedTiles, islandSeed, layerKeys, type Placed, type ScatterKind, scatterGround, scatterTrees, thinningAreas } from "../display/scatter";
import { byChunk, chunkAt } from "../display/chunks";
import { BuildingLayer } from "./buildings";
import { Chunked } from "./chunked";
import { FieldDecor, fieldDecorMaterial, FieldTiles } from "./fields";
import { ConstructionLayer } from "./harbour";
import { IconLayer } from "./icons";
import { footprintBox } from "./coords";
import { type Detail, DEFAULT_MODEL_HEIGHT, type ModelRegistry, placement, rotateXZ, statusHeight, toWorld } from "./models";
import { OutcropLayer } from "./outcrops";
import { footprintTiles, PlateauLayer } from "./plateaus";
import { roadMaterial, RoadLayer, type RoadTile } from "./roads";
import { FootprintShadows } from "./shadows";
import { buildTerrain, FoamLine } from "./terrain";
import { type DecorMaterials, decorMaterials, Decoration, FarTrees, muteScatter, TREE_MODELS } from "./trees";

/** One chunk's decoration input. */
interface DecorInput {
  trees: Placed[];
  ground: (Placed & { kind: ScatterKind })[];
  stumps: Placed[];
}

const placedSig = (p: Placed) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.variant},${p.scale.toFixed(3)},${p.yaw.toFixed(3)}`;

/** Contact shadow of a building: a soft rounded rectangle at its model's bounds, fading out over this many tiles. */
const BUILDING_SHADOW_RIM = 0.4;
/** Height (tiles) the blob shadows of buildings without a model lean for. */
const BUILDING_HEIGHT = DEFAULT_MODEL_HEIGHT;

export class IslandDetail {
  readonly root: TransformNode;
  /** The models, fields and decoration (every LOD). */
  private readonly models: TransformNode;
  /** Status icons, construction hulls and foam (near LOD). */
  private readonly near: TransformNode;
  private readonly buildings: BuildingLayer;
  /** Static layers per chunk (display/chunks.ts). */
  private readonly fields: Chunked<FieldTiles, BuildingDisplay[]>;
  private readonly fieldDecor: Chunked<FieldDecor, BuildingDisplay[]>;
  private readonly decoration: Chunked<Decoration, DecorInput>;
  private readonly roads: Chunked<RoadLayer, RoadTile[]>;
  /** The road tiles of the island ("x,y"): road joins across a chunk's edge. */
  private roadSet = new Set<string>();
  /** The chunk nodes (enabled while the chunk is in view). */
  private readonly chunkNodes = new Map<string, TransformNode>();
  /** The chunks in view (null: all). */
  private visibleChunks: ReadonlySet<string> | null = null;
  private readonly decorMaterials: DecorMaterials;
  /** The island's trees at far LOD (one merged mesh of simple crowns). */
  private readonly farTrees: FarTrees;
  /** Life plan of this island (drawn by the renderer's life layer while shown). */
  readonly life = new IslandLife();
  private readonly icons: IconLayer;
  private readonly construction: ConstructionLayer;
  private readonly buildingBlobs: FootprintShadows;
  private readonly outcrops: OutcropLayer;
  private readonly plateaus: PlateauLayer;
  private foam: FoamLine | null = null;
  private terrain: { lite: Mesh[]; full: Mesh[] } = { lite: [], full: [] };
  /** Model detail (full at near and mid, lite at far): the terrain's slab profile follows it. */
  private detail: Detail = "full";
  /** Smoothed coastline of the static terrain and the decoration seed (island ID + revision). */
  private loops: CoastLoop[] = [];
  private seed = 0;
  private statics: Island | null = null;
  /** Inputs of the merged layers last built (display/scatter.ts layerKeys; null: rebuild all). */
  private keys: ReturnType<typeof layerKeys> | null = null;
  /** Merged-layer rebuilds of this island (roads, layout, decoration), for tests and profiling. */
  readonly rebuilds = { roads: 0, layout: 0, decoration: 0 };
  /** The chunks each chunked layer rebuilt in its last rebuild (tests and profiling). */
  readonly chunkRebuilds: { roads: string[]; fields: string[]; decoration: string[] } = { roads: [], fields: [], decoration: [] };
  private terrainKey = "";
  /** The display payload and content the layers were built from (identity). */
  private builtFrom: { display: IslandDisplay; defs: ReadonlyMap<string, ContentBuilding> } | null = null;
  private lod: Lod = "near";
  /** Settled (from the payload): an unsettled island is drawn muted at far LOD. */
  private settled = true;
  private shown = false;
  private deposits: Island["deposits"] = [];

  constructor(
    private readonly scene: Scene,
    readonly id: string,
    position: { x: number; y: number },
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.root = new TransformNode(`island_${id}`, scene);
    this.root.position.set(position.x, 0, -position.y);
    this.models = new TransformNode(`island_${id}_models`, scene);
    this.models.parent = this.root;
    this.near = new TransformNode(`island_${id}_near`, scene);
    this.near.parent = this.root;
    this.buildings = new BuildingLayer(scene, this.models, registry);
    const fieldMaterials = new Map<string, StandardMaterial>();
    const fieldSig = (bs: BuildingDisplay[]) => bs.map((b) => `${b.id}:${b.type}:${b.x},${b.y}`).join(";");
    this.fields = new Chunked(
      (k) => new FieldTiles(scene, this.chunkNode(k), fieldMaterials),
      (l, bs) => l.update(bs, this.builtFrom?.defs ?? new Map()),
      (l) => l.dispose(),
      fieldSig,
    );
    const decorMaterial = fieldDecorMaterial(scene);
    this.fieldDecor = new Chunked(
      (k) => new FieldDecor(scene, this.chunkNode(k), decorMaterial),
      (l, bs) => l.update(bs, this.builtFrom?.defs ?? new Map()),
      (l) => l.dispose(),
      fieldSig,
    );
    this.decorMaterials = decorMaterials(scene, id);
    this.farTrees = new FarTrees(scene, id, this.models, this.decorMaterials.material, registry);
    this.decoration = new Chunked(
      (k) => new Decoration(scene, `${id}_${k}`, this.chunkNode(k), registry, this.decorMaterials),
      (l, d) => l.update(d.trees, d.ground, d.stumps, (x, y) => this.plateaus.heightAt(x, y)),
      (l) => l.dispose(),
      (d) => `${d.trees.map(placedSig).join(";")}|${d.ground.map((p) => `${p.kind}${placedSig(p)}@${this.plateaus.heightAt(Math.floor(p.x), Math.floor(p.y))}`).join(";")}|${d.stumps.map(placedSig).join(";")}`,
    );
    const roads = roadMaterial(scene);
    const has = (x: number, y: number) => this.roadSet.has(`${x},${y}`);
    this.roads = new Chunked(
      (k) => new RoadLayer(scene, this.chunkNode(k), roads),
      (l, tiles) => l.update(tiles, has),
      (l) => l.dispose(),
      // A tile's joins depend on its four neighbours (also across the chunk's edge).
      (tiles) => tiles.map((t) => `${t.x},${t.y},${t.type ?? ""},${[has(t.x, t.y - 1), has(t.x, t.y + 1), has(t.x - 1, t.y), has(t.x + 1, t.y)].map(Number).join("")}`).join(";"),
    );
    this.icons = new IconLayer(scene, this.near);
    this.construction = new ConstructionLayer(scene, this.near, registry);
    this.buildingBlobs = new FootprintShadows(scene, `blob_buildings_${id}`, this.root, 0.55);
    this.outcrops = new OutcropLayer(scene, this.root, registry);
    this.plateaus = new PlateauLayer(scene, this.root, registry);
    this.root.setEnabled(false);
  }

  /** Construction stages instead of the rise-in (the life layer; off with ?life=0). */
  setStages(on: boolean): void {
    this.buildings.stages = on;
  }

  /** Construction-stage instances drawn in the last frame (e2e). */
  stageCounts(): Record<string, number> {
    return this.buildings.stageCounts();
  }

  /** Moves the node when the island's position changed. */
  setPosition(p: { x: number; y: number }): void {
    if (this.root.position.x === p.x && this.root.position.z === -p.y) return;
    this.root.position.set(p.x, 0, -p.y);
    this.root.computeWorldMatrix(true);
    for (const n of this.chunkNodes.values()) n.computeWorldMatrix(true);
    for (const m of this.root.getChildMeshes()) if (m.isWorldMatrixFrozen) m.freezeWorldMatrix();
  }

  /** Rebuilds the terrain when the static data changed. */
  setStatics(statics: Island, settled = true): void {
    const key = `${statics.revision}|${statics.id}|${settled}`;
    this.settled = settled;
    this.applyMuted();
    if (key === this.terrainKey) return;
    for (const m of [...this.terrain.lite, ...this.terrain.full]) m.dispose();
    this.root.computeWorldMatrix(true);
    this.seed = islandSeed(statics.id, statics.revision);
    this.loops = coastline(statics);
    this.terrain = buildTerrain(this.scene, statics, this.loops, this.seed, (k) => this.chunkNode(k), settled, this.root);
    this.applyTerrainDetail();
    this.deposits = statics.deposits;
    this.statics = statics;
    this.updateRelief();
    this.foam ??= new FoamLine(this.scene, this.near, this.seed);
    this.foam.update(this.loops);
    this.terrainKey = key;
    this.statics = statics;
    // The decoration depends on the terrain too: rebuild with the next update.
    this.builtFrom = null;
    this.keys = null;
  }

  /** Whether the island is drawn with its full tiles (terrain and layers built). */
  hasTiles(): boolean {
    return this.statics !== null && this.builtFrom !== null;
  }

  /** Whether the layers reflect this payload and content. */
  builtWith(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): boolean {
    return this.builtFrom?.display === display && this.builtFrom.defs === defs;
  }

  /**
   * Brings the layers up to date with the island's payload. The instanced
   * layers (buildings, field tiles, icons, construction) and the life plan follow
   * every payload; the merged static meshes (roads, contact
   * shadows, field decoration, trees and scatter) are rebuilt only when
   * their inputs on this island changed (layerKeys) — per island, never
   * for the whole world.
   */
  update(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): void {
    const defsChanged = this.builtFrom?.defs !== defs;
    this.builtFrom = { display, defs };
    this.buildings.update(display.buildings, defs);
    this.chunkRebuilds.fields = this.fields.update(this.fieldsByChunk(display), defsChanged);
    this.life.update(display, defs, this.statics, this.smokeAnchor);
    this.icons.update(display.buildings, defs, this.statusY);
    this.construction.update(display, defs);
    const keys = layerKeys(display, defs);
    const old = defsChanged ? null : this.keys;
    this.keys = keys;
    if (old?.roads !== keys.roads) {
      this.rebuilds.roads++;
      this.roadSet = new Set(display.roads.map((t) => `${t.x},${t.y}`));
      this.chunkRebuilds.roads = this.roads.update(byChunk(display.roads, (t) => t), old === null);
    }
    if (old?.layout !== keys.layout) {
      this.rebuilds.layout++;
      this.fieldDecor.update(this.fieldsByChunk(display), old === null);
      this.updateBlobs(display, defs);
      this.updateRelief();
    }
    if (old?.decoration !== keys.decoration) {
      this.rebuilds.decoration++;
      this.updateDecoration(display, defs, old === null);
    }
  }

  /** The chunk node of a key (created on first use, enabled while in view). */
  private chunkNode(key: string): TransformNode {
    let n = this.chunkNodes.get(key);
    if (!n) {
      n = new TransformNode(`island_${this.id}_chunk_${key}`, this.scene);
      n.parent = this.root;
      n.setEnabled(this.visibleChunks === null || this.visibleChunks.has(key));
      n.computeWorldMatrix(true);
      this.chunkNodes.set(key, n);
    }
    return n;
  }

  /** The island chunks in view (null: all): only their static layers and building models are drawn. */
  setVisibleChunks(keys: ReadonlySet<string> | null): void {
    const same = keys === this.visibleChunks || (keys !== null && this.visibleChunks !== null && keys.size === this.visibleChunks.size && [...keys].every((k) => this.visibleChunks?.has(k)));
    if (same) return;
    this.visibleChunks = keys;
    for (const [k, n] of this.chunkNodes) n.setEnabled(keys === null || keys.has(k));
    this.buildings.setVisibleChunks(keys);
  }

  /** The chunks in view (null: all; tests and the life layer). */
  chunksInView(): ReadonlySet<string> | null {
    return this.visibleChunks;
  }

  /** The unmodelled fields by chunk. */
  private fieldsByChunk(display: IslandDisplay): Map<string, BuildingDisplay[]> {
    const defs = this.builtFrom?.defs;
    return byChunk(
      this.unmodelledFields(display).filter((b) => defs?.get(b.type)?.field),
      (b) => b,
    );
  }

  /**
   * Trees (thinned by forest harvesters) and ground scatter, kept off
   * buildings, fields and roads: placed for the whole island (seeded, so
   * an unchanged chunk places the same), rebuilt only in the chunks whose
   * placements changed.
   */
  private updateDecoration(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>, force = false): void {
    const st = this.statics;
    if (!st) return;
    const input = { width: st.width, height: st.height, terrain: st.terrain, seed: this.seed, blocked: blockedTiles(display.buildings, display.roads, defs) };
    const stumps: Placed[] = [];
    const trees = scatterTrees(input, thinningAreas(display.buildings, defs), TREE_MODELS.length, stumps);
    const chunks = new Map<string, DecorInput>();
    const at = (k: string) => {
      let c = chunks.get(k);
      if (!c) chunks.set(k, (c = { trees: [], ground: [], stumps: [] }));
      return c;
    };
    const key = (p: Placed) => chunkAt(p.x, p.y, st.width, st.height);
    for (const p of trees) at(key(p)).trees.push(p);
    for (const p of scatterGround(input)) at(key(p)).ground.push(p);
    for (const p of stumps) at(key(p)).stumps.push(p);
    this.chunkRebuilds.decoration = this.decoration.update(chunks, force);
    for (const d of this.decoration.values()) d.setFar(this.lod === "far");
    this.farTrees.setTrees(trees);
  }

  /** Status icon height of a building: its model's status anchor (else the default). */
  private readonly statusY = (b: { type: string }): number => statusHeight(this.registry?.entry(b.type));

  /** The payload without the fields drawn as models (the field layers draw the rest). */
  private unmodelledFields(display: IslandDisplay): IslandDisplay["buildings"] {
    const modelled = this.buildings.modelled();
    return modelled.size === 0 ? display.buildings : display.buildings.filter((b) => !modelled.has(b.id));
  }

  /** Plateaus and the deposit outcrops on them (mines and quarries keep their tiles at ground level). */
  private updateRelief(): void {
    const st = this.statics;
    if (!st) return;
    const blocked = this.footprintTiles();
    this.plateaus.update(st, this.seed, blocked);
    this.outcrops.update(this.deposits, this.seed, blocked, (x, y) => this.plateaus.heightAt(x, y));
  }

  /** Tiles covered by a building footprint ("x,y"; outcrops stay out of them). */
  private footprintTiles(): Set<string> {
    const built = this.builtFrom;
    return built ? footprintTiles(built.display.buildings, built.defs) : new Set();
  }


  /**
   * Contact shadows under every building (trees and ships keep their
   * discs): a soft rounded rectangle at the model's rotated bounds,
   * leaning for its height, where the manifest has a model, else at the
   * footprint with a default height.
   */
  private updateBlobs(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): void {
    const rects = [];
    for (const b of display.buildings) {
      const def = defs.get(b.type);
      if (!def || def.category === "roads" || def.field) continue;
      const entry = this.registry?.entry(b.type);
      if (entry && entry.kind === "building") {
        const p = placement(entry, def, b);
        rects.push({ ...p.rect, height: p.height });
      } else rects.push(footprintBox(b.x, b.y, def.width, def.height, b.rotation));
    }
    this.buildingBlobs.update(rects, BUILDING_SHADOW_RIM, BUILDING_HEIGHT);
  }

  /** A model finished loading or the manifest arrived: swaps placeholders and re-anchors icons and shadows. */
  refreshModels(): void {
    const built = this.builtFrom;
    if (!built) return;
    this.buildings.refresh();
    this.fields.update(this.fieldsByChunk(built.display));
    this.fieldDecor.update(this.fieldsByChunk(built.display));
    this.icons.update(built.display.buildings, built.defs, this.statusY);
    this.updateBlobs(built.display, built.defs);
    this.updateRelief();
    if ([...this.decoration.values()].some((d) => d.needsModels())) {
      this.rebuilds.decoration++;
      this.updateDecoration(built.display, built.defs, true);
    }
  }

  /** Model detail level (full at near and mid, lite at far). */
  setDetail(detail: Detail): void {
    this.detail = detail;
    this.applyTerrainDetail();
    const before = [...this.buildings.modelled()].join();
    this.buildings.setDetail(detail);
    const built = this.builtFrom;
    // Only when the detail changed which fields are modelled (a file still loading): no rebuild on a plain zoom.
    if (built && [...this.buildings.modelled()].join() !== before) {
      this.fields.update(this.fieldsByChunk(built.display));
      this.fieldDecor.update(this.fieldsByChunk(built.display));
    }
  }

  /** Content IDs drawn with a placeholder (shown; fields included). */
  placeholders(): string[] {
    if (!this.shown || !this.builtFrom) return [];
    const out = new Set(this.buildings.placeholders());
    const hull = this.construction.placeholder();
    if (hull) out.add(hull);
    const modelled = this.buildings.modelled();
    for (const b of this.builtFrom.display.buildings) {
      if (this.builtFrom.defs.get(b.type)?.field && !modelled.has(b.id)) out.add(b.type);
    }
    return [...out];
  }

  /** Meshes casting into the sun shadow map: the buildings while shown at near LOD. */
  shadowCasters(): AbstractMesh[] {
    if (!this.shown || this.lod !== "near") return [];
    const trees = [...this.decoration.entries()].filter(([k]) => this.visibleChunks === null || this.visibleChunks.has(k)).flatMap(([, d]) => d.casters());
    return [...this.buildings.meshes(), ...trees];
  }

  /** Shown (in view) or hidden, and the level of detail. */
  setShown(shown: boolean, lod: Lod): void {
    if (shown !== this.shown) {
      this.shown = shown;
      this.root.setEnabled(shown);
    }
    if (lod !== this.lod) {
      this.lod = lod;
      this.near.setEnabled(lod === "near");
      for (const d of this.decoration.values()) d.setFar(lod === "far");
      this.applyMuted();
    }
    this.farTrees.setShown(this.shown && this.lod === "far");
  }

  /** Unsettled islands at far LOD: the ground scatter tinted down (the desaturated ground is the terrain's lite set). */
  private applyMuted(): void {
    muteScatter(this.decorMaterials.scatterMaterial, this.lod === "far" && !this.settled);
  }

  /** Whether the ground scatter is drawn muted (tests). */
  mutedScatter(): boolean {
    return this.decorMaterials.scatterMaterial.diffuseColor.r < 1;
  }

  /** Trading Posts and shipyards drawn (shown at far LOD: the landmarks of the archipelago view). */
  landmarks(): number {
    const built = this.builtFrom;
    if (!this.shown || this.lod !== "far" || !built) return 0;
    return built.display.buildings.filter((b) => {
      const def = built.defs.get(b.type);
      return def?.trading_post !== undefined || def?.shipyard !== undefined;
    }).length;
  }

  /** The full slab profile with the full models; the coarse one with the lite models (far LOD). */
  private applyTerrainDetail(): void {
    const full = this.detail === "full";
    for (const m of this.terrain.full) m.setEnabled(full);
    for (const m of this.terrain.lite) m.setEnabled(!full);
  }

  /** Camera rotation (quarter turns, continuous; status icons face the camera). */
  setRotation(step: number): void {
    this.icons.setRotation(step);
  }

  /** Building selection frame (undefined: none on this island). */
  select(...args: Parameters<BuildingLayer["select"]>): void {
    this.buildings.select(...args);
  }

  /**
   * Rising buildings (shown), construction hulls and foam (near
   * LOD). Returns true when the building meshes were replaced (the shadow
   * casters need a refresh).
   */
  frame(nowMs: number): boolean {
    if (!this.shown) return false;
    const casters = this.buildings.frame(nowMs);
    if (this.lod !== "near") return casters;
    this.foam?.frame(nowMs);
    this.construction.frame(nowMs);
    return casters;
  }

  /** Buildings drawn with the other detail's model until the wanted one has loaded (shown). */
  bridged(): number {
    return this.shown ? this.buildings.bridged() : 0;
  }

  /** Whether a kit-bashed building or field model is drawn (shown). */
  drawsModels(): boolean {
    return this.shown && this.buildings.modelled().size > 0;
  }

  /** Trees and ground scatter items built (decoration, every LOD). */
  decorationCounts(): { trees: number; scatter: number } {
    let trees = 0;
    let scatter = 0;
    for (const d of this.decoration.values()) {
      trees += d.counts().trees;
      scatter += d.counts().scatter;
    }
    return { trees, scatter };
  }

  /** Where a producer's smoke leaves its chimney: the model's smoke anchor (island tiles), null without a model yet. */
  private readonly smokeAnchor = (b: BuildingDisplay, def: ContentBuilding) => {
    const entry = this.registry?.entry(b.type);
    const a = entry?.anchors.smoke;
    if (!entry || !a) return null;
    const p = placement(entry, def, b);
    const w = toWorld(entry.kind, a);
    const [x, z] = rotateXZ(w[0] * p.sx, w[2] * p.sz, p.yaw);
    return { x: p.cx + x, y: -(p.cz + z), h: w[1] };
  };

  /** Island origin (archipelago tiles) while shown, for the life layer; null when hidden. */
  lifeOrigin(): { x: number; y: number } | null {
    return this.shown ? { x: this.root.position.x, y: -this.root.position.z } : null;
  }

}
