// Ship and shipyard timers for the UI (D-027): linear in time from the
// server's timestamps, no rule evaluated. Travel times, capacities and
// slot rules are the server's; the slot count here is only a display
// bound for the shipment dialog (the server validates).
import type { BuildingDisplay, CargoDisplay, LegDisplay, ShipDisplay, ShipOrderDisplay } from "../api/client";
import { serverTimeMs } from "./extrapolate";
import { rotatedFootprint, waterRows } from "./geometry";

/**
 * A ship's name by ID (the server's name, D-055); "Ship #<id>" for a ship
 * the model no longer has (scrapped since a summary or a toast).
 */
export function shipName(ships: readonly Pick<ShipDisplay, "id" | "name">[], id: number): string {
  return ships.find((s) => s.id === id)?.name || `Ship #${id}`;
}

export type LegPhase = "handling" | "travelling" | "arrived";

export interface LegTiming {
  phase: LegPhase;
  /** Until the departure (0 once departed). */
  departsInMs: number;
  /** Until the arrival (0 once due). */
  arrivesInMs: number;
  /** Progress of the voyage between departure and arrival (permille). */
  progressPermille: number;
}

/** Phase and countdowns of a leg at server time nowMs. */
export function legTiming(leg: LegDisplay, nowMs: number): LegTiming {
  const depart = serverTimeMs(leg.depart_at);
  const arrive = serverTimeMs(leg.arrive_at);
  const departsInMs = Math.max(0, depart - nowMs);
  const arrivesInMs = Math.max(0, arrive - nowMs);
  const span = Math.max(1, arrive - depart);
  const progressPermille = Math.min(1000, Math.max(0, ((nowMs - depart) / span) * 1000));
  const phase: LegPhase = nowMs < depart ? "handling" : nowMs < arrive ? "travelling" : "arrived";
  return { phase, departsInMs, arrivesInMs, progressPermille };
}

export interface OrderTiming {
  remainingMs: number;
  progressPermille: number;
}

/** Remaining time and progress of a shipyard order at server time nowMs. */
export function orderTiming(order: ShipOrderDisplay, nowMs: number): OrderTiming {
  const start = serverTimeMs(order.ordered_at);
  const due = serverTimeMs(order.due_at);
  const span = Math.max(1, due - start);
  return {
    remainingMs: Math.max(0, due - nowMs),
    progressPermille: Math.min(1000, Math.max(0, ((nowMs - start) / span) * 1000)),
  };
}

/** A countdown as m:ss (rounded up to whole seconds), h:mm:ss from an hour. */
export function countdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A countdown with its unit: "2:00 min" (m:ss), "1:02:00 h" from an hour. */
export function countdownWithUnit(ms: number): string {
  return `${countdown(ms)} ${ms >= 3_600_000 ? "h" : "min"}`;
}

/** Cargo aboard per good (milli-units), summed over the slots. */
export function cargoTotals(cargo: readonly CargoDisplay[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cargo) out[c.good] = (out[c.good] ?? 0) + c.amount;
  return out;
}

/**
 * Slots the amounts would occupy (one good per slot): a display bound for
 * the shipment dialog only.
 */
export function slotsFor(amounts: Record<string, number>, slotSize: number): number {
  let n = 0;
  for (const a of Object.values(amounts)) if (a > 0) n += Math.ceil(a / Math.max(1, slotSize));
  return n;
}

/** Archipelago placement of an island (display payload fields). */
export interface IslandPlacement {
  position: { x: number; y: number };
  width: number;
  height: number;
}

/** A point in archipelago tiles (x right, y down). */
export interface ArchPoint {
  x: number;
  y: number;
}

/**
 * Centre of an island's rectangle (position + size / 2): the anchor of
 * its name label, and of its legs while its harbour berths are unknown.
 */
export function islandAnchor(is: IslandPlacement): ArchPoint {
  return { x: is.position.x + is.width / 2, y: is.position.y + is.height / 2 };
}

