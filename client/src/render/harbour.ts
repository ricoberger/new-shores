// Island-view additions (UI.md §4): ships at the island drawn on the water
// next to the coast nearest the harbour building (shipyard, else
// warehouse), and a hull rising on every shipyard with an order. Visual
// placement only; positions and progress come from the display payload.
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, IslandDisplay, ShipDisplay } from "../api/client";
import { shipsAt } from "../display/archipelago";
import type { TilePos } from "../display/geometry";
import { orderTiming } from "../display/ships";
import { footprintBox } from "./coords";
import { ColoredInstances, shipColor, shipMatrix, type ShipStyle, shipTemplate } from "./shipmesh";

const HARBOUR_SHIP_SCALE = 2;
/** Minimum distance (tiles) between two harbour berths. */
const BERTH_SPACING = 2;
const MAX_BERTHS = 24;
const CONSTRUCTION = [1, 0.62, 0.15, 1];

/**
 * Water tiles next to the coast, nearest first to the given tile, spaced
 * at least BERTH_SPACING apart (deterministic: ties by row, then column).
 */
export function harbourBerths(island: Pick<Island, "width" | "height" | "terrain">, near: { x: number; y: number }, count: number): TilePos[] {
  const { width, height, terrain } = island;
  const water = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || terrain[y * width + x] === "water";
  const coastal: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!water(x, y)) continue;
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

export class HarbourLayer {
  private readonly ships: ColoredInstances;
  private readonly construction: ColoredInstances;
  private berths: TilePos[] = [];
  private island: IslandDisplay | undefined;
  private shipList: ShipDisplay[] = [];
  private defs: ReadonlyMap<string, ContentBuilding> = new Map();
  private enabled = true;
  /** Tile centres of the ships drawn in the last frame. */
  private readonly drawn = new Map<number, { x: number; y: number; style: ShipStyle }>();
  /** Shipyards (building IDs) with a construction hull in the last frame, with its scale. */
  private readonly markers = new Map<number, number>();

  constructor(scene: Scene, parent: TransformNode | null = null) {
    this.ships = new ColoredInstances(shipTemplate(scene, "harbour_ships"));
    this.construction = new ColoredInstances(shipTemplate(scene, "shipyard_construction"));
    this.ships.mesh.parent = parent;
    this.construction.mesh.parent = parent;
  }

  update(island: IslandDisplay | undefined, statics: Island | undefined, ships: readonly ShipDisplay[], defs: ReadonlyMap<string, ContentBuilding>): void {
    this.island = island;
    this.shipList = [...ships];
    this.defs = defs;
    this.berths = [];
    if (!island || !statics) return;
    const harbour =
      island.buildings.find((b) => defs.get(b.type)?.shipyard) ?? island.buildings.find((b) => defs.get(b.type)?.warehouse);
    let near = { x: statics.width / 2, y: statics.height / 2 };
    if (harbour) {
      const def = defs.get(harbour.type);
      if (def) {
        const box = footprintBox(harbour.x, harbour.y, def.width, def.height, harbour.rotation);
        near = { x: box.cx, y: -box.cz };
      }
    }
    this.berths = harbourBerths(statics, near, MAX_BERTHS);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.ships.mesh.setEnabled(on);
    this.construction.mesh.setEnabled(on);
  }

  /** Places ships and construction hulls at server time nowMs (every frame). */
  frame(nowMs: number): void {
    this.drawn.clear();
    this.markers.clear();
    if (!this.enabled || !this.island) {
      this.ships.resize(0);
      this.construction.resize(0);
      return;
    }
    const here = shipsAt(this.shipList, this.island.id, nowMs)
      .slice()
      .sort((a, b) => a.id - b.id)
      .slice(0, this.berths.length);
    this.ships.resize(here.length);
    here.forEach((s, i) => {
      const b = this.berths[i] as TilePos;
      const style: ShipStyle = s.state === "anchored_unpaid" ? "unpaid" : "active";
      this.drawn.set(s.id, { x: b.x + 0.5, y: b.y + 0.5, style });
      shipMatrix(this.ships.matrices, i, b.x + 0.5, -0.05, -(b.y + 0.5), 0, HARBOUR_SHIP_SCALE);
      this.ships.setColor(i, shipColor(style));
    });
    this.ships.commit();

    const orders = this.island.buildings.filter((b) => b.ship_order);
    this.construction.resize(orders.length);
    orders.forEach((b, i) => {
      const def = this.defs.get(b.type);
      const box = def ? footprintBox(b.x, b.y, def.width, def.height, b.rotation) : { cx: b.x + 0.5, cz: -(b.y + 0.5) };
      const p = b.ship_order ? orderTiming(b.ship_order, nowMs).progressPermille / 1000 : 0;
      // The hull grows and rises out of the slipway as the order progresses.
      const scale = 1.2 + 1.8 * p;
      this.markers.set(b.id, scale);
      shipMatrix(this.construction.matrices, i, box.cx, 0.55 + 0.45 * p, box.cz, 0, scale);
      this.construction.setColor(i, CONSTRUCTION);
    });
    this.construction.commit();
  }

  /** Ships drawn in the last frame with their tile-centre position and style. */
  drawnShips(): IterableIterator<[number, { x: number; y: number; style: ShipStyle }]> {
    return this.drawn.entries();
  }

  /** Construction hulls drawn in the last frame: shipyard building ID and hull scale. */
  constructionMarkers(): { buildingId: number; scale: number }[] {
    return [...this.markers.entries()].map(([buildingId, scale]) => ({ buildingId, scale }));
  }
}
