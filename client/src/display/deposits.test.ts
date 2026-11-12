import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DisplayState } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { WorldOverlay } from "../ui/WorldOverlay";
import { NO_TOOL } from "../ui/tools";
import { depositCount, depositSlots, depositTiles, freeDepositSlots, highlightedDeposit } from "./deposits";

const base = (JSON.parse(readFileSync(join(__dirname, "../../../server/testdata/display/bootstrap_citizens.json"), "utf8")) as { base: DisplayState }).base;
const content = loadContent("content/old_coast");
const defs = new Map(content.buildings.map((b) => [b.id, b]));
const island = (id: string) => base.islands.find((i) => i.id === id)!;

describe("deposit highlight (UI.md §3)", () => {
  it("is the build tool's requires_deposit: quarry stone, iron mine iron; nothing for other tools", () => {
    expect(highlightedDeposit({ kind: "build", buildingType: "quarry", rotation: 0 }, defs)).toBe("stone");
    expect(highlightedDeposit({ kind: "build", buildingType: "iron_mine", rotation: 0 }, defs)).toBe("iron");
    expect(highlightedDeposit({ kind: "build", buildingType: "lumberjack", rotation: 0 }, defs)).toBeNull();
    expect(highlightedDeposit({ kind: "road", roadType: "road_dirt" }, defs)).toBeNull();
    expect(highlightedDeposit(NO_TOOL, defs)).toBeNull();
  });

  it("tints the tiles of the kind's free slots: a building on one tile of a slot takes the whole slot", () => {
    const is = island("oc-02");
    expect(depositTiles(is, "clay", defs)).toHaveLength(4);
    expect(freeDepositSlots(is, "clay", defs)).toHaveLength(2);
    expect(depositTiles(is, "gold", defs)).toEqual([]);
    const [slot] = freeDepositSlots(is, "stone", defs);
    const tile = slot!.tiles[0]!;
    const covered = { ...is, buildings: [{ ...is.buildings[0]!, type: "quarry", x: tile.x, y: tile.y, rotation: 0 as const }] };
    expect(defs.get("quarry")!.width).toBeGreaterThan(0);
    const left = depositTiles(covered, "stone", defs);
    expect(slot!.tiles.some((t) => left.some((d) => d.x === t.x && d.y === t.y))).toBe(false);
    expect(freeDepositSlots(covered, "stone", defs)).toHaveLength(freeDepositSlots(is, "stone", defs).length - 1);
  });

  it("puts the deposit's icon and slot count on the island labels with it, only while the tool is on", () => {
    expect(depositCount(island("oc-10"), "iron")).toBe(2);
    expect(depositCount(island("oc-10"), null)).toBe(0);
    const render = (deposit: string | null) =>
      renderToStaticMarkup(createElement(WorldOverlay, { renderer: null, model: base, selectedShip: null, nowMs: 0, onIsland: () => {}, deposit }));
    const on = render("iron");
    expect(on).toContain('data-testid="island-label-deposit-oc-10"');
    expect(on).toContain('data-testid="island-label-deposit-oc-02"');
    expect(on).not.toContain('data-testid="island-label-deposit-oc-03"');
    expect(render(null)).not.toContain("island-label-deposit-");
  });
});

describe("depositSlots (deposit markers)", () => {
  it("groups 4-adjacent tiles of one kind into a slot whose marker point lies between them", () => {
    const tiles = [
      { x: 10, y: 20, kind: "stone" },
      { x: 11, y: 20, kind: "stone" },
      // A vertical pair.
      { x: 30, y: 5, kind: "iron" },
      { x: 30, y: 6, kind: "iron" },
      // Diagonal neighbours are two slots; so are 4-adjacent tiles of two kinds.
      { x: 0, y: 40, kind: "clay" },
      { x: 1, y: 41, kind: "clay" },
      { x: 2, y: 41, kind: "salt" },
    ];
    expect(depositSlots(tiles).map(({ kind, x, y, tiles }) => ({ kind, x, y, n: tiles.length }))).toEqual([
      { kind: "iron", x: 30, y: 5.5, n: 2 },
      { kind: "stone", x: 10.5, y: 20, n: 2 },
      { kind: "clay", x: 0, y: 40, n: 1 },
      { kind: "clay", x: 1, y: 41, n: 1 },
      { kind: "salt", x: 2, y: 41, n: 1 },
    ]);
    expect(depositSlots([])).toEqual([]);
  });

  it("every slot of the reference game is a pair of tiles, one marker per slot", () => {
    for (const is of base.islands) {
      const slots = depositSlots(is.deposits);
      expect(slots.reduce((n, s) => n + s.tiles.length, 0)).toBe(is.deposits.length);
      for (const s of slots) expect(s.tiles).toHaveLength(2);
    }
  });
});