export interface ShipPlacement {
  /** Archipelago position (tiles). */
  point: ArchPoint;
  /** Heading in radians (atan2 of the direction in archipelago tiles), 0 when not travelling. */
  heading: number;
  /** Travelling between two islands (not at an anchor). */
  atSea: boolean;
}

/** Radius (tiles) of the ring on which ships at the same island are spread. */
const SPREAD_RADIUS = 6;

/**
 * Deterministic offset of the i-th ship at an island (i from 0), so that
 * several ships do not overlap and none hides under the island's label at
 * the anchor: points on rings around the anchor, the first one towards the
 * bottom of the screen (+x +y in archipelago tiles).
 */
export function spreadOffset(i: number): ArchPoint {
  const n = Math.max(0, Math.floor(i));
  const ring = Math.floor(n / 6) + 1;
  const angle = Math.PI / 4 + (n % 6) * (Math.PI / 3) + (ring % 2 === 0 ? Math.PI / 6 : 0);
  return { x: Math.cos(angle) * SPREAD_RADIUS * ring, y: Math.sin(angle) * SPREAD_RADIUS * ring };
}

/** The archipelago point of a sea position (the centre of its tile). */
export function seaPoint(p: { x: number; y: number }): ArchPoint {
  return { x: p.x + 0.5, y: p.y + 0.5 };
}

/**
 * Mooring points at a Trading Post's pier (D-051, local tiles, tile
 * centres): pier slot i is tile i of the front row (the outermost water
 * row) one tile further out to sea; queue slot j lies one more tile out,
 * two tiles apart along the row and between two pier slots (further rows
 * outward, staggered, when the row is full). Rotation turns "out" with the
 * building: rotation 0 is −y, 90 +x, 180 +y, 270 −x (the server's
 * sim.WaterTile). Visual placement only.
 */
export function pierPoint(
  def: { width: number; height: number; water_tiles?: number },
  b: Pick<BuildingDisplay, "x" | "y" | "rotation">,
  slot: number,
  queued: boolean,
): ArchPoint | null {
  const rows = waterRows(def, b.x, b.y, b.rotation);
  if (!rows) return null;
  const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
  const r = ((b.rotation % 360) + 360) % 360;
  // Front row: its first tile, the step along it and the outward step.
  const front =
    r === 90
      ? { x: b.x + w - 1, y: b.y, ax: 0, ay: 1, ox: 1, oy: 0, len: h }
      : r === 180
        ? { x: b.x, y: b.y + h - 1, ax: 1, ay: 0, ox: 0, oy: 1, len: w }
        : r === 270
          ? { x: b.x, y: b.y, ax: 0, ay: 1, ox: -1, oy: 0, len: h }
          : { x: b.x, y: b.y, ax: 1, ay: 0, ox: 0, oy: -1, len: w };
  const n = Math.max(0, Math.floor(slot));
  let along: number;
  let out: number;
  if (queued) {
    const perRow = Math.max(1, Math.ceil(front.len / 2));
    const row = Math.floor(n / perRow);
    along = Math.min(front.len - 1, ((n % perRow) * 2 + 1 - (row % 2)) % Math.max(1, front.len));
    out = 2 + row;
  } else {
    along = n % front.len;
    out = 1 + Math.floor(n / front.len);
  }
  return { x: front.x + front.ax * along + front.ox * out + 0.5, y: front.y + front.ay * along + front.oy * out + 0.5 };
}

/** Heading (radians, as ShipPlacement) of a ship moored at a pier: bow out to sea, so neighbours lie side by side. */
export function pierHeading(rotation: number): number {
  const r = ((rotation % 360) + 360) % 360;
  const [ox, oy] = r === 90 ? [1, 0] : r === 180 ? [0, 1] : r === 270 ? [-1, 0] : [0, -1];
  return Math.atan2(oy, ox);
}

