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

/**
 * A deposit slot (MECHANICS §2: two 4-adjacent deposit tiles of one kind; slots stand at least 16 tiles apart, so
 * every 4-connected group of a kind's tiles is one slot): its tiles and the point its marker floats over, the mean of
 * its tile centres minus ½ (tile coordinates: between the two tiles of a pair).
 */
export interface DepositSlot {
  kind: string;
  tiles: { x: number; y: number }[];
  x: number;
  y: number;
}

/** The deposit slots among tiles (4-connected groups of one kind), ordered by their first tile (row, then column). */
export function depositSlots(deposits: readonly DepositDisplay[]): DepositSlot[] {
  const left = new Map(deposits.map((d) => [`${d.x},${d.y}`, d]));
  const out: DepositSlot[] = [];
  for (const start of [...deposits].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (!left.delete(`${start.x},${start.y}`)) continue;
    const tiles = [{ x: start.x, y: start.y }];
    for (let i = 0; i < tiles.length; i++) {
      const m = tiles[i]!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${m.x + dx},${m.y + dy}`;
        if (left.get(k)?.kind !== start.kind) continue;
        left.delete(k);
        tiles.push({ x: m.x + dx, y: m.y + dy });
      }
    }
    const x = tiles.reduce((s, t) => s + t.x, 0) / tiles.length;
    const y = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
    out.push({ kind: start.kind, tiles, x, y });
  }
  return out;
}

/**
 * An island's free slots of a deposit kind: a slot with a building on any of its tiles is taken (a mine or quarry
 * occupies one slot, MECHANICS §2), so neither its tint nor its marker shows.
 */
export function freeDepositSlots(
  island: { deposits: readonly DepositDisplay[]; buildings?: readonly BuildingDisplay[] },
  kind: string,
  defs: ReadonlyMap<string, Pick<ContentBuilding, "width" | "height">>,
): DepositSlot[] {
  const slots = depositSlots(island.deposits.filter((d) => d.kind === kind));
  if (slots.length === 0 || !island.buildings?.length) return slots;
  const blocked = blockedTiles(island.buildings, [], defs);
  return slots.filter((s) => !s.tiles.some((t) => blocked.has(`${t.x},${t.y}`)));
}

/** An island's tiles of a deposit kind in its free slots (the tint; a taken slot's tiles hide under or beside its mine). */
export function depositTiles(
  island: { deposits: readonly DepositDisplay[]; buildings?: readonly BuildingDisplay[] },
  kind: string,
  defs: ReadonlyMap<string, Pick<ContentBuilding, "width" | "height">>,
): DepositDisplay[] {
  return freeDepositSlots(island, kind, defs).flatMap((s) => s.tiles.map((t) => ({ ...t, kind })));
}

/** How many slots of a deposit kind an island has (the far label's count; 0: no icon). */
export function depositCount(island: { deposits: readonly DepositDisplay[] }, kind: string | null): number {
  if (!kind) return 0;
  return depositSlots(island.deposits.filter((d) => d.kind === kind)).length;
}
