// Almanac view-model: pure transforms of the served content (GET
// /api/v1/content) into what the pages show. D-027: nothing here is a game
// rule; the only arithmetic is what CONTENT §12 tables show — per-minute
// rates from cycle times and shares as percent. Unknown or missing fields
// yield empty lists, never exceptions.
import type { Content, ContentBuilding, ContentShip, ContentTier } from "../api/client";
import type { components } from "../api/schema";
import { depositName, fertilityName } from "../display/tiers";
import { currentLocale, percentSpace, t, tOr } from "../i18n";

export type ContentNeed = components["schemas"]["ContentNeed"];
export type ContentQuest = components["schemas"]["ContentQuest"];
export type ContentObjective = components["schemas"]["ContentObjective"];
export type ContentGood = components["schemas"]["ContentGood"];
export type ContentNeedCategory = components["schemas"]["ContentNeedCategory"];

/** Build-menu group order of the buildings page. */
export const CATEGORY_ORDER: ContentBuilding["category"][] = ["houses", "production", "public", "harbour", "roads", "other"];
/** A build-menu group's name on the buildings page. */
export function categoryName(category: ContentBuilding["category"]): string {
  return tOr(`almanac.category.${category}`, titleCase(category));
}

/** Number with at most `max` decimals, trailing zeros trimmed ("1.5", "30"). */
export function num(n: number, max = 2): string {
  if (!Number.isFinite(n)) return "";
  const f = 10 ** max;
  const r = Math.round(n * f) / f;
  return new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: max, useGrouping: false }).format(r);
}

/** Whole or fractional units of a milli quantity ("0.5", "45"). */
export function milli(m: number | undefined): string {
  return num((m ?? 0) / 1000);
}

/** Units per minute of an amount per cycle (milli-units, ms): the arithmetic shown in CONTENT tables. */
export function perMinute(amountMilli: number, cycleMs: number): number {
  return cycleMs > 0 ? (amountMilli / 1000) * (60000 / cycleMs) : 0;
}

/** Share or weight in ppm (1 000 000 = 100 %) as percent. */
export function ppmPercent(ppm: number): string {
  return `${num(ppm / 10000, 1)}${percentSpace()}%`;
}

export interface CostPart {
  /** Absent for gold. */
  good?: string;
  amount: number;
}

