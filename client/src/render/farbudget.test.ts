import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import type { BuildingDisplay, ContentBuilding, DisplayState, Island, IslandDisplay, Terrain } from "../api/client";
import { groundFootprint } from "../display/camera";
import { coastline } from "../display/coastline";
import { visibleIslands } from "../display/frustum";
import { decodeMask, maskTerrain } from "../display/mask";
import { islandSeed, type Placed } from "../display/scatter";
import { BuildingLayer } from "./buildings";
import { FAR_TOWN_TRIS, MASK_TRIS, maskMeshData } from "./farmesh";
import { type ModelData, type ModelManifest, ModelRegistry, parseGlb } from "./models";
import { FAR_SHADOW_TRIS } from "./shadows";
import { buildTerrain } from "./terrain";
import { FAR_TREE_TRIS, FarTrees } from "./trees";

// Far-view budget guard (D-048, D-057 §5; ARCHITECTURE §5a): at the zoom
// cap (max_half_extent 120) the far LOD must stay within 250 k triangles
// on desktop and phone. The estimate takes every layer drawn at far from
// display data with the renderer's own functions, headless (NullEngine,
// the committed models served from public/models):
//
//   models_lite   the focused island's lite building chunks (BuildingLayer)
//   fields        0: painted into the lite ground (farfields.ts)
//   shadows       the cheap far outlines (FAR_SHADOW_TRIS per building)
//   far trees     FarTrees after its thinning, fed a forest on every land tile
//   terrain       the focused island's lite terrain (coarse for a very large
//                 town) plus the masks of every other island in view, at
//                 least MASK_TRIS (the relief that fills the rest)
//   ships         every ship of the payload at its full model
//
// The focused island's tiles are not in the display payload: its terrain
// is its 1:4 mask at tile resolution, terraced by distance from the coast
// (two levels) with mountains a level higher — a stand-in with more level
// walls than a generated island of that shape.

const repo = join(__dirname, "..", "..", "..");
const MODELS = join(__dirname, "..", "..", "public", "models");
const manifest = JSON.parse(readFileSync(join(MODELS, "manifest.json"), "utf8")) as ModelManifest;
const shipped = JSON.parse(readFileSync(join(repo, "content", "old_coast", "buildings.json"), "utf8")) as (ContentBuilding & { footprint: [number, number] })[];
const defs = new Map<string, ContentBuilding>(shipped.map((b) => [b.id, { ...b, width: b.footprint[0], height: b.footprint[1] } as ContentBuilding]));
const fixture = (name: string) => (JSON.parse(readFileSync(join(repo, "server", "testdata", "display", `${name}.json`), "utf8")) as { base: DisplayState }).base;

/** The far budget at the zoom cap (D-048). */
const FAR_BUDGET = 250_000;
const CAP_HALF = 120;
/** Desktop 1280 × 800 and phone 390 × 844 (the shots' devices). */
const DEVICES = { desktop: 1280 / 800, phone: 390 / 844 } as const;
/** Sea, haze, landmarks and the selection: a few hundred triangles. */
const SCENERY_TRIS = 1_000;

const engine = new NullEngine();
afterAll(() => engine.dispose());

function registry(scene: Scene): ModelRegistry {
  return new ModelRegistry(scene, {
    fetch: (url) => {
      const path = url.endsWith("manifest.json") ? "manifest.json" : (url.replace("/models/", "").split("?")[0] as string);
      return Promise.resolve(new Response(new Uint8Array(readFileSync(join(MODELS, path))), { status: 200 }));
    },
    parse: (bytes, s): Promise<ModelData> => parseGlb(bytes, s),
  });
}

async function loaded(reg: ModelRegistry): Promise<void> {
  for (let i = 0; i < 2000 && (reg.status().pending.length > 0 || !reg.status().manifest); i++) await new Promise((r) => setTimeout(r, 5));
}

/** The island's tiles from its mask, terraced by distance from the coast (stand-in relief, see above). */
function maskIsland(is: IslandDisplay): Island {
  const terrain = maskTerrain(decodeMask(is.terrain_mask, is.width, is.height), is.width, is.height) as Terrain[];
  const { width: w, height: h } = is;
  // Chebyshev distance to water (two passes).
  const d = new Int32Array(w * h).fill(1 << 20);
  for (let k = 0; k < w * h; k++) if (terrain[k] === "water") d[k] = 0;
  const relax = (k: number, n: number) => {
    if (n >= 0 && n < w * h) d[k] = Math.min(d[k] as number, (d[n] as number) + 1);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1], [1, -1]] as const) if (x + dx >= 0 && x + dx < w && y + dy >= 0) relax(y * w + x, (y + dy) * w + x + dx);
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) if (x + dx >= 0 && x + dx < w && y + dy < h) relax(y * w + x, (y + dy) * w + x + dx);
  let levels = "";
  let heights = "";
  for (let k = 0; k < w * h; k++) {
    const dist = d[k] as number;
    const land = terrain[k] !== "water" && terrain[k] !== "coast";
    levels += land ? String(Math.min(2, Math.floor(dist / 10))) : "0";
    heights += terrain[k] === "mountain" ? "1" : "0";
  }
  return { id: is.id, width: w, height: h, revision: "farbudget", terrain, levels, heights, fertilities: [], deposits: [] };
}

interface Estimate {
  models_lite: number;
  fields: number;
  shadows: number;
  far_trees: number;
  terrain: number;
  ships: number;
  scenery: number;
}

const total = (e: Estimate) => Object.values(e).reduce((a, b) => a + b, 0);

