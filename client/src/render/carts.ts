// Carts: purely visual. One small unlit instance per connected producer
// with an output rate > 0 travels from the producer's entrance to the
// entrance of its assigned warehouse (server's assigned_warehouse_id) and
// back within transfer_delay_ms. The road path is found by BFS over the
// road tiles for drawing only; no gameplay number is derived from it and
// without a path no cart is drawn.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { IslandDisplay } from "../api/client";
import type { TilePos } from "../display/geometry";
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

/** Shortest road path (BFS) from a road tile next to `from` to one next to `to`. */
export function roadPath(roads: ReadonlySet<string>, from: TilePos, to: TilePos): TilePos[] | null {
  const key = (p: TilePos) => `${p.x},${p.y}`;
  const adjacent = (p: TilePos) =>
    NEIGHBOURS.map((d) => ({ x: p.x + d.x, y: p.y + d.y })).filter((q) => roads.has(key(q)));
  const goals = new Set(adjacent(to).map(key));
  const prev = new Map<string, TilePos | null>();
  const queue: TilePos[] = [];
  for (const s of adjacent(from)) {
    prev.set(key(s), null);
    queue.push(s);
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as TilePos;
    if (goals.has(key(cur))) {
      const path: TilePos[] = [];
      for (let p: TilePos | null | undefined = cur; p; p = prev.get(key(p))) path.push(p);
      return path.reverse();
    }
    for (const n of adjacent(cur)) {
      if (!prev.has(key(n))) {
        prev.set(key(n), cur);
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

  constructor(scene: Scene) {
    this.mesh = CreateBox("carts", { width: 0.3, height: 0.22, depth: 0.3 }, scene);
    const mat = new StandardMaterial("carts", scene);
    mat.disableLighting = true;
    mat.emissiveColor = CART;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    setInstances(this.mesh, null);
  }

  update(island: IslandDisplay | undefined): void {
    this.carts = [];
    if (!island) return;
    const roads = new Set(island.roads.map((r) => `${r.x},${r.y}`));
    const byId = new Map(island.buildings.map((b) => [b.id, b]));
    for (const b of island.buildings) {
      const outputs = b.rates?.outputs ?? {};
      if (!b.assigned_warehouse_id || !Object.values(outputs).some((r) => r > 0)) continue;
      const wh = byId.get(b.assigned_warehouse_id);
      const period = b.transfer_delay_ms ?? 0;
      if (!wh || period <= 0) continue;
      const path = roadPath(roads, b.entrance, wh.entrance);
      if (path && path.length > 0) this.carts.push({ path, periodMs: period, phaseMs: (b.id * 7919) % period });
    }
    this.buffer = new Float32Array(this.carts.length * 16);
    this.frame(0, false);
    setInstances(this.mesh, this.carts.length ? this.buffer : null);
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
