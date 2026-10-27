import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DisplayState } from "../api/client";
import { extrapolate, serverTimeMs } from "./extrapolate";
import { cargoTotals, countdown, countdownWithUnit, legTiming, orderTiming, shipName, slotsFor } from "./ships";

// Server fixture (TestDisplayFixtures): a sloop on a manual leg and a
// pending shipyard order, with server payloads at forward offsets.
interface Fixture {
  base: DisplayState;
  samples: { offset_ms: number; display: DisplayState }[];
}

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display", "ship_display.json"), "utf8"),
) as Fixture;

function order(d: DisplayState) {
  const yard = d.islands[0]?.buildings.find((b) => b.ship_order !== undefined);
  return yard?.ship_order ?? null;
}

describe("ship timers against the server fixture", () => {
  const base = fixture.base;
  const t0 = serverTimeMs(base.evaluated_at);
  const ship = base.ships[0]!;
  const leg = ship.leg!;
  const pending = order(base)!;

  it("has a ship on a leg and a pending order", () => {
    expect(ship.state).toBe("manual_leg");
    expect(leg).not.toBeNull();
    expect(pending).not.toBeNull();
    expect(fixture.samples.length).toBeGreaterThan(0);
  });

  for (const s of fixture.samples) {
    it(`+${s.offset_ms} ms`, () => {
      const now = t0 + s.offset_ms;
      // Before next_change_at the server's leg and order are unchanged, so
      // the countdowns are the server timestamps minus the server time.
      expect(s.display.ships).toEqual(base.ships);
      expect(order(s.display)).toEqual(pending);
      expect(extrapolate(base, now).ships).toEqual(base.ships);
      const lt = legTiming(leg, now);
      expect(lt.arrivesInMs).toBe(serverTimeMs(leg.arrive_at) - serverTimeMs(s.display.evaluated_at));
      expect(lt.phase).toBe("travelling");
      const ot = orderTiming(pending, now);
      expect(ot.remainingMs).toBe(serverTimeMs(pending.due_at) - serverTimeMs(s.display.evaluated_at));
      expect(ot.progressPermille).toBeGreaterThan(0);
      expect(ot.progressPermille).toBeLessThan(1000);
    });
  }

  it("progress is linear and monotonic", () => {
    const a = legTiming(leg, t0).progressPermille;
    const b = legTiming(leg, t0 + 1000).progressPermille;
    const c = legTiming(leg, t0 + 2000).progressPermille;
    expect(b - a).toBeCloseTo(c - b);
    expect(b).toBeGreaterThan(a);
  });
});

describe("ship helpers", () => {
  const leg = {
    from_island_id: "a",
    from_position: null,
    to_island_id: "b",
    depart_at: "2026-01-01T00:00:20.000Z",
    arrive_at: "2026-01-01T00:01:20.000Z",
  };
  const t = (s: number) => serverTimeMs("2026-01-01T00:00:00.000Z") + s * 1000;

  it("phases of a leg", () => {
    expect(legTiming(leg, t(5))).toMatchObject({ phase: "handling", departsInMs: 15_000, arrivesInMs: 75_000, progressPermille: 0 });
    expect(legTiming(leg, t(50))).toMatchObject({ phase: "travelling", departsInMs: 0, arrivesInMs: 30_000, progressPermille: 500 });
    expect(legTiming(leg, t(90))).toMatchObject({ phase: "arrived", arrivesInMs: 0, progressPermille: 1000 });
  });

  it("formats countdowns", () => {
    expect(countdown(0)).toBe("0:00");
    expect(countdown(1)).toBe("0:01");
    expect(countdown(65_000)).toBe("1:05");
    expect(countdown(3_725_000)).toBe("1:02:05");
  });

  it("sums cargo and counts slots", () => {
    expect(cargoTotals([{ good: "planks", amount: 50_000 }, { good: "planks", amount: 20_000 }])).toEqual({ planks: 70_000 });
    expect(slotsFor({ planks: 70_000, wood: 1 }, 50_000)).toBe(3);
  });

describe("shipName (D-055)", () => {
  it("is the server's name of the ship, Ship #<id> for one the model no longer has", () => {
    expect(fixture.base.ships[0]!.name).toBe("Sloop 1");
    expect(shipName(fixture.base.ships, 1)).toBe("Sloop 1");
    expect(shipName([{ id: 3, name: "Gull" }], 3)).toBe("Gull");
    expect(shipName([], 7)).toBe("Ship #7");
  });
});

describe("countdownWithUnit", () => {
  it("adds min below an hour and h from an hour", () => {
    expect(countdownWithUnit(120_000)).toBe("2:00 min");
    expect(countdownWithUnit(42_000)).toBe("0:42 min");
    expect(countdownWithUnit(3_600_000)).toBe("1:00:00 h");
    expect(countdownWithUnit(3_725_000)).toBe("1:02:05 h");
  });
});
});
