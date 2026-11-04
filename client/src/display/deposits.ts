// The deposit highlight of the mine and quarry tools (UI.md §3): while a
// building with `requires_deposit` is the build tool, the tiles of that
// deposit kind are tinted on every island in view and the far view's
// island labels carry the deposit's icon. Display only (D-027): the server
// payload lists the deposits; the client never decides a placement.
import type { BuildingDisplay, ContentBuilding, DepositDisplay } from "../api/client";
import type { Tool } from "../ui/tools";
import { blockedTiles } from "./scatter";

/** The deposit kind the tool highlights: the build tool's `requires_deposit`, else null. */
export function highlightedDeposit(tool: Tool, defs: ReadonlyMap<string, Pick<ContentBuilding, "requires_deposit">>): string | null {
  if (tool.kind !== "build") return null;
  return defs.get(tool.buildingType)?.requires_deposit || null;
}

/** An island's tiles of a deposit kind that no building covers (a mine on them hides the tint under its model). */
export function depositTiles(
  island: { deposits: readonly DepositDisplay[]; buildings?: readonly BuildingDisplay[] },
  kind: string,
  defs: ReadonlyMap<string, Pick<ContentBuilding, "width" | "height">>,
): DepositDisplay[] {
  const of = island.deposits.filter((d) => d.kind === kind);
  if (of.length === 0 || !island.buildings?.length) return of;
  const blocked = blockedTiles(island.buildings, [], defs);
  return of.filter((d) => !blocked.has(`${d.x},${d.y}`));
}

/** How many tiles of a deposit kind an island has (the far label's count; 0: no icon). */
export function depositCount(island: { deposits: readonly DepositDisplay[] }, kind: string | null): number {
  if (!kind) return 0;
  let n = 0;
  for (const d of island.deposits) if (d.kind === kind) n++;
  return n;
}

/** A cluster of deposit tiles: the tile its marker floats over (the one nearest the cluster's centre) and its size. */
export interface DepositCluster {
  x: number;
  y: number;
  tiles: number;
}

/**
 * The clusters of deposit tiles (8-connected) with the tile each marker stands over (UI.md §3 deposit markers):
 * the cluster's tile nearest its mean, ties by row then column, so a marker always floats over its deposit.
 * Ordered by that tile (row, then column).
 */
export function depositClusters(tiles: readonly { x: number; y: number }[]): DepositCluster[] {
  const left = new Set(tiles.map((t) => `${t.x},${t.y}`));
  const out: DepositCluster[] = [];
  for (const start of tiles) {
    if (!left.delete(`${start.x},${start.y}`)) continue;
    const members = [start];
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const k = `${m.x + dx},${m.y + dy}`;
          if (left.delete(k)) members.push({ x: m.x + dx, y: m.y + dy });
        }
    }
    const mx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const my = members.reduce((s, m) => s + m.y, 0) / members.length;
    let best = members[0]!;
    let bestD = Infinity;
    for (const m of members) {
      const d = (m.x - mx) ** 2 + (m.y - my) ** 2;
      if (d < bestD || (d === bestD && (m.y < best.y || (m.y === best.y && m.x < best.x)))) {
        best = m;
        bestD = d;
      }
    }
    out.push({ x: best.x, y: best.y, tiles: members.length });
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}
