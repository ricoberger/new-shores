// Idle ships at a Trading Post's pier (visual only). The server's berths
// list the ships handling there and the queue; a ship that is idle at the
// island (after founding, after a route ended, anchored for unpaid upkeep)
// holds no berth, so the dock layout skipped it and it lay at a harbour
// berth with heading 0 — across the pier, behind the building. It now lies
// at a free pier berth like a moored ship, and waits in the queue's rows
// when the pier is full.

import type { BuildingDisplay, IslandDisplay } from "../api/client";
import { BERTH_ANCHORS, type Dock, type ModelAnchor, pierHeading } from "../display/ships";

interface IdleShip {
  id: number;
  state?: string;
  island_id?: string;
  leg?: unknown;
}

/** States of a ship at an island without a leg that lies in the harbour. */
const HARBOUR_STATES = new Set(["idle", "anchored_unpaid"]);

/**
 * The islands with their Trading Posts' `berths` extended by the idle ships
 * of the island: free berths first (up to `total`), then the end of the
 * queue; ascending ship ID. Everything else is passed through unchanged.
 */
export function withIdleAtPier<I extends Pick<IslandDisplay, "id" | "buildings">>(islands: readonly I[], ships: readonly IdleShip[]): I[] {
  const idle = new Map<string, number[]>();
  for (const s of ships) {
    if (s.leg || !s.island_id || !HARBOUR_STATES.has(s.state ?? "idle")) continue;
    const list = idle.get(s.island_id);
    if (list) list.push(s.id);
    else idle.set(s.island_id, [s.id]);
  }
  if (idle.size === 0) return [...islands];
  return islands.map((is) => {
    const ids = idle.get(is.id);
    if (!ids) return is;
    let seen = false;
    let changed = false;
    const buildings = is.buildings.map((b): BuildingDisplay => {
      if (seen || !b.berths) return b;
      seen = true;
      const held = new Set([...b.berths.ships, ...b.berths.queue]);
      const free = ids.filter((id) => !held.has(id)).sort((x, y) => x - y);
      if (free.length === 0) return b;
      changed = true;
      const room = Math.max(0, b.berths.total - b.berths.ships.length);
      return { ...b, berths: { ...b.berths, ships: [...b.berths.ships, ...free.slice(0, room)], queue: [...b.berths.queue, ...free.slice(room)] } };
    });
    return changed ? { ...is, buildings } : is;
  });
}

/** What the flank layout reads of a model manifest entry: the footprint and the anchors (model space, centred on the footprint). */
export interface FlankEntry {
  footprint?: { w: number; h: number };
  anchors: Readonly<Record<string, readonly [number, number, number] | undefined>>;
}

/**
 * Whether a berth anchor lies on a flank of the pier: its x (the footprint's
 * width axis, model space centred on the footprint) is outside the
 * footprint's x-range. Front berths lie within it (the Trading Post).
 */
export function isFlankAnchor(entry: FlankEntry, name: string): boolean {
  const a = entry.anchors[name];
  const w = entry.footprint?.w;
  return !!a && w !== undefined && Math.abs(a[0]) > w / 2 + 1e-6;
}

/** Gap between ships queued one behind the other along a flank (tiles). */
const FLANK_GAP = 0.3;
/** A hull's half-beam relative to its stern distance (sloop: beam 0.4 of length 2 against a stern at 0.5 of the length). */
const HALF_BEAM = 0.4;

/**
 * Ships at the long flanks of a pier (the `trading_pier` model: berth_1 and
 * berth_2 on the flanks, not on the front). The ship at pier slot i holds
 * berth anchor i + 1; if that is a flank anchor it lies parallel to the
 * pier's long axis, bow seaward (pierHeading), offset outward from the
 * anchor by its half-beam so the hull's side is at the pier's edge, centred
 * on the anchor along the flank. Queued ships wait on the flanks too, the
 * places alternating between the flank anchors, each one hull length further
 * seaward than the one before. Islands' buildings without flank anchors are
 * left to dockPoints (front rule); only the ships of the flank piers are
 * returned (archipelago tiles).
 */
export function flankDocks(
  islands: readonly { position: { x: number; y: number }; buildings: readonly BuildingDisplay[] }[],
  defs: ReadonlyMap<string, { width: number; height: number; trading_post?: unknown }>,
  entryOf: (type: string) => FlankEntry | null,
  anchor: ModelAnchor,
  stern: number,
  ratio: (shipId: number) => number = () => 1,
): Map<number, Dock> {
  const out = new Map<number, Dock>();
  for (const is of islands) {
    for (const b of is.buildings) {
      const def = defs.get(b.type);
      const entry = entryOf(b.type);
      if (!def?.trading_post || !b.berths || !entry) continue;
      const flank: { x: number; y: number; nx: number; ny: number }[] = [];
      const rot = ((b.rotation % 360) + 360) % 360;
      const [fw, fh] = rot === 90 || rot === 270 ? [def.height, def.width] : [def.width, def.height];
      const heading = pierHeading(b.rotation);
      const ox = Math.cos(heading);
      const oy = Math.sin(heading);
      for (const name of BERTH_ANCHORS) {
        if (!isFlankAnchor(entry, name)) continue;
        const a = anchor(b, def, name);
        if (!a) continue;
        // Outward from the pier's centre line, across its long axis.
        const dx = a.x - (b.x + fw / 2);
        const dy = a.y - (b.y + fh / 2);
        const across = dx * -oy + dy * ox;
        const side = across < 0 ? -1 : 1;
        flank.push({ x: a.x, y: a.y, nx: -oy * side, ny: ox * side });
      }
      if (flank.length === 0) continue;
      const put = (ids: readonly number[], queued: boolean) =>
        ids.forEach((id, i) => {
          const r = ratio(id);
          const k = queued ? i % flank.length : i;
          const f = flank[k];
          if (!f) return;
          const row = queued ? Math.floor(i / flank.length) + 1 : 0;
          const beam = HALF_BEAM * stern * r;
          const back = row * (2 * stern * r + FLANK_GAP);
          const x = f.x + f.nx * beam + ox * back;
          const y = f.y + f.ny * beam + oy * back;
          out.set(id, { point: { x: is.position.x + x, y: is.position.y + y }, heading, ...(queued ? { queued } : {}) });
        });
      put(b.berths.ships, false);
      put(b.berths.queue, true);
    }
  }
  return out;
}
