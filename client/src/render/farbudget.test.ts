import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it } from "vitest";
import { type ContentBuilding, type IslandDisplay, islandStatics, type IslandTiles } from "../api/client";
import { groundFootprint } from "../display/camera";
import { focusedIsland, islandRect, rectQuadOverlap, visibleIslands } from "../display/frustum";
import { decodeMask } from "../display/mask";
import { islandSeed } from "../display/scatter";
import type { ArchPoint } from "../display/ships";
import { allocateFarTerrain, FAR_SCENERY_TRIS, FAR_TRIS, type MaskIsland, MaskLayer, reliefOrder } from "./farmesh";
import { IslandDetail } from "./island";
import { type ModelData, type ModelManifest, ModelRegistry, parseGlb } from "./models";

// Far-view budget guard (D-048, D-057 §5; ARCHITECTURE §5a): at the zoom
// cap (max_half_extent 120) the far LOD must stay within 250 k triangles
// on desktop and phone. For the `make shots` fixtures settled, patricians
// and played (testdata/farbudget, captured from the dev server with
// capture.ts: display and every island's tiles) it builds the islands as
// the renderer does (IslandDetail with the committed models, headless),
// runs the renderer's far terrain allocation (farmesh.ts
// allocateFarTerrain, MaskLayer) for the camera at the cap over the
// archipelago's centre (the shots' far view, focused on the home island)
// at every 45° heading, and checks the triangles drawn per layer:
//
//   models_lite, far_trees, blob_buildings_far   the home island (fixed)
//   ships                                        the fleet's models
//   terrain_lite                                 fine or coarse (allocation)
//   mask_terrain                                 neighbours: outlines + relief
//   scenery                                      sea, haze, landmarks
//
// and the allocation: the home island always in relief; on settled and
// patricians in the shots' view (heading 0) at its fine lite terrain with
// every island in view in relief (other headings see more islands: the
// farther ones may fall back to their outline there).

const repo = join(__dirname, "..", "..", "..");
const MODELS = join(__dirname, "..", "..", "public", "models");
const manifest = JSON.parse(readFileSync(join(MODELS, "manifest.json"), "utf8")) as ModelManifest;
const shipped = JSON.parse(readFileSync(join(repo, "content", "old_coast", "buildings.json"), "utf8")) as (ContentBuilding & { footprint: [number, number] })[];
const defs = new Map<string, ContentBuilding>(shipped.map((b) => [b.id, { ...b, width: b.footprint[0], height: b.footprint[1] } as ContentBuilding]));

interface Fixture {
  archipelago: { seed: number; roll: number };
  islands: IslandDisplay[];
  ships: { id: number; type: string }[];
  tiles: Record<string, IslandTiles>;
}
const load = (name: string) => JSON.parse(gunzipSync(readFileSync(join(__dirname, "testdata", "farbudget", `${name}.json.gz`))).toString("utf8")) as Fixture;

const CAP_HALF = 120;
/** Desktop 1280 × 800 and phone 390 × 844 (the shots' devices). */
const DEVICES = { desktop: 1280 / 800, phone: 390 / 844 } as const;
const HOME = "isle-01";

/** Canvas stand-in for the dynamic textures (foam, field patterns, status icons): drawing is a no-op. */
class FakeCanvas {
  constructor(
    public width = 1,
    public height = 1,
  ) {}
  getContext(): unknown {
    return new Proxy(
      { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) },
      { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => undefined), set: () => true },
    );
  }
}
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ??= FakeCanvas;

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
  for (let i = 0; i < 4000 && (reg.status().pending.length > 0 || !reg.status().manifest); i++) await new Promise((r) => setTimeout(r, 5));
}

interface View {
  device: string;
  rotation: number;
  /** Triangles per layer. */
  layers: Record<string, number>;
  total: number;
  /** The home island's terrain and the islands in view with their relief / outline. */
  home: "lite" | "coarse";
  relief: string[];
  outline: string[];
}

