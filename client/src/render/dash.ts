/** A point in archipelago tiles. */
export interface DashPoint {
  x: number;
  y: number;
}

/**
 * Splits a closed polyline into dashes: `on` tiles drawn, `off` tiles
 * left out, the phase carried around corners so every dash has its full
 * length (a dash may bend at a corner: it is returned as several pieces).
 * Returns the drawn pieces as [from, to] pairs in order. Pure geometry for
 * the route editor's draft ribbon.
 */
export function dashPieces(pts: readonly DashPoint[], on: number, off: number): [DashPoint, DashPoint][] {
  if (!(on > 0) || !(off >= 0) || pts.length < 2) return [];
  const period = on + off;
  const out: [DashPoint, DashPoint][] = [];
  let s = 0; // arc length at the start of the segment
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as DashPoint;
    const b = pts[(i + 1) % pts.length] as DashPoint;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const at = (d: number): DashPoint => ({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
    // Walk the dash periods that overlap [s, s + len).
    let k = Math.floor(s / period);
    for (;;) {
      const from = Math.max(k * period, s) - s;
      const to = Math.min(k * period + on, s + len) - s;
      if (k * period >= s + len) break;
      if (to > from + 1e-9) out.push([at(from), at(to)]);
      k++;
    }
    s += len;
  }
  return out;
}
