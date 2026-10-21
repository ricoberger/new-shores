// Route drafts and the server's route numbers for the route editor (D-027):
// conversions between the editor's whole-unit draft and the command's
// milli-units, and formatting of the server's loop time and effects. No
// travel time, loop time or effect is computed here.
import type { Content, DisplayState, RouteDisplay, RouteStop } from "../api/client";
import { perMin, units } from "./format";
import type { Draft } from "./view";

/** The editor draft of a saved route (amounts in whole units). */
export function draftFromRoute(r: RouteDisplay): Draft {
  return {
    name: r.name,
    stops: r.stops.map((s) => ({
      island: s.island_id,
      load: s.load.map((l) => ({ good: l.good, max: Math.floor(l.max_amount / 1000) })),
      unload: [...s.unload],
    })),
  };
}

/** The stops of create_route / update_route (max_amount in milli-units). */
export function stopsFromDraft(d: Draft): RouteStop[] {
  return d.stops.map((s) => ({
    island_id: s.island,
    load: s.load.filter((l) => l.good !== "").map((l) => ({ good: l.good, max_amount: l.max * 1000 })),
    unload: s.unload.filter((g) => g !== ""),
  }));
}

/** The draft differs from the saved route (the shown server numbers are the saved route's). */
export function draftChanged(d: Draft, r: RouteDisplay): boolean {
  return JSON.stringify(stopsFromDraft(d)) !== JSON.stringify(stopsFromDraft(draftFromRoute(r))) || d.name !== r.name;
}

/** Whole units with an explicit sign ("+50", "−50", "0"). */
export function signedUnits(milli: number): string {
  const v = units(Math.abs(milli));
  if (v === "0") return "0";
  return milli < 0 ? `−${v}` : `+${v}`;
}

export interface EffectRow {
  island: string;
  islandName: string;
  good: string;
  goodName: string;
  perLoop: string;
  perMin: string;
}

/** Rows of the server's estimated route effects, in the server's order. */
export function effectRows(r: RouteDisplay, model: DisplayState, content: Content): EffectRow[] {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  return r.effects.map((e) => ({
    island: e.island_id,
    islandName: islandName(e.island_id),
    good: e.good,
    goodName: goodName(e.good),
    perLoop: signedUnits(e.per_loop),
    perMin: perMin(e.per_min, true),
  }));
}

/** ID of the route a create_route added: the one not among the IDs before. */
export function createdRouteId(before: readonly RouteDisplay[], after: readonly RouteDisplay[]): number | null {
  const known = new Set(before.map((r) => r.id));
  const added = after.filter((r) => !known.has(r.id)).map((r) => r.id);
  return added.length > 0 ? Math.max(...added) : null;
}
