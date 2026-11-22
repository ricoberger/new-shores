// Almanac calculator (D-084): residents per tier → demand per good → producer
// counts up the chains. D-027: not a rule and not a prediction about a world;
// the only arithmetic is D-084 §2–§3 on the served content — the §6.2 split of
// a category's demand over its supplied goods, and ⌈demand ÷ rate at 100 %⌉
// per recipe. Pure: no I/O, no clock, same input → same output.
import type { ContentBuilding } from "../api/client";
import { perMinute, type Index } from "./model";

/** Residents per tier ID and the goods the player does not supply. */
export interface CalcInput {
  residents: Readonly<Record<string, number>>;
  off: ReadonlySet<string>;
}

/** Upper bound of the residents field (the URL validation uses it too). */
export const MAX_RESIDENTS = 999_999;

/** Demand of residents for one good, per tier, units per minute. */
export interface GoodDemand {
  good: string;
  /** Residents' consumption, summed over the tiers. */
  residents: number;
  /** Consumption by upstream recipes (the counts' inputs). */
  upstream: number;
  total: number;
  byTier: { tier: string; perMin: number }[];
}

/** One goods category of a tier (own or carried) with the goods supplied. */
export interface CoverageEntry {
  tier: string;
  need: string;
  category: string;
  /** The lower tier the category is carried from, when it is. */
  fromTier?: string;
  alternatives: string[];
  supplied: string[];
  /** Σ share of the supplied goods, at most 1 (MECHANICS §6.2). */
  coverage: number;
}

export interface ChainRow {
  good: string;
  building: string;
  /** Producers needed: ⌈demand ÷ rate⌉. */
  count: number;
  demand: number;
  /** Output of one producer at 100 % (units per minute). */
  rate: number;
  /** demand ÷ (count × rate). */
  used: number;
  /** Fields or plots in all (count × fields.required) and per farm; 0 for a building without. */
  fields: number;
  fieldsPerFarm: number;
  fieldType?: string;
  deposit?: string;
  /** True when residents consume the good directly. */
  final: boolean;
}

export interface ChainGroup {
  /** The final good the chain was reached from first. */
  good: string;
  rows: ChainRow[];
}

export interface CalcTotals {
  buildings: number;
  fields: number;
  deposits: { kind: string; slots: number }[];
  workforce: { tier: string; amount: number }[];
  /** Maintenance of the production buildings, gold per minute. */
  upkeep: number;
  /** Tax of the residents entered at full coverage, gold per minute. */
  tax: number;
}

export interface CalcResult {
  residents: number;
  demand: GoodDemand[];
  coverage: CoverageEntry[];
  groups: ChainGroup[];
  totals: CalcTotals;
  /** Goods whose chain is a cycle (none in the content) or has no producer; the expansion stops there. */
  cycles: string[];
  unproduced: string[];
}

const EPS = 1e-9;

/** ⌈x⌉ that ignores floating-point noise just above a whole number. */
export function ceilCount(x: number): number {
  return x <= 0 ? 0 : Math.max(1, Math.ceil(x - EPS * Math.max(1, x)));
}

/** A residents value as a whole number in 0…MAX_RESIDENTS (NaN, negative → 0). */
export function clampResidents(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_RESIDENTS, Math.max(0, Math.floor(n))) : 0;
}

/** The goods of a producer's first output slot "good" and its rate at 100 %, undefined for a building without that output. */
function outputRate(b: ContentBuilding, good: string): number {
  const o = b.recipe?.outputs.find((x) => x.good === good);
  return o && b.recipe ? perMinute(o.amount, b.recipe.cycle_ms) : 0;
}

/** The first listed producer of a good with a positive output (D-084 §3: salt_pans before salt_works). */
function producerOf(idx: Index, good: string): ContentBuilding | undefined {
  return idx.producers(good).find((b) => outputRate(b, good) > 0);
}

/** First listed alternative of every input slot (D-084 §3). */
function inputsOf(b: ContentBuilding): { good: string; perMin: number }[] {
  const r = b.recipe;
  if (!r) return [];
  return r.inputs.map((i) => ({ good: i.goods?.[0] ?? i.good, perMin: perMinute(i.amount, r.cycle_ms) }));
}

