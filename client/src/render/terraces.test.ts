import { describe, expect, it } from "vitest";
import type { Terrain } from "../api/client";
import { marchingSquares, traceLoops } from "../display/coastline";
import { BRIDGE_DECK, bridgeRuns, cover, groundY, insideGrid, insideLoops, IslandGround, LEVEL_HEIGHT, LEVEL_STEPS, plinthColumns, reliefColumns, reliefOf, RIVER_DROP, ROCK_STEPS, roadRamps, rockField } from "./terraces";
import { EMPTY, islandField, VOXEL_STEP, withRock } from "./voxelterrain";

// The relief (D-058): terrace levels, rock and rivers as voxel columns.

const MAP: Record<string, Terrain> = { "~": "water", c: "coast", g: "grass", m: "mountain", r: "river", i: "islet", k: "cliff" };

function island(rows: string[], levels: string[], heights?: string[]) {
  return {
    width: rows[0]!.length,
    height: rows.length,
    terrain: rows.flatMap((r) => [...r].map((c) => MAP[c]!)),
    levels: levels.join(""),
    heights: heights?.join(""),
  };
}

describe("relief of an island", () => {
  it("reads levels and rock heights per tile (rock only on mountain, cliff and islet tiles; the sea flat)", () => {
    const r = reliefOf(island(["~gm", "~rk"], ["011", "011"], ["123", "456"]));
    expect(Array.from(r.level)).toEqual([0, 1, 1, 0, 1, 1]);
    expect(Array.from(r.rock)).toEqual([0, 0, 3, 0, 0, 6]);
    expect(groundY(r, 1, 0)).toBeCloseTo(LEVEL_HEIGHT);
    expect(groundY(r, 9, 9)).toBe(0);
    expect(LEVEL_HEIGHT).toBeCloseTo(LEVEL_STEPS * VOXEL_STEP);
  });

  it("is flat without levels or heights", () => {
    const r = reliefOf({ width: 2, height: 1, terrain: ["grass", "mountain"] });
    expect(Array.from(r.level)).toEqual([0, 0]);
    expect(Array.from(r.rock)).toEqual([0, 0]);
  });

  it("blends a tile predicate bilinearly between tile centres", () => {
    const left = (x: number) => x === 0;
    expect(cover(left, 0.5, 0.5)).toBeCloseTo(1); // a tile centre
    expect(cover(left, 0.5, 1)).toBeCloseTo(1);
    expect(cover(left, 1, 1)).toBeCloseTo(0.5);
    expect(cover(left, 1.5, 1)).toBeCloseTo(0);
  });
});

