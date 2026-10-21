// World layers of the continuous world (D-048): the sea with a haze toward
// its edges, the far-LOD island silhouettes and landmark markers
// (warehouses, shipyards), and at every LOD the ships, route ribbons with
// direction arrows and the selection ring. Scene coordinates are
// archipelago coordinates (tile (x, y) is world (x, 0, −y); archipelago
// tiles equal island tiles). Everything is a view of the display payload
// (D-027): ship positions are lerps of server leg timestamps between the
// islands' harbour berths.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, IslandDisplay, RouteDisplay, ShipDisplay, Terrain } from "../api/client";
import type { Rect } from "../display/camera";
import type { Lod } from "../display/lod";
import { anchorSlots, type ArchPoint, berthAnchor, type Berths, islandAnchor, type IslandPlacement, shipPlacement } from "../display/ships";
import { footprintBox } from "./coords";
import { ColoredInstances, shipColor, shipMatrix, type ShipStyle, shipTemplate } from "./shipmesh";
import { HAZE, SELECTION, TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";

const SILHOUETTE_TOP = 0.3;
const SILHOUETTE_BOTTOM = -0.2;
const SEA_LEVEL = -0.15;
/** Ships above the far-LOD silhouettes; at near/mid on the water. */
const SHIP_Y_FAR = SILHOUETTE_TOP + 0.05;
const SHIP_Y = 0;
/** Ship instance scale at near/mid LOD and at far LOD (≥ 1.5×, so ships stay visible zoomed out). */
export const SHIP_SCALE = 2;
export const SHIP_SCALE_FAR = 4;
const ROUTE_Y = SILHOUETTE_TOP + 0.25;
const ROUTE_WIDTH = 0.8;
const SEA_REPEAT_TILES = 24;
/** The haze starts this far (tiles) outside the islands' bounding box. */
const HAZE_INNER = 30;
const LANDMARK_SIZE = 3;
const LANDMARK_WAREHOUSE = [0.95, 0.85, 0.55, 1];
const LANDMARK_SHIPYARD = [0.75, 0.45, 0.25, 1];
/** Sea texture scroll speed (texture repeats per second). */
const SEA_SPEED = 0.01;

const ROUTE_COLORS = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"].map((h) => Color3.FromHexString(h));
const DRAFT_COLOR = Color3.FromHexString("#FFFFFF");
const ARROW_DIM = [0.75, 0.75, 0.75, 1];
const ARROW_BRIGHT = [1, 0.82, 0.25, 1];

export type ArchSelection = { kind: "none" } | { kind: "island"; id: string } | { kind: "ship"; id: number };

/** Unsettled islands: the terrain colours, desaturated. */
function silhouetteColor(t: Terrain | undefined, settled: boolean): Color3 {
  const c = (t && TERRAIN_COLORS[t]) || UNKNOWN_TERRAIN;
  if (settled) return c;
  const grey = (c.r + c.g + c.b) / 3;
  return new Color3(c.r * 0.3 + grey * 0.7, c.g * 0.3 + grey * 0.7, c.b * 0.3 + grey * 0.7);
}

/**
 * One mesh per island: the non-water tiles as a flat top at a low height
 * with walls along the outline (no elevation), vertex-coloured by terrain.
 */
function buildSilhouette(scene: Scene, island: Island, settled: boolean, material: StandardMaterial): Mesh {
  const { width, height, terrain } = island;
  const land = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && terrain[y * width + x] !== "water";
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const quad = (p: number[], n: [number, number, number], c: Color3) => {
    const v = positions.length / 3;
    positions.push(...p);
    for (let i = 0; i < 4; i++) {
      normals.push(...n);
      colors.push(c.r, c.g, c.b, 1);
    }
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  const T = SILHOUETTE_TOP;
  const B = SILHOUETTE_BOTTOM;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!land(x, y)) continue;
      const c = silhouetteColor(terrain[y * width + x], settled);
      quad([x, T, -y, x + 1, T, -y, x + 1, T, -(y + 1), x, T, -(y + 1)], [0, 1, 0], c);
      const wall = c.scale(0.7);
      if (!land(x, y - 1)) quad([x + 1, T, -y, x, T, -y, x, B, -y, x + 1, B, -y], [0, 0, 1], wall);
      if (!land(x, y + 1)) quad([x, T, -(y + 1), x + 1, T, -(y + 1), x + 1, B, -(y + 1), x, B, -(y + 1)], [0, 0, -1], wall);
      if (!land(x - 1, y)) quad([x, T, -y, x, T, -(y + 1), x, B, -(y + 1), x, B, -y], [-1, 0, 0], wall);
      if (!land(x + 1, y)) quad([x + 1, T, -(y + 1), x + 1, T, -y, x + 1, B, -y, x + 1, B, -(y + 1)], [1, 0, 0], wall);
    }
  }
  const mesh = new Mesh(`silhouette_${island.id}`, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.colors = colors;
  data.normals = normals;
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

/** Procedural sea texture: deterministic value noise in two blues. */
function seaTexture(scene: Scene): RawTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const grid = Array.from({ length: 8 * 8 }, rnd);
  const at = (x: number, y: number) => grid[(y & 7) * 8 + (x & 7)] as number;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * 8;
      const fy = (y / n) * 8;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const v =
        at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
      const k = 0.88 + v * 0.2;
      const i = (y * n + x) * 4;
      data[i] = Math.min(255, 0x2b * k);
      data[i + 1] = Math.min(255, 0x5c * k);
      data[i + 2] = Math.min(255, 0x8a * k);
      data[i + 3] = 255;
    }
  }
  const tex = RawTexture.CreateRGBATexture(data, n, n, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

interface Silhouette {
  mesh: Mesh;
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
  private readonly sea: Mesh;
  private readonly seaTexture: RawTexture;
  private readonly haze: Mesh;
  private readonly ships = new Map<string, ColoredInstances>();
  private readonly arrows: ColoredInstances;
  private readonly landmarks: ColoredInstances;
  private readonly routeLines = new Map<string, RouteLine>();
  private readonly ring: Mesh;
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
  private seaMargin = 400;

  constructor(private readonly scene: Scene) {
    this.silhouetteMaterial = new StandardMaterial("silhouettes", scene);
    this.silhouetteMaterial.specularColor = Color3.Black();
    this.silhouetteMaterial.backFaceCulling = false;

    this.sea = CreateGround("sea", { width: 1, height: 1 }, scene);
    this.seaTexture = seaTexture(scene);
    const seaMat = new StandardMaterial("sea", scene);
    seaMat.disableLighting = true;
    seaMat.emissiveTexture = this.seaTexture;
    seaMat.specularColor = Color3.Black();
    this.sea.material = seaMat;
    this.sea.isPickable = false;
    this.sea.alwaysSelectAsActiveMesh = true;
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
    const towerMat = new StandardMaterial("landmarks", scene);
    towerMat.specularColor = Color3.Black();
    tower.material = towerMat;
    tower.isPickable = false;
    tower.alwaysSelectAsActiveMesh = true;
    this.landmarks = new ColoredInstances(tower);

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
      cur?.mesh.dispose();
      const mesh = buildSilhouette(this.scene, st, is.settled, this.silhouetteMaterial);
      mesh.position.set(is.position.x, 0, -is.position.y);
      mesh.freezeWorldMatrix();
      this.silhouettes.set(is.id, { mesh, key });
    }
    for (const [id, s] of this.silhouettes) {
      if (!this.placements.has(id)) {
        s.mesh.dispose();
        this.silhouettes.delete(id);
      }
    }
    this.layoutSea();
    this.shipList = [...ships];
    this.routes = [...routes];
    this.rebuildRoutes();
    this.applyVisibility();
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
    this.sea.scaling.set(w, 1, h);
    this.sea.position.set((b.minX + b.maxX) / 2, SEA_LEVEL, -(b.minY + b.maxY) / 2);
    this.seaTexture.uScale = w / SEA_REPEAT_TILES;
    this.seaTexture.vScale = h / SEA_REPEAT_TILES;
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
    this.applyVisibility();
  }

  /** A dragged ship is drawn at the pointer (null: none). */
  setDragged(d: { shipId: number; point: ArchPoint } | null): void {
    this.dragged = d;
  }

  private applyVisibility(): void {
    const far = this.lod === "far";
    for (const [id, s] of this.silhouettes) s.mesh.setEnabled(far && this.visible.has(id));
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

  private shipInstances(type: string): ColoredInstances {
    let inst = this.ships.get(type);
    if (!inst) {
      inst = new ColoredInstances(shipTemplate(this.scene, `ships_${type}`));
      this.ships.set(type, inst);
    }
    return inst;
  }

  /** Ship instance scale at the current LOD. */
  shipScale(): number {
    return this.lod === "far" ? SHIP_SCALE_FAR : SHIP_SCALE;
  }

  /** Positions ships, the selection ring and the sea at server time nowMs (every frame). */
  frame(nowMs: number): void {
    const off = (nowMs / 1000) * SEA_SPEED;
    this.seaTexture.uOffset = off % 1;
    this.seaTexture.vOffset = (off * 0.6) % 1;
    const slots = anchorSlots(this.shipList);
    const byType = new Map<string, ShipDisplay[]>();
    for (const s of this.shipList) {
      let list = byType.get(s.type);
      if (!list) byType.set(s.type, (list = []));
      list.push(s);
    }
    for (const [type, inst] of this.ships) if (!byType.has(type)) inst.resize(0);
    this.shipPoints.clear();
    this.shipStyles.clear();
    const scale = this.shipScale();
    const y = this.lod === "far" ? SHIP_Y_FAR : SHIP_Y;
    for (const [type, list] of byType) {
      const inst = this.shipInstances(type);
      inst.resize(list.length);
      list.forEach((s, i) => {
        const p = shipPlacement(s, this.placements, nowMs, slots.get(s.id) ?? 0, this.berths);
        let point = p?.point ?? { x: 0, y: 0 };
        if (this.dragged?.shipId === s.id) point = this.dragged.point;
        this.shipPoints.set(s.id, point);
        shipMatrix(inst.matrices, i, point.x, y, -point.y, p?.heading ?? 0, p ? scale : 0);
        const style: ShipStyle = s.state === "anchored_unpaid" ? "unpaid" : "active";
        this.shipStyles.set(s.id, style);
        inst.setColor(i, shipColor(style));
      });
      inst.commit();
    }
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
