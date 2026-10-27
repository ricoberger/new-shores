// Landmarks (far view): the Trading Post and the shipyards of the settled
// islands drawn from their mask mesh (render/farmesh.ts: every island but
// the focused one at far LOD) — their lite models on the mask's ground, so
// the settled islands of the archipelago view read as settled. All of them
// are merged into one static mesh (one draw call), rebuilt only when the
// set of landmarks or their loaded models change. Render data only.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding } from "../api/client";
import type { Lod } from "../display/lod";
import { buildingData, mergeItems } from "./buildings";
import { skyFill } from "./lighting";
import { atDetail, type ModelData, type ModelRegistry, modelFileFor, placement } from "./models";

/** A mask-drawn island whose landmarks are drawn. */
export interface LandmarkIsland {
  id: string;
  /** Archipelago position of the island's tile (0, 0). */
  position: { x: number; y: number };
  buildings: readonly BuildingDisplay[];
}

/** Whether an island's landmarks are drawn: a settled island drawn from its mask at far LOD, not the focused one (that one has its detail). */
export function showsLandmarks(is: { id: string; settled: boolean }, lod: Lod, focus: string | null, masked: boolean): boolean {
  return masked && lod === "far" && is.settled && is.id !== focus;
}

/** Whether a building is a landmark of the far view: a Trading Post or a shipyard. */
export function isLandmark(def: ContentBuilding | undefined): boolean {
  return def?.trading_post !== undefined || def?.shipyard !== undefined;
}

const WHITE = [1, 1, 1, 1] as const;

/** The merged landmark mesh of the mask-drawn settled islands. */
export class LandmarkLayer {
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private key = "";
  private last: { islands: readonly LandmarkIsland[]; defs: ReadonlyMap<string, ContentBuilding> } = { islands: [], defs: new Map() };
  private count = 0;

  constructor(
    private readonly scene: Scene,
    private readonly registry: ModelRegistry | null,
  ) {
    this.material = skyFill(new StandardMaterial("landmarks", scene));
    this.material.specularColor = Color3.Black();
  }

  /** Draws the landmarks of exactly these islands (their lite models; a model still loading is left out until refresh()). */
  show(islands: readonly LandmarkIsland[], defs: ReadonlyMap<string, ContentBuilding>): void {
    this.last = { islands, defs };
    const items: { data: ModelData; cx: number; cz: number; yaw: number; sx: number; sz: number; tint: readonly number[] }[] = [];
    const keys: string[] = [];
    for (const is of islands) {
      for (const b of is.buildings) {
        const def = defs.get(b.type);
        if (!def || !isLandmark(def)) continue;
        const entry = this.registry?.entry(b.type);
        const main = entry && modelFileFor(entry, b);
        if (!entry || !main) continue;
        const file = atDetail(main, "lite");
        const data = this.registry?.request(file);
        if (!data) continue;
        const p = placement(entry, def, b);
        items.push({ data: buildingData(data), cx: p.cx + is.position.x, cz: p.cz - is.position.y, yaw: p.yaw, sx: p.sx, sz: p.sz, tint: WHITE });
        keys.push(`${is.id}@${is.position.x},${is.position.y}:${b.id}:${file.path}:${b.x},${b.y},${b.rotation}`);
      }
    }
    const key = keys.join(";");
    if (key === this.key) return;
    this.key = key;
    this.count = items.length;
    this.mesh?.dispose();
    this.mesh = null;
    if (items.length === 0) return;
    const mesh = new Mesh("landmarks", this.scene);
    mergeItems(items).applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    this.mesh = mesh;
  }

  /** Redraws with the last input (models that finished loading join). */
  refresh(): void {
    this.show(this.last.islands, this.last.defs);
  }

  /** Landmarks drawn (tests and stats). */
  drawn(): number {
    return this.count;
  }

  /** Triangles of the merged mesh. */
  triangles(): number {
    return this.mesh ? (this.mesh.getTotalIndices() / 3) | 0 : 0;
  }
}
