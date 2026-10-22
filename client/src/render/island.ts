// Per-island detail of the continuous world (D-048): terrain, buildings,
// fields, roads, carts, status icons and construction hulls of one island
// under a node at the island's archipelago position, so local tile (x, y)
// is world (position.x + x, 0, −(position.y + y)). Built lazily (when the
// island is first shown at near or mid LOD) and rebuilt on payload changes
// while shown. The level of detail toggles layers: near shows everything
// (with trees, ground scatter, field decoration and foam), mid shows
// terrain (ground, beach, cliffs, outcrops), roads, contact shadows and
// flat category blocks only. Buildings, fields and ships are kit-bashed
// models where the manifest has them (render/models.ts), placeholders
// otherwise.
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, IslandDisplay } from "../api/client";
import { type CoastLoop, coastline } from "../display/coastline";
import type { Lod } from "../display/lod";
import { rotatedFootprint } from "../display/geometry";
import { blockedTiles, islandSeed, layerKeys, scatterGround, scatterTrees, thinningAreas } from "../display/scatter";
import { BlockLayer } from "./blocks";
import { BuildingLayer } from "./buildings";
import { CartLayer } from "./carts";
import { FieldDecor, FieldTiles } from "./fields";
import { ConstructionLayer } from "./harbour";
import { IconLayer } from "./icons";
import { footprintBox } from "./coords";
import { type Detail, DEFAULT_MODEL_HEIGHT, type ModelRegistry, placement, statusHeight } from "./models";
import { OutcropLayer } from "./outcrops";
import { PlateauLayer } from "./plateaus";
import { RoadLayer } from "./roads";
import { FootprintShadows } from "./shadows";
import { buildTerrain, FoamLine } from "./terrain";
import { Decoration } from "./trees";

/** Contact shadow of a building: a soft frame this wide (tiles) around its rotated footprint. */
const BUILDING_SHADOW_RIM = 0.3;
/** Height (tiles) the blob shadows of buildings without a model lean for. */
const BUILDING_HEIGHT = DEFAULT_MODEL_HEIGHT;

