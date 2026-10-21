// Coastline of an island (ART_DIRECTION §4), render-only and pure:
// marching squares over the tile grid with land (any non-water terrain)
// = 1 and water = 0 sampled at the tile centres, outside the map = water.
// The contour runs through the midpoints of the tile edges between a land
// and a water tile (a chamfered outline), every loop is closed, and loops
// are oriented with the land on the right-hand side (x right, y down).
// Saddles (two diagonal land tiles) keep the land tiles apart. Chaikin
// smoothing rounds the chamfers. Coordinates are island tiles.

export interface CoastPoint {
  x: number;
  y: number;
  /** The land tile next to this crossing (the tile the beach or cliff belongs to). */
  landX: number;
  landY: number;
}

/** A closed contour (the last point connects back to the first). */
export type CoastLoop = CoastPoint[];

interface Segment {
  a: CoastPoint;
  b: CoastPoint;
}

type Edge = "T" | "R" | "B" | "L";

/** Edges a cell's contour crosses per case (tl·8 + tr·4 + br·2 + bl·1); saddles 5 and 10 keep the land corners apart. */
const CASES: Readonly<Record<number, readonly (readonly [Edge, Edge])[]>> = {
  0: [],
  1: [["L", "B"]],
  2: [["B", "R"]],
  3: [["L", "R"]],
  4: [["T", "R"]],
  5: [
    ["T", "R"],
    ["L", "B"],
  ],
  6: [["T", "B"]],
  7: [["T", "L"]],
  8: [["T", "L"]],
  9: [["T", "B"]],
  10: [
    ["T", "L"],
    ["B", "R"],
  ],
  11: [["T", "R"]],
  12: [["L", "R"]],
  13: [["R", "B"]],
  14: [["L", "B"]],
  15: [],
};

/**
 * Oriented contour segments of the land/water boundary. `land(x, y)` is
 * called only for tiles inside the map (0 ≤ x < width, 0 ≤ y < height).
 */
export function marchingSquares(width: number, height: number, land: (x: number, y: number) => boolean): Segment[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && land(x, y);
  const out: Segment[] = [];
  for (let j = -1; j < height; j++) {
    for (let i = -1; i < width; i++) {
      const tl = at(i, j);
      const tr = at(i + 1, j);
      const br = at(i + 1, j + 1);
      const bl = at(i, j + 1);
      const index = (tl ? 8 : 0) + (tr ? 4 : 0) + (br ? 2 : 0) + (bl ? 1 : 0);
      const edges = CASES[index] ?? [];
      if (edges.length === 0) continue;
      // Edge midpoints with the land tile of each crossing.
      const pt = (e: Edge): CoastPoint => {
        switch (e) {
          case "T":
            return { x: i + 1, y: j + 0.5, landX: tl ? i : i + 1, landY: j };
          case "R":
            return { x: i + 1.5, y: j + 1, landX: i + 1, landY: tr ? j : j + 1 };
          case "B":
            return { x: i + 1, y: j + 1.5, landX: bl ? i : i + 1, landY: j + 1 };
          case "L":
            return { x: i + 0.5, y: j + 1, landX: i, landY: tl ? j : j + 1 };
        }
      };
      const corners = [
        { x: i + 0.5, y: j + 0.5, on: tl },
        { x: i + 1.5, y: j + 0.5, on: tr },
        { x: i + 1.5, y: j + 1.5, on: br },
        { x: i + 0.5, y: j + 1.5, on: bl },
      ].filter((c) => c.on);
      for (const [e1, e2] of edges) {
        let a = pt(e1);
        let b = pt(e2);
        // Land on the right: the nearest land corner must lie right of a → b.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        let c = corners[0] as { x: number; y: number };
        for (const k of corners) if (Math.hypot(k.x - mx, k.y - my) < Math.hypot(c.x - mx, c.y - my)) c = k;
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (cross < 0) [a, b] = [b, a];
        out.push({ a, b });
      }
    }
  }
  return out;
}

const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

/** Joins oriented segments into closed loops (deterministic: in segment order). */
export function traceLoops(segments: readonly Segment[]): CoastLoop[] {
  const byStart = new Map<string, Segment>();
  for (const s of segments) byStart.set(key(s.a), s);
  const used = new Set<Segment>();
  const loops: CoastLoop[] = [];
  for (const s of segments) {
    if (used.has(s)) continue;
    const loop: CoastPoint[] = [];
    let cur: Segment | undefined = s;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push(cur.a);
      cur = byStart.get(key(cur.b));
    }
    loops.push(loop);
  }
  return loops;
}

/** Chaikin corner cutting of a closed loop; each new point keeps the land tile of its nearer original point. */
export function chaikin(loop: CoastLoop, iterations = 2): CoastLoop {
  let cur = loop;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next: CoastPoint[] = [];
    for (let k = 0; k < cur.length; k++) {
      const p = cur[k] as CoastPoint;
      const q = cur[(k + 1) % cur.length] as CoastPoint;
      next.push(
        { x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y, landX: p.landX, landY: p.landY },
        { x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y, landX: q.landX, landY: q.landY },
      );
    }
    cur = next;
  }
  return cur;
}

/** Signed area of a loop (y down): positive for clockwise on screen. */
export function loopArea(loop: readonly { x: number; y: number }[]): number {
  let a = 0;
  for (let k = 0; k < loop.length; k++) {
    const p = loop[k] as { x: number; y: number };
    const q = loop[(k + 1) % loop.length] as { x: number; y: number };
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** The smoothed coastline loops of a terrain grid (land: any terrain but water). */
export function coastline(island: { width: number; height: number; terrain: readonly string[] }, smoothing = 2): CoastLoop[] {
  const { width, terrain } = island;
  const loops = traceLoops(marchingSquares(island.width, island.height, (x, y) => terrain[y * width + x] !== "water"));
  return loops.map((l) => chaikin(l, smoothing));
}

/** Unit normal pointing to the water side at point k of a loop (land is on the right). */
export function outwardNormal(loop: readonly { x: number; y: number }[], k: number): { x: number; y: number } {
  const n = loop.length;
  const p = loop[(k - 1 + n) % n] as { x: number; y: number };
  const q = loop[(k + 1) % n] as { x: number; y: number };
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  // Left of the walking direction (y down): (dy, −dx).
  return { x: dy / len, y: -dx / len };
}
