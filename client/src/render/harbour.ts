// Harbours (UI.md §4): the berths where ships at an island lie — water
// next to the coast nearest the Trading Post's pier (D-051; a shipyard on
// an island without one) — and a hull rising on every shipyard with an order. Visual
// placement only; positions and progress come from the display payload.
// The hull is the ship type's model once loaded (the placeholder before).
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, IslandDisplay } from "../api/client";
import { covers, type TilePos, waterRows } from "../display/geometry";
import { orderTiming, pierHeading } from "../display/ships";
import { footprintBox } from "./coords";
import { buildingAnchor, type ModelRegistry, shipMeshes, shipModel } from "./models";
import { ColoredInstances, shipMatrix, shipTemplate } from "./shipmesh";

/** Minimum distance (tiles) between two harbour berths. */
const BERTH_SPACING = 2;
const MAX_BERTHS = 24;
/** The hull under construction keeps its own colours (no tint). */
const CONSTRUCTION = [1, 1, 1, 1];

/**
 * Water tiles next to the coast, nearest first to the given tile, spaced
 * at least BERTH_SPACING apart (deterministic: ties by row, then column).
 * Tiles for which `taken` holds (a pier or slipway over the water) are
 * skipped.
 */
export function harbourBerths(
  island: Pick<Island, "width" | "height" | "terrain">,
  near: { x: number; y: number },
  count: number,
  taken: (x: number, y: number) => boolean = () => false,
): TilePos[] {
  const { width, height, terrain } = island;
  const water = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || terrain[y * width + x] === "water";
  const coastal: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!water(x, y) || taken(x, y)) continue;
      if (water(x - 1, y) && water(x + 1, y) && water(x, y - 1) && water(x, y + 1)) continue;
      coastal.push({ x, y, d: Math.hypot(x + 0.5 - near.x, y + 0.5 - near.y) });
    }
  }
  coastal.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const out: TilePos[] = [];
  for (const c of coastal) {
    if (out.length >= count) break;
    if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= BERTH_SPACING)) out.push({ x: c.x, y: c.y });
  }
  return out;
}

/**
 * Harbour berths of an island (local tiles): water tiles next to the coast
 * nearest the Trading Post's pier (its water rows, D-051), else a
 * shipyard, beside the buildings over the water rather than on them.
 * Ships at the island lie there; the first berth anchors its legs and
 * route ribbons. None without either (an unsettled island: water next to
 * its centre can be a river or a lake inland, D-058; the founding ship
 * stays where its leg ended).
 */
export function islandBerths(island: IslandDisplay, statics: Island, defs: ReadonlyMap<string, ContentBuilding>): TilePos[] {
  const harbour = island.buildings.find((b) => defs.get(b.type)?.trading_post) ?? island.buildings.find((b) => defs.get(b.type)?.shipyard);
  if (!harbour) return [];
  let near = { x: statics.width / 2, y: statics.height / 2 };
  const def = defs.get(harbour.type);
  if (def) {
    const pier = waterRows(def, harbour.x, harbour.y, harbour.rotation);
    if (pier) near = { x: pier.x + pier.w / 2, y: pier.y + pier.h / 2 };
    else {
      const box = footprintBox(harbour.x, harbour.y, def.width, def.height, harbour.rotation);
      near = { x: box.cx, y: -box.cz };
    }
  }
  const overWater = island.buildings.filter((b) => (defs.get(b.type)?.water_tiles ?? 0) > 0);
  const taken = (x: number, y: number) =>
    overWater.some((b) => {
      const def = defs.get(b.type);
      return def !== undefined && covers(b.x, b.y, def.width, def.height, b.rotation, x, y);
    });
  return harbourBerths(statics, near, MAX_BERTHS, taken);
}

/** Height of the hull's waterline origin above the slip per unit of scale: its keel rests on the keel blocks. */
const SLIP_KEEL = 0.12;

/** A hull rising on every shipyard with an order (near LOD, under the island's node). */
export class ConstructionLayer {
  private construction: ColoredInstances;
  /** The hull is the model (of this ship type) rather than the placeholder. */
  private modelType: string | null = null;
  private orderType: string | null = null;
  private island: IslandDisplay | undefined;
  private defs: ReadonlyMap<string, ContentBuilding> = new Map();
  /** Shipyards (building IDs) with a construction hull in the last frame, with its scale. */
  private readonly markers = new Map<number, number>();

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null = null,
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.construction = new ColoredInstances(shipTemplate(scene, "shipyard_construction"));
    this.construction.mesh.parent = parent;
  }

  /** Swaps the placeholder hull for the ordered type's model once it has loaded. */
  private useModel(type: string): void {
    if (this.modelType === type || !this.registry) return;
    const model = shipModel(this.registry, type);
    if (!model) return;
    this.construction.mesh.dispose(false, true);
    const meshes = shipMeshes(this.scene, "shipyard_construction", model);
    meshes.cargo?.dispose();
    meshes.hull.parent = this.parent;
    this.construction = new ColoredInstances(meshes.hull);
    this.modelType = type;
  }

  /** The ordered ship type when its hull is drawn with the placeholder (no loaded model), else null. */
  placeholder(): string | null {
    return this.markers.size > 0 && this.modelType === null ? this.orderType : null;
  }

  update(island: IslandDisplay | undefined, defs: ReadonlyMap<string, ContentBuilding>): void {
    this.island = island;
    this.defs = defs;
  }

  /** Places the construction hulls at server time nowMs (every frame while shown). */
  frame(nowMs: number): void {
    this.markers.clear();
    const orders = this.island ? this.island.buildings.filter((b) => b.ship_order) : [];
    const type = orders[0]?.ship_order?.type ?? null;
    this.orderType = type;
    if (type) this.useModel(type);
    this.construction.resize(orders.length);
    orders.forEach((b, i) => {
      const def = this.defs.get(b.type);
      const box = def ? footprintBox(b.x, b.y, def.width, def.height, b.rotation) : { cx: b.x + 0.5, cz: -(b.y + 0.5) };
      // On the slipway (the model's slip anchor, D-054) bow out to sea; the footprint centre without a model.
      const entry = this.registry?.entry(b.type);
      const slip = entry && def ? buildingAnchor(entry, def, b, "slip") : null;
      const p = b.ship_order ? orderTiming(b.ship_order, nowMs).progressPermille / 1000 : 0;
      // The hull grows and rises out of the slipway as the order progresses.
      const scale = 1.2 + 1.8 * p;
      this.markers.set(b.id, scale);
      if (slip) shipMatrix(this.construction.matrices, i, slip.x, slip.h + SLIP_KEEL * scale, -slip.y, pierHeading(b.rotation), scale);
      else shipMatrix(this.construction.matrices, i, box.cx, 0.55 + 0.45 * p, box.cz, 0, scale);
      this.construction.setColor(i, CONSTRUCTION);
    });
    this.construction.commit();
  }

}
