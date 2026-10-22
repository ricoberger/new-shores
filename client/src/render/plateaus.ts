// Mountains as plateaus (restyle diorama), visual only: the island's
// mountain tiles rise in one step (and the tiles deep inside a mountain
// range in a second one), each step a flat rocky top with the slab's
// layered cliff profile down to the level below. The rules do not change
// (D-036): roads never go on mountains, and a building that covers
// mountain tiles (a mine or a quarry on its deposit) keeps them at ground
// level — they are cut out of the plateau, so the building stands in a
// notch. Rebuilt with the layout (building footprints); shown at near and
// mid LOD under the island root. One merged mesh per island.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Island } from "../api/client";
import { chaikin, marchingSquares, traceLoops } from "../display/coastline";
import { ISLAND, TERRAIN } from "../theme/palette";
import { skyFill } from "./lighting";
import { c3 } from "./palette";
import { Builder, fillCell, groundColor, type ProfileRing, slabStrip } from "./terrain";

/** Height (tiles) of one plateau step. */
export const PLATEAU_STEP = 0.42;

const MOUNTAIN = c3(TERRAIN.mountain);
const ROCK_RIM = Color3.Lerp(MOUNTAIN, c3(ISLAND.cliff_upper), 0.35);

/** Cliff profile of one step from its top (h1) down to the level below (h0): a rounded lip, an upper band, a ledge and a lower band. */
function stepProfile(h0: number, h1: number): ProfileRing[] {
  const d = h1 - h0;
  return [
    { out: -0.12, y: h1, color: MOUNTAIN.scale(1.02), jitter: 0 },
    { out: 0, y: h1, color: ROCK_RIM, jitter: 0 },
    { out: 0.05, y: h1 - 0.12 * d, color: ROCK_RIM.scale(0.92), jitter: 0 },
    { out: 0.08, y: h1 - 0.45 * d, color: Color3.Lerp(MOUNTAIN, c3(ISLAND.cliff_ledge), 0.5), jitter: 0.06 * d },
    { out: 0.15, y: h1 - 0.52 * d, color: Color3.Lerp(MOUNTAIN, c3(ISLAND.cliff_ledge), 0.5).scale(1.06), jitter: 0.06 * d },
    { out: 0.18, y: h1 - 0.6 * d, color: Color3.Lerp(MOUNTAIN, c3(ISLAND.cliff_lower), 0.5), jitter: 0.04 * d },
    { out: 0.22, y: h0 + 0.12 * d, color: Color3.Lerp(MOUNTAIN, c3(ISLAND.cliff_lower), 0.5).scale(0.82), jitter: 0 },
    { out: 0.28, y: h0 - 0.02, color: c3(ISLAND.cliff_foot).scale(1.4), jitter: 0 },
  ];
}

/**
 * Plateau level of every tile (0: ground, 1, 2), row-major: mountain
 * tiles outside `blocked` ("x,y" keys) are level 1, and level 2 where all
 * eight neighbours are level 1 too.
 */
export function plateauLevels(island: Pick<Island, "width" | "height" | "terrain">, blocked: ReadonlySet<string>): Uint8Array {
  const { width, height, terrain } = island;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (terrain[y * width + x] === "mountain" && !blocked.has(`${x},${y}`)) out[y * width + x] = 1;
  }
  const one = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && out[y * width + x]! >= 1;
  const two: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!one(x, y)) continue;
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!one(x + dx, y + dy)) all = false;
      if (all) two.push(y * width + x);
    }
  }
  for (const i of two) out[i] = 2;
  return out;
}

/** Ground height (tiles) of a tile under the plateaus. */
export function plateauHeight(levels: Uint8Array, width: number, x: number, y: number): number {
  return (levels[y * width + x] ?? 0) * PLATEAU_STEP;
}

export class PlateauLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private key = "";
  private levelsData: Uint8Array = new Uint8Array(0);
  private width = 0;

  constructor(
    private readonly scene: Scene,
    private readonly parent: TransformNode | null,
  ) {
    this.material = skyFill(new StandardMaterial("plateaus", scene));
    this.material.specularColor = Color3.Black();
    this.material.backFaceCulling = false;
  }

  /** Rebuilds the plateaus of an island with the tiles kept at ground level (building footprints). */
  update(island: Island, seed: number, blocked: ReadonlySet<string>): void {
    const levels = plateauLevels(island, blocked);
    const key = `${island.id}|${island.revision}|${Array.from(levels).join("")}`;
    this.levelsData = levels;
    this.width = island.width;
    if (key === this.key) return;
    this.key = key;
    this.mesh?.dispose();
    this.mesh = null;
    const { width, height, terrain } = island;
    const b = new Builder();
    for (const level of [1, 2]) {
      const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && levels[y * width + x]! >= level;
      const h1 = level * PLATEAU_STEP;
      const h0 = (level - 1) * PLATEAU_STEP;
      const top = (x: number, y: number) => groundColor(terrain[y * width + x] as Island["terrain"][number], x, y, seed + level).scale(1 + 0.04 * level);
      for (let j = -1; j < height; j++) for (let i = -1; i < width; i++) fillCell(b, inside, top, ROCK_RIM, i, j, h1);
      const loops = traceLoops(marchingSquares(width, height, inside)).map((l) => chaikin(l, 2));
      const profile = stepProfile(h0, h1);
      for (const loop of loops) slabStrip(b, loop, seed + 31 * level, (c) => c, profile, 2);
    }
    this.mesh = b.mesh(`plateaus_${island.id}`, this.scene, this.material, this.parent);
  }

  /** Ground height (tiles) at a tile (0 off the plateaus). */
  heightAt(x: number, y: number): number {
    if (this.width === 0) return 0;
    return plateauHeight(this.levelsData, this.width, x, y);
  }

  /** The plateau mesh (sun shadow casters), if any. */
  meshes(): Mesh[] {
    return this.mesh ? [this.mesh] : [];
  }
}