/** Coverage per tier and goods category, and the residents' demand per good (§6.2: split over the supplied goods). */
function residentsDemand(idx: Index, input: CalcInput) {
  const direct = new Map<string, { perMin: number; byTier: Map<string, number> }>();
  const coverage: CoverageEntry[] = [];
  for (const need of idx.content.needs ?? []) {
    const residents = clampResidents(input.residents[need.tier] ?? 0);
    if (residents <= 0 || !need.goods?.length) continue;
    const supplied = need.goods.filter((g) => !input.off.has(g.good));
    const entry: CoverageEntry = {
      tier: need.tier,
      need: need.id,
      category: need.category ?? "",
      ...(need.from_tier ? { fromTier: need.from_tier } : {}),
      alternatives: need.goods.map((g) => g.good),
      supplied: supplied.map((g) => g.good),
      coverage: Math.min(1, supplied.reduce((s, g) => s + (g.share ?? 0), 0) / 1_000_000),
    };
    coverage.push(entry);
    for (const g of supplied) {
      const perMin = (residents * (g.per_resident_per_min ?? 0)) / 1_000_000 / supplied.length;
      const d = direct.get(g.good) ?? { perMin: 0, byTier: new Map<string, number>() };
      d.perMin += perMin;
      d.byTier.set(need.tier, (d.byTier.get(need.tier) ?? 0) + perMin);
      direct.set(g.good, d);
    }
  }
  return { direct, coverage };
}

/**
 * Demand per good, coverage and the producers needed (D-084 §2–§3). Goods are
 * processed consumers first (reverse post-order of the input graph), so an
 * intermediate shared by several recipes is summed before it is rounded up.
 * An upstream recipe is fed by the *demand* of the one above it, not by its
 * rounded-up capacity: the counts do not compound.
 */