/** Where a ship at a Trading Post's pier lies (archipelago tiles) and which way it points. */
export interface Dock {
  point: ArchPoint;
  heading: number;
  /** Waiting in the Trading Post's queue (not moored at the pier). */
  queued?: boolean;
}

/**
 * A model anchor of a building (island tiles; h: height above the ground),
 * null without a loaded model or without that anchor. The render layer
 * reads it from the model manifest; display code only places things at it.
 */
export type ModelAnchor = (b: BuildingDisplay, def: { width: number; height: number }, name: string) => { x: number; y: number; h: number } | null;

/** The Trading Post model's berth anchors (D-054: berth_1 … berth_4, the stern points on the pier front). */
export const BERTH_ANCHORS = ["berth_1", "berth_2", "berth_3", "berth_4"] as const;
/** Fan of the ships moored at the pier: radians of turn per tile of the berth's offset from the pier's centre (bows spread, sterns close), for a ship of the reference length. */
const BERTH_FAN = (28 * Math.PI) / 180 / 1.5;
/** Queue: ships along a row (centre first, then alternating sides), their spacing and the gap behind the moored bows (tiles). */
const QUEUE_PER_ROW = 5;
const QUEUE_SPACING = 2.5;
const QUEUE_GAP = 1;
/** Hull length (tiles, content ships.json `length_tiles`) of the reference ship, the sloop: the ship drawn at the layers' scale and laid on the berth anchors as they are. */
export const REFERENCE_SHIP_LENGTH_MILLI = 2_000;

/** A ship type's length relative to the reference ship (1 for the sloop or without content length). */
export function shipLengthRatio(ship: { length_milli_tiles?: number } | undefined): number {
  const l = ship?.length_milli_tiles ?? 0;
  return l > 0 ? l / REFERENCE_SHIP_LENGTH_MILLI : 1;
}

/**
 * Where the ships lie at a Trading Post's pier with the model's berth
 * anchors (D-054, island tiles; each ship's origin and heading).
 * `moored[i]` and `queued[i]` are the length ratios (shipLengthRatio) of
 * the ships holding pier slot i and waiting at queue place i.
 *
 * A moored ship lies stern-first at the pier front, bow out, fanned by its
 * offset from the pier's centre, its stern `stern × ratio` tiles behind its
 * origin. The berths are spaced by ship length: slot i takes the side of
 * berth anchor i + 1 (the middle pair first, then outwards), and each ship
 * takes a width of `anchor spacing × ratio` along the pier, so sloops lie
 * exactly on the anchors and longer ships push their neighbours outwards
 * instead of overlapping them. A queued ship waits bow out beyond the
 * longest moored bow: QUEUE_PER_ROW along a row (centre first), further rows
 * further out. An entry is null without anchors (the model is not loaded)
 * or for a pier slot beyond the anchors; pierPoint is the fallback. Visual
 * placement only.
 */
