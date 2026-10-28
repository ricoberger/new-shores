// Display helpers for tiers and the build menu (D-027: lookups of
// server-provided state only). Lock reasons list the unmet unlock
// conditions the server reports in DisplayState.tiers; nothing here
// evaluates an unlock rule.
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { units } from "./format";

/** Total residents per tier over all islands (milli-residents). */
export function populationTotals(model: DisplayState | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const is of model?.islands ?? []) {
    for (const [tier, n] of Object.entries(is.population)) {
      out.set(tier, (out.get(tier) ?? 0) + n);
    }
  }
  return out;
}

/** Whether the server reports the tier as unlocked (unknown: locked). */
export function tierUnlocked(model: DisplayState | null, tierId: string): boolean {
  return model?.tiers.find((t) => t.id === tierId)?.unlocked ?? false;
}

/**
 * Lock reason of a tier from the server's unlock progress, e.g.
 * "Needs Citizens — Settlers 88/120, Chapel". Only unmet conditions are
 * listed; null when the tier is unlocked.
 */
export function lockReason(model: DisplayState | null, content: Content, tierId: string): string | null {
  const tier = model?.tiers.find((t) => t.id === tierId);
  if (tier?.unlocked) return null;
  const tierName = (id: string) => content.tiers.find((t) => t.id === id)?.name ?? id;
  const head = `Needs ${tierName(tierId)}`;
  if (!tier) return head;
  const parts: string[] = [];
  for (const [id, p] of Object.entries(tier.population)) {
    if (p.have < p.need) parts.push(`${tierName(id)} ${units(p.have)}/${units(p.need)}`);
  }
  for (const [id, built] of Object.entries(tier.buildings)) {
    if (!built) parts.push(content.buildings.find((b) => b.id === id)?.name ?? id);
  }
  return parts.length > 0 ? `${head} — ${parts.join(", ")}` : head;
}

/**
 * Whether a building is offered in the build menu: houses of a later tier
 * are reached by upgrading a house only (MECHANICS §6.1; the server rejects
 * them with upgrade_only), so they are not listed.
 */
export function listedInBuildMenu(b: ContentBuilding, content: Content): boolean {
  // The Trading Post is placed only by founding from a ship (D-051); a field
  // only from its farm's panel (D-051 part 4).
  if (b.trading_post || b.field) return false;
  const first = content.tiers.find((t) => t.index === 0)?.id;
  return !b.house || b.house.tier === first;
}

/**
 * Fertility requirement of a building on an island (from the island's
 * static data): null when the building needs none.
 */
export function fertilityNeed(b: ContentBuilding, fertilities: readonly string[] | undefined): { fertility: string; present: boolean } | null {
  const f = b.work_area?.fertility ?? b.field?.fertility;
  if (!f) return null;
  return { fertility: f, present: (fertilities ?? []).includes(f) };
}

/** "Needs wheat fertility — this island has hemp" (or "has none"). */
export function missingFertilityText(fertility: string, fertilities: readonly string[] | undefined): string {
  const have = fertilities && fertilities.length > 0 ? fertilities.join(", ") : "none";
  return `Needs ${fertility} fertility — this island has ${have}`;
}

/** "Must cover a stone deposit" / "Must cover an iron deposit" (the article follows the deposit's name). */
/** Ghost hint text of a water-edge site that does not fit (D-051): its front rows on land, or its back rows on water. */
export function waterEdgeText(problem: "front" | "land", waterTiles: number): string {
  const rows = waterTiles === 1 ? "front row" : `${waterTiles} front rows`;
  return problem === "front" ? `Its ${rows} must stand on the water — rotate it (R) to face the sea` : "Only its front rows may stand on the water";
}

export function depositText(kind: string): string {
  return `Must cover ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind} deposit`;
}

/**
 * Unlock toasts (D-056 §10): "Citizens unlocked — 15 new buildings" for
 * every tier the server reports unlocked in next but not in prev (the
 * tier_unlocked boundary as seen by the client). The count is the tier's
 * buildings offered in the build menu (roads included, fields and
 * upgrade-only houses not). No toasts without a previous model (the
 * first load), so a returning player is not greeted with old unlocks.
 */
export function unlockToasts(prev: DisplayState | null, next: DisplayState | null, content: Content | null): string[] {
  if (!prev || !next || !content) return [];
  const out: string[] = [];
  for (const t of next.tiers) {
    if (!t.unlocked || tierUnlocked(prev, t.id) || !prev.tiers.some((p) => p.id === t.id)) continue;
    const name = content.tiers.find((x) => x.id === t.id)?.name ?? t.id;
    const n = content.buildings.filter((b) => b.tier === t.id && listedInBuildMenu(b, content)).length;
    out.push(n > 0 ? `${name} unlocked — ${n} new building${n === 1 ? "" : "s"}` : `${name} unlocked`);
  }
  return out;
}