/** Cost as display parts: gold first, then materials in ID order; zero gold is omitted when materials exist. */
export function costParts(cost: { gold?: number; materials?: Record<string, number> } | undefined): CostPart[] {
  if (!cost) return [];
  const parts: CostPart[] = [];
  const mats = Object.entries(cost.materials ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if ((cost.gold ?? 0) > 0 || mats.length === 0) parts.push({ amount: (cost.gold ?? 0) / 1000 });
  for (const [good, amount] of mats) parts.push({ good, amount: amount / 1000 });
  return parts;
}

export interface Index {
  content: Content;
  tiers: ContentTier[];
  tier(id: string | undefined): ContentTier | undefined;
  building(id: string | undefined): ContentBuilding | undefined;
  good(id: string | undefined): ContentGood | undefined;
  ship(id: string | undefined): ContentShip | undefined;
  quest(id: string | undefined): ContentQuest | undefined;
  /** Display name of any ID of a content table, the ID itself when unknown. */
  tierName(id: string | undefined): string;
  buildingName(id: string | undefined): string;
  goodName(id: string | undefined): string;
  shipName(id: string | undefined): string;
  categoryName(id: string | undefined): string;
  /** Buildings whose recipe outputs the good, content order. */
  producers(good: string): ContentBuilding[];
  /** Buildings whose recipe takes the good (also as an alternative input). */
  consumers(good: string): ContentBuilding[];
  /** Needs that accept the good, own-tier ones only. */
  needsOfGood(good: string): ContentNeed[];
  /** Farm → field buildings that serve it. */
  modulesOf(farm: string): ContentBuilding[];
  /** Shipyards that can build the ship. */
  shipyardsOf(ship: string): ContentBuilding[];
}

const by = <T extends { id: string }>(list: readonly T[] | undefined) => new Map((list ?? []).map((x) => [x.id, x]));

export function buildIndex(content: Content): Index {
  const tiers = content.tiers ?? [];
  const buildings = content.buildings ?? [];
  const needs = content.needs ?? [];
  const tierMap = by(tiers);
  const buildingMap = by(buildings);
  const goodMap = by(content.goods);
  const shipMap = by(content.ships);
  const questMap = by(content.quests);
  const categoryMap = by(content.need_categories);
  const producers = new Map<string, ContentBuilding[]>();
  const consumers = new Map<string, ContentBuilding[]>();
  for (const b of buildings) {
    for (const o of b.recipe?.outputs ?? []) push(producers, o.good, b);
    for (const i of b.recipe?.inputs ?? []) for (const g of i.goods?.length ? i.goods : [i.good]) push(consumers, g, b);
  }
  const needsOfGood = new Map<string, ContentNeed[]>();
  for (const n of needs) {
    if (n.from_tier) continue;
    for (const g of n.goods ?? []) push(needsOfGood, g.good, n);
  }
  const modules = new Map<string, ContentBuilding[]>();
  for (const b of buildings) {
    if (!b.field) continue;
    for (const farm of b.field.farms?.length ? b.field.farms : [b.field.farm]) push(modules, farm, b);
  }
  const shipyards = new Map<string, ContentBuilding[]>();
  for (const b of buildings) for (const s of b.shipyard?.ships ?? []) push(shipyards, s, b);
  const nameOf = (m: Map<string, { name: string }>, id: string | undefined) => (id === undefined ? "" : (m.get(id)?.name ?? id));
  return {
    content,
    tiers,
    tier: (id) => (id === undefined ? undefined : tierMap.get(id)),
    building: (id) => (id === undefined ? undefined : buildingMap.get(id)),
    good: (id) => (id === undefined ? undefined : goodMap.get(id)),
    ship: (id) => (id === undefined ? undefined : shipMap.get(id)),
    quest: (id) => (id === undefined ? undefined : questMap.get(id)),
    tierName: (id) => nameOf(tierMap, id),
    buildingName: (id) => nameOf(buildingMap, id),
    goodName: (id) => nameOf(goodMap, id),
    shipName: (id) => nameOf(shipMap, id),
    categoryName: (id) => nameOf(categoryMap, id),
    producers: (g) => producers.get(g) ?? [],
    consumers: (g) => consumers.get(g) ?? [],
    needsOfGood: (g) => needsOfGood.get(g) ?? [],
    modulesOf: (f) => modules.get(f) ?? [],
    shipyardsOf: (s) => shipyards.get(s) ?? [],
  };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) {
    if (!l.includes(v)) l.push(v);
  } else m.set(k, [v]);
}

// ---------------------------------------------------------------- overview

export interface TierView {
  id: string;
  name: string;
  index: number;
  house: string | null;
  residentsFloor: number;
  residentsMax: number;
  /** Tax per resident and minute (units). */
  tax: number;
  /** Tax of a full house per minute (arithmetic of the two numbers above). */
  taxFullHouse: number;
  unlock: { population: { tier: string; amount: number }[]; buildings: string[] };
}

export function tierViews(idx: Index): TierView[] {
  return idx.tiers.map((t) => ({
    id: t.id,
    name: t.name,
    index: t.index,
    house: t.house ?? null,
    residentsFloor: (t.residents_floor ?? 0) / 1000,
    residentsMax: (t.residents_max ?? 0) / 1000,
    tax: (t.tax_per_resident_per_min ?? 0) / 1000,
    taxFullHouse: ((t.tax_per_resident_per_min ?? 0) / 1000) * ((t.residents_max ?? 0) / 1000),
    unlock: {
      population: Object.entries(t.unlock?.population ?? {}).map(([tier, amount]) => ({ tier, amount: amount / 1000 })),
      buildings: t.unlock?.buildings ?? [],
    },
  }));
}

// ------------------------------------------------------------------- needs

export interface NeedAlternative {
  /** Good or building ID. */
  id: string;
  kind: "good" | "building";
  share: number;
  /** Goods: units per resident and minute. */
  perResident?: number;
  /** Buildings: radius of the first level; all level radii. */
  radius?: number;
  radii?: number[];
  /** Goods: producing buildings; buildings: itself. */
  providers: string[];
}

export interface NeedView {
  id: string;
  name: string;
  category: string;
  categoryName: string;
  icon: string;
  kind: "required" | "optional";
  /** Weight within the tier's own needs, percent of the own sum. */
  ownPercent: number;
  alternatives: NeedAlternative[];
  /** Whether the alternatives are building services. */
  services: boolean;
}

export interface TierNeeds {
  tier: string;
  name: string;
  own: NeedView[];
  /** Tiers whose categories this tier carries at reduced rates (cumulative). */
  carried: string[];
  /** Services added at this tier (not in a lower tier's services list), in list order. */
  servicesAdded: string[];
}

