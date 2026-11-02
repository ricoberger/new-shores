// Display lookups of the build menu (D-027: nothing here decides whether a building can be built, the server
// does). The menu has one tab per content tier; inside a tab the buildings are grouped General, Production,
// Public and Harbour from the server's category, the production ones ordered along their chains. The cost
// parts the player cannot currently afford are only a hint: every card stays clickable.
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { needCategory, type NeedCategoryInfo } from "./needs";
import { listedInBuildMenu, lockParts, tierUnlocked } from "./tiers";

export type BuildGroup = "general" | "production" | "public" | "harbour";

/** The groups of a tab in menu order. */
export const BUILD_GROUPS: readonly BuildGroup[] = ["general", "production", "public", "harbour"];

export interface BuildTierTab {
  id: string;
  index: number;
  name: string;
  unlocked: boolean;
  /** The unmet unlock conditions of a locked tier ("88/120 Settlers · Build Chapel"); empty when unlocked. */
  subtitle: string;
}

/** The tiers that have buildings in the menu, in tier order, with the server's unlock state. */
export function buildTierTabs(model: DisplayState | null, content: Content): BuildTierTab[] {
  const listed = content.buildings.filter((b) => listedInBuildMenu(b, content));
  return [...content.tiers]
    .sort((a, b) => a.index - b.index)
    .filter((tier) => listed.some((b) => b.tier === tier.id))
    .map((tier) => ({ id: tier.id, index: tier.index, name: tier.name, unlocked: tierUnlocked(model, tier.id), subtitle: lockParts(model, content, tier.id) }));
}

/** The tab selected by default: the highest tier the server reports unlocked, else the first. */
export function defaultBuildTier(tabs: readonly BuildTierTab[]): string | undefined {
  return [...tabs].reverse().find((tab) => tab.unlocked)?.id ?? tabs[0]?.id;
}

/**
 * The group of a building: houses, roads (not the quay), the Warehouse and the Market (the one service with
 * levels) are General; the rest follows the server's category (the quay is a harbour building there).
 */
export function buildGroupOf(b: ContentBuilding): BuildGroup {
  if (b.warehouse || (b.service?.levels.length ?? 0) > 1) return "general";
  switch (b.category) {
    case "production":
      return "production";
    case "public":
      return "public";
    case "harbour":
      return "harbour";
    default:
      return "general";
  }
}

/** Order inside Harbour: the shipyard, the pier, the depot, then the quay (a road on the shallows). */
function harbourRank(b: ContentBuilding): number {
  if (b.shipyard) return 0;
  if (b.pier) return 1;
  if (b.depot) return 2;
  return 3;
}

/** Order inside General: the house, the roads, the Market, the Warehouse, anything else. */
function generalRank(b: ContentBuilding): number {
  if (b.house) return 0;
  if (b.road) return 1;
  if (b.service) return 2;
  if (b.warehouse) return 3;
  return 4;
}

/**
 * How many production steps a building is away from the raw materials, by its recipe: 0 without inputs (a
 * farm, a mine, a lumberjack), else one more than its deepest input, where a good is as deep as its shallowest
 * producer. Cycles and goods nobody produces count as 0.
 */
export function chainDepths(content: Content): Map<string, number> {
  const producers = new Map<string, ContentBuilding[]>();
  for (const b of content.buildings) for (const o of b.recipe?.outputs ?? []) producers.set(o.good, [...(producers.get(o.good) ?? []), b]);
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const buildingDepth = (b: ContentBuilding): number => {
    const known = depths.get(b.id);
    if (known !== undefined) return known;
    if (visiting.has(b.id)) return 0;
    visiting.add(b.id);
    let depth = 0;
    for (const input of b.recipe?.inputs ?? []) {
      const options = input.goods && input.goods.length > 0 ? input.goods : [input.good];
      const goodDepth = (g: string) => {
        const ds = (producers.get(g) ?? []).map(buildingDepth);
        return ds.length > 0 ? Math.min(...ds) : 0;
      };
      // The input is as deep as its shallowest producer; this building sits one step deeper.
      const inputDepth = Math.min(...options.map(goodDepth));
      depth = Math.max(depth, inputDepth + 1);
    }
    visiting.delete(b.id);
    depths.set(b.id, depth);
    return depth;
  };
  for (const b of content.buildings) buildingDepth(b);
  return depths;
}

export interface BuildGroupRun {
  group: BuildGroup;
  items: ContentBuilding[];
}

/** The buildings of a tier tab in menu order: the groups General, Production, Public, Harbour, empty ones left out. */
export function buildMenuGroups(content: Content, tierId: string): BuildGroupRun[] {
  const depths = chainDepths(content);
  const listed = content.buildings.map((b, order) => ({ b, order })).filter(({ b }) => b.tier === tierId && listedInBuildMenu(b, content));
  const runs: BuildGroupRun[] = [];
  for (const group of BUILD_GROUPS) {
    const own = listed.filter(({ b }) => buildGroupOf(b) === group);
    if (own.length === 0) continue;
    const rank = (b: ContentBuilding) => (group === "general" ? generalRank(b) : group === "production" ? (depths.get(b.id) ?? 0) : group === "harbour" ? harbourRank(b) : 0);
    own.sort((x, y) => rank(x.b) - rank(y.b) || x.order - y.order);
    runs.push({ group, items: own.map(({ b }) => b) });
  }
  return runs;
}

export interface CostPart {
  good: string;
  /** Milli-units. */
  amount: number;
  /** More than the island has (milli-gold or goods in stock): shown red, display only. */
  short: boolean;
}

/** The cost of a building: gold and its materials, each marked when the player cannot cover it right now. */
export function buildCost(b: ContentBuilding, gold: number, stock: (good: string) => number): { gold: { amount: number; short: boolean }; materials: CostPart[] } {
  return {
    gold: { amount: b.cost.gold, short: b.cost.gold > gold },
    materials: Object.entries(b.cost.materials).map(([good, amount]) => ({ good, amount, short: amount > stock(good) })),
  };
}

/** The need category a public building serves (Faith for a chapel, Safety for the guard); undefined when no need asks for it. */
export function serviceNeedCategory(content: Content, b: ContentBuilding): NeedCategoryInfo | undefined {
  const chain = b.service?.chain;
  const need = content.needs?.find((n) => n.category && ((chain && n.chain === chain) || n.buildings?.some((x) => x.building === b.id)));
  return need?.category ? needCategory(content, need.category) : undefined;
}

/** The goods a producer takes in and gives out, as good IDs (an input with alternatives lists the first). */
export function recipeFlow(b: ContentBuilding): { inputs: string[]; outputs: string[] } | undefined {
  if (!b.recipe) return undefined;
  return { inputs: b.recipe.inputs.map((i) => i.good), outputs: b.recipe.outputs.map((o) => o.good) };
}
