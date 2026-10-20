// Ship and shipyard timers for the UI (D-027): linear in time from the
// server's timestamps, no rule evaluated. Travel times, capacities and
// slot rules are the server's; the slot count here is only a display
// bound for the shipment dialog (the server validates).
import type { CargoDisplay, LegDisplay, ShipOrderDisplay } from "../api/client";
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
