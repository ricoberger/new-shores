// Ship and shipyard timers for the UI (D-027): linear in time from the
// server's timestamps, no rule evaluated. Travel times, capacities and
// slot rules are the server's; the slot count here is only a display
// bound for the shipment dialog (the server validates).
import type { CargoDisplay, LegDisplay, ShipDisplay, ShipOrderDisplay } from "../api/client";
import { serverTimeMs } from "./extrapolate";

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
 * Archipelago position of a ship at server time nowMs (D-027: a lerp of
 * the server's leg timestamps, no rule). On a leg it is at the origin's
 * berth anchor while handling (now < depart_at), on the straight line
 * between the two berth anchors while travelling (fraction clamped to
 * [0, 1]; the line may cross land) and at the destination's anchor after
 * arrive_at (until the next payload). Without a leg (idle,
 * anchored_unpaid) it lies at harbour berth `slot + 1` of its island (the
 * first berth is the anchor of the legs), or at the island centre plus
 * the spread offset of `slot` when the berths are unknown. Null when an
 * island is unknown.
 */
export function shipPlacement(
  ship: Pick<ShipDisplay, "island_id" | "leg">,
  islands: ReadonlyMap<string, IslandPlacement>,
  nowMs: number,
  slot = 0,
  berths?: Berths,
): ShipPlacement | null {
  const leg = ship.leg;
  if (leg) {
    const a = berthAnchor(leg.from_island_id, islands, berths);
    const b = berthAnchor(leg.to_island_id, islands, berths);
    if (!a || !b) return null;
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    const depart = serverTimeMs(leg.depart_at);
    const arrive = serverTimeMs(leg.arrive_at);
    if (nowMs < depart) return { point: a, heading, atSea: false };
    const f = Math.min(1, Math.max(0, (nowMs - depart) / Math.max(1, arrive - depart)));
    return { point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, heading, atSea: f < 1 };
  }
  const is = islands.get(ship.island_id);
  if (!is) return null;
  const list = berths?.get(ship.island_id);
  if (list && list.length > 0) {
    const berth = list[Math.min(list.length - 1, slot + 1)] as ArchPoint;
    return { point: berth, heading: 0, atSea: false };
  }
  const a = islandAnchor(is);
  const o = spreadOffset(slot);
  return { point: { x: a.x + o.x, y: a.y + o.y }, heading: 0, atSea: false };
}

/**
 * Spread slot of every ship without a leg (idle, anchored_unpaid): its
 * index among those ships at the same island by ascending ID. Ships with a
 * leg get none (they are at the origin anchor while handling).
 */
export function anchorSlots(ships: readonly Pick<ShipDisplay, "id" | "island_id" | "leg">[]): Map<number, number> {
  const byIsland = new Map<string, number[]>();
  for (const s of ships) {
    const at = s.leg ? "" : s.island_id;
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
