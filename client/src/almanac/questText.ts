// Quest conditions in player words for the almanac. Covers every objective
// kind of MECHANICS §12a; an unlisted kind falls back to a generic line.
// (The in-game `display/quests.ts` formats progress of a running world; the
// almanac has no world, only the target of the content.)
import { milli, num, type ContentObjective, type ContentQuest, type Index } from "./model";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** One objective as a sentence fragment, e.g. "Lay 10 tiles of Dirt road". */
export function objectiveSentence(o: ContentObjective, idx: Index): string {
  const where = o.island ? ` on island ${o.island}` : "";
  const n = o.target;
  switch (o.kind) {
    case "building_count": {
      const b = idx.building(o.type);
      const name = idx.buildingName(o.type);
      if (b?.road) return `Lay ${n} ${plural(n, "tile", "tiles")} of ${name}${where}`;
      return `Have ${n} × ${name}${where}`;
    }
    case "connected":
      return `Connect ${idx.buildingName(o.type)} to the Trading Post or a Warehouse${where}`;
    case "population":
      return `Reach ${milli(n)} ${idx.tierName(o.tier)}`;
    case "stock":
      return `Have ${milli(n)} ${idx.goodName(o.good)} in stock${where}`;
    case "route_exists":
      return "Send a ship along a route";
    case "island_settled":
      return `Settle ${n} ${plural(n, "island", "islands")}`;
    case "tier_unlocked":
      return `Unlock ${idx.tierName(o.tier)}`;
    case "ship_count":
      return o.type ? `Own ${n} ${idx.shipName(o.type)}${n === 1 ? "" : "s"}` : `Own ${n} ${plural(n, "ship", "ships")}`;
    case "satisfaction":
      return `Keep ${idx.tierName(o.tier)} satisfaction at ${num(n / 10, 1)} % or more`;
  }
  return `Complete a “${String((o as { kind: string }).kind)}” objective`;
}

export interface QuestView {
  id: string;
  title: string;
  text: string;
  conditions: string[];
  gold: number;
  goods: { good: string; amount: number }[];
  prerequisites: { id: string; title: string }[];
  /** Quests that list this one as a prerequisite. */
  unlocks: { id: string; title: string }[];
  chain: string;
}

/** Quest IDs start with their chain name (`intro_…`, `citizens_…`). */
export function chainOf(id: string): string {
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : id;
}

/** Quests in content order, each with its conditions, rewards and neighbours. */
export function questViews(idx: Index): QuestView[] {
  const quests: ContentQuest[] = idx.content.quests ?? [];
  return quests.map((q) => ({
    id: q.id,
    title: q.title,
    text: q.text,
    conditions: (q.objectives ?? []).map((o) => objectiveSentence(o, idx)),
    gold: (q.rewards?.gold ?? 0) / 1000,
    goods: Object.entries(q.rewards?.goods ?? {}).map(([good, amount]) => ({ good, amount: amount / 1000 })),
    prerequisites: (q.prerequisites ?? []).map((id) => ({ id, title: idx.quest(id)?.title ?? id })),
    unlocks: quests.filter((o) => o.prerequisites?.includes(q.id)).map((o) => ({ id: o.id, title: o.title })),
    chain: chainOf(q.id),
  }));
}