/** The far views at the cap on the home island of a fixture (every device and 45° heading). */
async function farViews(name: string): Promise<View[]> {
  const fx = load(name);
  const scene = new Scene(engine);
  const reg = registry(scene);
  await reg.loadManifest();
  // The archipelago's centre (shots.ts showArchipelago); the camera there focuses the home island.
  const centre = {
    x: (Math.min(...fx.islands.map((i) => i.position.x)) + Math.max(...fx.islands.map((i) => i.position.x + i.width))) / 2,
    y: (Math.min(...fx.islands.map((i) => i.position.y)) + Math.max(...fx.islands.map((i) => i.position.y + i.height))) / 2,
  };
  expect(focusedIsland(fx.islands, centre)).toBe(HOME);
  const views: { device: string; aspect: number; rotation: number; footprint: ArchPoint[]; ids: string[] }[] = [];
  for (const [device, aspect] of Object.entries(DEVICES)) {
    for (let rotation = 0; rotation < 4; rotation += 0.5) {
      const footprint = groundFootprint({ ...centre, half: CAP_HALF, rotation }, aspect);
      views.push({ device, aspect, rotation, footprint, ids: visibleIslands(fx.islands, footprint) });
    }
  }
  // Every island in some view, built as the renderer builds it.
  const details = new Map<string, IslandDetail>();
  for (const id of new Set(views.flatMap((v) => v.ids))) {
    const is = fx.islands.find((i) => i.id === id) as IslandDisplay;
    const d = new IslandDetail(scene, id, is.position, reg);
    d.setStatics(islandStatics(fx.tiles[id] as IslandTiles, is));
    d.update(is, defs);
    details.set(id, d);
  }
  await loaded(reg);
  for (const d of details.values()) d.refreshModels();
  // The decor models the refresh asked for (tree crowns).
  await loaded(reg);
  for (const d of details.values()) {
    d.refreshModels();
    d.setShown(true, "far");
    d.setDetail("lite");
  }
  const homeDetail = details.get(HOME) as IslandDetail;
  const fleet = fx.ships.reduce((n, s) => n + (manifest.models[s.type]?.file?.triangles ?? 0), 0);
  const key = `${fx.archipelago.seed}/${fx.archipelago.roll}`;
  const out: View[] = [];
  for (const v of views) {
    const layer = new MaskLayer(scene);
    // The renderer's relief order (engine.ts applyView): on-screen area, largest first, ties nearest.
    const masked: MaskIsland[] = reliefOrder(
      v.ids
        .filter((id) => id !== HOME)
        .map((id) => fx.islands.find((i) => i.id === id) as IslandDisplay)
        .map((is) => ({
          id: is.id,
          position: is.position,
          mask: decodeMask(is.terrain_mask, is.width, is.height),
          seed: islandSeed(is.id, key),
          tiles: details.get(is.id)?.farTerrain() ?? null,
          area: rectQuadOverlap(islandRect(is), v.footprint),
          dist: Math.hypot(is.position.x + is.width / 2 - centre.x, is.position.y + is.height / 2 - centre.y),
        })),
    );
    const rest = allocateFarTerrain([homeDetail], layer.outlineTriangles(masked), fleet);
    layer.show(masked, rest);
    const fixed = homeDetail.farFixedCost();
    const layers = {
      models_lite: fixed.models,
      far_trees: fixed.trees,
      blob_buildings_far: fixed.shadows,
      ships: fleet,
      terrain_lite: homeDetail.liteTerrainTriangles(),
      mask_terrain: layer.triangles(),
      scenery: FAR_SCENERY_TRIS,
    };
    const relief = layer.tiled();
    out.push({
      device: v.device,
      rotation: v.rotation,
      layers,
      total: Object.values(layers).reduce((a, b) => a + b, 0),
      home: homeDetail.liteTerrainTriangles() === homeDetail.fineTerrainTriangles() ? "lite" : "coarse",
      relief,
      outline: masked.map((m) => m.id).filter((id) => !relief.includes(id)),
    });
  }
  scene.dispose();
  return out;
}

describe("far budget at the zoom cap (D-048)", () => {
  for (const name of ["settled", "patricians", "played"] as const) {
    it(`${name}: ≤ ${FAR_TRIS} triangles on desktop and phone at every heading, the home island in relief${name === "played" ? "" : ", every island in view in relief"}`, async () => {
      const views = await farViews(name);
      for (const v of views) {
        const at = `${name} ${v.device} rotation ${v.rotation}: ${JSON.stringify(v)}`;
        expect(v.total, at).toBeLessThanOrEqual(FAR_TRIS);
        expect(v.layers.terrain_lite, at).toBeGreaterThan(0);
        if (name !== "played" && v.rotation === 0) {
          expect(v.home, at).toBe("lite");
          expect(v.outline, at).toEqual([]);
        }
      }
      // The models are the committed ones (not placeholders): the town is in the estimate.
      expect(views[0]!.layers.models_lite).toBeGreaterThan(0);
    }, 120_000);
  }
});
