import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { insolvencyBanner } from "./insolvency";
import { claimableCount, objectiveProgress, objectiveText, questTitle, rewardText, rewardsGoods } from "./quests";
import { arrivalLines, intervalText, shouldShowSummary, summaryView } from "./summary";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "server", "testdata", "display");
const fixture = (name: string) => (JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8")) as { base: DisplayState }).base;

const content = {
  region: { id: "r", name: "R", version: "v", rules: {} },
  tiers: [
    { id: "settlers", name: "Settlers", index: 0 },
    { id: "citizens", name: "Citizens", index: 1 },
  ],
  goods: [
    { id: "fish", name: "Fish" },
    { id: "planks", name: "Planks" },
    { id: "wood", name: "Wood" },
    { id: "tools", name: "Tools" },
  ],
  buildings: [
    { id: "road_dirt", name: "Dirt road", road: { seconds_per_tile: 1 } },
    { id: "fisher", name: "Fisher" },
    { id: "lumberjack", name: "Lumberjack" },
    { id: "sawmill", name: "Sawmill" },
  ],
  ships: [{ id: "sloop", name: "Sloop" }],
  needs: [],
  quests: [
    { id: "intro_home_island", title: "Choose your home island", text: "", objectives: [], rewards: { gold: 25_000, goods: {} }, prerequisites: [] },
    { id: "intro_first_road", title: "Roads from the Trading Post", text: "", objectives: [], rewards: { gold: 25_000, goods: {} }, prerequisites: [] },
    { id: "intro_planks", title: "Timber for the colony", text: "", objectives: [], rewards: { gold: 0, goods: { planks: 45_000 } }, prerequisites: [] },
    { id: "intro_houses", title: "Room for settlers", text: "", objectives: [], rewards: { gold: 25_000, goods: {} }, prerequisites: [] },
    { id: "intro_fish", title: "Fish for the table", text: "", objectives: [], rewards: { gold: 0, goods: { planks: 45_000 } }, prerequisites: [] },
  ],
} as unknown as Content;

const islandName = (id: string) => (id === "start" ? "Start" : id);

describe("quests", () => {
  it("reads quest progress from a server fixture (golden z)", () => {
    const model = fixture("away_summary_12h");
    expect(claimableCount(model)).toBe(4);
    expect(model.quests.claimable.map((id) => questTitle(content, id))).toEqual([
      "Choose your home island",
      "Roads from the Trading Post",
      "Timber for the colony",
      "Room for settlers",
    ]);
    expect(model.quests.active.map((q) => q.id)).toEqual(["intro_fish"]);
    const o = model.quests.active[0]!.objectives[0]!;
    expect(o.met).toBe(false);
    expect(objectiveText(o, content)).toBe("Fisher connected to the Trading Post or a Warehouse");
    expect(model.quests.completed.every((q) => !q.claimed)).toBe(true);
    expect(claimableCount(null)).toBe(0);
  });

  it("formats objectives in their units", () => {
    expect(objectiveText({ kind: "building_count", type: "road_dirt", current: 7, target: 10, met: false }, content)).toBe(
      "Dirt road (tiles) 7/10",
    );
    expect(objectiveText({ kind: "population", tier: "settlers", current: 88_000, target: 120_000, met: false }, content)).toBe(
      "Settlers 88/120",
    );
    expect(objectiveText({ kind: "stock", good: "tools", island: "start", current: 2_500, target: 10_000, met: false }, content)).toBe(
      "Tools in stock on start 2/10",
    );
    expect(objectiveProgress({ kind: "satisfaction", tier: "settlers", current: 500, target: 800, met: false })).toBe("50/80 %");
    expect(objectiveProgress({ kind: "satisfaction", tier: "citizens", current: -1, target: 800, met: false })).toBe("–/80 %");
    expect(objectiveText({ kind: "route_exists", current: 1, target: 1, met: true }, content)).toBe("A route with a ship");
  });

  it("describes rewards and whether a claim needs an island", () => {
    expect(rewardText(content.quests[0]!, content)).toBe("25 gold");
    expect(rewardText(content.quests[2]!, content)).toBe("45 Planks");
    expect(rewardsGoods(content.quests[0])).toBe(false);
    expect(rewardsGoods(content.quests[2])).toBe(true);
  });
});

describe("away summary", () => {
  it("formats the pending summary of a server fixture (golden z)", () => {
    const model = fixture("away_summary_12h");
    const s = model.away_summary;
    expect(s).not.toBeNull();
    const v = summaryView(s!, content, islandName, undefined, "UTC");
    expect(v.from).toBe("1 Jan, 00:30");
    expect(v.to).toBe("12:30");
    expect(v.duration).toBe("12 h 0 min");
    expect(v.gold).toEqual({ before: "258", after: "26", change: "−232" });
    expect(v.population).toEqual([{ tier: "settlers", name: "Settlers", before: "32", after: "8" }]);
    expect(v.islands.map((is) => is.name)).toEqual(["Start"]);
    const planks = v.islands[0]!.goods.find((g) => g.good === "planks")!;
    expect(planks).toMatchObject({ name: "Planks", produced: "158", stock: "300/300" });
    expect(v.islands[0]!.goods.find((g) => g.good === "fish")).toMatchObject({ consumed: "31", stock: "0/300" });
    expect(v.paused).toBe(8);
    expect(v.stillPaused).toEqual(["Lumberjack #3 (Start)", "Lumberjack #4 (Start)", "Sawmill #5 (Start)"]);
    expect(v.shipsArrived).toBe(1);
    expect(v.arrivals).toEqual(["Ship #1: 1 arrival (island2)"]);
    expect(v.quests).toEqual([]);
    // With the model's ship names (D-055): the arrivals and a paused ship are named.
    const named = summaryView(
      { ...s!, still_unpaid: [...s!.still_unpaid, { type: "sloop", ship_id: 1, island_id: "start" } as NonNullable<typeof s>["still_unpaid"][number]] },
      content,
      islandName,
      (id) => (id === 1 ? "Gull" : `Ship #${id}`),
      "UTC",
    );
    expect(named.arrivals).toEqual(["Gull: 1 arrival (island2)"]);
    expect(named.stillPaused.at(-1)).toBe("Gull (Start)");
  });

  it("groups the arrivals per ship, ships and islands in the order of their first arrival", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const arrivals = [
      { ship_id: 2, island_id: "b", at },
      { ship_id: 1, island_id: "a", at },
      { ship_id: 2, island_id: "a", at },
      { ship_id: 2, island_id: "b", at },
    ];
    const names: Record<string, string> = { a: "Cormorant Rock", b: "Mistle Haven" };
    const lines = arrivalLines(arrivals, (id) => names[id] ?? id, (id) => (id === 2 ? "Gull" : `Ship #${id}`));
    expect(lines).toEqual(["Gull: 3 arrivals (Mistle Haven 2, Cormorant Rock 1)", "Ship #1: 1 arrival (Cormorant Rock)"]);
    expect(arrivalLines([], (id) => id, (id) => `Ship #${id}`)).toEqual([]);
  });

  it("formats the interval as day and time, the end's day only when it differs, in the given time zone", () => {
    expect(intervalText("2026-10-25T21:36:39.279Z", "2026-10-26T04:08:23.689Z", "UTC")).toEqual({ from: "25 Oct, 21:36", to: "26 Oct, 04:08" });
    expect(intervalText("2026-10-25T08:05:00Z", "2026-10-25T19:40:00Z", "UTC")).toEqual({ from: "25 Oct, 08:05", to: "19:40" });
    // The same instants in Berlin (CET, UTC+1): both on 26 Oct.
    expect(intervalText("2026-10-25T23:36:00Z", "2026-10-26T04:08:00Z", "Europe/Berlin")).toEqual({ from: "26 Oct, 00:36", to: "05:08" });
  });

  it("opens once per summary id", () => {
    const s = fixture("away_summary_12h").away_summary!;
    expect(shouldShowSummary(s, new Set())).toBe(true);
    expect(shouldShowSummary(s, new Set([s.id]))).toBe(false);
    expect(shouldShowSummary({ ...s, id: s.id + 1 }, new Set([s.id]))).toBe(true);
    expect(shouldShowSummary(null, new Set())).toBe(false);
  });
});

describe("insolvency banner", () => {
  it("renders the sentence from a fixture with unpaid buildings", () => {
    const model = fixture("away_summary_12h");
    expect(model.insolvency.unpaid_buildings).toBe(3);
    expect(insolvencyBanner(model)).toBe(
      "Your city cannot afford its upkeep: −4.5 gold/min. Paused: 3 buildings. Demolish, resume manually, or grow your tax base.",
    );
  });

  it("adds unpaid ships to the sentence", () => {
    const model = fixture("away_summary_12h");
    const withShip = { ...model, insolvency: { ...model.insolvency, unpaid_ships: 1, balance_if_resumed_per_min: -5_520 } };
    expect(insolvencyBanner(withShip)).toBe(
      "Your city cannot afford its upkeep: −5.5 gold/min. Paused: 3 buildings, 1 ships. Demolish, resume manually, or grow your tax base.",
    );
  });

  it("renders no banner without unpaid buildings", () => {
    const model = fixture("chain_planks");
    expect(model.insolvency.unpaid_buildings + model.insolvency.unpaid_ships).toBe(0);
    expect(insolvencyBanner(model)).toBeNull();
    expect(insolvencyBanner(null)).toBeNull();
  });
});
