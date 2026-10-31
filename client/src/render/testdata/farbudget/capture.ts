// Captures the far-budget guard's fixtures (render/farbudget.test.ts):
// the display payload and every island's tiles of the `make shots` server
// fixtures settled, patricians, played and seafaring (the unsettled start
// at sea; server/internal/devworld),
// trimmed to what the renderer reads and gzipped next to this file.
//
// Run with a dev server up (any port), from the client directory:
//   (cd ../server && go run ./cmd/server --dev --content ../content/old_coast --addr :18190) &
//   node src/render/testdata/farbudget/capture.ts http://localhost:18190
// Re-run when the devworld fixtures, the island generator or the content
// change what these worlds hold.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const api = process.argv[2] ?? "http://localhost:18190";
const FIXTURES = ["settled", "patricians", "played", "seafaring"] as const;

type Json = Record<string, unknown>;

async function get(path: string): Promise<Json> {
  const res = await fetch(`${api}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return (await res.json()) as Json;
}

for (const fixture of FIXTURES) {
  const reset = await fetch(`${api}/api/v1/dev/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fixture }) });
  if (!reset.ok) throw new Error(`reset ${fixture}: ${reset.status} ${await reset.text()}`);
  const display = (await get("/api/v1/world")).display as Json;
  const islands = (display.islands as Json[]).map((is) => {
    // The renderer's inputs only (no stock, workforce or population).
    const { id, position, width, height, settled, scenic, rock, terrain_mask, fertilities, deposits, buildings, roads } = is;
    return { id, position, width, height, settled, scenic, rock, terrain_mask, fertilities, deposits, buildings, roads };
  });
  const tiles: Record<string, Json> = {};
  for (const is of islands) tiles[is.id as string] = await get(`/api/v1/world/islands/${is.id as string}/tiles`);
  const ships = (display.ships as Json[]).map((s) => ({ id: s.id, type: s.type }));
  const out = { fixture, archipelago: display.archipelago, islands, ships, tiles };
  const file = join(import.meta.dirname, `${fixture}.json.gz`);
  writeFileSync(file, gzipSync(JSON.stringify(out), { level: 9 }));
  console.log(`${file}: ${islands.length} islands, ${islands.reduce((n, is) => n + (is.buildings as unknown[]).length, 0)} buildings`);
}