/**
 * The far view's triangles with the camera at the cap on the island `focus`
 * (its centre, every 45° heading; the worst) on a device of `aspect`.
 */
async function estimate(state: DisplayState, focus: IslandDisplay, aspect: number): Promise<Estimate> {
  const scene = new Scene(engine);
  const reg = registry(scene);
  await reg.loadManifest();
  // The focused island's lite models; the fields drawn with them (none: patches in the ground).
  const layer = new BuildingLayer(scene, null, reg);
  layer.update(focus.buildings, defs);
  await loaded(reg);
  layer.refresh();
  const models = layer.chunkTriangles();
  const noFields = new BuildingLayer(scene, null, reg);
  noFields.update(
    focus.buildings.filter((b) => !defs.get(b.type)?.field),
    defs,
  );
  noFields.refresh();
  const fields = models - noFields.chunkTriangles();
  const blobs = focus.buildings.filter((b) => !defs.get(b.type)?.field).length * FAR_SHADOW_TRIS;
  // Far trees: a forest on every land tile, thinned to the island's budget.
  const island = maskIsland(focus);
  const forest: Placed[] = [];
  for (let k = 0; k < island.width * island.height; k++) {
    if (island.terrain[k] === "water") continue;
    for (let i = 0; i < 3; i++) forest.push({ x: (k % island.width) + 0.2 + i * 0.3, y: Math.floor(k / island.width) + 0.5, variant: (k + i) % 4, scale: 1, yaw: k * 0.7 });
  }
  const trees = new FarTrees(scene, "budget", null, new StandardMaterial("budget", scene));
  trees.setTrees(forest);
  const farTrees = trees.triangles();
  // Terrain: the focused island's lite (or coarse) terrain and the other islands' masks in view.
  const node = new TransformNode("budget", scene);
  const terrain = buildTerrain(scene, island, coastline(island), 7, () => node);
  terrain.setCoarse(models > FAR_TOWN_TRIS);
  const lite = terrain.lite.reduce((n, m) => n + m.getTotalIndices() / 3, 0);
  const centre = { x: focus.position.x + focus.width / 2, y: focus.position.y + focus.height / 2 };
  let masks = 0;
  const maskTris = new Map<string, number>();
  for (let r = 0; r < 4; r += 0.5) {
    const view = groundFootprint({ x: centre.x, y: centre.y, half: CAP_HALF, rotation: r }, aspect);
    let sum = 0;
    for (const id of visibleIslands(state.islands, view)) {
      if (id === focus.id) continue;
      const is = state.islands.find((i) => i.id === id) as IslandDisplay;
      let n = maskTris.get(id);
      if (n === undefined) maskTris.set(id, (n = maskMeshData(decodeMask(is.terrain_mask, is.width, is.height), islandSeed(id, "farbudget")).indices.length / 3));
      sum += n;
    }
    masks = Math.max(masks, sum);
  }
  const ships = state.ships.reduce((n, s) => n + (manifest.models[s.type]?.file?.triangles ?? 0), 0);
  scene.dispose();
  return {
    models_lite: models,
    fields,
    shadows: blobs,
    far_trees: farTrees,
    terrain: Math.max(MASK_TRIS, lite + masks),
    ships,
    scenery: SCENERY_TRIS,
  };
}

/** The settled island with the most buildings. */
function largest(state: DisplayState): IslandDisplay {
  return [...state.islands].sort((a, b) => b.buildings.length - a.buildings.length)[0] as IslandDisplay;
}

/** A synthetic town on `is`: 120 buildings, 600 field tiles and 200 tree plots on its land tiles. */
function syntheticTown(is: IslandDisplay): IslandDisplay {
  const island = maskIsland(is);
  const land: { x: number; y: number }[] = [];
  for (let y = 0; y < is.height; y += 3) for (let x = 0; x < is.width; x += 3) if (island.terrain[y * is.width + x] === "grass") land.push({ x, y });
  const kinds = ["house_settlers", "house_citizens", "house_merchants", "sawmill", "lumberjack", "wheat_farm", "bakery", "warehouse"];
  const buildings: BuildingDisplay[] = [];
  let id = 1;
  const place = (type: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const at = land[id % land.length] as { x: number; y: number };
      buildings.push({ id, type, x: at.x, y: at.y, rotation: 0, paused: false, paused_reason: "", status: "ok" } as BuildingDisplay);
      id++;
    }
  };
  for (let i = 0; i < 120; i++) place(kinds[i % kinds.length] as string, 1);
  place("wheat_field", 600);
  place("tree_plot", 200);
  return { ...is, buildings };
}

describe("far budget at the zoom cap (D-048)", () => {
  const state = fixture("bootstrap_patricians");
  const big = largest(state);
  const cases: [string, IslandDisplay][] = [
    [`${big.id} of bootstrap_patricians (${big.buildings.length} buildings)`, big],
    ["a synthetic town (120 buildings, 600 field tiles, 200 tree plots)", syntheticTown(big)],
  ];
  for (const [name, focus] of cases) {
    for (const [device, aspect] of Object.entries(DEVICES)) {
      it(`${name} on ${device}: ≤ ${FAR_BUDGET} triangles, fields painted, trees capped`, async () => {
        const e = await estimate(state, focus, aspect);
        expect(e.fields).toBe(0);
        expect(e.far_trees).toBeLessThanOrEqual(FAR_TREE_TRIS);
        expect(e.models_lite).toBeGreaterThan(0);
        expect(total(e), JSON.stringify(e)).toBeLessThanOrEqual(FAR_BUDGET);
      }, 60_000);
    }
  }
});