export function needsByTier(idx: Index): TierNeeds[] {
  const needs = idx.content.needs ?? [];
  const seenServices = new Set<string>();
  return idx.tiers.map((t) => {
    const mine = needs.filter((n) => n.tier === t.id);
    const own = mine.filter((n) => !n.from_tier);
    const carried = [...new Set(mine.filter((n) => n.from_tier).map((n) => n.from_tier as string))];
    const sum = own.reduce((s, n) => s + (n.weight ?? 0), 0);
    const views = own.map((n): NeedView => {
      // Services needs carry no category in the payload; their category is the one named "services".
      const cat = n.category ?? (n.buildings?.length ? "services" : "");
      const alternatives: NeedAlternative[] = [
        ...(n.goods ?? []).map(
          (g): NeedAlternative => ({
            id: g.good,
            kind: "good",
            share: (g.share ?? 0) / 1_000_000,
            perResident: (g.per_resident_per_min ?? 0) / 1_000_000,
            providers: idx.producers(g.good).map((b) => b.id),
          }),
        ),
        ...(n.buildings ?? []).map((b): NeedAlternative => {
          const def = idx.building(b.building);
          const radii = def?.service?.levels?.map((l) => l.radius) ?? (def?.service ? [def.service.radius] : []);
          return { id: b.building, kind: "building", share: (b.share ?? 0) / 1_000_000, radius: def?.service?.radius, radii, providers: [b.building] };
        }),
      ];
      return {
        id: n.id,
        name: n.name,
        category: cat,
        categoryName: idx.categoryName(cat) || n.name,
        icon: (idx.content.need_categories ?? []).find((c) => c.id === cat)?.icon ?? "",
        kind: n.kind,
        ownPercent: sum > 0 ? ((n.weight ?? 0) / sum) * 100 : 0,
        alternatives,
        services: (n.buildings?.length ?? 0) > 0,
      };
    });
    const servicesAdded: string[] = [];
    for (const v of views) {
      if (!v.services) continue;
      for (const a of v.alternatives) {
        if (!seenServices.has(a.id)) {
          seenServices.add(a.id);
          servicesAdded.push(a.id);
        }
      }
    }
    return { tier: t.id, name: t.name, own: views, carried, servicesAdded };
  });
}

// --------------------------------------------------------------- buildings

export interface FlowView {
  /** Alternative goods of one slot (one entry for a plain input). */
  goods: string[];
  perMin: number;
}

export interface LevelView {
  level: number;
  cost: CostPart[];
  capacity?: number;
  throughput?: number;
  berths?: number;
  radius?: number;
  tier?: string;
}

export interface BuildingView {
  id: string;
  name: string;
  tier: string;
  category: ContentBuilding["category"];
  width: number;
  height: number;
  waterTiles: number;
  /** "3 × 4", plus "of which 3 rows on water" etc. */
  footprint: string;
  requiresRoad: boolean;
  cost: CostPart[];
  upkeep: number;
  inputs: FlowView[];
  outputs: FlowView[];
  cycleSeconds?: number;
  radius?: number;
  workforce?: { tier: string; amount: number };
  residents?: { tier: string };
  /** Fertility / deposit / terrain requirements in words. */
  needsSite: string[];
  /** Field buildings of this farm and what they are for. */
  modules: { building: string; required?: number; max?: number }[];
  /** For a field building: the farms it serves. */
  fieldOf: string[];
  levels: LevelView[];
  ships: string[];
  roadSecondsPerTile?: number;
  /** Berths a trading pier adds to its island (D-060). */
  pierBerths?: number;
  /** A quay: a road on the shallow water (D-060). */
  shallows: boolean;
}

