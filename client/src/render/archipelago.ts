// World layers of the continuous world (D-048): the sea with a haze toward
// its edges, the far-LOD island silhouettes and landmark markers
// (warehouses, shipyards), and at every LOD the ships, route ribbons with
// direction arrows and the selection ring. Scene coordinates are
// archipelago coordinates (tile (x, y) is world (x, 0, −y); archipelago
// tiles equal island tiles). Everything is a view of the display payload
// (D-027): ship positions are lerps of server leg timestamps between the
// islands' harbour berths.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, IslandDisplay, RouteDisplay, ShipDisplay, Terrain } from "../api/client";
import type { Rect } from "../display/camera";
import type { Lod } from "../display/lod";
import type { Quality } from "../display/quality";
import { anchorSlots, type ArchPoint, berthAnchor, type Berths, islandAnchor, type IslandPlacement, shipPlacement } from "../display/ships";
import { footprintBox } from "./coords";
import { BlobLayer, blobMatrix } from "./shadows";
import { Sea } from "./water";
import { buildIslandMeshes, FAR_PROFILE, type GroundColors, SEA_LEVEL as TERRAIN_SEA_LEVEL } from "./terrain";
import { coastline } from "../display/coastline";
import { islandSeed } from "../display/scatter";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ColoredInstances, shipColor, shipMatrix, type ShipStyle, shipTemplate } from "./shipmesh";
import { type ModelRegistry, shipMeshes, shipModel } from "./models";
import { ARROW_BRIGHT, ARROW_DIM, colorTuple, DRAFT_COLOR, HAZE, ROUTE_COLORS, SELECTION, TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";
import { BUILDINGS } from "../theme/palette";
import { skyFill } from "./lighting";

/** Top of the far-LOD silhouettes: the islands' ground (the same slab as near LOD). */
const SILHOUETTE_TOP = 0;
/** Height of the sea surface (the islands' slabs drop into it). */
export const SEA_LEVEL = TERRAIN_SEA_LEVEL;
/** Ships above the far-LOD silhouettes; at near/mid on the water. */
const SHIP_Y_FAR = SILHOUETTE_TOP + 0.05;
const SHIP_Y = 0;
/** Ship instance scale at near/mid LOD and at far LOD (≥ 1.5×, so ships stay visible zoomed out). */
export const SHIP_SCALE = 2;
export const SHIP_SCALE_FAR = 4;
const ROUTE_Y = SILHOUETTE_TOP + 0.25;
const ROUTE_WIDTH = 0.8;
/** The haze starts this far (tiles) outside the islands' bounding box. */
const HAZE_INNER = 30;
const LANDMARK_SIZE = 3;
const LANDMARK_WAREHOUSE = colorTuple(BUILDINGS.ochre);
const LANDMARK_SHIPYARD = colorTuple(BUILDINGS.terracotta);


export type ArchSelection = { kind: "none" } | { kind: "island"; id: string } | { kind: "ship"; id: number };

/** Unsettled islands: the colours, desaturated. */
function desaturate(c: Color3, settled: boolean): Color3 {
  if (settled) return c;
  const grey = (c.r + c.g + c.b) / 3;
  return new Color3(c.r * 0.3 + grey * 0.7, c.g * 0.3 + grey * 0.7, c.b * 0.3 + grey * 0.7);
}

/** Far-LOD colours: flat terrain colours on the same slab as near LOD, desaturated for unsettled islands. */
function silhouetteColors(settled: boolean): GroundColors {
  return {
    tile: (t: Terrain | undefined) => desaturate((t && TERRAIN_COLORS[t]) || UNKNOWN_TERRAIN, settled),
    slab: (c: Color3) => desaturate(c, settled),
  };
}

/** The far-LOD silhouette of an island: the near terrain's ground fill and diorama slab with flat colours, one mesh per chunk. */
function buildSilhouette(scene: Scene, island: Island, settled: boolean, material: StandardMaterial, seed: number, parent: TransformNode): Mesh[] {
  return buildIslandMeshes(scene, island, coastline(island, 1), seed, silhouetteColors(settled), material, parent, "silhouette", FAR_PROFILE);
}

interface Silhouette {
  node: TransformNode;
  meshes: Mesh[];
  key: string;
}

interface RouteLine {
  mesh: Mesh;
  material: StandardMaterial;
  key: string;
  color: Color3;
}

/** A frame of quads from an inner to an outer rectangle, haze-coloured, transparent inside and opaque outside. */
function hazeFrame(scene: Scene): Mesh {
  const mesh = new Mesh("haze", scene);
  const mat = new StandardMaterial("haze", scene);
  mat.disableLighting = true;
  mat.diffuseColor = Color3.Black();
  mat.emissiveColor = HAZE;
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

function setHazeGeometry(mesh: Mesh, inner: Rect, outer: Rect, y: number): void {
  // Vertices 0–3 inner (alpha 0), 4–7 outer (alpha 1), corners in order.
  const corners = (r: Rect) => [r.minX, -r.minY, r.maxX, -r.minY, r.maxX, -r.maxY, r.minX, -r.maxY];
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const ci = corners(inner);
  const co = corners(outer);
  for (let i = 0; i < 4; i++) {
    positions.push(ci[i * 2] as number, y, ci[i * 2 + 1] as number);
    colors.push(1, 1, 1, 0);
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < 4; i++) {
    positions.push(co[i * 2] as number, y, co[i * 2 + 1] as number);
    colors.push(1, 1, 1, 1);
    normals.push(0, 1, 0);
  }
  const indices: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    indices.push(i, 4 + i, 4 + j, i, 4 + j, j);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.colors = colors;
  data.normals = normals;
  data.applyToMesh(mesh, true);
}

export class ArchipelagoLayer {
  private readonly silhouetteMaterial: StandardMaterial;
  private readonly silhouettes = new Map<string, Silhouette>();
  private readonly sea: Sea;
  private readonly haze: Mesh;
  /** Ship instances per type, with the cargo attachment where the model has one; model: the kit-bashed model (else the placeholder). */
  private readonly ships = new Map<string, { inst: ColoredInstances; cargo: ColoredInstances | null; model: boolean }>();
  private readonly arrows: ColoredInstances;
  private readonly landmarks: ColoredInstances;
  private readonly routeLines = new Map<string, RouteLine>();
  private readonly ring: Mesh;
  /** Blob shadows of the ships at near and mid LOD (matrices rewritten every frame). */
  private readonly shipBlobs: BlobLayer;
  private shipBlobBuffer = new Float32Array(0);
  private placements = new Map<string, IslandPlacement>();
  private islandList: IslandDisplay[] = [];
  private defs: ReadonlyMap<string, ContentBuilding> = new Map();
  private berths: Berths = new Map();
  private shipList: ShipDisplay[] = [];
  private routes: RouteDisplay[] = [];
  private draft: string[] | null = null;
  private highlight: number | null = null;
  private selection: ArchSelection = { kind: "none" };
  private lod: Lod = "near";
  private visible: ReadonlySet<string> = new Set();
  /** Positions (archipelago tiles) of the ships in the last frame. */
  private readonly shipPoints = new Map<number, ArchPoint>();
  /** Instance style of every ship drawn in the last frame. */
  private readonly shipStyles = new Map<number, ShipStyle>();
  private dragged: { shipId: number; point: ArchPoint } | null = null;
  private seaKey = "";
  private landKey = "";
  private seaMargin = 400;

  constructor(
    private readonly scene: Scene,
    private readonly registry: ModelRegistry | null = null,
  ) {
    this.silhouetteMaterial = skyFill(new StandardMaterial("silhouettes", scene));
    this.silhouetteMaterial.specularColor = Color3.Black();
    this.silhouetteMaterial.backFaceCulling = false;

    this.sea = new Sea(scene, SEA_LEVEL);
    this.haze = hazeFrame(scene);

    const arrow = CreateCylinder("route_arrows", { diameterTop: 0, diameterBottom: 1.6, height: 2.2, tessellation: 3 }, scene);
    // Point the cone along +X and flatten it onto the sea.
    arrow.bakeTransformIntoVertices(Matrix.Scaling(1, 1, 0.35).multiply(Matrix.RotationZ(-Math.PI / 2)));
    const arrowMat = new StandardMaterial("route_arrows", scene);
    arrowMat.disableLighting = true;
    arrowMat.emissiveColor = Color3.White();
    arrow.material = arrowMat;
    arrow.isPickable = false;
    arrow.alwaysSelectAsActiveMesh = true;
    this.arrows = new ColoredInstances(arrow);

    // Far-LOD landmarks: a simple tower per warehouse and shipyard.
    const tower = CreateBox("landmarks", { width: LANDMARK_SIZE, height: LANDMARK_SIZE, depth: LANDMARK_SIZE }, scene);
    tower.bakeTransformIntoVertices(Matrix.Translation(0, LANDMARK_SIZE / 2, 0));
    const towerMat = skyFill(new StandardMaterial("landmarks", scene));
    towerMat.specularColor = Color3.Black();
    tower.material = towerMat;
    tower.isPickable = false;
    tower.alwaysSelectAsActiveMesh = true;
    this.landmarks = new ColoredInstances(tower);

    this.shipBlobs = new BlobLayer(scene, "blob_ships", null, 0.45);
    this.shipBlobs.mesh.alwaysSelectAsActiveMesh = true;

    this.ring = CreateTorus("arch_selection", { diameter: 1, thickness: 0.06, tessellation: 32 }, scene);
    const ringMat = new StandardMaterial("arch_selection", scene);
    ringMat.disableLighting = true;
    ringMat.emissiveColor = SELECTION;
    this.ring.material = ringMat;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
  }

  /** Bounding box of all islands (archipelago tiles), or null without islands. */
  bounds(): Rect | null {
    let b: Rect | null = null;
    for (const p of this.placements.values()) {
      const r = { minX: p.position.x, maxX: p.position.x + p.width, minY: p.position.y, maxY: p.position.y + p.height };
      b = b
        ? { minX: Math.min(b.minX, r.minX), maxX: Math.max(b.maxX, r.maxX), minY: Math.min(b.minY, r.minY), maxY: Math.max(b.maxY, r.maxY) }
        : r;
    }
    return b;
  }

  placement(id: string): IslandPlacement | undefined {
    return this.placements.get(id);
  }

  /**
   * Rebuilds what changed in the payload: silhouettes, sea extent, berths,
   * landmarks, routes and the ship list. `berths` are the islands' harbour
   * berths in archipelago tiles.
   */
  update(
    islands: readonly IslandDisplay[],
    statics: ReadonlyMap<string, Island>,
    ships: readonly ShipDisplay[],
    routes: readonly RouteDisplay[],
    berths: Berths,
    defs: ReadonlyMap<string, ContentBuilding>,
  ): void {
    this.placements = new Map(islands.map((is) => [is.id, { position: is.position, width: is.width, height: is.height }]));
    this.islandList = [...islands];
    this.berths = berths;
    this.defs = defs;
    for (const is of islands) {
      const st = statics.get(is.id);
      if (!st) continue;
      const key = `${st.revision}|${is.settled}|${is.position.x},${is.position.y}`;
      const cur = this.silhouettes.get(is.id);
      if (cur?.key === key) continue;
      cur?.node.dispose();
      const node = new TransformNode(`silhouette_${is.id}`, this.scene);
      node.position.set(is.position.x, 0, -is.position.y);
      node.computeWorldMatrix(true);
      const meshes = buildSilhouette(this.scene, st, is.settled, this.silhouetteMaterial, islandSeed(st.id, st.revision), node);
      node.setEnabled(this.lod === "far" && this.visible.has(is.id));
      this.silhouettes.set(is.id, { node, meshes, key });
    }
    for (const [id, s] of this.silhouettes) {
      if (!this.placements.has(id)) {
        s.node.dispose();
        this.silhouettes.delete(id);
      }
    }
    // The sea's shallows follow the islands' land (recomputed only when it moved or changed).
    const land = islands.flatMap((is) => {
      const st = statics.get(is.id);
      return st ? [{ position: is.position, width: st.width, height: st.height, terrain: st.terrain, key: `${is.id}|${st.revision}|${is.position.x},${is.position.y}` }] : [];
    });
    const landKey = land.map((l) => l.key).join(";");
    if (landKey !== this.landKey) {
      this.landKey = landKey;
      this.sea.setIslands(land);
    }
    this.layoutSea();
    this.shipList = [...ships];
    this.routes = [...routes];
    this.rebuildRoutes();
    this.applyVisibility();
  }

  /** Render quality of the sea (ripples with specular, or glints). */
  setQuality(q: Quality): void {
    this.sea.setQuality(q);
  }

  /** Margin (tiles) of the sea around the islands' bounding box: no background shows at any target and zoom. */
  setSeaMargin(margin: number): void {
    if (Math.abs(margin - this.seaMargin) < 0.5) return;
    this.seaMargin = margin;
    this.layoutSea();
  }

  private layoutSea(): void {
    const b = this.bounds();
    const key = b ? `${b.minX},${b.maxX},${b.minY},${b.maxY},${this.seaMargin}` : "";
    if (!b || key === this.seaKey) return;
    this.seaKey = key;
    const m = Math.max(this.seaMargin, HAZE_INNER + 1);
    const w = b.maxX - b.minX + 2 * m;
    const h = b.maxY - b.minY + 2 * m;
    this.sea.layout({ minX: b.minX - m, minY: b.minY - m, maxX: b.minX - m + w, maxY: b.minY - m + h });
    const grow = (d: number): Rect => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
    setHazeGeometry(this.haze, grow(HAZE_INNER), grow(m), SEA_LEVEL + 0.01);
  }

  /** Stops of the route being edited (island IDs), drawn live; null hides the draft. */
  setDraft(stops: readonly string[] | null): void {
    const next = stops ? [...stops] : null;
    if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
    this.draft = next;
    this.rebuildRoutes();
  }

  /** The highlighted route (the selected ship's or the edited one). */
  setHighlight(routeId: number | null): void {
    if (routeId === this.highlight) return;
    this.highlight = routeId;
    this.rebuildRoutes();
  }

  setSelection(sel: ArchSelection): void {
    this.selection = sel;
  }

  /** Level of detail and the islands in view: silhouettes and landmarks show at far LOD only, for islands in view. */
  show(lod: Lod, visible: ReadonlySet<string>): void {
    this.lod = lod;
    this.visible = visible;
    this.sea.setLod(lod);
    this.applyVisibility();
  }

  /** A dragged ship is drawn at the pointer (null: none). */
  setDragged(d: { shipId: number; point: ArchPoint } | null): void {
    this.dragged = d;
  }

  private applyVisibility(): void {
    const far = this.lod === "far";
    for (const [id, s] of this.silhouettes) s.node.setEnabled(far && this.visible.has(id));
    this.rebuildLandmarks();
  }

  private rebuildLandmarks(): void {
    const marks: { x: number; y: number; color: readonly number[] }[] = [];
    if (this.lod === "far") {
      for (const is of this.islandList) {
        if (!this.visible.has(is.id)) continue;
        for (const b of is.buildings) {
          const def = this.defs.get(b.type);
          if (!def || (!def.warehouse && !def.shipyard)) continue;
          const box = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
          marks.push({ x: is.position.x + box.cx, y: is.position.y - box.cz, color: def.shipyard ? LANDMARK_SHIPYARD : LANDMARK_WAREHOUSE });
        }
      }
    }
    this.landmarks.resize(marks.length);
    marks.forEach((m, i) => {
      shipMatrix(this.landmarks.matrices, i, m.x, SILHOUETTE_TOP, -m.y, 0, 1);
      this.landmarks.setColor(i, m.color);
    });
    this.landmarks.commit();
  }

  /** Landmark markers drawn (far LOD). */
  landmarkCount(): number {
    return this.landmarks.size();
  }

  /** Anchor point of an island's legs and route ribbons (its first berth, else its centre). */
  anchor(id: string): ArchPoint | null {
    return berthAnchor(id, this.placements, this.berths);
  }

  private rebuildRoutes(): void {
    const lines: { key: string; stops: string[]; color: Color3; bright: boolean }[] = this.routes.map((r, i) => ({
      key: `route_${r.id}`,
      stops: r.stops.map((s) => s.island_id),
      color: ROUTE_COLORS[i % ROUTE_COLORS.length] as Color3,
      bright: r.id === this.highlight,
    }));
    if (this.draft && this.draft.length > 0) lines.push({ key: "draft", stops: this.draft, color: DRAFT_COLOR, bright: true });
    const keep = new Set<string>();
    const arrows: { x: number; y: number; heading: number; bright: boolean }[] = [];
    const anyBright = lines.some((l) => l.bright);
    for (const l of lines) {
      const pts = l.stops.map((id) => this.anchor(id)).filter((p): p is ArchPoint => p !== null);
      if (pts.length < 2) continue;
      keep.add(l.key);
      const geomKey = JSON.stringify(pts);
      let line = this.routeLines.get(l.key);
      if (!line || line.key !== geomKey) {
        line?.mesh.dispose();
        line?.material.dispose();
        const material = new StandardMaterial(l.key, this.scene);
        material.disableLighting = true;
        const mesh = this.buildLine(l.key, pts);
        mesh.material = material;
        line = { mesh, material, key: geomKey, color: l.color };
        this.routeLines.set(l.key, line);
      }
      line.color = l.color;
      // The highlighted route is bright, others are dimmer (all bright
      // when nothing is highlighted would hide the highlight's meaning).
      const dim = anyBright && !l.bright;
      line.material.emissiveColor = dim ? l.color.scale(0.45) : l.color;
      line.material.alpha = dim ? 0.55 : 1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i] as ArchPoint;
        const b = pts[(i + 1) % pts.length] as ArchPoint;
        if (a.x === b.x && a.y === b.y) continue;
        arrows.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, heading: Math.atan2(b.y - a.y, b.x - a.x), bright: l.bright });
      }
    }
    for (const [key, line] of this.routeLines) {
      if (!keep.has(key)) {
        line.mesh.dispose();
        line.material.dispose();
        this.routeLines.delete(key);
      }
    }
    this.arrows.resize(arrows.length);
    arrows.forEach((a, i) => {
      shipMatrix(this.arrows.matrices, i, a.x, ROUTE_Y + 0.05, -a.y, a.heading, 1);
      this.arrows.setColor(i, a.bright ? ARROW_BRIGHT : ARROW_DIM);
    });
    this.arrows.commit();
  }

  /** A closed polyline of flat quads (archipelago coordinates). */
  private buildLine(name: string, pts: readonly ArchPoint[]): Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const h = ROUTE_WIDTH / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as ArchPoint;
      const b = pts[(i + 1) % pts.length] as ArchPoint;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      // Perpendicular in archipelago tiles; world Z is −y.
      const px = (-dy / len) * h;
      const py = (dx / len) * h;
      const v = positions.length / 3;
      positions.push(a.x + px, ROUTE_Y, -(a.y + py), b.x + px, ROUTE_Y, -(b.y + py), b.x - px, ROUTE_Y, -(b.y - py), a.x - px, ROUTE_Y, -(a.y - py));
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }

  /**
   * The instances of a ship type: the model (and its cargo attachment)
   * once loaded, the placeholder before and without one — swapped on the
   * first frame after the model arrives.
   */
  private shipInstances(type: string): { inst: ColoredInstances; cargo: ColoredInstances | null; model: boolean } {
    let s = this.ships.get(type);
    if (s?.model) return s;
    const model = this.registry ? shipModel(this.registry, type) : null;
    if (s && !model) return s;
    if (s) {
      s.inst.mesh.dispose(false, true);
      s.cargo?.mesh.dispose(false, true);
    }
    if (model) {
      const m = shipMeshes(this.scene, `ships_${type}`, model);
      s = { inst: new ColoredInstances(m.hull), cargo: m.cargo ? new ColoredInstances(m.cargo) : null, model: true };
    } else {
      s = { inst: new ColoredInstances(shipTemplate(this.scene, `ships_${type}`)), cargo: null, model: false };
    }
    this.ships.set(type, s);
    return s;
  }

  /** Whether a ship model is drawn (any LOD). */
  drawsModels(): boolean {
    for (const s of this.ships.values()) if (s.model && s.inst.size() > 0) return true;
    return false;
  }

  /** Ship types drawn with the placeholder in the last frame. */
  shipPlaceholders(): string[] {
    return [...this.ships.entries()].filter(([, s]) => !s.model && s.inst.size() > 0).map(([t]) => t);
  }

  /** Ship instance scale at the current LOD. */
  shipScale(): number {
    return this.lod === "far" ? SHIP_SCALE_FAR : SHIP_SCALE;
  }

  /** Positions ships, the selection ring and the sea at server time nowMs (every frame). */
  frame(nowMs: number): void {
    this.sea.frame(nowMs);
    const slots = anchorSlots(this.shipList);
    const byType = new Map<string, ShipDisplay[]>();
    for (const s of this.shipList) {
      let list = byType.get(s.type);
      if (!list) byType.set(s.type, (list = []));
      list.push(s);
    }
    for (const [type, s] of this.ships) {
      if (byType.has(type)) continue;
      s.inst.resize(0);
      s.cargo?.resize(0);
    }
    this.shipPoints.clear();
    this.shipStyles.clear();
    const scale = this.shipScale();
    const y = this.lod === "far" ? SHIP_Y_FAR : SHIP_Y;
    const blobs = this.lod !== "far";
    if (blobs && this.shipBlobBuffer.length !== this.shipList.length * 16) {
      this.shipBlobBuffer = new Float32Array(this.shipList.length * 16);
      this.shipBlobs.set(this.shipList.length ? this.shipBlobBuffer : null);
    }
    this.shipBlobs.setEnabled(blobs && this.shipList.length > 0);
    let blob = 0;
    for (const [type, list] of byType) {
      const { inst, cargo, model } = this.shipInstances(type);
      // A model's origin is its waterline (at the sea surface); the placeholder floats on y = SHIP_Y.
      const sy = model && this.lod !== "far" ? SEA_LEVEL : y;
      inst.resize(list.length);
      const loaded = cargo ? list.filter((s) => s.cargo.length > 0).length : 0;
      cargo?.resize(loaded);
      let c = 0;
      list.forEach((s, i) => {
        const p = shipPlacement(s, this.placements, nowMs, slots.get(s.id) ?? 0, this.berths);
        let point = p?.point ?? { x: 0, y: 0 };
        if (this.dragged?.shipId === s.id) point = this.dragged.point;
        this.shipPoints.set(s.id, point);
        shipMatrix(inst.matrices, i, point.x, sy, -point.y, p?.heading ?? 0, p ? scale : 0);
        if (blobs) blobMatrix(this.shipBlobBuffer, blob++, point.x, -point.y, p ? 1.25 * scale : 0, p ? 0.5 * scale : 0, 0.5 * scale, p?.heading ?? 0, SEA_LEVEL + 0.02);
        const style: ShipStyle = s.state === "anchored_unpaid" ? "unpaid" : "active";
        this.shipStyles.set(s.id, style);
        inst.setColor(i, shipColor(style));
        // Crates on deck while carrying cargo, at the same matrix.
        if (cargo && s.cargo.length > 0) {
          cargo.matrices.set(inst.matrices.subarray(i * 16, i * 16 + 16), c * 16);
          cargo.setColor(c, shipColor(style));
          c++;
        }
      });
      inst.commit();
      cargo?.commit();
    }
    if (blobs && blob > 0) this.shipBlobs.mesh.thinInstanceBufferUpdated("matrix");
    this.placeRing();
  }

  private placeRing(): void {
    const sel = this.selection;
    let at: ArchPoint | null = null;
    let size = 0;
    if (sel.kind === "island" && this.lod === "far") {
      const p = this.placements.get(sel.id);
      if (p) {
        at = islandAnchor(p);
        size = Math.max(p.width, p.height) * 1.1;
      }
    } else if (sel.kind === "ship") {
      at = this.shipPoints.get(sel.id) ?? null;
      size = this.shipScale() * 1.6;
    }
    if (!at) {
      this.ring.setEnabled(false);
      return;
    }
    this.ring.position.set(at.x, this.lod === "far" ? SHIP_Y_FAR : SHIP_Y + 0.05, -at.y);
    this.ring.scaling.set(size, 1, size);
    this.ring.setEnabled(true);
  }

  /** Archipelago position of a ship in the last frame. */
  shipPoint(id: number): ArchPoint | undefined {
    return this.shipPoints.get(id);
  }

  /** Instance style a ship was drawn with in the last frame. */
  shipStyle(id: number): ShipStyle | undefined {
    return this.shipStyles.get(id);
  }

  /** Ship IDs with their last-frame position. */
  shipPointEntries(): IterableIterator<[number, ArchPoint]> {
    return this.shipPoints.entries();
  }

  /** The island whose land is at (or within one tile of) an archipelago point. */
  islandAt(p: ArchPoint, statics: ReadonlyMap<string, Island>): string | null {
    for (const [id, pl] of this.placements) {
      const lx = Math.floor(p.x - pl.position.x);
      const ly = Math.floor(p.y - pl.position.y);
      if (lx < -1 || ly < -1 || lx > pl.width || ly > pl.height) continue;
      const st = statics.get(id);
      if (!st) return id;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = lx + dx;
          const y = ly + dy;
          if (x >= 0 && y >= 0 && x < st.width && y < st.height && st.terrain[y * st.width + x] !== "water") return id;
        }
      }
    }
    return null;
  }

  /** The island whose rectangle contains an archipelago point (tools act on it), or null over the open sea. */
  islandRectAt(p: ArchPoint): string | null {
    for (const [id, pl] of this.placements) {
      if (p.x >= pl.position.x && p.y >= pl.position.y && p.x < pl.position.x + pl.width && p.y < pl.position.y + pl.height) return id;
    }
    return null;
  }
}
