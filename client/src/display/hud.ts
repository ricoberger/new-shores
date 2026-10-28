// Top-bar aggregates of the focused island (UI.md §2, D-051 part 7), from
// server display numbers, static island data and content — sums, counts and
// resident-weighted means, no game rule (D-027): the island's resources
// (fertilities, deposits, free coast), its construction-material stocks,
// and per tier the workforce ("employed / total") and an island
// satisfaction aggregate with the worst unmet need.
import type { BuildingDisplay, Content, ContentBuilding, ContentSizeClass, Island, IslandDisplay, NeedDisplay } from "../api/client";
import { depositCounts } from "./archipelago";
import type { NeedRef } from "./needs";
import { blockedTiles } from "./scatter";

/** An island's resources: fertility tags, deposit kinds with tile counts, and its coast tiles (all, and free of buildings and roads). */
export interface IslandResources {
  fertilities: string[];
  deposits: { kind: string; tiles: number }[];
  coast: { tiles: number; free: number };
}

/** Resources of an island from its static data and (for the free coast) its buildings and roads. */
export function islandResources(
  statics: Island,
  display: Pick<IslandDisplay, "buildings" | "roads"> | undefined,
  defs: ReadonlyMap<string, Pick<ContentBuilding, "width" | "height">>,
): IslandResources {
  const blocked = display ? blockedTiles(display.buildings, display.roads, defs) : new Set<string>();
  let tiles = 0;
  let free = 0;
  statics.terrain.forEach((t, i) => {
    if (t !== "coast") return;
    tiles++;
    if (!blocked.has(`${i % statics.width},${Math.floor(i / statics.width)}`)) free++;
  });
  return { fertilities: [...statics.fertilities], deposits: depositCounts(statics), coast: { tiles, free } };
}

/**
 * The island's kind for the island card and the top bar (D-053): the
 * content name of its size class ("Large", "Resource rock"); empty for a
 * hand-made island. Without the content's size classes (still loading)
 * the ID stands in.
 */
export function islandKind(island: Pick<IslandDisplay, "size_class" | "rock">, content: { size_classes?: Pick<ContentSizeClass, "id" | "name">[] } | null): string {
  if (!island.size_class) return "";
  return content?.size_classes?.find((c) => c.id === island.size_class)?.name ?? island.size_class;
}

/** Goods used as construction materials (any building's or ship's material cost), in the content's goods order. */
export function constructionGoods(content: Pick<Content, "goods" | "buildings" | "ships">): string[] {
  const used = new Set<string>();
  for (const b of content.buildings) for (const g of Object.keys(b.cost?.materials ?? {})) used.add(g);
  for (const s of content.ships ?? []) for (const g of Object.keys(s.cost?.materials ?? {})) used.add(g);
  const order = content.goods.map((g) => g.id).filter((g) => used.has(g));
  // Goods of costs the goods list does not know (content drift) go last, sorted.
  return [...order, ...[...used].filter((g) => !order.includes(g)).sort()];
}

/** The worst unmet need of a tier on an island: its resident-weighted fulfilment and the most common reason. */
export interface WorstNeed {
  id: string;
  /** Goods category ("food") or the building asked for ("market"). */
  category?: string;
  building?: string;
  fulfilmentPermille: number;
  reason: NeedDisplay["reason"];
}

/** A tier's row of the top bar on one island. */
export interface TierRow {
  tier: string;
  name: string;
  /** Workers in use: min(required, available) of the island's pool (milli-residents). */
  employed: number;
  /** Residents of the tier on the island (milli-residents). */
  total: number;
  /** Workers the island's buildings want of the tier (milli-residents). */
  required: number;
  /** Jobs the residents cannot fill: max(0, required − available) (milli-residents). */
  short: number;
  /** Resident-weighted mean satisfaction of the tier's houses (permille), null without residents. */
  satisfactionPermille: number | null;
  /** The need with the lowest resident-weighted fulfilment below 100 %, null when every need is met. */
  worst: WorstNeed | null;
}

/** The tier of a house building (content), or undefined for other buildings. */
function houseTier(defs: ReadonlyMap<string, ContentBuilding>, b: BuildingDisplay): string | undefined {
  return defs.get(b.type)?.house?.tier;
}

/** Per tier: workforce "employed / total" and the satisfaction aggregate with the worst unmet need (tiers in content order). */
export function tierRows(island: IslandDisplay, content: Pick<Content, "tiers">, defs: ReadonlyMap<string, ContentBuilding>): TierRow[] {
  return content.tiers.map((t) => {
    const pool = island.workforce[t.id];
    const total = island.population[t.id] ?? 0;
    const employed = pool ? Math.min(pool.required, pool.available) : 0;
    const required = pool?.required ?? 0;
    const short = pool ? Math.max(0, pool.required - pool.available) : 0;
    let weight = 0;
    let sat = 0;
    const needs = new Map<string, { n: NeedDisplay; weight: number; sum: number; reasons: Map<NeedDisplay["reason"], number> }>();
    for (const b of island.buildings) {
      if (houseTier(defs, b) !== t.id) continue;
      const r = b.residents ?? 0;
      if (r <= 0) continue;
      weight += r;
      sat += r * (b.satisfaction_permille ?? 0);
      for (const n of b.needs ?? []) {
        let acc = needs.get(n.id);
        if (!acc) needs.set(n.id, (acc = { n, weight: 0, sum: 0, reasons: new Map() }));
        acc.weight += r;
        acc.sum += r * n.fulfilment_permille;
        if (n.reason !== "ok") acc.reasons.set(n.reason, (acc.reasons.get(n.reason) ?? 0) + r);
      }
    }
    let worst: WorstNeed | null = null;
    for (const [id, acc] of needs) {
      const f = Math.round(acc.sum / acc.weight);
      if (f >= 1000 || (worst && worst.fulfilmentPermille <= f)) continue;
      const reason = [...acc.reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "short_supply";
      worst = { id, fulfilmentPermille: f, reason, ...(acc.n.category ? { category: acc.n.category } : {}), ...(acc.n.building ? { building: acc.n.building } : {}) };
    }
    return { tier: t.id, name: t.name, employed, total, required, short, satisfactionPermille: weight > 0 ? Math.round(sat / weight) : null, worst };
  });
}

const REASONS: Record<NeedDisplay["reason"], string> = {
  ok: "met",
  short_supply: "short supply",
  no_supply: "no supply on the island",
  out_of_range: "out of range",
  not_connected: "not connected",
  paused: "paused",
};

/** "Worst unmet need: Food 40 % (short supply)" or "All needs met" (the satisfaction tooltip); label names the need (display/needs needLabel). */
export function worstNeedText(w: WorstNeed | null, label: (n: NeedRef) => string): string {
  if (!w) return "All needs met";
  const name = label(w);
  return `Worst unmet need: ${name} ${Math.round(w.fulfilmentPermille / 10)} % (${REASONS[w.reason]})`;
}