export function buildingView(idx: Index, b: ContentBuilding): BuildingView {
  const r = b.recipe;
  const needsSite: string[] = [];
  if (b.requires_deposit) needsSite.push(t("almanac.site.deposit", { name: titleCase(depositName(b.requires_deposit)) }));
  if (b.work_area?.fertility) needsSite.push(t("almanac.site.fertility", { name: titleCase(fertilityName(b.work_area.fertility)) }));
  if (b.field?.terrain?.length) needsSite.push(t("almanac.site.on", { terrain: b.field.terrain.map(terrainName).join("/") }));
  if (b.field?.fertility) needsSite.push(t("almanac.site.fertility", { name: titleCase(fertilityName(b.field.fertility)) }));
  const levels: LevelView[] = [];
  b.trading_post?.levels?.forEach((l, i) =>
    levels.push({ level: i + 1, cost: costParts(l.cost), capacity: l.capacity / 1000, throughput: l.throughput_per_min / 1000, berths: l.berths }),
  );
  b.warehouse?.levels?.forEach((l, i) => levels.push({ level: i + 1, cost: costParts(l.cost), throughput: l.throughput_per_min / 1000 }));
  b.service?.levels?.forEach((l, i) => levels.push({ level: i + 1, cost: costParts(l.cost), radius: l.radius, tier: l.tier }));
  b.depot?.levels?.forEach((l, i) => levels.push({ level: i + 1, cost: costParts(l.cost), capacity: l.capacity / 1000, tier: l.tier }));
  const cycle = r?.cycle_ms ?? 0;
  const modules = idx.modulesOf(b.id).map((m) => ({ building: m.id }));
  const mods = b.fields ? modules.map((m) => ({ ...m, required: b.fields?.required, max: b.fields?.max })) : modules;
  return {
    id: b.id,
    name: b.name,
    tier: b.tier,
    category: b.category,
    width: b.width,
    height: b.height,
    waterTiles: b.water_tiles ?? 0,
    footprint: b.water_tiles ? t("almanac.footprintWater", { width: b.width, height: b.height, count: b.water_tiles }) : `${b.width} × ${b.height}`,
    requiresRoad: b.requires_road,
    cost: costParts(b.cost),
    upkeep: (b.upkeep_per_min ?? 0) / 1000,
    inputs: (r?.inputs ?? []).map((i) => ({ goods: i.goods?.length ? i.goods : [i.good], perMin: perMinute(i.amount, cycle) })),
    outputs: (r?.outputs ?? []).map((o) => ({ goods: [o.good], perMin: perMinute(o.amount, cycle) })),
    cycleSeconds: r ? cycle / 1000 : undefined,
    radius: b.service?.radius,
    workforce: b.workforce ? { tier: b.workforce.tier, amount: b.workforce.amount / 1000 } : undefined,
    residents: b.house ? { tier: b.house.tier } : undefined,
    needsSite,
    modules: mods,
    fieldOf: b.field ? (b.field.farms?.length ? b.field.farms : [b.field.farm]) : [],
    levels,
    ships: b.shipyard?.ships ?? [],
    roadSecondsPerTile: b.road ? b.road.ms_per_tile / 1000 : undefined,
    pierBerths: b.pier?.berths,
    shallows: b.road?.shallows ?? false,
  };
}

export interface BuildingGroup {
  tier: string;
  tierName: string;
  categories: { category: ContentBuilding["category"]; name: string; buildings: ContentBuilding[] }[];
}

/** Buildings by tier (progression order), then category; every building exactly once. */
export function buildingGroups(idx: Index): BuildingGroup[] {
  const buildings = idx.content.buildings ?? [];
  const tierIds = idx.tiers.map((t) => t.id);
  // Buildings of a tier ID the content does not list still appear, after the known tiers.
  const extra = [...new Set(buildings.map((b) => b.tier))].filter((t) => !tierIds.includes(t));
  return [...tierIds, ...extra]
    .map((tier) => {
      const mine = buildings.filter((b) => b.tier === tier);
      const cats = [...CATEGORY_ORDER, ...new Set(mine.map((b) => b.category))].filter((c, i, a) => a.indexOf(c) === i);
      return {
        tier,
        tierName: idx.tierName(tier),
        categories: cats
          .map((category) => ({ category, name: categoryName(category), buildings: mine.filter((b) => b.category === category) }))
          .filter((c) => c.buildings.length > 0),
      };
    })
    .filter((g) => g.categories.length > 0);
}

/** A terrain's name ("grass"); the id itself for one the catalogue lacks. */
export function terrainName(id: string): string {
  return tOr(`almanac.terrain.${id}`, id);
}

/** A goods type's name ("Food"). */
export function goodTypeName(type: string): string {
  return tOr(`almanac.goodType.${type}`, titleCase(type));
}

