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
}

export interface SummaryIsland {
  id: string;
  name: string;
  goods: SummaryGoodLine[];
}

export interface SummaryView {
  /** Start of the interval, e.g. "25 Oct, 21:36" (local time). */
  from: string;
  /** End of the interval: "04:08" on the start's day, else "26 Oct, 04:08". */
  to: string;
  /** e.g. "12 h 0 min". */
  duration: string;
  /** Signed gold change, e.g. "+125" or "−20", and the amounts. */
  gold: { before: string; after: string; change: string };
  /** Population per tier, e.g. { name: "Settlers", before: "32", after: "8" }. */
  population: { tier: string; name: string; before: string; after: string }[];
  islands: SummaryIsland[];
  paused: number;
  resumed: number;
  stillPaused: string[];
  shipsArrived: number;
  /** One line per ship (in the order of its first arrival), e.g. "Gull: 42 arrivals (Cormorant Rock 21, Mistle Haven 21)". */
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

/**
 * Day and time of an RFC 3339 timestamp in a time zone (the player's when
 * undefined): { day: "25 Oct", time: "21:36", key: "2026-10-25" }.
 */
export function dayAndTime(ts: string, timeZone?: string): { day: string; time: string; key: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts));
  const part = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${part("day")} ${part("month")}`, time: `${part("hour")}:${part("minute")}`, key: `${part("year")}-${part("month")}-${part("day")}` };
}

/** An interval's ends: "25 Oct, 21:36" and "26 Oct, 04:08", the end's day left out on the same day ("21:36"). */
export function intervalText(from: string, to: string, timeZone?: string): { from: string; to: string } {
  const a = dayAndTime(from, timeZone);
  const b = dayAndTime(to, timeZone);
  return { from: `${a.day}, ${a.time}`, to: a.key === b.key ? b.time : `${b.day}, ${b.time}` };
}

/**
 * The arrivals grouped per ship, in the order of each ship's first
 * arrival: "Gull: 42 arrivals (Cormorant Rock 21, Mistle Haven 21)", the
 * islands in the order of the ship's first arrival there; a single
 * arrival names only its island ("Gull: 1 arrival (Cormorant Rock)").
 */
export function arrivalLines(arrivals: AwaySummary["arrivals"], islandName: (id: string) => string, shipName: (id: number) => string): string[] {
  const ships = new Map<number, Map<string, number>>();
  for (const a of arrivals) {
    let islands = ships.get(a.ship_id);
    if (!islands) ships.set(a.ship_id, (islands = new Map()));
    islands.set(a.island_id, (islands.get(a.island_id) ?? 0) + 1);
  }
  return [...ships].map(([id, islands]) => {
    const n = [...islands.values()].reduce((sum, c) => sum + c, 0);
    const where = n === 1 ? islandName([...islands.keys()][0]!) : [...islands].map(([is, c]) => `${islandName(is)} ${c}`).join(", ");
    return `${shipName(id)}: ${n} ${n === 1 ? "arrival" : "arrivals"} (${where})`;
  });
}

/** The view model of a summary for the away dialog. */
export function summaryView(
  s: AwaySummary,
  content: Content,
  islandName: (id: string) => string,
  shipName: (id: number) => string = (id) => `Ship #${id}`,
  /** Time zone of the times shown (tests); the player's when undefined. */
  timeZone?: string,
): SummaryView {
  const interval = intervalText(s.from, s.to, timeZone);
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const tierName = (id: string) => content.tiers.find((t) => t.id === id)?.name ?? id;
  const typeName = (id: string) => content.buildings.find((b) => b.id === id)?.name ?? content.ships.find((sh) => sh.id === id)?.name ?? id;
  const tierOrder = (id: string) => content.tiers.find((t) => t.id === id)?.index ?? 99;
  return {
    from: interval.from,
    to: interval.to,
    duration: durationText(s.from, s.to),
    gold: { before: units(s.gold_before), after: units(s.gold_after), change: signed(s.gold_after - s.gold_before) },
    population: Object.entries(s.population)
      .sort(([a], [b]) => tierOrder(a) - tierOrder(b))
      .map(([tier, p]) => ({ tier, name: tierName(tier), before: units(p.before), after: units(p.after) })),
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
          })),
      })),
    paused: s.auto_paused,
    resumed: s.auto_resumed,
    stillPaused: s.still_unpaid.map((u) =>
      u.ship_id != null ? `${shipName(u.ship_id)} (${islandName(u.island_id)})` : `${typeName(u.type)} #${u.building_id} (${islandName(u.island_id)})`,
    ),
    shipsArrived: s.ships_arrived,
    arrivals: arrivalLines(s.arrivals, islandName, shipName),
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
