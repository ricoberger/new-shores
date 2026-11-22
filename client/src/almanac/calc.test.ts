import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculate, ceilCount, housePreset, parseQuery, writeQuery, type CalcInput, type CalcResult } from "./calc";
import { buildIndex, housesSupplied, needsByTier } from "./model";
import { loadContent, REPO } from "./testContent";

const content = loadContent("content/old_coast");
const idx = buildIndex(content);
const input = (residents: Record<string, number>, off: string[] = []): CalcInput => ({ residents, off: new Set(off) });
const row = (r: CalcResult, good: string) => r.groups.flatMap((g) => g.rows).find((x) => x.good === good);
const demand = (r: CalcResult, good: string) => r.demand.find((d) => d.good === good);

describe("calculate", () => {
  it("is empty without residents", () => {
    const r = calculate(idx, input({}));
    expect(r.demand).toEqual([]);
    expect(r.groups).toEqual([]);
    expect(r.coverage).toEqual([]);
    expect(r.totals.buildings).toBe(0);
    expect(r.totals.tax).toBe(0);
  });

  it("one Citizen house alone: the §6.2 split over two supplied goods, carried fish, one producer each", () => {
    const r = calculate(idx, input({ citizens: 14 }));
    // Bread and cheese share the food category: each at half the per-resident rate.
    expect(demand(r, "bread")?.residents).toBeCloseTo((14 * 0.001156) / 2, 9);
    expect(demand(r, "cheese")?.residents).toBeCloseTo((14 * 0.000621) / 2, 9);
    // The carried Settlers categories (D-056) are Citizens' needs too.
    expect(demand(r, "fish")?.residents).toBeCloseTo(14 * 0.001012, 9);
    expect(row(r, "bread")?.building).toBe("bakery");
    expect(row(r, "bread")?.count).toBe(1);
    expect(row(r, "fish")?.count).toBe(1);
    // The chain below: the bakery's flour, the mill's wheat, the farm's fields.
    const wheat = row(r, "wheat");
    expect(wheat?.count).toBe(1);
    expect(wheat?.fields).toBe(wheat?.fieldsPerFarm);
    expect(wheat?.fields).toBeGreaterThan(0);
    // Every producer counts once; no row stands for a zero demand.
    for (const x of r.groups.flatMap((g) => g.rows)) {
      expect(x.count).toBeGreaterThanOrEqual(1);
      expect(x.used).toBeLessThanOrEqual(1 + 1e-9);
      expect(x.used).toBeGreaterThan(0);
    }
    expect(r.totals.tax).toBeCloseTo(14 * 0.9, 6);
    expect(r.totals.workforce.length).toBeGreaterThan(0);
    expect(r.totals.upkeep).toBeGreaterThan(0);
    expect(r.cycles).toEqual([]);
    expect(r.unproduced).toEqual([]);
  });

  it("coverage: one of two goods supplied covers 0.6 and takes the whole category's demand", () => {
    const r = calculate(idx, input({ citizens: 100 }, ["cheese"]));
    const food = r.coverage.find((c) => c.need === "citizens_food");
    expect(food?.coverage).toBeCloseTo(0.6, 9);
    expect(food?.supplied).toEqual(["bread"]);
    expect(demand(r, "bread")?.residents).toBeCloseTo(100 * 0.001156, 9);
    expect(demand(r, "cheese")).toBeUndefined();
    expect(r.coverage.find((c) => c.need === "citizens_drink")?.coverage).toBe(1);
    // All goods of a category off: nothing is demanded.
    const none = calculate(idx, input({ citizens: 100 }, ["bread", "cheese"]));
    expect(none.coverage.find((c) => c.need === "citizens_food")?.coverage).toBe(0);
    expect(demand(none, "bread")).toBeUndefined();
  });

  it("sums demand over the tiers and shared intermediates before rounding up", () => {
    const both = calculate(idx, input({ settlers: 60, citizens: 140 }));
    const fish = demand(both, "fish");
    expect(fish?.byTier.map((b) => b.tier)).toEqual(["settlers", "citizens"]);
    expect(fish?.residents).toBeCloseTo(60 * 0.002975 + 140 * 0.001012, 9);
    // Charcoal feeds several recipes; one burner covers the sum of their fractions, not one burner per recipe.
    const big = calculate(idx, input({ merchants: 520, patricians: 430 }));
    const charcoal = row(big, "charcoal");
    expect(charcoal).toBeDefined();
    const d = demand(big, "charcoal");
    expect(d?.upstream).toBeGreaterThan(0);
    expect(charcoal?.count).toBe(ceilCount((d?.total ?? 0) / (charcoal?.rate ?? 1)));
    const consumers = big.groups.flatMap((g) => g.rows).filter((x) => idx.building(x.building)?.recipe?.inputs.some((i) => i.goods.includes("charcoal")));
    expect(consumers.length).toBeGreaterThan(1);
  });

  it("takes the first listed alternative input and the producer of its slot", () => {
    const r = calculate(idx, input({ patricians: 430 }));
    expect(row(r, "coal")).toBeUndefined();
    expect(row(r, "charcoal")).toBeDefined();
    expect(r.totals.deposits.map((d) => d.kind)).toContain("iron");
  });

  it("totals: deposit slots per kind, workforce by tier, fields", () => {
    const r = calculate(idx, input({ citizens: 400, merchants: 200 }));
    const rows = r.groups.flatMap((g) => g.rows);
    expect(r.totals.buildings).toBe(rows.reduce((s, x) => s + x.count, 0));
    expect(r.totals.fields).toBe(rows.reduce((s, x) => s + x.fields, 0));
    for (const dep of r.totals.deposits) expect(dep.slots).toBe(rows.filter((x) => x.deposit === dep.kind).reduce((s, x) => s + x.count, 0));
    const workers = rows.reduce((s, x) => s + x.count * (idx.building(x.building)?.workforce?.amount ?? 0) / 1000, 0);
    expect(r.totals.workforce.reduce((s, w) => s + w.amount, 0)).toBeCloseTo(workers, 6);
    expect(r.totals.tax).toBeCloseTo(400 * 0.9 + 200 * 1.62, 6);
  });

  it("terminates on a cyclic recipe graph and reports the cycle", () => {
    const cyc = structuredClone(content);
    const bakery = cyc.buildings.find((b) => b.id === "bakery");
    // Flour needs bread: bread → flour → bread.
    const mill = cyc.buildings.find((b) => b.recipe?.outputs.some((o) => o.good === "flour"));
    expect(bakery && mill).toBeTruthy();
    mill!.recipe!.inputs = [{ good: "bread", goods: ["bread"], amount: 1000 }];
    const r = calculate(buildIndex(cyc), input({ citizens: 100 }));
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(row(r, "bread")?.count).toBeGreaterThanOrEqual(1);
  });

  it("rounds with floating-point tolerance", () => {
    expect(ceilCount(1)).toBe(1);
    expect(ceilCount(1 + 1e-12)).toBe(1);
    expect(ceilCount(1.01)).toBe(2);
    expect(ceilCount(0.0001)).toBe(1);
    expect(ceilCount(0)).toBe(0);
  });
});