describe("relief columns", () => {
  it("raises a level by LEVEL_STEPS with straight edges on the tile border and no ramps by the sea", () => {
    // Every tile is within a tile of the sea: cliffs, no ramps (any seed).
    const rows = ["~~~~~~", "~gggg~", "~gggg~", "~~~~~~"];
    const lv = ["000000", "000110", "000110", "000000"];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const c = reliefColumns(reliefOf(island(rows, lv)), 4, seed);
      const at = (x: number, y: number) => c.ground[Math.floor(y * 4) * c.nx + Math.floor(x * 4)];
      expect(at(3.1, 1.5)).toBe(LEVEL_STEPS);
      expect(at(4.5, 2.5)).toBe(LEVEL_STEPS);
      expect(at(2.9, 1.5)).toBe(0);
      expect(c.flat[Math.floor(1.5 * 4) * c.nx + 13]).toBe(LEVEL_STEPS);
      expect(c.flat[Math.floor(1.5 * 4) * c.nx + 11]).toBe(0);
    }
  });

  it("cuts ramps of one step per column only inland, in noise zones", () => {
    // A wide level-1 plateau far from the sea: some of its edge columns ramp (1–3 steps), none jump by more than the level.
    const w = 40;
    const rws = Array.from({ length: w }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === w - 1 ? "~" : "g")).join(""));
    const lvs = Array.from({ length: w }, (_, y) => Array.from({ length: w }, (_, x) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? "1" : "0")).join(""));
    const seeds = [1, 2, 3, 4, 5];
    let ramps = 0;
    for (const s of seeds) {
      const c = reliefColumns(reliefOf(island(rws, lvs)), 4, s);
      for (let k = 0; k < c.ground.length; k++) if (c.ground[k]! > 0 && c.ground[k]! < LEVEL_STEPS) ramps++;
    }
    expect(ramps).toBeGreaterThan(0);
  });

  it("puts rivers RIVER_DROP below their level and marks waterfalls where the river drops a level", () => {
    const r = ["~~~~~~", "~gggg~", "~rrrr~", "~gggg~", "~~~~~~"];
    const l = ["000000", "001100", "001100", "001100", "000000"];
    const c = reliefColumns(reliefOf(island(r, l)), 4, 1);
    const col = (x: number, y: number) => Math.floor(y * 4) * c.nx + Math.floor(x * 4);
    expect(c.river[col(1.5, 2.5)]).toBe(1);
    expect(c.riverH[col(1.5, 2.5)]).toBe(-RIVER_DROP);
    expect(c.riverH[col(2.5, 2.5)]).toBe(LEVEL_STEPS - RIVER_DROP);
    // The level-1 river column next to the level-0 one is a waterfall; the low one is not.
    expect(c.fall[Math.floor(2.5 * 4) * c.nx + 8]).toBe(1);
    expect(c.fall[col(1.5, 2.5)]).toBe(0);
  });

  it("cuts a river into two water columns between banks one step down, its stair corners rounded by half a tile", () => {
    const r = ["~~~~~~~~", "~gggggg~", "~grrrgg~", "~gggrgg~", "~gggrgg~", "~gggggg~", "~~~~~~~~"];
    const c = reliefColumns(reliefOf(island(r, r.map((row) => row.replace(/./g, "0")))), 4, 1);
    const at = (i: number, j: number) => j * c.nx + i;
    // A straight run (tile 3, 2; columns 12–15, rows 8–11): banks at the edges, water in the middle two rows.
    for (const j of [8, 11]) {
      expect(c.bank[at(13, j)]).toBe(1);
      expect(c.river[at(13, j)]).toBe(0);
      expect(c.ground[at(13, j)]).toBe(-1);
    }
    for (const j of [9, 10]) {
      expect(c.river[at(13, j)]).toBe(1);
      expect(c.riverH[at(13, j)]).toBe(-RIVER_DROP);
    }
    // The outer corner of the bend (tile 4, 2) carves its bank in by half a tile; its inner corner is water.
    expect(c.river[at(18, 9)]).toBe(1);
    expect(c.bank[at(19, 9)]).toBe(1);
    expect(c.river[at(16, 11)]).toBe(1);
    // No river or bank outside the river tiles.
    for (let k = 0; k < c.river.length; k++) {
      const t = r[Math.floor(Math.floor(k / c.nx) / 4)]![Math.floor((k % c.nx) / 4)];
      if (t !== "r") expect(c.river[k]! + c.bank[k]!).toBe(0);
    }
  });

  it("raises rock from ragged rims to its blended height, uneven and cut out under building footprints", () => {
    const r = ["~~~~~~~~~", "~ggggggg~", "~gmmmmmg~", "~gmmmmmg~", "~gmmmmmg~", "~gmmmmmg~", "~gmmmmmg~", "~ggggggg~", "~~~~~~~~~"];
    const l = r.map((row) => row.replace(/./g, "0"));
    const h = r.map((row) => row.replace(/./g, (ch) => (ch === "m" ? "1" : "0")));
    const rel = reliefOf(island(r, l, h));
    const c = reliefColumns(rel, 4, 1);
    const centre = 18 * c.nx + 18;
    // One rock level is ROCK_STEPS steps, roughened by noise (± ROCK_ROUGH / 2) and per-column grain.
    expect(Math.abs(c.rock[centre]! - ROCK_STEPS)).toBeLessThanOrEqual(6);
    // Uneven tops: the inner columns are not one plate.
    const inner = new Set<number>();
    for (let j = 12; j < 24; j++) for (let i = 12; i < 24; i++) inner.add(c.rock[j * c.nx + i]!);
    expect(inner.size).toBeGreaterThan(2);
    // The pair lattice alternates its half-step offset per level: odd tops occur next to even ones.
    expect([...inner].some((v) => v % 2 === 1)).toBe(true);
    expect([...inner].some((v) => v % 2 === 0)).toBe(true);
    expect(c.rim[centre]).toBeGreaterThan(2);
    // No rock outside the mountain tiles (erosion only removes).
    for (let k = 0; k < c.rock.length; k++) {
      const tx = Math.floor((k % c.nx) / 4);
      const ty = Math.floor(Math.floor(k / c.nx) / 4);
      if (r[ty]![tx] !== "m") expect(c.rock[k]).toBe(0);
    }
    // Rims step up: no rock column is more than two steps above a rockless neighbour.
    for (let k = 0; k < c.rock.length; k++) {
      const i = k % c.nx;
      if (i + 1 < c.nx && c.rock[k + 1] === 0) expect(c.rock[k]!).toBeLessThanOrEqual(2);
    }
    const cut = reliefColumns(rel, 4, 1, new Set(["4,4"]));
    expect(cut.rock[centre]).toBe(0);
    // The rock field stands on the ground; its walls reach down to it.
    const f = rockField(c, 1);
    expect(f.h[centre]).toBe(c.rock[centre]);
    expect(f.h[0]).toBe(EMPTY);
    expect(f.floor![centre]).toBe(0);
  });

  it("bakes the rock into the lite and far fields", () => {
    const r = ["~~~~~", "~gmg~", "~~~~~"];
    const l = ["00000", "00000", "00000"];
    const h = ["00000", "00200", "00000"];
    const rel = island(r, l, h);
    const loops = traceLoops(marchingSquares(rel.width, rel.height, (x, y) => x >= 0 && y >= 0 && x < rel.width && y < rel.height && rel.terrain[y * rel.width + x] !== "water"));
    const f = islandField(rel, loops, 1);
    const k = 6 * f.nx + 10;
    expect(f.h[k]).toBe(0);
    expect(withRock(f, 1).h[k]).toBeGreaterThan(0);
    // The far terrain: the rock in double levels, at most `tiers` (lower rock keeps its colour only).
    const full = withRock(f, 1).h[k] as number;
    expect(withRock(f, 1, { tiers: 1 }).h[k]).toBe(Math.min(2 * LEVEL_STEPS, Math.round(full / (2 * LEVEL_STEPS)) * 2 * LEVEL_STEPS));
    expect(withRock(f, 1, { tiers: 0 }).h[k]).toBe(0);
    expect(withRock(f, 1, { tiers: 0 }).top[k]).toBe(withRock(f, 1).top[k]);
  });
});