export function pierLayout(
  anchors: readonly { x: number; y: number }[],
  rotation: number,
  moored: readonly number[],
  queued: readonly number[],
  stern: number,
): { moored: ({ point: ArchPoint; heading: number } | null)[]; queued: ({ point: ArchPoint; heading: number } | null)[] } {
  if (anchors.length === 0) return { moored: moored.map(() => null), queued: queued.map(() => null) };
  const out = pierHeading(rotation);
  const ox = Math.cos(out);
  const oy = Math.sin(out);
  // "Along" is "out" turned by +90°: a positive offset turns the bow that way.
  const ax = -oy;
  const ay = ox;
  const cx = anchors.reduce((s, a) => s + a.x, 0) / anchors.length;
  const cy = anchors.reduce((s, a) => s + a.y, 0) / anchors.length;
  const offsets = anchors.map((a) => (a.x - cx) * ax + (a.y - cy) * ay);
  // The anchor spacing: the width one reference ship takes along the pier.
  const sorted = [...offsets].sort((a, b) => a - b);
  let unit = Infinity;
  for (let k = 1; k < sorted.length; k++) if (sorted[k]! - sorted[k - 1]! > 1e-6) unit = Math.min(unit, sorted[k]! - sorted[k - 1]!);
  if (!Number.isFinite(unit)) unit = 1.5;
  // Width already taken on each side of the centre (neg: negative offsets); the slots fill outwards in anchor order.
  const taken = { neg: 0, pos: 0 };
  const mooredOut = moored.map((ratio, n) => {
    const a = anchors[n];
    const o = offsets[n];
    if (!a || o === undefined) return null;
    const width = unit * ratio;
    let off = o;
    if (Math.abs(o) > 1e-6) {
      const side = o < 0 ? "neg" : "pos";
      off = Math.sign(o) * (taken[side] + width / 2);
      taken[side] += width;
    } else {
      // A ship on the centre line (odd anchor counts) takes half its width of each side.
      taken.neg += width / 2;
      taken.pos += width / 2;
    }
    // The pier front through the anchor (its depth along "out" kept), shifted along to the packed offset.
    const bx = a.x + ax * (off - o);
    const by = a.y + ay * (off - o);
    const heading = out + (off / ratio) * BERTH_FAN;
    const len = stern * ratio;
    return { point: { x: bx + Math.cos(heading) * len, y: by + Math.sin(heading) * len }, heading };
  });
  // The moored bows reach 2 × stern × ratio out; the queue's sterns wait QUEUE_GAP beyond, each row a ship length further.
  const reach = Math.max(2 * stern, ...moored.map((r) => 2 * stern * r));
  const qr = Math.max(1, ...queued);
  const queuedOut = queued.map((_, n) => {
    const row = Math.floor(n / QUEUE_PER_ROW);
    const k = n % QUEUE_PER_ROW;
    const along = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * QUEUE_SPACING * qr;
    const dist = reach + stern * qr + QUEUE_GAP + row * (2 * stern * qr + QUEUE_GAP);
    return { point: { x: cx + ox * dist + ax * along, y: cy + oy * dist + ay * along }, heading: out };
  });
  return { moored: mooredOut, queued: queuedOut };
}

/**
 * Where ship `slot` lies at a Trading Post's pier with the model's berth
 * anchors when every ship there has the reference length (pierLayout):
 * a moored ship holds berth anchor slot + 1, a queued ship waits at queue
 * place `slot`. Null without anchors or with more moored ships than
 * anchors.
 */
export function berthDock(
  anchors: readonly { x: number; y: number }[],
  rotation: number,
  slot: number,
  queued: boolean,
  stern: number,
): { point: ArchPoint; heading: number } | null {
  const n = Math.max(0, Math.floor(slot));
  const ones = new Array<number>(n + 1).fill(1);
  const layout = queued ? pierLayout(anchors, rotation, [], ones, stern).queued : pierLayout(anchors, rotation, ones, [], stern).moored;
  return layout[n] ?? null;
}

/**
 * Archipelago points of the ships at a Trading Post's pier (D-051, D-054):
 * a ship holding a berth at pier slot = its index among the berth's ships,
 * a queued ship at queue slot = its place in the queue. With the model's
 * berth anchors (`anchor`) they moor at the pier's berths (pierLayout,
 * `stern`: tiles from a reference ship's origin back to its stern; `ratio`:
 * a ship's length relative to the reference, by ship ID); without them
 * along the front row (pierPoint). From the payload's `berths`; fisher and
 * shipyard jetties hold no ships.
 */
