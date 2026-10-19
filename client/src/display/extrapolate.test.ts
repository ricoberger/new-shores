import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DisplayState } from "../api/client";
import { extrapolate, serverTimeMs } from "./extrapolate";

// Shared fixtures written by the Go test TestDisplayFixtures
// (server/internal/sim/scenario): the Display payload at the end of every
// scenario and true server payloads at forward offsets before next_change_at.
interface Fixture {
  scenario: string;
  base: DisplayState;
  samples: { offset_ms: number; display: DisplayState }[];
}

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");

function loadFixtures(): Fixture[] {
  return readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as Fixture);
}

/** Removes the extrapolated fields, leaving the pass-through fields. */
function passThrough(d: DisplayState): unknown {
  return {
    ...d,
    evaluated_at: undefined,
    gold: undefined,
    islands: d.islands.map((is) => ({
      ...is,
      inventory: Object.fromEntries(Object.entries(is.inventory).map(([k, g]) => [k, { ...g, stock: undefined }])),
      buildings: is.buildings.map((b) => ({
        ...b,
        cycle_progress_permille: undefined,
        growth_progress_permille: undefined,
      })),
    })),
  };
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1000;
  return Math.min(d, 1000 - d);
}

/**
 * Compares the extrapolation of base at offsetMs with the server's sample.
 * Quantities may differ by tol milli-units (gold: milli-gold), progress by
 * tol permille. Returns the violations.
 */
export function compareSample(base: DisplayState, offsetMs: number, sample: DisplayState, tol: number): string[] {
  const out: string[] = [];
  const ext = extrapolate(base, serverTimeMs(base.evaluated_at) + offsetMs);
  if (Math.abs(ext.gold - sample.gold) > tol) {
    out.push(`gold ${ext.gold} vs ${sample.gold}`);
  }
  sample.islands.forEach((is, i) => {
    const ei = ext.islands[i];
    if (!ei) {
      out.push(`island ${is.id} missing`);
      return;
    }
    for (const [good, g] of Object.entries(is.inventory)) {
      const e = ei.inventory[good];
      if (!e || Math.abs(e.stock - g.stock) > tol) {
        out.push(`${is.id} ${good} stock ${e?.stock} vs ${g.stock}`);
      }
    }
    is.buildings.forEach((b, j) => {
      const eb = ei.buildings[j];
      if (!eb) {
        out.push(`building ${b.id} missing`);
        return;
      }
      if (b.cycle_progress_permille !== undefined) {
        const d = circularDistance(eb.cycle_progress_permille ?? NaN, b.cycle_progress_permille);
        if (!(d <= tol)) out.push(`building ${b.id} cycle ${eb.cycle_progress_permille} vs ${b.cycle_progress_permille}`);
      }
      if (b.growth_progress_permille !== undefined) {
        const d = Math.abs((eb.growth_progress_permille ?? NaN) - b.growth_progress_permille);
        if (!(d <= tol)) out.push(`building ${b.id} growth ${eb.growth_progress_permille} vs ${b.growth_progress_permille}`);
      }
    });
  });
  return out;
}

const fixtures = loadFixtures();

describe("extrapolate against server fixtures", () => {
  it("finds the fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(5);
    expect(fixtures.some((f) => f.samples.length > 0)).toBe(true);
  });

  for (const fx of fixtures) {
    describe(fx.scenario, () => {
      for (const s of fx.samples) {
        it(`+${s.offset_ms} ms`, () => {
          const tol = 1 + Math.ceil(s.offset_ms / 60_000);
          expect(compareSample(fx.base, s.offset_ms, s.display, tol)).toEqual([]);
          // Pass-through fields must not change before next_change_at.
          expect(passThrough(s.display)).toEqual(passThrough(fx.base));
          const ext = extrapolate(fx.base, serverTimeMs(fx.base.evaluated_at) + s.offset_ms);
          expect(passThrough(ext)).toEqual(passThrough(fx.base));
        });
      }
    });
  }

  it("detects differences when the tolerance is 0", () => {
    const violations = fixtures.flatMap((fx) =>
      fx.samples.flatMap((s) => compareSample(fx.base, s.offset_ms, s.display, 0)),
    );
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("extrapolate", () => {
  const base: DisplayState = {
    evaluated_at: "2026-01-01T00:00:00.000Z",
    next_change_at: null,
    gold: 1000,
    balance_rate_per_min: -600,
    tax_rate_per_min: 0,
    upkeep_rate_per_min: 600,
    tiers: [],
    islands: [
      {
        id: "a",
        width: 1,
        height: 1,
        roads: [],
        workforce: {},
        population: {},
        inventory: {
          up: { stock: 900, capacity: 1000, in_transit: 0, rate_per_min: 600 },
          down: { stock: 100, capacity: 1000, in_transit: 0, rate_per_min: -600 },
        },
        buildings: [
          {
            id: 1,
            type: "x",
            x: 0,
            y: 0,
            rotation: 0,
            entrance: { x: 0, y: 0 },
            paused: false,
            paused_reason: "",
            status: "ok",
            efficiency_permille: 1000,
            throughput_factor_permille: 1000,
            cycle_progress_permille: 900,
            cycle_rate_permille_per_min: 2000,
            growth_progress_permille: 900,
            growth_rate_per_min: 1000,
          },
        ],
      },
    ],
  };
  const t0 = serverTimeMs(base.evaluated_at);

  it("clamps stocks to [0, capacity] and gold to >= 0", () => {
    const d = extrapolate(base, t0 + 60_000 * 5);
    expect(d.gold).toBe(0);
    expect(d.islands[0]?.inventory.up?.stock).toBe(1000);
    expect(d.islands[0]?.inventory.down?.stock).toBe(0);
  });

  it("wraps cycle progress and clamps growth progress", () => {
    const b = extrapolate(base, t0 + 6_000).islands[0]?.buildings[0];
    expect(b?.cycle_progress_permille).toBeCloseTo(100);
    expect(extrapolate(base, t0 + 60_000).islands[0]?.buildings[0]?.growth_progress_permille).toBe(1000);
  });

  it("never extrapolates backwards", () => {
    expect(extrapolate(base, t0 - 60_000).gold).toBe(1000);
  });
});