describe("loops", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];
  const hole = [
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 1 },
  ];

  it("tests points against loops even-odd (holes cut out)", () => {
    expect(insideLoops([square], 2, 2)).toBe(true);
    expect(insideLoops([square, hole], 2, 2)).toBe(false);
    expect(insideLoops([square, hole], 0.5, 2)).toBe(true);
    expect(insideLoops([square], 5, 2)).toBe(false);
  });

  it("tests a grid exactly like insideLoops", () => {
    for (const loops of [[square], [square, hole]]) {
      const [x0, y0, g, nx, ny] = [-0.6, -0.55, 0.25, 32, 28];
      const grid = insideGrid(loops, x0, y0, g, nx, ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) expect(grid[j * nx + i] === 1).toBe(insideLoops(loops, x0 + i * g, y0 + j * g));
    }
  });
});

describe("island ground", () => {
  // A level-1 strip (x 2–3) beside level 0, a river tile at (1, 2).
  const rows = ["gggg", "gggg", "grgg"];
  const lv = ["0011", "0011", "0011"];

  it("puts buildings on the highest level under their footprint", () => {
    const g = new IslandGround();
    g.setRelief(reliefOf(island(rows, lv)));
    expect(g.tile(0, 0)).toBe(0);
    expect(g.tile(2, 0)).toBeCloseTo(LEVEL_HEIGHT);
    expect(g.base(1, 0, 2, 2)).toBeCloseTo(LEVEL_HEIGHT);
    expect(g.base(0, 0, 2, 2)).toBe(0);
  });

  it("ramps a road up a level across the upper tile and carries roads over rivers on bridges", () => {
    const g = new IslandGround();
    g.setRelief(reliefOf(island(rows, lv)));
    g.setRoads([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    // (2, 0) climbs from the west edge (level 0) to its east edge (level 1).
    expect(g.rampAt(2, 0)).toBe(1);
    expect(g.surface(2.0, 0.5)).toBeCloseTo(0);
    expect(g.surface(2.5, 0.5)).toBeCloseTo(LEVEL_HEIGHT / 2);
    expect(g.surface(3.5, 0.5)).toBeCloseTo(LEVEL_HEIGHT);
    // The river tile is a one-tile bridge along x.
    expect(g.bridges()).toEqual([{ x: 1, y: 2, len: 1, axis: "x", level: 0 }]);
    expect(g.surface(1.5, 2.5)).toBeCloseTo(BRIDGE_DECK);
    // Off the roads: the tile's level.
    expect(g.surface(3.5, 1.5)).toBeCloseTo(LEVEL_HEIGHT);
  });

  it("finds bridge runs along y and of two tiles", () => {
    const r = reliefOf(island(["grg", "grg", "ggg"], ["000", "000", "000"]));
    const runs = bridgeRuns(r, new Set([1, 4, 7]));
    expect(runs).toEqual([{ x: 1, y: 0, len: 2, axis: "y", level: 0 }]);
    expect(roadRamps(r, new Set([1, 4, 7])).every((d) => d === -1)).toBe(true);
  });

  it("raises plinths under footprints to their base (lower tiles and ramp columns)", () => {
    const rel = reliefOf(island(rows, lv));
    const c = reliefColumns(rel, 4, 1);
    const p = plinthColumns(c, rel, [{ x: 1, y: 0, w: 2, h: 1 }]);
    // Tile (1, 0) is level 0 under a footprint reaching level 1: its columns rise to 4 steps.
    expect(p[1 * c.nx + 5]).toBe(LEVEL_STEPS);
    // Outside the footprint: none.
    expect(p[1 * c.nx + 1]).toBe(0);
    expect(p[6 * c.nx + 5]).toBe(0);
    const f = rockField(c, 1, p);
    expect(f.h[1 * c.nx + 5]).toBe(LEVEL_STEPS);
    expect(f.kind![1 * c.nx + 5]).toBe(1);
  });
});