export function dockPoints(
  islands: readonly Pick<IslandPlacement & { buildings: readonly BuildingDisplay[] }, "position" | "buildings">[],
  defs: ReadonlyMap<string, { width: number; height: number; water_tiles?: number; trading_post?: unknown }>,
  anchor: ModelAnchor | null = null,
  stern = 0,
  ratio: (shipId: number) => number = () => 1,
): Map<number, Dock> {
  const out = new Map<number, Dock>();
  for (const is of islands) {
    for (const b of is.buildings) {
      const def = defs.get(b.type);
      if (!def?.trading_post || !b.berths) continue;
      const anchors: { x: number; y: number }[] = [];
      if (anchor) {
        for (const name of BERTH_ANCHORS) {
          const a = anchor(b, def, name);
          if (!a) break;
          anchors.push(a);
        }
      }
      const layout = pierLayout(anchors, b.rotation, b.berths.ships.map(ratio), b.berths.queue.map(ratio), stern);
      const put = (ids: readonly number[], queued: boolean) =>
        ids.forEach((id, i) => {
          const at = (queued ? layout.queued : layout.moored)[i] ?? null;
          const p = at?.point ?? pierPoint(def, b, i, queued);
          if (p) out.set(id, { point: { x: is.position.x + p.x, y: is.position.y + p.y }, heading: at?.heading ?? pierHeading(b.rotation), ...(queued ? { queued } : {}) });
        });
      put(b.berths.ships, false);
      put(b.berths.queue, true);
    }
  }
  return out;
}

/** Harbour berths of every island (archipelago tiles, nearest to the harbour first). */
export type Berths = ReadonlyMap<string, readonly ArchPoint[]>;

/**
 * Anchor point of an island for legs and route ribbons: its first harbour
 * berth, or the island centre while its berths are unknown (static data
 * not loaded). A visual convention only; the server measures distances.
 */
export function berthAnchor(id: string, islands: ReadonlyMap<string, IslandPlacement>, berths?: Berths): ArchPoint | null {
  const first = berths?.get(id)?.[0];
  if (first) return first;
  const is = islands.get(id);
  return is ? islandAnchor(is) : null;
}

/**
 * Point and heading (radians, atan2 in archipelago tiles) at fraction f
 * (clamped to [0, 1]) of a polyline's length.
 */
export function alongPath(pts: readonly ArchPoint[], f: number): { point: ArchPoint; heading: number } {
  const first = pts[0] ?? { x: 0, y: 0 };
  if (pts.length < 2) return { point: first, heading: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let rest = Math.min(1, Math.max(0, f)) * total;
  let heading = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len === 0) continue;
    heading = Math.atan2(q.y - p.y, q.x - p.x);
    if (f < 1 && rest < len) {
      const t = rest / len;
      return { point: { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, heading };
    }
    rest -= len;
  }
  // The end (f >= 1, or rounding past the last segment): exactly the last point.
  return { point: pts[pts.length - 1]!, heading };
}

/**
 * Polyline of a leg (archipelago tiles): the server's voyage around land
 * (`path`, D-058 §5) between the visual anchors — the origin `a` (sea
 * position, pier slot or first berth) and the destination's first berth;
 * the server's harbour ends stay in (the hop from a pier to its harbour
 * is on the water; a straight line from the pier to the first waypoint
 * could cut a corner of land). An end without berths (no Trading Post)
 * is the server's shore point. Without a path (older payloads) the
 * straight line between the berth anchors. Repeated points are dropped.
 * Null when an island is unknown.
 */
export function legPath(
  leg: LegDisplay,
  islands: ReadonlyMap<string, IslandPlacement>,
  berths?: Berths,
  dock?: Dock,
): ArchPoint[] | null {
  const path = leg.path ?? [];
  const end = (id: string, p: { x: number; y: number } | undefined): ArchPoint | null =>
    berths?.get(id)?.[0] ?? (p ? seaPoint(p) : berthAnchor(id, islands, berths));
  const a = leg.from_position ? seaPoint(leg.from_position) : (dock?.point ?? end(leg.from_island_id, path[0]));
  const b = end(leg.to_island_id, path[path.length - 1]);
  if (!a || !b) return null;
  const pts = [a, ...path.map(seaPoint), b];
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y);
}

