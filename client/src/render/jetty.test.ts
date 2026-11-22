// The timber jetty (D-085) on the shared display fixture jetty_harbour
// (server/testdata/display, written by the Go fixture generator from the
// scenario of the same name): a quay replaced part of a jetty row, both
// stand on the water. Checks the client's mirrors and the `boards` paint.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentBuilding, DisplayState } from "../api/client";
import { REPO, loadContent } from "../almanac/testContent";
import { buildingNotes } from "../display/buildMenu";
import { shoreTiles, waterEdgeTiles } from "../display/geometry";
import { isQuayType, roadsOnWater, waterRoadsFor, withQuays } from "../display/quay";
import { planRoadDrag } from "../display/roaddrag";
import { boardsTop, PLANKS } from "./groundpaint";
import { fieldBase, isJettyTile, isWaterRoadTile, paintRoads, QUAY_H } from "./roadvoxels";
import { coastSide, type Field, pileSide, SIDE_PILES, SIDE_QUAY, SIDE_ROCK, TERRAIN_VPT } from "./voxelterrain";

const content = loadContent("content/old_coast");
const defs = new Map<string, ContentBuilding>(content.buildings.map((b) => [b.id, b]));
const fixture = JSON.parse(readFileSync(join(REPO, "server/testdata/display/jetty_harbour.json"), "utf8")) as { base: DisplayState };
const island = fixture.base.islands[0]!;
// The scenario's terrain rows (the display payload carries only the mask).
const rows = (JSON.parse(readFileSync(join(REPO, "server/testdata/scenarios/jetty_harbour.json"), "utf8")) as { islands: { rows: string[] }[] }).islands[0]!.rows;
const NAMES: Record<string, string> = { "~": "water", c: "coast", ".": "grass" };
const statics = { width: island.width, height: island.height, terrain: rows.flatMap((r) => [...r].map((ch) => NAMES[ch] ?? "grass")) };
const terrain = (x: number, y: number) => statics.terrain[y * statics.width + x] ?? "water";
const jetties = island.roads.filter((r) => r.type === "jetty");
const quays = island.roads.filter((r) => r.type === "quay");

