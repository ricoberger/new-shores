import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { type ContentBuilding, type IslandDisplay, type Island, islandStatics, type IslandTiles } from "../../api/client";

// The `played` server fixture as captured for the far-budget guard
// (farbudget/capture.ts), for the renderer tests that need a real world:
// 17 islands, three of them settled, with the shipped content's footprints.
// Replaces the retired client-only synthetic fixtures.

interface Captured {
  islands: IslandDisplay[];
  tiles: Record<string, IslandTiles>;
}

const repo = join(__dirname, "..", "..", "..", "..");
const captured = JSON.parse(gunzipSync(readFileSync(join(__dirname, "farbudget", "played.json.gz"))).toString("utf8")) as Captured;
const shipped = JSON.parse(readFileSync(join(repo, "content", "old_coast", "buildings.json"), "utf8")) as (ContentBuilding & { footprint: [number, number] })[];

/** The shipped content's buildings by ID (width and height from the footprint). */
export function playedDefs(): Map<string, ContentBuilding> {
  return new Map(shipped.map((b) => [b.id, { ...b, width: b.footprint[0], height: b.footprint[1] } as ContentBuilding]));
}

/** Fresh copies of the captured islands (tests mutate them); `ids` selects and orders a subset. */
export function playedIslands(ids?: readonly string[]): IslandDisplay[] {
  const all = structuredClone(captured.islands);
  return ids ? ids.map((id) => all.find((is) => is.id === id)!) : all;
}

/** The static layers of a captured island. */
export function playedStatics(is: IslandDisplay): Island {
  return islandStatics(captured.tiles[is.id] as IslandTiles, is);
}
