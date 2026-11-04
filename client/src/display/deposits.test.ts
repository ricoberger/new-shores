import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DisplayState } from "../api/client";
import { loadContent } from "../almanac/testContent";
import { WorldOverlay } from "../ui/WorldOverlay";
import { NO_TOOL } from "../ui/tools";
import { depositClusters, depositCount, depositTiles, highlightedDeposit } from "./deposits";

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

  it("tints the deposit tiles of the kind that no building covers", () => {
    const is = island("isle-02");
    expect(depositTiles(is, "clay", defs)).toHaveLength(4);
    expect(depositTiles(is, "gold", defs)).toEqual([]);
    const stone = is.deposits.filter((d) => d.kind === "stone");
    const quarry = defs.get("quarry")!;
    const covered = { ...is, buildings: [{ ...is.buildings[0]!, type: "quarry", x: stone[0]!.x, y: stone[0]!.y, rotation: 0 as const }] };
    expect(quarry.width).toBeGreaterThan(0);
    expect(depositTiles(covered, "stone", defs).some((d) => d.x === stone[0]!.x && d.y === stone[0]!.y)).toBe(false);
  });

  it("puts the deposit's icon and tile count on the island labels with it, only while the tool is on", () => {
    expect(depositCount(island("isle-10"), "iron")).toBe(4);
    expect(depositCount(island("isle-10"), null)).toBe(0);
    const render = (deposit: string | null) =>
      renderToStaticMarkup(createElement(WorldOverlay, { renderer: null, model: base, selectedShip: null, nowMs: 0, onIsland: () => {}, deposit }));
    const on = render("iron");
    expect(on).toContain('data-testid="island-label-deposit-isle-10"');
    expect(on).toContain('data-testid="island-label-deposit-isle-02"');
    expect(on).not.toContain('data-testid="island-label-deposit-isle-03"');
    expect(render(null)).not.toContain("island-label-deposit-");
  });
});

describe("depositClusters (deposit markers)", () => {
  it("groups 8-connected tiles and floats each marker over its tile nearest the cluster's centre", () => {
    const tiles = [
      // A 3×3 block: the centre tile.
      ...[0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => ({ x: 10 + x, y: 20 + y }))),
      // A diagonal pair joins into one cluster; the tie goes to the upper row.
      { x: 30, y: 5 },
      { x: 31, y: 6 },
      // A lone tile.
      { x: 0, y: 40 },
    ];
    expect(depositClusters(tiles)).toEqual([
      { x: 30, y: 5, tiles: 2 },
      { x: 11, y: 21, tiles: 9 },
      { x: 0, y: 40, tiles: 1 },
    ]);
    expect(depositClusters([])).toEqual([]);
  });

  it("every marker stands on a deposit tile of the reference game", () => {
    for (const is of base.islands) {
      const stone = is.deposits.filter((d) => d.kind === "stone");
      const keys = new Set(stone.map((d) => `${d.x},${d.y}`));
      const clusters = depositClusters(stone);
      expect(clusters.reduce((n, c) => n + c.tiles, 0)).toBe(stone.length);
      for (const c of clusters) expect(keys.has(`${c.x},${c.y}`)).toBe(true);
    }
  });
});
