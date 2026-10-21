// Per-island detail of the continuous world (D-048): terrain, buildings,
// fields, roads, carts, status icons and construction hulls of one island
// under a node at the island's archipelago position, so local tile (x, y)
// is world (position.x + x, 0, −(position.y + y)). Built lazily (when the
// island is first shown at near or mid LOD) and rebuilt on payload changes
// while shown. The level of detail toggles layers: near shows everything,
// mid shows terrain (ground, beach, cliffs, outcrops), roads, blob shadows
// and flat category blocks only.
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, IslandDisplay } from "../api/client";
import { type CoastLoop, coastline } from "../display/coastline";
import type { Lod } from "../display/lod";
import { islandSeed } from "../display/scatter";
import { BlockLayer } from "./blocks";
import { BuildingLayer } from "./buildings";
import { CartLayer } from "./carts";
import { FieldTiles } from "./fields";
import { ConstructionLayer } from "./harbour";
import { IconLayer } from "./icons";
import { footprintBox } from "./coords";
import { OutcropLayer } from "./outcrops";
import { RoadLayer } from "./roads";
import { FootprintShadows } from "./shadows";
import { buildTerrain, FoamLine } from "./terrain";

/** Contact shadow of a building: a soft frame this wide (tiles) around its rotated footprint. */
const BUILDING_SHADOW_RIM = 0.3;
/** Height (tiles) the blob shadows of buildings lean for. */
const BUILDING_HEIGHT = 0.7;

export class IslandDetail {
  readonly root: TransformNode;
  private readonly near: TransformNode;
  private readonly mid: TransformNode;
  private readonly buildings: BuildingLayer;
  private readonly fields: FieldTiles;
  private readonly roads: RoadLayer;
  private readonly carts: CartLayer;
  private readonly icons: IconLayer;
  private readonly construction: ConstructionLayer;
  private readonly blocks: BlockLayer;
  private readonly buildingBlobs: FootprintShadows;
  private readonly outcrops: OutcropLayer;
  private foam: FoamLine | null = null;
  private terrain: Mesh[] = [];
  /** Smoothed coastline of the static terrain and the decoration seed (island ID + revision). */
  private loops: CoastLoop[] = [];
  private seed = 0;
  private terrainKey = "";
  /** The display payload and content the layers were built from (identity). */
  private builtFrom: { display: IslandDisplay; defs: ReadonlyMap<string, ContentBuilding> } | null = null;
  private lod: Lod = "near";
  private shown = false;

  constructor(
    private readonly scene: Scene,
    readonly id: string,
    position: { x: number; y: number },
  ) {
    this.root = new TransformNode(`island_${id}`, scene);
    this.root.position.set(position.x, 0, -position.y);
    this.near = new TransformNode(`island_${id}_near`, scene);
    this.near.parent = this.root;
    this.mid = new TransformNode(`island_${id}_mid`, scene);
    this.mid.parent = this.root;
    this.buildings = new BuildingLayer(scene, this.near);
    this.fields = new FieldTiles(scene, this.near);
    this.roads = new RoadLayer(scene, this.root);
    this.carts = new CartLayer(scene, this.near);
    this.icons = new IconLayer(scene, this.near);
    this.construction = new ConstructionLayer(scene, this.near);
    this.blocks = new BlockLayer(scene, this.mid);
    this.buildingBlobs = new FootprintShadows(scene, `blob_buildings_${id}`, this.root, 0.55);
    this.outcrops = new OutcropLayer(scene, this.root);
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
    this.outcrops.update(statics.deposits, this.seed);
    this.foam ??= new FoamLine(this.scene, this.near, this.seed);
    this.foam.update(this.loops);
    this.terrainKey = key;
  }

  /** Whether the layers reflect this payload and content. */
  builtWith(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): boolean {
    return this.builtFrom?.display === display && this.builtFrom.defs === defs;
  }

  /** Rebuilds the buildings, fields, roads, carts, icons and blocks from the island's payload. */
  update(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): void {
    this.builtFrom = { display, defs };
    this.buildings.update(display.buildings, defs);
    this.fields.update(display.buildings, defs);
    this.roads.update(display.roads);
    this.carts.update(display, defs);
    this.icons.update(display.buildings, defs);
    this.construction.update(display, defs);
    this.blocks.update(display.buildings, defs);
    this.updateBlobs(display, defs);
  }

  /** Contact shadows around every building (near and mid LOD). */
  private updateBlobs(display: IslandDisplay, defs: ReadonlyMap<string, ContentBuilding>): void {
    const rects = [];
    for (const b of display.buildings) {
      const def = defs.get(b.type);
      if (!def || def.category === "roads" || def.field) continue;
      rects.push(footprintBox(b.x, b.y, def.width, def.height, b.rotation));
    }
    this.buildingBlobs.update(rects, BUILDING_SHADOW_RIM, BUILDING_HEIGHT);
  }

  /** Meshes casting into the sun shadow map: the buildings while shown at near LOD. */
  shadowCasters(): AbstractMesh[] {
    return this.shown && this.lod === "near" ? this.buildings.meshes() : [];
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

  /** Moves carts and construction hulls (near LOD, shown). */
  frame(nowMs: number): void {
    if (!this.shown || this.lod !== "near") return;
    this.foam?.frame(nowMs);
    this.carts.frame(nowMs);
    this.construction.frame(nowMs);
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
