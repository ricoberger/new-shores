// Deterministic decoration placement (ART_DIRECTION §4), render-only and
// pure: everything derives from a seed that is a stable hash of the
// island's ID and revision (the API has no island seed), so the same
// island and revision look the same across reloads and clients.
import { hashString } from "./noise";

/** Decoration seed of an island revision. */
export function islandSeed(id: string, revision: string): number {
  return hashString(`${id}|${revision}`);
}