export function calculate(idx: Index, input: CalcInput): CalcResult {
  const { direct, coverage } = residentsDemand(idx, input);
  const demand = new Map<string, number>();
  for (const [g, d] of direct) demand.set(g, d.perMin);

  // Post-order over good → inputs of its (first) producer; a good on the stack is a cycle and is cut.
  const state = new Map<string, "open" | "done">();
  const post: string[] = [];
  const cycles = new Set<string>();
  const unproduced = new Set<string>();
  const visit = (good: string) => {
    const s = state.get(good);
    if (s === "done") return;
    if (s === "open") {
      cycles.add(good);
      return;
    }
    state.set(good, "open");
    const p = producerOf(idx, good);
    if (!p) unproduced.add(good);
    else for (const i of inputsOf(p)) visit(i.good);
    state.set(good, "done");
    post.push(good);
  };
  for (const g of direct.keys()) visit(g);

  const rows = new Map<string, ChainRow>();
  const upstream = new Map<string, number>();
  const done = new Set<string>();
  for (const good of [...post].reverse()) {
    done.add(good);
    const d = demand.get(good) ?? 0;
    const p = producerOf(idx, good);
    if (!p || d <= 0) continue;
    const rate = outputRate(p, good);
    const count = ceilCount(d / rate);
    rows.set(good, {
      good,
      building: p.id,
      count,
      demand: d,
      rate,
      used: d / (count * rate),
      fields: count * (p.fields?.required ?? 0),
      fieldsPerFarm: p.fields?.required ?? 0,
      ...(p.fields ? { fieldType: p.fields.type } : {}),
      ...(p.requires_deposit ? { deposit: p.requires_deposit } : {}),
      final: direct.has(good),
    });
    for (const i of inputsOf(p)) {
      // A cycle edge points at a good already processed: its demand cannot be added any more, so it is cut.
      if (done.has(i.good)) continue;
      const need = (d / rate) * i.perMin;
      demand.set(i.good, (demand.get(i.good) ?? 0) + need);
      upstream.set(i.good, (upstream.get(i.good) ?? 0) + need);
    }
  }

  // Chains: one group per final good in need order; a shared intermediate is listed once, under the first chain that reaches it.
  const listed = new Set<string>();
  const groups: ChainGroup[] = [];
  const walk = (good: string, into: ChainRow[]) => {
    const row = rows.get(good);
    if (!row || listed.has(good)) return;
    listed.add(good);
    into.push(row);
    const p = idx.building(row.building);
    if (p) for (const i of inputsOf(p)) walk(i.good, into);
  };
  for (const good of direct.keys()) {
    const into: ChainRow[] = [];
    walk(good, into);
    if (into.length > 0) groups.push({ good, rows: into });
  }

  const all = [...rows.values()];
  const deposits = new Map<string, number>();
  const workforce = new Map<string, number>();
  let upkeep = 0;
  for (const r of all) {
    const b = idx.building(r.building);
    if (!b) continue;
    upkeep += (r.count * (b.upkeep_per_min ?? 0)) / 1000;
    if (r.deposit) deposits.set(r.deposit, (deposits.get(r.deposit) ?? 0) + r.count);
    if (b.workforce) workforce.set(b.workforce.tier, (workforce.get(b.workforce.tier) ?? 0) + (r.count * b.workforce.amount) / 1000);
  }
  const tierOrder = idx.tiers.map((x) => x.id);
  const byTierOrder = (a: string, b: string) => tierOrder.indexOf(a) - tierOrder.indexOf(b);
  let total = 0;
  let tax = 0;
  for (const x of idx.tiers) {
    const n = clampResidents(input.residents[x.id] ?? 0);
    total += n;
    tax += (n * (x.tax_per_resident_per_min ?? 0)) / 1000;
  }
  return {
    residents: total,
    demand: [...demand.entries()]
      .filter(([, v]) => v > 0)
      .map(([good, v]) => ({
        good,
        residents: direct.get(good)?.perMin ?? 0,
        upstream: upstream.get(good) ?? 0,
        total: v,
        byTier: [...(direct.get(good)?.byTier ?? [])].map(([tier, perMin]) => ({ tier, perMin })).sort((a, b) => byTierOrder(a.tier, b.tier)),
      })),
    coverage,
    groups,
    totals: {
      buildings: all.reduce((s, r) => s + r.count, 0),
      fields: all.reduce((s, r) => s + r.fields, 0),
      deposits: [...deposits].map(([kind, slots]) => ({ kind, slots })).sort((a, b) => a.kind.localeCompare(b.kind)),
      workforce: [...workforce].map(([tier, amount]) => ({ tier, amount })).sort((a, b) => byTierOrder(a.tier, b.tier)),
      upkeep,
      tax,
    },
    cycles: [...cycles],
    unproduced: [...unproduced],
  };
}

// --------------------------------------------------------------------- URL

/** Query key of a tier's residents: the tier ID's first letter (s, c, m, p). */
export function tierKey(tier: string): string {
  return tier.charAt(0);
}

/** Residents and unsupplied goods from a query string; invalid values and unknown goods are ignored. */
export function parseQuery(idx: Index, search: string): CalcInput {
  const q = new URLSearchParams(search);
  const residents: Record<string, number> = {};
  for (const x of idx.tiers) {
    const v = q.get(tierKey(x.id));
    if (v !== null && /^\d{1,6}$/.test(v)) residents[x.id] = clampResidents(Number(v));
  }
  const off = new Set((q.get("off") ?? "").split(",").filter((g) => g !== "" && idx.good(g)));
  return { residents, off };
}

/** The query string ("" or "?s=120&c=400&off=cider") of an input; zero residents and nothing off are left out. */
export function writeQuery(idx: Index, input: CalcInput): string {
  const q: string[] = [];
  for (const x of idx.tiers) {
    const n = clampResidents(input.residents[x.id] ?? 0);
    if (n > 0) q.push(`${tierKey(x.id)}=${n}`);
  }
  const off = [...input.off].filter((g) => idx.good(g)).sort();
  if (off.length > 0) q.push(`off=${off.join(",")}`);
  return q.length > 0 ? `?${q.join("&")}` : "";
}

/** The input of one full house of a tier ("?c=14"), the Needs page's preset link. */
export function housePreset(idx: Index, tier: string, houses = 1): string {
  const max = (idx.tier(tier)?.residents_max ?? 0) / 1000;
  return writeQuery(idx, { residents: { [tier]: clampResidents(max * houses) }, off: new Set() });
}
