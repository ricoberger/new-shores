// Display names of needs and need categories from the content catalogue
// (needs[].name, need_categories[]): the one lookup every panel uses
// instead of printing content IDs. Display payloads keep IDs; unknown IDs
// (content drift, fixtures without needs) fall back to the ID, never a
// crash.
import type { Content } from "../api/client";

/** The parts of the content the lookups read; every list is optional (older or partial catalogues). */
export type NeedContent = Partial<Pick<Content, "needs" | "need_categories" | "buildings" | "tiers">> | null | undefined;

/** A goods-need category for display: its name and HUD icon key (undefined when the content does not know it). */
export interface NeedCategoryInfo {
  id: string;
  name: string;
  icon?: string;
}

/** The display name of a need (content ID, e.g. "settlers_food" → "Food"); the ID when unknown. */
export function needName(content: NeedContent, id: string): string {
  return content?.needs?.find((n) => n.id === id)?.name || id;
}

/** A goods-need category (e.g. "clothing" → Clothing with icon need:clothing); the ID as name when unknown. */
export function needCategory(content: NeedContent, id: string): NeedCategoryInfo {
  const c = content?.need_categories?.find((x) => x.id === id);
  return c ? { id, name: c.name || id, icon: c.icon } : { id, name: id };
}

/** A need as the display payloads reference it: the need ID plus its category or building. */
export interface NeedRef {
  id: string;
  category?: string;
  building?: string;
}

/**
 * The tier a need was carried from (cumulative tiers, D-056: a lower tier's
 * category on a higher tier's house), as its display name; undefined for a
 * tier's own needs and unknown IDs.
 */
export function needFromTier(content: NeedContent, id: string): string | undefined {
  const from = content?.needs?.find((n) => n.id === id)?.from_tier;
  if (!from) return undefined;
  return content?.tiers?.find((t) => t.id === from)?.name || from;
}

/**
 * The label of a need entry of a house or the top bar: the need's content
 * name, followed by the lower tier's name for a carried category ("Food
 * (Settlers)"); without one (unknown need ID) its category's name, the
 * building's name, else the ID.
 */
export function needLabel(content: NeedContent, n: NeedRef): string {
  const name = needName(content, n.id);
  if (name !== n.id) {
    const from = needFromTier(content, n.id);
    return from ? `${name} (${from})` : name;
  }
  if (n.category) return needCategory(content, n.category).name;
  if (n.building) return content?.buildings?.find((b) => b.id === n.building)?.name || n.building;
  return n.id;
}

/**
 * A house's need entries in card order: the tier's own needs first, then
 * the lower tiers' categories (in the payload's order within each group).
 */
export function orderNeeds<T extends { id: string }>(content: NeedContent, needs: readonly T[]): T[] {
  const lower = (n: T) => (content?.needs?.find((x) => x.id === n.id)?.from_tier ? 1 : 0);
  return [...needs].sort((a, b) => lower(a) - lower(b));
}

/**
 * The alternatives of a need from the content (D-056 weighted shares), as
 * display names in content order: "Bread or Cheese", "Small market,
 * Chapel, Tavern or School". Undefined for an unknown need or a need with
 * a single alternative.
 */
export function needAlternatives(content: (NeedContent & Partial<Pick<Content, "goods">>) | null | undefined, id: string): string | undefined {
  const n = content?.needs?.find((x) => x.id === id);
  const names = [
    ...(n?.goods ?? []).map((g) => content?.goods?.find((x) => x.id === g.good)?.name || g.good),
    ...(n?.buildings ?? []).map((b) => content?.buildings?.find((x) => x.id === b.building)?.name || b.building),
  ];
  if (names.length < 2) return undefined;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The words of a house's `upgrade.reason` (the server's first failing gate
 * condition, shown as the disabled Upgrade button's tooltip): "needs_below_
 * threshold:food:60" names the category (and the percent the hint shows). Display only; an unknown reason is
 * shown as it is.
 */
export function upgradeReasonText(content: NeedContent, reason: string): string {
  const [code, category] = reason.split(":") as [string, string | undefined];
  switch (code) {
    case "tier_locked":
      return "The next tier is not unlocked yet";
    case "not_full":
      return "The house is not full yet";
    case "needs_below_threshold":
      return category ? `${needCategory(content, category).name} is not supplied well enough` : "A need is not supplied well enough";
    case "cannot_afford":
      return "Not enough gold or materials";
    case "no_house":
      return "There is no house of a next tier";
    default:
      return reason;
  }
}
