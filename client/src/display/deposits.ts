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
