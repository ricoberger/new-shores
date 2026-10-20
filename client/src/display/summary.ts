// Formatting of the "while you were away" summary (server data only).
import type { Content } from "../api/client";
import type { components } from "../api/schema";
import { units } from "./format";
import { questTitle } from "./quests";

export type AwaySummary = components["schemas"]["AwaySummary"];

export interface SummaryGoodLine {
  good: string;
  name: string;
  produced: string;
  consumed: string;
  lost: string;
  stock: string;
  atCapacity: boolean;
}

export interface SummaryIsland {
  id: string;
  name: string;
  goods: SummaryGoodLine[];
}

export interface SummaryView {
  from: string;
  to: string;
  /** e.g. "12 h 0 min". */
  duration: string;
  /** Signed gold change, e.g. "+125" or "−20", and the amounts. */
  gold: { before: string; after: string; change: string };
  /** Population per tier, e.g. { name: "Settlers", text: "32 → 8" }. */
  population: { tier: string; name: string; text: string }[];
  islands: SummaryIsland[];
  paused: number;
  resumed: number;
  stillPaused: string[];
  shipsArrived: number;
  arrivals: string[];
  quests: string[];
}

const signed = (milli: number) => {
  const v = units(Math.abs(milli));
  if (v === "0") return "0";
  return milli < 0 ? `−${v}` : `+${v}`;
};

/** Duration between two RFC 3339 timestamps as "h h m min". */
export function durationText(from: string, to: string): string {
  const min = Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/** Local time of an RFC 3339 timestamp, e.g. "14:05". */
function clock(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** The view model of a summary for the away dialog. */
export function summaryView(s: AwaySummary, content: Content, islandName: (id: string) => string): SummaryView {
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const tierName = (id: string) => content.tiers.find((t) => t.id === id)?.name ?? id;
  const typeName = (id: string) => content.buildings.find((b) => b.id === id)?.name ?? content.ships.find((sh) => sh.id === id)?.name ?? id;
  const tierOrder = (id: string) => content.tiers.find((t) => t.id === id)?.index ?? 99;
  return {
    from: s.from,
    to: s.to,
    duration: durationText(s.from, s.to),
    gold: { before: units(s.gold_before), after: units(s.gold_after), change: signed(s.gold_after - s.gold_before) },
    population: Object.entries(s.population)
      .sort(([a], [b]) => tierOrder(a) - tierOrder(b))
      .map(([tier, p]) => ({ tier, name: tierName(tier), text: `${units(p.before)} → ${units(p.after)}` })),
    islands: s.islands
      .filter((is) => Object.keys(is.goods).length > 0)
      .map((is) => ({
        id: is.id,
        name: islandName(is.id),
        goods: Object.entries(is.goods)
          .sort(([a], [b]) => goodName(a).localeCompare(goodName(b)))
          .map(([good, g]) => ({
            good,
            name: goodName(good),
            produced: units(g.produced),
            consumed: units(g.consumed),
            lost: units(g.lost),
            stock: `${units(g.stock_after)}/${units(g.capacity)}`,
            atCapacity: g.at_capacity,
          })),
      })),
    paused: s.auto_paused,
    resumed: s.auto_resumed,
    stillPaused: s.still_unpaid.map((u) => `${typeName(u.type)} #${u.building_id ?? u.ship_id} (${islandName(u.island_id)})`),
    shipsArrived: s.ships_arrived,
    arrivals: s.arrivals.map((a) => `Ship #${a.ship_id} at ${islandName(a.island_id)}, ${clock(a.at)}`),
    quests: s.quests_completed.map((q) => questTitle(content, q.id)),
  };
}

/**
 * Whether the away dialog opens for the model's summary: once per summary
 * id (an id the player already closed never re-opens it; a new id does).
 */
export function shouldShowSummary(summary: AwaySummary | null | undefined, closed: ReadonlySet<number>): boolean {
  return summary != null && !closed.has(summary.id);
}
