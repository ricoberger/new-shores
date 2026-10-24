// Display helpers for quests (D-027: the server evaluates every objective
// and reports current/target in Display.quests; nothing here decides
// whether a quest is complete).
import type { Content, DisplayState } from "../api/client";
import type { components } from "../api/schema";
import { units } from "./format";

export type ContentQuest = components["schemas"]["ContentQuest"];
export type ObjectiveDisplay = components["schemas"]["ObjectiveDisplay"];
export type ActiveQuestDisplay = components["schemas"]["ActiveQuestDisplay"];

/** Number of completed quests whose rewards were not claimed. */
export function claimableCount(model: DisplayState | null): number {
  return model?.quests.claimable.length ?? 0;
}

/** The content definition of a quest (undefined for unknown IDs). */
export function questDef(content: Content, id: string): ContentQuest | undefined {
  return content.quests.find((q) => q.id === id);
}

/** Title of a quest, its ID when unknown. */
export function questTitle(content: Content, id: string): string {
  return questDef(content, id)?.title ?? id;
}

const name = (list: { id: string; name: string }[], id: string | undefined) => list.find((x) => x.id === id)?.name ?? id ?? "";

/** Progress "current/target" in the objective's unit. */
export function objectiveProgress(o: ObjectiveDisplay): string {
  switch (o.kind) {
    case "population":
    case "stock":
      return `${units(Math.max(o.current, 0))}/${units(o.target)}`;
    case "satisfaction":
      return `${o.current < 0 ? "–" : Math.round(o.current / 10)}/${Math.round(o.target / 10)} %`;
    default:
      return `${o.current}/${o.target}`;
  }
}

/** One line per objective, e.g. "Dirt road (tiles) 10/10". */
export function objectiveText(o: ObjectiveDisplay, content: Content): string {
  const where = o.island ? ` on ${o.island}` : "";
  const building = name(content.buildings, o.type);
  const tier = name(content.tiers, o.tier);
  switch (o.kind) {
    case "building_count":
      return `${building}${content.buildings.find((b) => b.id === o.type)?.road ? " (tiles)" : ""}${where} ${objectiveProgress(o)}`;
    case "connected":
      return `${building} connected to the Trading Post or a Warehouse${where}`;
    case "population":
      return `${tier} ${objectiveProgress(o)}`;
    case "stock":
      return `${name(content.goods, o.good)} in stock${where} ${objectiveProgress(o)}`;
    case "route_exists":
      return "A route with a ship";
    case "island_settled":
      return `Settled islands ${objectiveProgress(o)}`;
    case "tier_unlocked":
      return `${tier} unlocked`;
    case "ship_count":
      return `Ships ${objectiveProgress(o)}`;
    case "satisfaction":
      return `${tier} satisfaction ${objectiveProgress(o)}`;
  }
  return o.kind;
}

/** Reward description, e.g. "25 gold, 45 Planks". */
export function rewardText(q: ContentQuest, content: Content): string {
  const parts: string[] = [];
  if (q.rewards.gold > 0) parts.push(`${units(q.rewards.gold)} gold`);
  for (const [good, amount] of Object.entries(q.rewards.goods)) {
    parts.push(`${units(amount)} ${name(content.goods, good)}`);
  }
  return parts.join(", ");
}

/** Whether claiming the quest needs a target island (it rewards goods). */
export function rewardsGoods(q: ContentQuest | undefined): boolean {
  return q !== undefined && Object.keys(q.rewards.goods).length > 0;
}
