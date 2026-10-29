// Test helper: the served content payload (GET /api/v1/content) built from a
// content directory's JSON files, in the units of the display payload (milli
// quantities, ms, ppm). It mirrors only what the almanac reads; the server
// stays the authority — see the cross-check in model.test.ts.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Content } from "../api/client";

/** Repository root (client/src/almanac → ..). */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (dir: string, file: string): any => JSON.parse(readFileSync(join(dir, file), "utf8")); // eslint-disable-line @typescript-eslint/no-explicit-any
const m = (v: number | undefined) => Math.round((v ?? 0) * 1000);

function cost(c: Raw | undefined) {
  const materials: Record<string, number> = {};
  for (const [k, v] of Object.entries(c ?? {})) if (k !== "gold") materials[k] = m(v as number);
  return { gold: m(c?.gold), materials };
}

function category(b: Raw): string {
  if (b.house) return "houses";
  if (b.recipe || b.field || b.warehouse) return "production";
  if (b.service) return "public";
  if (b.trading_post || b.shipyard) return "harbour";
  if (b.road) return "roads";
  return "other";
}

/** Reads `<dir>/*.json` into a Content payload; `dir` is relative to the repository root. */
export function loadContent(dir: string): Content {
  const d = join(REPO, dir);
  const buildingsRaw: Raw[] = read(d, "buildings.json");
  const buildings = buildingsRaw.map((b) => {
    const out: Raw = {
      id: b.id,
      name: b.name,
      tier: b.tier,
      category: category(b),
      width: b.footprint[0],
      height: b.footprint[1],
      coastal: !!b.coastal,
      water_tiles: b.water_tiles ?? 0,
      requires_road: !!b.requires_road,
      cost: cost(b.cost),
      upkeep_per_min: m(b.upkeep_per_min),
      pause_category: b.pause_category,
    };
    if (b.recipe)
      out.recipe = {
        inputs: b.recipe.inputs.map((i: Raw) => {
          const goods: string[] = Array.isArray(i.good) ? i.good : [i.good];
          return { good: goods[0], goods, amount: m(i.amount) };
        }),
        outputs: b.recipe.outputs.map((o: Raw) => ({ good: o.good, amount: m(o.amount) })),
        cycle_ms: m(b.recipe.cycle_seconds),
      };
    if (b.house) out.house = b.house;
    if (b.trading_post)
      out.trading_post = {
        levels: b.trading_post.levels.map((l: Raw) => ({
          capacity: m(l.capacity),
          throughput_per_min: m(l.throughput_per_min),
          berths: l.berths,
          ...(l.cost ? { cost: cost(l.cost) } : {}),
        })),
      };
    if (b.warehouse)
      out.warehouse = { levels: b.warehouse.levels.map((l: Raw) => ({ throughput_per_min: m(l.throughput_per_min), ...(l.cost ? { cost: cost(l.cost) } : {}) })) };
    if (b.road) out.road = { ms_per_tile: m(b.road.seconds_per_tile) };
    if (b.service) {
      const levels: Raw[] = b.service.levels ?? [{ radius: b.service.radius }];
      out.service = { radius: levels[0]?.radius, levels: levels.map((l) => ({ radius: l.radius, ...(l.tier ? { tier: l.tier } : {}), ...(l.cost ? { cost: cost(l.cost) } : {}) })) };
    }
    if (b.work_area) out.work_area = b.work_area;
    if (b.workforce) out.workforce = { tier: b.workforce.tier, amount: m(b.workforce.amount) };
    if (b.shipyard) out.shipyard = b.shipyard;
    if (b.requires_deposit) out.requires_deposit = b.requires_deposit;
    if (b.fields) out.fields = b.fields;
    if (b.field) out.field = { ...b.field, farms: Array.isArray(b.field.farm) ? b.field.farm : [b.field.farm], farm: Array.isArray(b.field.farm) ? b.field.farm[0] : b.field.farm };
    return out;
  });
  const tiers = (read(d, "tiers.json") as Raw[]).map((t, index) => ({
    id: t.id,
    name: t.name,
    index,
    residents_floor: m(t.residents.floor),
    residents_max: m(t.residents.max),
    tax_per_resident_per_min: m(t.tax_per_resident_per_min),
    house: t.house ?? null,
    unlock: {
      population: Object.fromEntries(Object.entries((t.unlock?.population ?? {}) as Record<string, number>).map(([k, v]) => [k, m(v)])),
      buildings: t.unlock?.buildings ?? [],
    },
  }));
  const tierOrder = tiers.map((t) => t.id);
  const needs = (read(d, "needs.json") as Raw[])
    .map((n) => {
      const alternatives = (n.goods ?? n.buildings ?? []).length;
      const share = (s: number | undefined) => Math.round((s ?? (alternatives === 1 ? 1 : 0.6)) * 1_000_000);
      return {
        id: n.id,
        name: n.name,
        tier: n.tier,
        kind: n.kind,
        weight: Math.round(n.weight * 1_000_000),
        ...(n.from_tier ? { from_tier: n.from_tier } : {}),
        ...(n.category && !n.buildings ? { category: n.category } : {}),
        ...(n.goods ? { goods: n.goods.map((g: Raw) => ({ good: g.good, per_resident_per_min: Math.round(g.per_resident_per_min * 1_000_000), share: share(g.share) })) } : {}),
        ...(n.buildings ? { buildings: n.buildings.map((b: Raw) => ({ building: b.building, share: share(b.share) })) } : {}),
      };
    })
    .sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));
  return {
    region: { id: "", name: "", version: "", ...read(d, "region.json"), rules: {}, camera: { max_half_extent: 120 } },
    quests: (read(d, "quests.json") as Raw[]).map((q) => ({
      id: q.id,
      title: q.title,
      text: q.text,
      objectives: q.objectives.map((o: Raw) => {
        const { min, count, ...rest } = o;
        const unit = o.kind === "population" || o.kind === "stock" ? 1000 : o.kind === "satisfaction" ? 1000 : 1;
        return { ...rest, target: Math.round((min ?? count ?? 1) * unit) };
      }),
      rewards: { gold: m(q.rewards?.gold), goods: Object.fromEntries(Object.entries((q.rewards?.goods ?? {}) as Record<string, number>).map(([k, v]) => [k, m(v)])) },
      prerequisites: q.prerequisites ?? [],
    })),
    tiers,
    goods: read(d, "goods.json"),
    buildings,
    needs,
    need_categories: read(d, "need_categories.json"),
    ships: (read(d, "ships.json") as Raw[]).map((s) => ({
      id: s.id,
      name: s.name,
      tier: s.tier,
      slots: s.slots,
      slot_size: m(s.slot_size),
      speed_permille: m(s.speed),
      ...(s.length_tiles === undefined ? {} : { length_milli_tiles: m(s.length_tiles) }),
      build_ms: m(s.build_seconds),
      cost: cost(s.cost),
      upkeep_per_min: m(s.upkeep_per_min),
    })),
    size_classes: (read(d, "islands.json").size_classes as Raw[]).map((s) => ({ id: s.id, name: s.name, rock: !!s.rock })),
  } as unknown as Content;
}
