// Quest conditions in player words for the almanac. Covers every objective
// kind of MECHANICS §12a; an unlisted kind falls back to a generic line.
// (The in-game `display/quests.ts` formats progress of a running world; the
// almanac has no world, only the target of the content.)
import { t } from "../i18n";
import { milli, num, type ContentObjective, type ContentQuest, type Index } from "./model";

/** One objective as a sentence fragment, e.g. "Lay 10 tiles of Dirt road". */
export function objectiveSentence(o: ContentObjective, idx: Index): string {
  const where = o.island ? t("almanac.obj.on", { island: o.island }) : "";
  const n = o.target;
  switch (o.kind) {
    case "building_count": {
      const b = idx.building(o.type);
      const name = idx.buildingName(o.type);
      if (b?.road) return t("almanac.obj.road", { count: n, name }) + where;
      return t("almanac.obj.have", { count: n, name }) + where;
    }
    case "connected":
      return t("almanac.obj.connected", { name: idx.buildingName(o.type) }) + where;
    case "population":
      return t("almanac.obj.population", { amount: milli(n), tier: idx.tierName(o.tier) });
    case "stock":
      return t("almanac.obj.stock", { amount: milli(n), good: idx.goodName(o.good) }) + where;
    case "route_exists":
      return t("almanac.obj.route");
    case "island_settled":
      return t("almanac.obj.settle", { count: n });
    case "tier_unlocked":
      return t("almanac.obj.unlock", { tier: idx.tierName(o.tier) });
    case "ship_count":
      return o.type ? t("almanac.obj.ownShip", { count: n, name: idx.shipName(o.type) }) : t("almanac.obj.ownShips", { count: n });
    case "satisfaction":
      return t("almanac.obj.satisfaction", { tier: idx.tierName(o.tier), percent: num(n / 10, 1) });
  }
  return t("almanac.obj.unknown", { kind: String((o as { kind: string }).kind) });
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