describe("the jetty (D-085) on the jetty_harbour fixture", () => {
  it("has jetty and quay tiles on the water, both water roads of the quay tool", () => {
    expect(jetties.length).toBeGreaterThan(0);
    expect(quays.length).toBeGreaterThan(0);
    for (const r of [...jetties, ...quays]) expect(terrain(r.x, r.y)).toBe("water");
    expect(isQuayType(defs, "jetty")).toBe(true);
    const onWater = roadsOnWater(statics, island.roads);
    expect(new Set(onWater.values())).toEqual(new Set(["jetty", "quay"]));
  });

  it("hints the quay over a jetty as replace and the jetty over a quay as skip (D-085 §3)", () => {
    const data = { island: statics, buildings: [], roads: island.roads, defs };
    const j = jetties[jetties.length - 1]!;
    const q = quays[0]!;
    expect(planRoadDrag(j, j, "quay", data)[0]!.hint).toBe("replace");
    expect(planRoadDrag(q, q, "jetty", data)[0]!.hint).toBe("skip");
    expect(planRoadDrag(j, j, "jetty", data)[0]!.hint).toBe("skip");
  });

  it("tints a quay-only building over the jetty with terrain, a fisher stands on it (D-085 §2)", () => {
    // A jetty tile with jetties on both sides: the fisher's three columns stand on the row.
    const j = jetties.find((r) => jetties.some((o) => o.x === r.x - 1 && o.y === r.y) && jetties.some((o) => o.x === r.x + 1 && o.y === r.y))!;
    const fisher = defs.get("fisher")!;
    const pier = defs.get("trading_pier")!;
    expect(fisher.stands_on).toEqual(["jetty", "quay"]);
    expect(pier.stands_on).toEqual(["quay"]);
    // The fisher's land rows on the jetty row: valid; its water rows on open water in front.
    const forFisher = waterRoadsFor(island.roads, fisher.stands_on);
    const fx = j.x - 1;
    const fy = j.y - fisher.height + 1;
    const fisherTiles = waterEdgeTiles(fisher, withQuays(terrain, forFisher.on, forFisher.off), fx, fy, 0);
    expect(fisherTiles.filter((t) => t.y === j.y).every((t) => t.problem === null)).toBe(true);
    // The salt pans (quay-only would be red) read the jetty as land too; the Trading Post's default (quay) reads it as water_road.
    const forTP = waterRoadsFor(island.roads, defs.get("trading_post")!.stands_on);
    expect(withQuays(terrain, forTP.on, forTP.off)(j.x, j.y)).toBe("water_road");
    expect(withQuays(terrain, forTP.on, forTP.off)(quays[0]!.x, quays[0]!.y)).toBe("quay");
    // A shore building over the jetty: its footprint tile on the jetty is red (land = terrain).
    const forPier = waterRoadsFor(island.roads, pier.stands_on);
    const px = j.x - 1;
    const py = j.y - pier.height + 1;
    const pierTiles = shoreTiles(pier, withQuays(terrain, forPier.on, forPier.off), px, py, 0);
    expect(pierTiles.find((t) => t.x === j.x && t.y === j.y)?.problem).toBe("land");
    // Its back edge resting on the jetty: land (the server's terrain), on the quay it would be fine.
    const backOnJetty = shoreTiles(pier, withQuays(terrain, forPier.on, forPier.off), px, py - 1, 0);
    expect(backOnJetty.find((t) => t.x === j.x && t.y === j.y - 1)?.problem).toBe("land");
    expect(shoreTiles(pier, withQuays(terrain, forFisher.on, forFisher.off), px, py - 1, 0).find((t) => t.x === j.x && t.y === j.y - 1)?.problem).toBeNull();
  });

  it("paints jetties as boards on piles, quays as stone, at the shore's level", () => {
    // A flat field: land (level 0) from the coast row, the sea (seabed -6) above.
    const nx = island.width * TERRAIN_VPT;
    const ny = island.height * TERRAIN_VPT;
    const f: Field = { nx, ny, x0: 0, y0: 0, s: 1 / TERRAIN_VPT, h: new Int8Array(nx * ny), top: new Uint32Array(nx * ny).fill(0x5a8a3a), bottom: -6, side: coastSide };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (terrain(Math.floor(i / TERRAIN_VPT), Math.floor(j / TERRAIN_VPT)) === "water") f.h[j * nx + i] = -6;
    const base = fieldBase(f);
    const tiles = island.roads.map((r) => ({ x: r.x, y: r.y, type: r.type }));
    expect(tiles.filter(isWaterRoadTile).length).toBe(jetties.length + quays.length);
    paintRoads(f, base, tiles, 7);
    const col = (x: number, y: number, a: number, b: number) => (y * TERRAIN_VPT + b) * nx + x * TERRAIN_VPT + a;
    const planks = new Set<number>();
    for (const t of tiles.filter(isJettyTile)) {
      for (let b = 0; b < TERRAIN_VPT; b++) {
        for (let a = 0; a < TERRAIN_VPT; a++) {
          const k = col(t.x, t.y, a, b);
          expect(f.h[k]).toBe(QUAY_H);
          expect(f.kind?.[k]).toBe(SIDE_PILES);
          expect(f.road?.[k]).toBe(4);
          planks.add(f.top[k] as number);
        }
      }
    }
    // No fender, bollard or post on a jetty: every column is a plank of the boards.
    const r = (p: number) => (p >> 16) & 255;
    const plankR = Math.round(Math.min(1, PLANKS.r) * 255);
    for (const p of planks) expect(Math.abs(r(p) - plankR)).toBeLessThan(20);
    // The quays keep their stone deck and rock or dressed-stone sides.
    const q = quays[0]!;
    expect([SIDE_ROCK, SIDE_QUAY]).toContain(f.kind?.[col(q.x, q.y, 1, 1)]);
    expect(f.top[col(q.x, q.y, 1, 1)]).not.toBe(boardsTop(0, 0.5));
    // A jetty row along x lays its planks across the run: the shade alternates along x, not along y.
    const jt = jetties[Math.floor(jetties.length / 2)]!;
    const shade = (a: number, b: number) => r(f.top[col(jt.x, jt.y, a, b)] as number);
    expect(Math.abs(shade(0, 0) - shade(1, 0))).toBeGreaterThan(Math.abs(shade(0, 0) - shade(0, 1)));
  });

  it("averages the boards to the plank colour for the lite and far views; the piles are dark under the boards' edge", () => {
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += (boardsTop(i, 0.5) >> 16) & 255;
    expect(Math.abs(sum / 4 - Math.round(PLANKS.r * 255))).toBeLessThan(4);
    expect(pileSide(0).r).toBeGreaterThan(pileSide(-1).r);
    expect(pileSide(-5).r).toBeLessThanOrEqual(pileSide(-1).r);
    expect(coastSide(-1, SIDE_PILES)).toEqual(pileSide(-1));
  });

  it("writes the card notes: the jetty is built over by the quay, the quay builds over the jetty", () => {
    expect(buildingNotes(defs.get("jetty")!, content)).toEqual(["On shallow water", "Quay builds over it"]);
    expect(buildingNotes(defs.get("quay")!, content)).toEqual(["On shallow water", "Builds over Jetty"]);
    // Without the content (info panel) no road notes.
    expect(buildingNotes(defs.get("jetty")!)).toEqual([]);
  });
});
