// Placement ghost of the build, move and found tools (UI.md §3): the
// building's real model (the full tier; the moved building's own variant
// or level) drawn translucent and tinted by validity — neutral, yellow
// ("not connected") or red (the server would reject it) — at the tool's
// rotation. A depth pre-pass keeps the translucent model clean (only its
// front surface shows). Content IDs without a model, and models still
// loading, keep the box ghost of the footprint. Fields and roads have
// their own previews. Purely visual, never pickable.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding } from "../api/client";
import type { ArchPoint } from "../display/ships";
import { type Rotation, rotatedFootprint } from "../display/geometry";
import { skyFill } from "./lighting";
import { GHOST, WATER_ROWS } from "./palette";
import { modelFileFor, modelMesh, type ModelRegistry, placement, worldData } from "./models";

/** Opacity of the box ghost and of the model ghost. */
const BOX_ALPHA = 0.45;
const MODEL_ALPHA = 0.7;
/**
 * Share of the validity colour in the model ghost's diffuse (multiplies
 * the vertex colours) and its emissive lift: light for the neutral ghost
 * (the model keeps its own colours), strong for yellow and red so the
 * warning reads at a glance.
 */
const TINT = { neutral: 0.25, warn: 0.75 };
const LIFT = { neutral: 0.12, warn: 0.42 };

/** Opacity and height (above the ground plane) of the water-rows strip of a water-edge ghost. */
const WATER_ROWS_ALPHA = 0.55;
const WATER_ROWS_Y = 0.03;

/** What the ghost shows: the building at a tile of an island, its rotation and (move tool) the building ID. */
export interface GhostSpec {
  /**
   * Water rows of a water-edge building (D-051, island tiles): drawn as a
   * light strip under the pier part so the player sees which rows must
   * stand on the sea.
   */
  waterRows?: { x: number; y: number; w: number; h: number } | null;
  def: ContentBuilding;
  /** Archipelago position of the island's tile (0, 0). */
  island: ArchPoint;
  x: number;
  y: number;
  rotation: Rotation;
  /** The moved building (its variant or level); undefined: a new one (a fixed variant, level 1). */
  buildingId?: number;
  level?: number;
}

/** Diffuse multiplier and emissive lift of a validity colour on a model ghost (GHOST is the neutral one). */
export function ghostTint(color: Color3): { diffuse: Color3; emissive: Color3 } {
  const k = color.equals(GHOST) ? "neutral" : "warn";
  return { diffuse: Color3.White().scale(1 - TINT[k]).add(color.scale(TINT[k])), emissive: color.scale(LIFT[k]) };
}

export class PlacementGhost {
  private readonly box: Mesh;
  private readonly boxMaterial: StandardMaterial;
  private readonly modelMaterial: StandardMaterial;
  /** Ghost meshes per model file path (built once, enabled while shown). */
  private readonly models = new Map<string, Mesh>();
  private shown: Mesh | null = null;
  private color: Color3 | null = null;
  private readonly water: Mesh;
  private waterShown: { x: number; y: number; w: number; h: number } | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly registry: ModelRegistry | null,
  ) {
    this.box = CreateBox("ghost", { size: 1 }, scene);
    this.boxMaterial = skyFill(new StandardMaterial("ghost", scene));
    this.boxMaterial.alpha = BOX_ALPHA;
    this.box.material = this.boxMaterial;
    this.box.isPickable = false;
    this.box.setEnabled(false);
    this.modelMaterial = skyFill(new StandardMaterial("ghost_model", scene));
    this.modelMaterial.specularColor = Color3.Black();
    this.modelMaterial.alpha = MODEL_ALPHA;
    this.modelMaterial.needDepthPrePass = true;
    this.water = CreateBox("ghost_water_rows", { size: 1 }, scene);
    const wm = skyFill(new StandardMaterial("ghost_water_rows", scene));
    wm.diffuseColor = WATER_ROWS;
    wm.emissiveColor = WATER_ROWS.scale(0.5);
    wm.alpha = WATER_ROWS_ALPHA;
    this.water.material = wm;
    this.water.isPickable = false;
    this.water.setEnabled(false);
  }

  /** Shows the ghost of a building at a tile, tinted by a validity colour. */
  show(spec: GhostSpec, color: Color3): void {
    const mesh = this.modelFor(spec);
    if (this.shown && this.shown !== mesh) this.shown.setEnabled(false);
    this.shown = mesh ?? this.box;
    if (color !== this.color) {
      this.color = color;
      this.boxMaterial.diffuseColor = color;
      const t = ghostTint(color);
      this.modelMaterial.diffuseColor = t.diffuse;
      this.modelMaterial.emissiveColor = t.emissive;
    }
    if (mesh) {
      const entry = this.registry?.entry(spec.def.id);
      if (!entry) return;
      const p = placement(entry, spec.def, { x: spec.x, y: spec.y, rotation: spec.rotation });
      mesh.position.set(spec.island.x + p.cx, 0, -spec.island.y + p.cz);
      mesh.rotation.y = p.yaw;
      mesh.scaling.set(p.sx, 1, p.sz);
    } else {
      const [w, h] = rotatedFootprint(spec.def.width, spec.def.height, spec.rotation);
      this.box.scaling.set(w, 0.6, h);
      this.box.position.set(spec.island.x + spec.x + w / 2, 0.3, -(spec.island.y + spec.y + h / 2));
    }
    this.shown.setEnabled(true);
    const rows = spec.waterRows ?? null;
    this.waterShown = rows ? { x: rows.x, y: rows.y, w: rows.w, h: rows.h } : null;
    if (rows) {
      this.water.scaling.set(rows.w, 0.04, rows.h);
      this.water.position.set(spec.island.x + rows.x + rows.w / 2, WATER_ROWS_Y, -(spec.island.y + rows.y + rows.h / 2));
    }
    this.water.setEnabled(rows !== null);
  }

  hide(): void {
    this.shown?.setEnabled(false);
    this.shown = null;
    this.water.setEnabled(false);
    this.waterShown = null;
  }

  /** The water rows the ghost highlights (island tiles; null: none or hidden; tests). */
  waterRows(): { x: number; y: number; w: number; h: number } | null {
    return this.waterShown;
  }

  /** What is drawn: "model", "box" or null (hidden; tests). */
  kind(): "model" | "box" | null {
    if (!this.shown) return null;
    return this.shown === this.box ? "box" : "model";
  }

  /** The ghost mesh of a building's full model, or null (no model, or still loading: the request starts it). */
  private modelFor(spec: GhostSpec): Mesh | null {
    const entry = this.registry?.entry(spec.def.id);
    if (!entry || entry.kind !== "building" || !this.registry) return null;
    const file = modelFileFor(entry, { id: spec.buildingId ?? 0, level: spec.level ?? 1 });
    if (!file) return null;
    let mesh = this.models.get(file.path);
    if (mesh) return mesh;
    const data = this.registry.request(file);
    if (!data) return null;
    mesh = modelMesh(this.scene, `ghost_${file.path}`, worldData("building", data), this.modelMaterial);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    this.models.set(file.path, mesh);
    return mesh;
  }
}
