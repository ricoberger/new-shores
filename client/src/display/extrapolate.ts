// Display model (D-027, ARCHITECTURE §5): linear extrapolation of the
// server's Display payload. Pure functions only: no DOM, no Babylon, no
// fetch, and no game rule — every number is a server number or a linear
// extrapolation of one.
import type { BuildingDisplay, DisplayState, GoodDisplay, IslandDisplay } from "../api/client";

const MS_PER_MIN = 60_000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Milliseconds since the Unix epoch of an RFC 3339 server timestamp. */
export function serverTimeMs(timestamp: string): number {
  return Date.parse(timestamp);
}

/** Minutes elapsed since the payload's evaluated_at, never negative. */
export function elapsedMinutes(server: DisplayState, serverNowMs: number): number {
  return Math.max(0, (serverNowMs - serverTimeMs(server.evaluated_at)) / MS_PER_MIN);
}

export function extrapolateGood(g: GoodDisplay, dtMin: number): GoodDisplay {
  return {
    ...g,
    stock: clamp(g.stock + g.rate_per_min * dtMin, 0, g.capacity),
    in_transit: Math.max(0, g.in_transit + g.in_transit_rate_per_min * dtMin),
  };
}

export function extrapolateBuilding(b: BuildingDisplay, dtMin: number): BuildingDisplay {
  if (b.cycle_progress_permille === undefined && b.growth_progress_permille === undefined) {
    return b;
  }
  const out = { ...b };
  if (b.cycle_progress_permille !== undefined) {
    const p = b.cycle_progress_permille + (b.cycle_rate_permille_per_min ?? 0) * dtMin;
    out.cycle_progress_permille = ((p % 1000) + 1000) % 1000;
  }
  if (b.growth_progress_permille !== undefined) {
    out.growth_progress_permille = clamp(
      b.growth_progress_permille + (b.growth_rate_per_min ?? 0) * dtMin,
      -1000,
      1000,
    );
  }
  return out;
}

export function extrapolateIsland(is: IslandDisplay, dtMin: number): IslandDisplay {
  const inventory: IslandDisplay["inventory"] = {};
  for (const [good, g] of Object.entries(is.inventory)) {
    inventory[good] = extrapolateGood(g, dtMin);
  }
  return { ...is, inventory, buildings: is.buildings.map((b) => extrapolateBuilding(b, dtMin)) };
}

/**
 * Extrapolates the server payload to serverNowMs. Stocks, gold, cycle and
 * growth progress move linearly; every other field passes through
 * unchanged (it only changes at next_change_at, when the client re-fetches).
 */
export function extrapolate(server: DisplayState, serverNowMs: number): DisplayState {
  const dtMin = elapsedMinutes(server, serverNowMs);
  return {
    ...server,
    gold: Math.max(0, server.gold + server.balance_rate_per_min * dtMin),
    islands: server.islands.map((is) => extrapolateIsland(is, dtMin)),
  };
}

/**
 * Server clock offset: offset = evaluated_at - receive time, so that
 * serverNow = Date.now() + offset. Under --time-scale != 1 this lags (dev
 * only).
 */
export function clockOffsetMs(server: DisplayState, receivedAtMs: number): number {
  return serverTimeMs(server.evaluated_at) - receivedAtMs;
}