/**
 * Archipelago position of a ship at server time nowMs (D-027: a lerp of
 * the server's leg timestamps, no rule). On a leg it is at the origin's
 * anchor while handling (now < depart_at), along the leg's path around
 * land (legPath) at constant speed while travelling (fraction of the
 * time clamped to [0, 1]) and at the destination's anchor after
 * arrive_at (until the next payload). Without a leg (idle,
 * anchored_unpaid) it lies at harbour berth `slot + 1` of its island (the
 * first berth is the anchor of the legs); at an island without berths
 * (unsettled: the founding ship before found_island) at `arrived`, the
 * end of its last leg, when known, else at the island centre plus the
 * spread offset of `slot`. Null when an island is unknown.
 */
export function shipPlacement(
  ship: Pick<ShipDisplay, "island_id" | "leg"> & { position?: ShipDisplay["position"] },
  islands: ReadonlyMap<string, IslandPlacement>,
  nowMs: number,
  slot = 0,
  berths?: Berths,
  dock?: Dock,
  arrived?: ArchPoint,
): ShipPlacement | null {
  const leg = ship.leg;
  if (leg) {
    // A leg from the sea (the start ship, D-051) starts at its sea position;
    // a ship handling at a Trading Post's pier starts at its pier slot.
    const pts = legPath(leg, islands, berths, dock);
    if (!pts) return null;
    const depart = serverTimeMs(leg.depart_at);
    const arrive = serverTimeMs(leg.arrive_at);
    // Handling at the pier it lies bow out like the moored ships around it (D-054).
    if (nowMs < depart) return { point: pts[0]!, heading: dock && !leg.from_position ? dock.heading : alongPath(pts, 0).heading, atSea: false };
    const f = Math.min(1, Math.max(0, (nowMs - depart) / Math.max(1, arrive - depart)));
    const at = alongPath(pts, f);
    return { point: at.point, heading: at.heading, atSea: f < 1 };
  }
  // At sea without a leg: the start ship before it sails.
  if (!ship.island_id && ship.position) return { point: seaPoint(ship.position), heading: 0, atSea: true };
  // At a Trading Post's pier: unloading at its slot, or queued further out.
  if (dock) return { point: dock.point, heading: dock.heading, atSea: false };
  const is = islands.get(ship.island_id);
  if (!is) return null;
  const list = berths?.get(ship.island_id);
  if (list && list.length > 0) {
    const berth = list[Math.min(list.length - 1, slot + 1)] as ArchPoint;
    return { point: berth, heading: 0, atSea: false };
  }
  if (arrived) return { point: arrived, heading: 0, atSea: false };
  const a = islandAnchor(is);
  const o = spreadOffset(slot);
  return { point: { x: a.x + o.x, y: a.y + o.y }, heading: 0, atSea: false };
}

/**
 * Spread slot of every ship without a leg (idle, anchored_unpaid): its
 * index among those ships at the same island by ascending ID. Ships with a
 * leg get none (they are at the origin anchor while handling), nor do
 * ships at a Trading Post's pier or in its queue (`docked`, dockPoints).
 */
export function anchorSlots(ships: readonly Pick<ShipDisplay, "id" | "island_id" | "leg">[], docked?: ReadonlyMap<number, unknown>): Map<number, number> {
  const byIsland = new Map<string, number[]>();
  for (const s of ships) {
    const at = s.leg || docked?.has(s.id) ? "" : s.island_id;
    if (!at) continue;
    let list = byIsland.get(at);
    if (!list) byIsland.set(at, (list = []));
    list.push(s.id);
  }
  const out = new Map<number, number>();
  for (const list of byIsland.values()) {
    list.sort((a, b) => a - b);
    list.forEach((id, i) => out.set(id, i));
  }
  return out;
}
