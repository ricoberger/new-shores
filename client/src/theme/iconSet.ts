// Lookups of the HUD icon set (theme/icons.ts, generated): goods, needs,
// statuses, build categories and tools, with a generic fallback for
// content IDs the set does not know (goods: a crate; needs: a question
// mark) — never a missing image.
import type { StatusKey } from "../display/status";
import { ICON_PATHS } from "./icons";

const path = (key: string, fallback: string): string => ICON_PATHS[key] ?? ICON_PATHS[fallback] ?? "";

/** Icon of a good (content ID). */
export function goodIcon(id: string): string {
  return path(`good:${id}`, "good:_fallback");
}

/**
 * Icon of a need: the HUD icon key its category names in content
 * (need_categories[].icon) when the set has it, else its goods category
 * (food, drink, clothing) or the public building it asks for.
 */
export function needIcon(need: { category?: string; building?: string }, iconKey?: string): string {
  if (iconKey && ICON_PATHS[iconKey]) return ICON_PATHS[iconKey];
  const key = need.category ? `need:${need.category}` : need.building ? `need:${need.building}` : "";
  return path(key, "need:_fallback");
}

/** Icon of a building status. */
export function statusIcon(key: StatusKey): string {
  return path(`status:${key}`, "need:_fallback");
}

/** Icon of a build category (houses, production, public, harbour, roads, other). */
export function categoryIcon(id: string): string {
  return path(`category:${id}`, "category:other");
}

export type ToolIcon =
  | "demolish"
  | "resume"
  | "upgrade"
  | "move"
  | "rotate"
  | "confirm"
  | "cancel"
  | "camera-left"
  | "camera-right"
  | "quests"
  | "ships"
  | "routes"
  | "world-map"
  | "account"
  | "menu"
  | "minimap"
  | "close"
  | "install"
  | "population"
  | "gold"
  | "warnings"
  | "credits"
  | "register"
  | "logout";

/** Icon of a HUD tool or control. */
export function toolIcon(name: ToolIcon): string {
  return path(`tool:${name}`, "need:_fallback");
}

/**
 * Icon of an island resource (top bar, island card): a fertility tag shows
 * its crop's good ("wheat", "apple" → apples), a deposit its raw good
 * ("iron" → iron ore, "stone"), the coast the harbour category.
 */
export function resourceIcon(kind: "fertility" | "deposit" | "coast", id = ""): string {
  if (kind === "coast") return categoryIcon("harbour");
  const keys = kind === "fertility" ? [`good:${id}`, `good:${id}s`] : [`good:${id}_ore`, `good:${id}`];
  for (const k of keys) if (ICON_PATHS[k]) return ICON_PATHS[k];
  return path("", "good:_fallback");
}