export function titleCase(id: string): string {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------- goods

export interface GoodView {
  id: string;
  name: string;
  type: string;
  construction: boolean;
  producedBy: { building: string; perMin: number }[];
  consumedBy: { building: string; perMin: number; alternative: boolean }[];
  neededBy: { need: string; tier: string; category: string }[];
  /** Buildings that list the good in their cost. */
  usedToBuild: number;
}

export function goodView(idx: Index, g: ContentGood): GoodView {
  const producedBy = idx.producers(g.id).map((b) => {
    const o = b.recipe?.outputs.find((x) => x.good === g.id);
    return { building: b.id, perMin: o ? perMinute(o.amount, b.recipe?.cycle_ms ?? 0) : 0 };
  });
  const consumedBy = idx.consumers(g.id).map((b) => {
    const i = b.recipe?.inputs.find((x) => (x.goods?.length ? x.goods : [x.good]).includes(g.id));
    const alt = (i?.goods?.length ?? 0) > 1;
    return { building: b.id, perMin: i ? perMinute(i.amount, b.recipe?.cycle_ms ?? 0) : 0, alternative: alt };
  });
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    construction: g.type === "construction",
    producedBy,
    consumedBy,
    neededBy: idx.needsOfGood(g.id).map((n) => ({ need: n.id, tier: n.tier, category: n.category ?? "" })),
    usedToBuild: (idx.content.buildings ?? []).filter((b) => g.id in (b.cost?.materials ?? {})).length,
  };
}

export interface ChainNode {
  good: string;
  /** Producer branches; empty for a raw good (or at the depth limit / on a cycle). */
  via: { building: string; perMin: number; site: string[]; inputs: { goods: ChainNode[]; perMin: number }[] }[];
  /** True when the node stopped because the good already appears above it. */
  cycle?: boolean;
}

/** Upstream chain: the good, its producers, their input slots (alternatives side by side), recursively. */
export function chain(idx: Index, good: string, path: string[] = [], depth = 8): ChainNode {
  if (path.includes(good)) return { good, via: [], cycle: true };
  if (depth <= 0) return { good, via: [] };
  const next = [...path, good];
  return {
    good,
    via: idx.producers(good).map((b) => ({
      building: b.id,
      perMin: perMinute(b.recipe?.outputs.find((o) => o.good === good)?.amount ?? 0, b.recipe?.cycle_ms ?? 0),
      site: [
        ...(b.fields ? idx.modulesOf(b.id).map((m) => `${b.fields?.required} × ${m.name}`) : []),
        ...(b.requires_deposit ? [t("almanac.chain.deposit", { name: titleCase(depositName(b.requires_deposit)) })] : []),
        ...(b.work_area?.fertility ? [t("almanac.chain.fertility", { name: titleCase(fertilityName(b.work_area.fertility)) })] : []),
      ],
      inputs: (b.recipe?.inputs ?? []).map((i) => ({
        perMin: perMinute(i.amount, b.recipe?.cycle_ms ?? 0),
        goods: (i.goods?.length ? i.goods : [i.good]).map((g) => chain(idx, g, next, depth - 1)),
      })),
    })),
  };
}

// ------------------------------------------------------------------- ships

export interface ShipView {
  id: string;
  name: string;
  tier: string;
  slots: number;
  slotSize: number;
  totalCapacity: number;
  speed: number;
  cost: CostPart[];
  upkeep: number;
  lengthTiles?: number;
  buildMinutes: number;
  shipyards: string[];
}

export function shipView(idx: Index, s: ContentShip): ShipView {
  return {
    id: s.id,
    name: s.name,
    tier: s.tier,
    slots: s.slots,
    slotSize: s.slot_size / 1000,
    totalCapacity: (s.slots * s.slot_size) / 1000,
    speed: s.speed_permille / 1000,
    cost: costParts(s.cost),
    upkeep: (s.upkeep_per_min ?? 0) / 1000,
    lengthTiles: s.length_milli_tiles === undefined ? undefined : s.length_milli_tiles / 1000,
    buildMinutes: s.build_ms / 60000,
    shipyards: idx.shipyardsOf(s.id).map((b) => b.id),
  };
}

// ----------------------------------------------------------------- islands

interface Range {
  min: number;
  max: number;
}

export interface IslandsView {
  sizeClasses: {
    id: string;
    name: string;
    rock: boolean;
    scenic: boolean;
    size?: number;
    count?: Range;
    fertilities?: Range;
    deposits?: Range;
    /** Shape parameters (D-058) in words, e.g. "1–3 arms, 1–2 rivers, 2 levels, 3–6 islets". */
    shape?: string;
    /** The home candidate (D-053) is of this class. */
    home: boolean;
  }[];
  /** Pools of the archipelago generator, only when the served content carries them. */
  fertilities: { id: string; count?: Range }[];
  deposits: { id: string; count?: Range }[];
  home: { label: string; items: string[] }[];
  /** True when only the names of the size classes are served. */
  basicOnly: boolean;
}

