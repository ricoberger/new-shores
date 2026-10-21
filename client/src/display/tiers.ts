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
  for (const [id, delivered] of Object.entries(tier.goods_delivered)) {
    if (!delivered) parts.push(`deliver ${content.goods.find((g) => g.id === id)?.name ?? id}`);
  }
  return parts.length > 0 ? `${head} — ${parts.join(", ")}` : head;
}

/**
 * Whether a building is offered in the build menu: houses of a later tier
 * are reached by upgrading a house only (MECHANICS §6.1; the server rejects
 * them with upgrade_only), so they are not listed.
 */
export function listedInBuildMenu(b: ContentBuilding, content: Content): boolean {
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
