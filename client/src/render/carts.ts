// Carts: purely visual. One small unlit instance per connected producer
// with an output rate > 0 travels from a road tile next to the producer's
// footprint to a road tile next to the footprint of its assigned warehouse
// (server's assigned_warehouse_id) and back within transfer_delay_ms. The
// road path is found by BFS over the road tiles for drawing only; no
// gameplay number is derived from it and without a path no cart is drawn.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, IslandDisplay } from "../api/client";
import { adjacentRoads, type FootprintDef, rotatedFootprint, type TilePos, tileKey } from "../display/geometry";
import { setInstances } from "./instances";
import { CART } from "./palette";

interface Cart {
  path: TilePos[];
  periodMs: number;
  phaseMs: number;
}

const NEIGHBOURS: readonly TilePos[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Road tiles next to a building's rotated footprint. */
function footprintRoads(roads: ReadonlySet<string>, b: BuildingDisplay, def: FootprintDef): TilePos[] {
  const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
  return adjacentRoads(roads, b.x, b.y, w, h);
}

/** Shortest road path (BFS) from one of the road tiles `from` to one of `to`. */
export function roadPath(roads: ReadonlySet<string>, from: readonly TilePos[], to: readonly TilePos[]): TilePos[] | null {
  const adjacent = (p: TilePos) =>
    NEIGHBOURS.map((d) => ({ x: p.x + d.x, y: p.y + d.y })).filter((q) => roads.has(tileKey(q)));
  const goals = new Set(to.map(tileKey));
  const prev = new Map<string, TilePos | null>();
  const queue: TilePos[] = [];
  for (const s of from) {
    if (prev.has(tileKey(s))) continue;
    prev.set(tileKey(s), null);
    queue.push(s);
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as TilePos;
    if (goals.has(tileKey(cur))) {
      const path: TilePos[] = [];
      for (let p: TilePos | null | undefined = cur; p; p = prev.get(tileKey(p))) path.push(p);
      return path.reverse();
    }
    for (const n of adjacent(cur)) {
      if (!prev.has(tileKey(n))) {
        prev.set(tileKey(n), cur);
        queue.push(n);
      }
    }
  }
  return null;
}

export class CartLayer {
  private readonly mesh: Mesh;
  private carts: Cart[] = [];
  private buffer = new Float32Array(0);

  constructor(scene: Scene, parent: TransformNode | null = null) {
    this.mesh = CreateBox("carts", { width: 0.3, height: 0.22, depth: 0.3 }, scene);
    const mat = new StandardMaterial("carts", scene);
    mat.disableLighting = true;
    mat.emissiveColor = CART;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.parent = parent;
    setInstances(this.mesh, null);
  }

  update(island: IslandDisplay | undefined, defs: ReadonlyMap<string, FootprintDef>): void {
    this.carts = [];
    if (!island) return;
    const roads = new Set(island.roads.map(tileKey));
    const byId = new Map(island.buildings.map((b) => [b.id, b]));
    for (const b of island.buildings) {
      const outputs = b.rates?.outputs ?? {};
      if (!b.assigned_warehouse_id || !Object.values(outputs).some((r) => r > 0)) continue;
      const wh = byId.get(b.assigned_warehouse_id);
      const def = defs.get(b.type);
      const whDef = wh && defs.get(wh.type);
      const period = b.transfer_delay_ms ?? 0;
      if (!wh || !def || !whDef || period <= 0) continue;
      const path = roadPath(roads, footprintRoads(roads, b, def), footprintRoads(roads, wh, whDef));
      if (path && path.length > 0) this.carts.push({ path, periodMs: period, phaseMs: (b.id * 7919) % period });
    }
    this.buffer = new Float32Array(this.carts.length * 16);
    this.frame(0, false);
    setInstances(this.mesh, this.carts.length ? this.buffer : null);
  }

  /** Number of carts drawn (one per delivering producer with a road path). */
  count(): number {
    return this.carts.length;
  }

  /** Positions the carts at server time nowMs (called every frame). */
  frame(nowMs: number, upload = true): void {
    if (this.carts.length === 0) return;
    this.carts.forEach((c, i) => {
      const t = ((nowMs + c.phaseMs) % c.periodMs) / c.periodMs; // 0..1 round trip
      const f = t < 0.5 ? t * 2 : 2 - t * 2; // 0..1..0
      const pos = f * (c.path.length - 1);
      const a = c.path[Math.floor(pos)] as TilePos;
      const b = c.path[Math.min(c.path.length - 1, Math.floor(pos) + 1)] as TilePos;
      const k = pos - Math.floor(pos);
      const x = a.x + (b.x - a.x) * k + 0.5;
      const z = -(a.y + (b.y - a.y) * k + 0.5);
      this.buffer.set(Matrix.Translation(x, 0.15, z).asArray(), i * 16);
    });
    if (upload) this.mesh.thinInstanceBufferUpdated("matrix");
  }
}
