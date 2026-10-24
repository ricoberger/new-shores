// Display names of needs and need categories from the content catalogue
// (needs[].name, need_categories[]): the one lookup every panel uses
// instead of printing content IDs. Display payloads keep IDs; unknown IDs
// (content drift, fixtures without needs) fall back to the ID, never a
// crash.
import type { Content } from "../api/client";

/** The parts of the content the lookups read; every list is optional (older or partial catalogues). */
export type NeedContent = Partial<Pick<Content, "needs" | "need_categories" | "buildings">> | null | undefined;

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
 * The label of a need entry of a house or the top bar: the need's content
 * name; without one (unknown need ID) its category's name, the building's
 * name, else the ID.
 */
export function needLabel(content: NeedContent, n: NeedRef): string {
  const name = needName(content, n.id);
  if (name !== n.id) return name;
  if (n.category) return needCategory(content, n.category).name;
  if (n.building) return content?.buildings?.find((b) => b.id === n.building)?.name || n.building;
  return n.id;
}
