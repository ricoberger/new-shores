import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import { rotatedFootprint } from "../display/geometry";
import { buildDenseArchipelagoFixture, buildDenseFixture, buildShowcaseFixture, fixtureDefs } from "./fixture";

const CONTENT = join(__dirname, "..", "..", "..", "content", "old_coast");
const T = Date.parse("2026-10-21T16:00:00Z");

interface ContentJson {
  id: string;
  tier: string;
  footprint: [number, number];
  field?: { type: string };
  requires_deposit?: string;
  house?: unknown;
  road?: unknown;
  warehouse?: unknown;
  trading_post?: unknown;
  shipyard?: unknown;
  service?: unknown;
  recipe?: unknown;
}

const content = JSON.parse(readFileSync(join(CONTENT, "buildings.json"), "utf8")) as ContentJson[];

/** The server's category rule (openapi ContentBuilding.category). */
function category(b: ContentJson): string {
  if (b.house) return "houses";
  if (b.recipe || b.field || b.warehouse) return "production";
  if (b.service) return "public";
  if (b.trading_post || b.shipyard) return "harbour";
  if (b.road) return "roads";
  return "other";
}

function overlaps(buildings: readonly BuildingDisplay[], defs: Map<string, ContentBuilding>): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const b of buildings) {
    const def = defs.get(b.type)!;
    const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
    for (let y = b.y; y < b.y + h; y++) {
      for (let x = b.x; x < b.x + w; x++) {
        const k = `${x},${y}`;
        if (seen.has(k)) out.push(`${b.id} overlaps ${seen.get(k)} at ${k}`);
        seen.set(k, b.id);
      }
    }
  }
  return out;
}

describe("fixtures use the real content", () => {
  it("define every tier 1–2 building with its content tier, category, footprint and deposit", () => {
    const defs = new Map(fixtureDefs().map((d) => [d.id, d]));
    for (const b of content.filter((c) => c.tier === "settlers" || c.tier === "citizens")) {
      const d = defs.get(b.id);
      expect(d, b.id).toBeDefined();
      expect({ tier: d!.tier, category: d!.category, w: d!.width, h: d!.height, field: d!.field?.type, deposit: d!.requires_deposit }).toEqual({
        deposit: b.requires_deposit,
        tier: b.tier,
        category: category(b),
        w: b.footprint[0],
        h: b.footprint[1],
        field: b.field?.type,
      });
    }
  });

  it("carry the content's Trading Post and Warehouse levels and upgrade costs (milli-units, as the API sends them)", () => {
    type Level = { capacity?: number; throughput_per_min: number; berths?: number; cost?: Record<string, number> };
    const api = (l: Level) => {
      const { gold = 0, ...materials } = l.cost ?? {};
      return {
        ...(l.capacity === undefined ? {} : { capacity: l.capacity * 1000 }),
        throughput_per_min: l.throughput_per_min * 1000,
        ...(l.berths === undefined ? {} : { berths: l.berths }),
        ...(l.cost ? { cost: { gold: gold * 1000, materials: Object.fromEntries(Object.entries(materials).map(([g, n]) => [g, n * 1000])) } } : {}),
      };
    };
    const defs = new Map(fixtureDefs().map((d) => [d.id, d]));
    for (const id of ["trading_post", "warehouse"] as const) {
      const shipped = content.find((b) => b.id === id) as unknown as Record<string, { levels: Level[] }>;
      const fixture = defs.get(id) as unknown as Record<string, { levels: unknown[] }>;
      expect(fixture[id]!.levels, id).toEqual(shipped[id]!.levels.map(api));
    }
  });

  it("dense-2x400 keeps ≈ 400 buildings and ≥ 60 delivering producers without overlaps", () => {
    const f = buildDenseFixture(T);
    const defs = new Map(f.content.buildings.map((b) => [b.id, b]));
    const dense = f.server.display.islands[0]!;
    expect(dense.buildings.length).toBeGreaterThanOrEqual(380);
    expect(dense.buildings.length).toBeLessThanOrEqual(425);
    const delivering = dense.buildings.filter((b) => (b.assigned_warehouse_id ?? 0) > 0 && Object.values(b.rates?.outputs ?? {}).some((r) => r > 0));
    expect(delivering.length).toBeGreaterThanOrEqual(60);
    const types = new Set(dense.buildings.map((b) => b.type));
    for (const t of ["house_settlers", "lumberjack", "sawmill", "fisher", "chapel", "trading_post", "warehouse", "shipyard", "pasture", "wheat_field"]) expect(types, t).toContain(t);
    expect(dense.roads.every((r) => r.type === "road_dirt")).toBe(true);
    for (const is of f.server.display.islands) expect(overlaps(is.buildings, defs), is.id).toEqual([]);
    // Every building lies on the island and off the roads.
    const roads = new Set(dense.roads.map((r) => `${r.x},${r.y}`));
    for (const b of dense.buildings) {
      const def = defs.get(b.type)!;
      const [w, h] = rotatedFootprint(def.width, def.height, b.rotation);
      for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) expect(roads.has(`${x},${y}`), `${b.type}#${b.id} on a road`).toBe(false);
    }
  });

  it("dense-archipelago-8 has no overlaps either", () => {
    const f = buildDenseArchipelagoFixture(T);
    const defs = new Map(f.content.buildings.map((b) => [b.id, b]));
    for (const is of f.server.display.islands) expect(overlaps(is.buildings, defs), is.id).toEqual([]);
  });

  it("the showcase places every model ID with all variants, every Trading Post and Warehouse level, a paused building and the three sloop styles", () => {
    const f = buildShowcaseFixture(T);
    const defs = new Map(f.content.buildings.map((b) => [b.id, b]));
    const is = f.server.display.islands[0]!;
    const types = new Set(is.buildings.map((b) => b.type));
    for (const b of content.filter((c) => (c.tier === "settlers" || c.tier === "citizens") && !c.road)) expect(types, b.id).toContain(b.id);
    expect(is.buildings.filter((b) => b.type === "house_settlers").length).toBeGreaterThanOrEqual(6);
    expect(is.buildings.filter((b) => b.type === "house_citizens").length).toBeGreaterThanOrEqual(6);
    expect(new Set(is.buildings.filter((b) => b.type === "trading_post").map((b) => b.level))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(is.buildings.filter((b) => b.type === "warehouse").map((b) => b.level))).toEqual(new Set([1, 2, 3]));
    expect(is.buildings.some((b) => b.paused)).toBe(true);
    expect(overlaps(is.buildings, defs)).toEqual([]);
    const ships = f.server.display.ships;
    expect(ships.some((s) => s.state === "anchored_unpaid")).toBe(true);
    expect(ships.some((s) => s.cargo.length > 0 && s.state !== "anchored_unpaid")).toBe(true);
    expect(ships.some((s) => s.cargo.length === 0 && s.state !== "anchored_unpaid")).toBe(true);
  });
});