export class IslandDetail {
  readonly root: TransformNode;
  private readonly near: TransformNode;
  private readonly mid: TransformNode;
  private readonly buildings: BuildingLayer;
  private readonly fields: FieldTiles;
  private readonly fieldDecor: FieldDecor;
  private readonly decoration: Decoration;
  private readonly roads: RoadLayer;
  private readonly carts: CartLayer;
  private readonly icons: IconLayer;
  private readonly construction: ConstructionLayer;
  private readonly blocks: BlockLayer;
  private readonly buildingBlobs: FootprintShadows;
  private readonly outcrops: OutcropLayer;
  private readonly plateaus: PlateauLayer;
  private foam: FoamLine | null = null;
  private terrain: Mesh[] = [];
  /** Smoothed coastline of the static terrain and the decoration seed (island ID + revision). */
  private loops: CoastLoop[] = [];
  private seed = 0;
  private statics: Island | null = null;
  /** Inputs of the merged layers last built (display/scatter.ts layerKeys; null: rebuild all). */
  private keys: ReturnType<typeof layerKeys> | null = null;
  /** Merged-layer rebuilds of this island (roads, layout, decoration), for tests and profiling. */
  readonly rebuilds = { roads: 0, layout: 0, decoration: 0 };
  private terrainKey = "";
  /** The display payload and content the layers were built from (identity). */
  private builtFrom: { display: IslandDisplay; defs: ReadonlyMap<string, ContentBuilding> } | null = null;
  private lod: Lod = "near";
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
    this.near = new TransformNode(`island_${id}_near`, scene);
    this.near.parent = this.root;
    this.mid = new TransformNode(`island_${id}_mid`, scene);
    this.mid.parent = this.root;
    this.buildings = new BuildingLayer(scene, this.near, registry);
    this.fields = new FieldTiles(scene, this.near);
    this.fieldDecor = new FieldDecor(scene, this.near);
    this.decoration = new Decoration(scene, id, this.near);
    this.roads = new RoadLayer(scene, this.root);
    this.carts = new CartLayer(scene, this.near);
    this.icons = new IconLayer(scene, this.near);
    this.construction = new ConstructionLayer(scene, this.near, registry);
    this.blocks = new BlockLayer(scene, this.mid);
    this.buildingBlobs = new FootprintShadows(scene, `blob_buildings_${id}`, this.root, 0.55);
    this.outcrops = new OutcropLayer(scene, this.root, registry);
    this.plateaus = new PlateauLayer(scene, this.root);
    this.mid.setEnabled(false);
    this.root.setEnabled(false);
  }

  /** Moves the node when the island's position changed. */
  setPosition(p: { x: number; y: number }): void {
    if (this.root.position.x === p.x && this.root.position.z === -p.y) return;
    this.root.position.set(p.x, 0, -p.y);
    for (const m of this.terrain) m.freezeWorldMatrix();
  }

  /** Rebuilds the terrain when the static data changed. */
  setStatics(statics: Island): void {
    const key = `${statics.revision}|${statics.id}`;
    if (key === this.terrainKey) return;
    for (const m of this.terrain) m.dispose();
    this.root.computeWorldMatrix(true);
    this.seed = islandSeed(statics.id, statics.revision);
    this.loops = coastline(statics);
    this.terrain = buildTerrain(this.scene, statics, this.loops, this.seed, this.root);
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

  /** Whether the layers reflect this payload and content. */
  builtWith(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): boolean {
    return this.builtFrom?.display === display && this.builtFrom.defs === defs;
  }

  /**
   * Brings the layers up to date with the island's payload. The instanced
   * layers (buildings, field tiles, carts, icons, construction) follow
   * every payload; the merged static meshes (roads, blocks, contact
   * shadows, field decoration, trees and scatter) are rebuilt only when
   * their inputs on this island changed (layerKeys) — per island, never
   * for the whole world.
   */
  update(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): void {
    const defsChanged = this.builtFrom?.defs !== defs;
    this.builtFrom = { display, defs };
    this.buildings.update(display.buildings, defs);
    this.fields.update(this.unmodelledFields(display), defs);
    this.carts.update(display, defs);
    this.icons.update(display.buildings, defs, this.statusY);
    this.construction.update(display, defs);
    const keys = layerKeys(display, defs);
    const old = defsChanged ? null : this.keys;
    this.keys = keys;
    if (old?.roads !== keys.roads) {
      this.rebuilds.roads++;
      this.roads.update(display.roads);
    }
    if (old?.layout !== keys.layout) {
      this.rebuilds.layout++;
      this.blocks.update(display.buildings, defs);
      this.fieldDecor.update(this.unmodelledFields(display), defs);
      this.updateBlobs(display, defs);
      this.updateRelief();
    }
    if (old?.decoration !== keys.decoration) {
      this.rebuilds.decoration++;
      this.updateDecoration(display, defs);
    }
  }

  /** Trees (thinned by forest harvesters) and ground scatter, kept off buildings, fields and roads. */
  private updateDecoration(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): void {
    const st = this.statics;
    if (!st) return;
    const input = { width: st.width, height: st.height, terrain: st.terrain, seed: this.seed, blocked: blockedTiles(display.buildings, display.roads, defs) };
    this.decoration.update(scatterTrees(input, thinningAreas(display.buildings, defs)), scatterGround(input));
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
    const out = new Set<string>();
    const built = this.builtFrom;
    if (!built) return out;
    for (const b of built.display.buildings) {
      const def = built.defs.get(b.type);
      if (!def || def.category === "roads" || def.field) continue;
      const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
      for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) out.add(`${x},${y}`);
    }
    return out;
  }

  /**
   * Contact shadows around every building (near and mid LOD): the model's
   * rotated bounds and height where the manifest has a model, else the
   * footprint and a default height.
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
    this.fields.update(this.unmodelledFields(built.display), built.defs);
    this.fieldDecor.update(this.unmodelledFields(built.display), built.defs);
    this.icons.update(built.display.buildings, built.defs, this.statusY);
    this.updateBlobs(built.display, built.defs);
    this.updateRelief();
  }

  /** Model detail level (lite at the near default zoom, full zoomed in). */
  setDetail(detail: Detail): void {
    this.buildings.setDetail(detail);
    const built = this.builtFrom;
    if (built) {
      this.fields.update(this.unmodelledFields(built.display), built.defs);
      this.fieldDecor.update(this.unmodelledFields(built.display), built.defs);
    }
  }

  /** Content IDs drawn with a placeholder (shown at near LOD; fields included). */
  placeholders(): string[] {
    if (!this.shown || this.lod !== "near" || !this.builtFrom) return [];
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
    return this.shown && this.lod === "near" ? [...this.buildings.meshes(), ...this.decoration.casters()] : [];
  }

  /** Shown (in view at near or mid LOD) or hidden, and the level of detail. */
  setShown(shown: boolean, lod: Lod): void {
    if (shown !== this.shown) {
      this.shown = shown;
      this.root.setEnabled(shown);
    }
    if (lod !== this.lod) {
      this.lod = lod;
      this.near.setEnabled(lod === "near");
      this.mid.setEnabled(lod === "mid");
    }
  }

  /** Camera rotation step (status icons face the camera). */
  setRotation(step: number): void {
    this.icons.setRotation(step);
  }

  /** Building selection frame (undefined: none on this island). */
  select(...args: Parameters<BuildingLayer["select"]>): void {
    this.buildings.select(...args);
  }

  /**
   * Moves carts and construction hulls (near LOD, shown). Returns true when
   * the building meshes were replaced (the shadow casters need a refresh).
   */
  frame(nowMs: number): boolean {
    if (!this.shown || this.lod !== "near") return false;
    this.foam?.frame(nowMs);
    const casters = this.buildings.frame(nowMs);
    this.carts.frame(nowMs);
    this.construction.frame(nowMs);
    return casters;
  }

  /** Buildings drawn with the other detail's model until the wanted one has loaded (shown at near LOD). */
  bridged(): number {
    return this.shown && this.lod === "near" ? this.buildings.bridged() : 0;
  }

  /** Whether a kit-bashed building or field model is drawn (shown at near LOD). */
  drawsModels(): boolean {
    return this.shown && this.lod === "near" && this.buildings.modelled().size > 0;
  }

  /** Trees and ground scatter items built (near-LOD decoration). */
  decorationCounts(): { trees: number; scatter: number } {
    return this.decoration.counts();
  }

  /** Carts drawn (near LOD, shown). */
  cartCount(): number {
    return this.shown && this.lod === "near" ? this.carts.count() : 0;
  }

  /** Construction hulls drawn in the last frame (near LOD, shown). */
  constructionMarkers(): { buildingId: number; scale: number }[] {
    return this.shown && this.lod === "near" ? this.construction.constructionMarkers() : [];
  }
}
