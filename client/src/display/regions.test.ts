import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState, Island, ShipDisplay } from "../api/client";
import type { SyncSnapshot } from "../api/sync";
import { RegionSource } from "../render/regionsource";
import { RegionSwitcher } from "../ui/RegionSwitcher";
import { shipWhere } from "../ui/ShipsPanel";
import { warningEntries } from "../ui/WarningsPanel";
import { betweenRegions, currentRegionId, homeRegionId, regionName, regionStatics, regionView, showRegionSwitcher, warningsByRegion } from "./regions";

// Regions in one world (D-076) with a synthetic two-region payload: the
// shared route_loop fixture (islands start and island2, ship 1 on a leg,
// route 1 between them) with island2 moved into a second region "south",
// a third island there, a ship at sea in the south and a ship on a
// passage between the regions.
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixture = (name: string) => (JSON.parse(readFileSync(join(repo, "server", "testdata", "display", `${name}.json`), "utf8")) as { base: DisplayState }).base;

const passage: ShipDisplay["leg"] = {
  from_island_id: "start",
  from_position: null,
  to_island_id: "far",
  depart_at: "2026-01-01T00:00:00.000Z",
  arrive_at: "2026-01-01T00:10:00.000Z",
  passage: true,
};

function twoRegions(southUnlocked = true): DisplayState {
  const d = structuredClone(fixture("route_loop"));
  const south = d.islands.find((is) => is.id === "island2")!;
  const ship = d.ships[0]!;
  d.regions = [
    d.regions[0]!,
    { id: "south", unlocked: southUnlocked, seed: 1_053_002, passage_point: { x: 40, y: 30 }, bounds: { x: 0, y: 0, width: 80, height: 60 } },
  ];
  south.region_id = "south";
  d.islands.push({ ...structuredClone(south), id: "far", name: "Far", buildings: [] });
  d.ships = [
    { ...ship, region_id: "old_coast" },
    { ...ship, id: 2, name: "Cog 2", region_id: "south", leg: null, island_id: "", position: { x: 40, y: 30 } },
    { ...ship, id: 3, name: "Cog 3", region_id: null, state: "manual_leg", island_id: "", leg: passage },
  ];
  for (const r of d.routes) for (const st of r.stops) st.region_id = st.island_id === "island2" ? "south" : "old_coast";
  return d;
}

const content = {
  region: { id: "old_coast", name: "Old Coast" },
  regions: [
    { id: "old_coast", prefix: "oc", home: true, gate: null, catalogue: null },
    { id: "south", prefix: "so", home: false, gate: "kontor", catalogue: { region: { id: "south", name: "The South" } } },
  ],
} as unknown as Content;

describe("one region", () => {
  it("passes the payload through and hides the switcher", () => {
    const d = fixture("route_loop");
    expect(d.regions).toHaveLength(1);
    expect(homeRegionId(d)).toBe("old_coast");
    expect(regionView(d, "old_coast")).toBe(d);
    expect(showRegionSwitcher(d)).toBe(false);
    expect(renderToStaticMarkup(createElement(RegionSwitcher, { model: d, content, current: "old_coast", warnings: new Map(), onSelect: () => {} }))).toBe("");
    const statics = new Map(d.islands.map((is) => [is.id, {} as Island]));
    expect(regionStatics(statics, d)).toBe(statics);
  });
});