const isRange = (v: unknown): v is Range => typeof v === "object" && v !== null && typeof (v as Range).min === "number" && typeof (v as Range).max === "number";
const asRange = (v: unknown): Range | undefined => (isRange(v) ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

/** The shape parameters of a size class in words (D-058), undefined without them or for a class without any. */
function shapeText(v: unknown): string | undefined {
  const s = rec(v);
  const parts: string[] = [];
  const counted = (r: unknown, key: "arms" | "rivers" | "islets") => {
    const x = asRange(r);
    if (x && x.max > 0) parts.push(t(`almanac.shape.${key}`, { range: x.min === x.max ? String(x.min) : `${x.min}–${x.max}`, count: x.max }));
  };
  counted(s.arms, "arms");
  if (typeof s.plain === "number" && s.plain > 0) parts.push(t("almanac.shape.plain", { size: s.plain }));
  counted(s.rivers, "rivers");
  if (typeof s.levels === "number" && s.levels > 0) parts.push(t("almanac.shape.terraces", { count: s.levels }));
  counted(s.islets, "islets");
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Size classes with whatever the payload carries: the served schema has the
 * name, the flags, size, count, the per-island pool ranges, the shape and
 * the home class; the archipelago pools and the home guarantees are read
 * defensively from optional fields (islands.json is changing) and
 * rendered only when present.
 */
export function islandsView(content: Content): IslandsView {
  const c = rec(content);
  const classes = (content.size_classes ?? []).map((s) => {
    const x = rec(s);
    return {
      id: s.id,
      name: s.name,
      rock: s.rock === true,
      scenic: s.scenic === true,
      size: typeof x.size === "number" ? x.size : undefined,
      count: asRange(x.count),
      fertilities: asRange(x.fertilities),
      deposits: asRange(x.deposits),
      shape: shapeText(x.shape),
      home: x.home === true,
    };
  });
  const pool = (v: unknown) => (Array.isArray(v) ? v.map(rec).filter((e) => typeof e.id === "string").map((e) => ({ id: e.id as string, count: asRange(e.count) })) : []);
  const fertilities = pool(c.fertilities);
  const deposits = pool(c.deposits);
  const home = rec(c.home);
  const homeRows: IslandsView["home"] = [];
  const row = (label: string, items: string[]) => {
    if (items.length) homeRows.push({ label, items });
  };
  if (typeof home.size_class === "string") homeRows.push({ label: t("almanac.home.sizeClass"), items: [classes.find((c) => c.id === home.size_class)?.name ?? home.size_class] });
  row(t("almanac.home.terrain"), strings(home.terrain).map(terrainName));
  row(t("almanac.home.deposits"), strings(home.deposits).map(depositName));
  row(t("almanac.home.fertilitiesAny"), strings(home.fertilities_any).map(fertilityName));
  row(t("almanac.home.fertilitiesNone"), strings(home.fertilities_none).map(fertilityName));
  row(t("almanac.home.depositsNone"), strings(home.deposits_none).map(depositName));
  return {
    sizeClasses: classes,
    fertilities,
    deposits,
    home: homeRows,
    basicOnly: classes.every((s) => s.count === undefined && s.size === undefined) && fertilities.length === 0 && deposits.length === 0,
  };
}

// ------------------------------------------------------------------ search

export type SectionId = "overview" | "buildings" | "goods" | "needs" | "ships" | "quests" | "islands";

export interface SearchEntry {
  section: SectionId;
  id: string;
  name: string;
}

/** Every named thing of every section, for the search box. */
export function searchEntries(idx: Index): SearchEntry[] {
  const c = idx.content;
  return [
    ...idx.tiers.map((t) => ({ section: "overview" as const, id: t.id, name: t.name })),
    ...(c.buildings ?? []).map((b) => ({ section: "buildings" as const, id: b.id, name: b.name })),
    ...(c.goods ?? []).map((g) => ({ section: "goods" as const, id: g.id, name: g.name })),
    ...idx.tiers.map((x) => ({ section: "needs" as const, id: x.id, name: t("almanac.search.needs", { tier: x.name }) })),
    ...(c.ships ?? []).map((s) => ({ section: "ships" as const, id: s.id, name: s.name })),
    ...(c.quests ?? []).map((q) => ({ section: "quests" as const, id: q.id, name: q.title })),
    ...(c.size_classes ?? []).map((s) => ({ section: "islands" as const, id: s.id, name: s.name })),
  ];
}

export function search(entries: SearchEntry[], query: string): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
}