describe("D-080 table A: houses per producer", () => {
  it("a producer supplies the table's number of full houses, the next house needs a second one", () => {
    const checked: string[] = [];
    for (const tier of needsByTier(idx)) {
      const max = (idx.tier(tier.tier)?.residents_max ?? 0) / 1000;
      for (const n of tier.own) {
        if (n.alternatives.length < 2 || n.alternatives.some((a) => a.kind !== "good")) continue;
        for (const a of n.alternatives) {
          const producer = idx.producers(a.id)[0];
          const h = housesSupplied(idx, producer?.id ?? "").find((x) => x.good === a.id && x.tier === tier.tier)?.houses ?? 0;
          expect(h, `${tier.tier} ${a.id}`).toBeGreaterThan(1);
          const off = n.alternatives.filter((o) => o.id !== a.id).map((o) => o.id);
          const at = (houses: number) => row(calculate(idx, input({ [tier.tier]: houses * max }, off)), a.id);
          // Only the residents' own consumption is compared: upstream demand (a good used by another recipe) adds nothing here.
          const resident = (houses: number) => demand(calculate(idx, input({ [tier.tier]: houses * max }, off)), a.id)?.residents ?? 0;
          const fit = Math.floor(h);
          expect(resident(fit) / (at(fit)?.rate ?? 1), `${a.id} ${fit} houses`).toBeLessThanOrEqual(1 + 1e-9);
          expect(resident(fit + 1) / (at(fit + 1)?.rate ?? 1) * (at(fit + 1)?.count ?? 0), `${a.id} ${fit + 1} houses`).toBeGreaterThan(1);
          checked.push(a.id);
        }
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(18);
  });
});

describe("URL query", () => {
  it("parses residents and unsupplied goods, ignoring invalid and unknown values", () => {
    const p = parseQuery(idx, "?s=120&c=400&m=abc&p=-5&off=cider,nonsense,mead");
    expect(p.residents).toEqual({ settlers: 120, citizens: 400 });
    expect([...p.off].sort()).toEqual(["cider", "mead"]);
    expect(parseQuery(idx, "?s=1000000").residents).toEqual({});
    expect(parseQuery(idx, "?s=999999").residents).toEqual({ settlers: 999999 });
    expect(parseQuery(idx, "?s=0").residents).toEqual({ settlers: 0 });
    expect(parseQuery(idx, "").residents).toEqual({});
  });

  it("writes only what differs from the empty state and round-trips", () => {
    expect(writeQuery(idx, input({}))).toBe("");
    expect(writeQuery(idx, input({ settlers: 120, citizens: 0, merchants: 200 }, ["mead", "cider", "nope"]))).toBe("?s=120&m=200&off=cider,mead");
    const q = "?s=120&c=400&m=200&p=100&off=cheese";
    const p = parseQuery(idx, q);
    expect(writeQuery(idx, p)).toBe(q);
  });

  it("builds the full-house preset of a tier", () => {
    expect(housePreset(idx, "citizens")).toBe("?c=14");
    expect(housePreset(idx, "settlers")).toBe("?s=6");
    expect(housePreset(idx, "patricians", 2)).toBe("?p=86");
  });
});

describe("Patricians reference town", () => {
  // The plan chain bootstrap_patricians → merchants → citizens: settler houses are placed, upgrades move them up a tier.
  const loadPlan = (name: string): Record<string, any> => JSON.parse(readFileSync(join(REPO, "server/testdata/plans", name), "utf8")); // eslint-disable-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let n: string | undefined = "bootstrap_patricians.plan.json"; n; ) {
    const p = loadPlan(n);
    chain.unshift(p);
    n = p.continues;
  }
  const producers = new Map<string, number>();
  const houses: Record<string, number> = {};
  const order = idx.tiers.map((t) => t.id);
  const houseTier = Object.fromEntries(idx.tiers.map((t) => [t.house ?? "", t.id]));
  for (const p of chain)
    for (const a of p.actions as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (a.build) producers.set(a.build.type, (producers.get(a.build.type) ?? 0) + (a.build.count ?? 1));
      if (a.houses) houses.settlers = (houses.settlers ?? 0) + a.houses.count;
      if (a.upgrade) {
        const from = houseTier[a.upgrade.from] as string;
        const to = order[order.indexOf(from) + 1] as string;
        houses[from] = (houses[from] ?? 0) - a.upgrade.count;
        houses[to] = (houses[to] ?? 0) + a.upgrade.count;
      }
    }
  const residents = Object.fromEntries(Object.entries(houses).map(([tier, h]) => [tier, h * ((idx.tier(tier)?.residents_max ?? 0) / 1000)]));
  // 756 Settlers, 476 Citizens, 1 612 Merchants, 172 Patricians. The reference games supply one good of a category where it has two (coverage 0.6): what no plan producer makes is off.
  const off = (content.needs ?? []).flatMap((n) => (n.goods ?? []).map((g) => g.good)).filter((g) => !(idx.producers(g).some((b) => producers.has(b.id))));
  const r = calculate(idx, input(residents, off));
  const goodsOfNeeds = new Set((content.needs ?? []).flatMap((n) => (n.goods ?? []).map((g) => g.good)));

  it("reads a town with houses of every tier", () => {
    for (const tier of order) expect(houses[tier], tier).toBeGreaterThan(0);
  });

  it("the plan's final producers are at least the calculator's and within the surplus bound", () => {
    let compared = 0;
    for (const good of goodsOfNeeds) {
      const calc = row(r, good);
      if (!calc) continue;
      const plan = producers.get(calc.building) ?? 0;
      compared++;
      expect(plan, `${good}: plan ${plan} < calculator ${calc.count}`).toBeGreaterThanOrEqual(calc.count);
      // TestReferenceGamesSurplus: capacity beyond the last producer ≤ 1.6 × demand.
      expect((plan - 1) * calc.rate, `${good}: surplus`).toBeLessThanOrEqual(1.6 * calc.demand + 1e-9);
    }
    expect(compared).toBe(15);
  });
});