describe("two regions", () => {
  it("shows one region's islands, ships and routes on the map", () => {
    const d = twoRegions();
    const home = regionView(d, "old_coast");
    expect(home.islands.map((is) => is.id)).toEqual(["start"]);
    expect(home.ships.map((s) => s.id)).toEqual([1]);
    expect(home.routes).toEqual([]); // route 1 crosses into the south
    expect(home.archipelago.seed).toBe(d.archipelago.seed);
    const south = regionView(d, "south");
    expect(south.islands.map((is) => is.id)).toEqual(["island2", "far"]);
    expect(south.ships.map((s) => s.id)).toEqual([2]);
    expect(south.archipelago).toMatchObject({ seed: 1_053_002, roll: 0, rerollable: false, bounds: { x: 0, y: 0, width: 80, height: 60 } });
    // World-wide state stays whole.
    expect(south.gold).toBe(d.gold);
    expect(south.quests).toBe(d.quests);
    const statics = new Map(d.islands.map((is) => [is.id, {} as Island]));
    expect([...regionStatics(statics, south).keys()]).toEqual(["island2", "far"]);
  });

  it("keeps a ship between regions off every map but in the ship list", () => {
    const d = twoRegions();
    const between = d.ships.filter(betweenRegions);
    expect(between.map((s) => s.id)).toEqual([3]);
    for (const r of d.regions) expect(regionView(d, r.id).ships.some((s) => s.id === 3)).toBe(false);
    const where = shipWhere(between[0]!, Date.parse("2026-01-01T00:05:00.000Z"), (id) => id);
    expect(where).toBe("between regions, arrives in 5:00");
    // A single-region payload with a ship between regions (a region opened elsewhere) narrows too.
    const one = { ...d, regions: [d.regions[0]!], islands: d.islands.filter((is) => is.region_id === "old_coast") };
    expect(regionView(one, "old_coast").ships.map((s) => s.id)).toEqual([1]);
  });

  it("switches between unlocked regions with warning badges", () => {
    const d = twoRegions();
    expect(showRegionSwitcher(d)).toBe(true);
    expect(currentRegionId(d, null)).toBe("old_coast");
    expect(currentRegionId(d, "south")).toBe("south");
    expect(currentRegionId(d, "nowhere")).toBe("old_coast");
    expect(regionName(content, "south")).toBe("The South");
    expect(regionName(content, "old_coast")).toBe("Old Coast");
    const selected: string[] = [];
    const html = renderToStaticMarkup(
      createElement(RegionSwitcher, { model: d, content, current: "south", warnings: new Map([["south", 2]]), onSelect: (id: string) => selected.push(id) }),
    );
    expect(html).toContain('data-testid="region-switcher"');
    expect(html).toContain("Old Coast");
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="The South, 2 warnings"/);
    expect(html).toContain(">2</span>");
    const locked = twoRegions(false);
    expect(showRegionSwitcher(locked)).toBe(false);
    expect(currentRegionId(locked, "south")).toBe("old_coast");
  });

  it("counts warnings per region", () => {
    const d = twoRegions();
    const ins = fixture("insolvency");
    const entries = warningEntries({ ...d, islands: [...d.islands, ...ins.islands.map((is) => ({ ...is, region_id: "south" }))] }, { buildings: [], tiers: [], goods: [], needs: [], need_categories: [], ships: [] } as unknown as Content);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.regionId === e.is.region_id)).toBe(true);
    expect(warningsByRegion(entries).get("south")).toBe(entries.filter((e) => e.regionId === "south").length);
  });
});

describe("the renderer's region source", () => {
  function source(snapshot: SyncSnapshot) {
    let listener: (() => void) | null = null;
    const inner = {
      subscribe: (l: () => void) => {
        listener = l;
        return () => {
          listener = null;
        };
      },
      getSnapshot: () => snapshot,
      serverNowMs: () => 0,
    };
    return { inner, notify: () => listener?.() };
  }
  const snap = (display: DisplayState): SyncSnapshot => ({
    server: { version: 1, display },
    model: display,
    nowMs: 0,
    content: null,
    islands: new Map(display.islands.map((is) => [is.id, {} as Island])),
    unreachable: false,
  });

  it("passes one region through and narrows two", () => {
    const one = snap(fixture("route_loop"));
    const s1 = new RegionSource(source(one).inner);
    expect(s1.getSnapshot()).toBe(one);

    const two = snap(twoRegions());
    const { inner } = source(two);
    const s2 = new RegionSource(inner);
    let calls = 0;
    const off = s2.subscribe(() => calls++);
    const home = s2.getSnapshot();
    expect(s2.getSnapshot()).toBe(home); // memoised
    expect(home.server!.display.islands.map((is) => is.id)).toEqual(["start"]);
    s2.setRegion("south");
    expect(calls).toBe(1);
    s2.setRegion("south");
    expect(calls).toBe(1);
    const south = s2.getSnapshot();
    expect(south.server!.display.islands.map((is) => is.id)).toEqual(["island2", "far"]);
    expect(south.model!.ships.map((s) => s.id)).toEqual([2]);
    expect([...south.islands.keys()]).toEqual(["island2", "far"]);
    off();
  });
});
