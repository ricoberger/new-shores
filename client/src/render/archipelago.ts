// Archipelago layers (UI.md §1): island silhouettes, the sea, ships, route
// lines with direction arrows and the selection ring, all under one root
// node. Scene coordinates are the local tile coordinates of the island
// whose detail is built (the "origin" island): the root is offset by
// −position of that island, so its silhouette coincides with its detailed
// terrain and the camera never jumps when the view switches. Archipelago
// tiles equal island tiles (1:1). Everything is a view of the display
// payload (D-027): ship positions are lerps of server leg timestamps.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Island, IslandDisplay, RouteDisplay, ShipDisplay, Terrain } from "../api/client";
import { anchorSlots, type ArchPoint, islandAnchor, type IslandPlacement, shipPlacement } from "../display/ships";
import { ColoredInstances, SHIP_ACTIVE, SHIP_UNPAID, shipMatrix, shipTemplate } from "./shipmesh";
import { SELECTION, TERRAIN_COLORS, UNKNOWN_TERRAIN } from "./palette";

const SILHOUETTE_TOP = 0.3;
const SILHOUETTE_BOTTOM = -0.2;
const SEA_LEVEL = -0.15;
const SHIP_Y = SILHOUETTE_TOP + 0.05;
const SHIP_SCALE = 4;
const ROUTE_Y = SILHOUETTE_TOP + 0.25;
const ROUTE_WIDTH = 0.8;
const SEA_MARGIN = 400;
const SEA_REPEAT_TILES = 24;
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

export class ArchipelagoLayer {
  readonly root: TransformNode;
  private origin: ArchPoint = { x: 0, y: 0 };
  private readonly silhouetteMaterial: StandardMaterial;
  private readonly silhouettes = new Map<string, Silhouette>();
  private readonly sea: Mesh;
  private readonly seaTexture: RawTexture;
  private readonly ships = new Map<string, ColoredInstances>();
  private readonly arrows: ColoredInstances;
  private readonly routeLines = new Map<string, RouteLine>();
  private readonly ring: Mesh;
  private placements = new Map<string, IslandPlacement>();
  private shipList: ShipDisplay[] = [];
  private routes: RouteDisplay[] = [];
  private draft: string[] | null = null;
  private highlight: number | null = null;
  private selection: ArchSelection = { kind: "none" };
  private archMode = false;
  private shownIsland = "";
  /** Positions (archipelago tiles) of the ships in the last frame. */
  private readonly shipPoints = new Map<number, ArchPoint>();
  private dragged: { shipId: number; point: ArchPoint } | null = null;
  private seaKey = "";

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode("archipelago", scene);
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
    this.sea.parent = this.root;

    const arrow = CreateCylinder("route_arrows", { diameterTop: 0, diameterBottom: 1.6, height: 2.2, tessellation: 3 }, scene);
    // Point the cone along +X and flatten it onto the sea.
    arrow.bakeTransformIntoVertices(Matrix.Scaling(1, 1, 0.35).multiply(Matrix.RotationZ(-Math.PI / 2)));
    const arrowMat = new StandardMaterial("route_arrows", scene);
    arrowMat.disableLighting = true;
    arrowMat.emissiveColor = Color3.White();
    arrow.material = arrowMat;
    arrow.isPickable = false;
    arrow.parent = this.root;
    arrow.alwaysSelectAsActiveMesh = true;
    this.arrows = new ColoredInstances(arrow);

    this.ring = CreateTorus("arch_selection", { diameter: 1, thickness: 0.06, tessellation: 32 }, scene);
    const ringMat = new StandardMaterial("arch_selection", scene);
    ringMat.disableLighting = true;
    ringMat.emissiveColor = SELECTION;
    this.ring.material = ringMat;
    this.ring.isPickable = false;
    this.ring.parent = this.root;
    this.ring.setEnabled(false);
  }

  /** Archipelago position of the island whose local tiles are the scene coordinates. */
  setOrigin(p: ArchPoint): void {
    this.origin = { x: p.x, y: p.y };
    this.root.position.set(-p.x, 0, p.y);
  }

  getOrigin(): ArchPoint {
    return this.origin;
  }

  /** Scene (world) point of an archipelago point. */
  toWorld(p: ArchPoint, y = 0): Vector3 {
    return new Vector3(p.x - this.origin.x, y, -(p.y - this.origin.y));
  }

  /** Archipelago point of a scene (world) ground point. */
  toArch(v: Vector3): ArchPoint {
    return { x: v.x + this.origin.x, y: -v.z + this.origin.y };
  }

  /** Bounding box of all islands (archipelago tiles), or null without islands. */
  bounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    let b: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
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

  /** Rebuilds what changed in the payload: silhouettes, sea extent, routes and the ship list. */
  update(islands: readonly IslandDisplay[], statics: ReadonlyMap<string, Island>, ships: readonly ShipDisplay[], routes: readonly RouteDisplay[]): void {
    this.placements = new Map(islands.map((is) => [is.id, { position: is.position, width: is.width, height: is.height }]));
    for (const is of islands) {
      const st = statics.get(is.id);
      if (!st) continue;
      const key = `${st.revision}|${is.settled}|${is.position.x},${is.position.y}`;
      const cur = this.silhouettes.get(is.id);
      if (cur?.key === key) continue;
      cur?.mesh.dispose();
      const mesh = buildSilhouette(this.scene, st, is.settled, this.silhouetteMaterial);
      mesh.parent = this.root;
      // Not frozen: the root moves when the scene is re-based on another island.
      mesh.position.set(is.position.x, 0, -is.position.y);
      this.silhouettes.set(is.id, { mesh, key });
    }
    for (const [id, s] of this.silhouettes) {
      if (!this.placements.has(id)) {
        s.mesh.dispose();
        this.silhouettes.delete(id);
      }
    }
    const b = this.bounds();
    const seaKey = b ? `${b.minX},${b.maxX},${b.minY},${b.maxY}` : "";
    if (b && seaKey !== this.seaKey) {
      this.seaKey = seaKey;
      const w = b.maxX - b.minX + 2 * SEA_MARGIN;
      const h = b.maxY - b.minY + 2 * SEA_MARGIN;
      this.sea.scaling.set(w, 1, h);
      this.sea.position.set((b.minX + b.maxX) / 2, SEA_LEVEL, -(b.minY + b.maxY) / 2);
      this.seaTexture.uScale = w / SEA_REPEAT_TILES;
      this.seaTexture.vScale = h / SEA_REPEAT_TILES;
    }
    this.shipList = [...ships];
    this.routes = [...routes];
    this.rebuildRoutes();
    this.applyVisibility();
  }

  /** Stops of the route being edited (island IDs), drawn live; null hides the draft. */
  setDraft(stops: readonly string[] | null): void {
    const next = stops ? [...stops] : null;
    if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
    this.draft = next;
    this.rebuildRoutes();
    this.applyVisibility();
  }

  /** The highlighted route (the selected ship's or the edited one). */
  setHighlight(routeId: number | null): void {
    if (routeId === this.highlight) return;
    this.highlight = routeId;
    this.rebuildRoutes();
    this.applyVisibility();
  }

  setSelection(sel: ArchSelection): void {
    this.selection = sel;
  }

  /** Archipelago mode shows everything; the island view only the sea and the other islands' silhouettes. */
  setMode(archipelago: boolean, shownIsland: string): void {
    this.archMode = archipelago;
    this.shownIsland = shownIsland;
    this.applyVisibility();
  }

  /** A dragged ship is drawn at the pointer (null: none). */
  setDragged(d: { shipId: number; point: ArchPoint } | null): void {
    this.dragged = d;
  }

  private applyVisibility(): void {
    for (const [id, s] of this.silhouettes) s.mesh.setEnabled(this.archMode || id !== this.shownIsland);
    for (const inst of this.ships.values()) inst.mesh.setEnabled(this.archMode);
    this.arrows.mesh.setEnabled(this.archMode);
    for (const r of this.routeLines.values()) r.mesh.setEnabled(this.archMode);
    if (!this.archMode) this.ring.setEnabled(false);
  }

  private anchor(id: string): ArchPoint | null {
    const p = this.placements.get(id);
    return p ? islandAnchor(p) : null;
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

  /** A closed polyline of flat quads (archipelago coordinates under the root). */
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
    mesh.parent = this.root;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }

  private shipInstances(type: string): ColoredInstances {
    let inst = this.ships.get(type);
    if (!inst) {
      const mesh = shipTemplate(this.scene, `ships_${type}`);
      mesh.parent = this.root;
      inst = new ColoredInstances(mesh);
      inst.mesh.setEnabled(this.archMode);
      this.ships.set(type, inst);
    }
    return inst;
  }

  /** Positions ships, the selection ring and the sea at server time nowMs (every frame). */
  frame(nowMs: number): void {
    const off = (nowMs / 1000) * SEA_SPEED;
    this.seaTexture.uOffset = off % 1;
    this.seaTexture.vOffset = (off * 0.6) % 1;
    if (!this.archMode) return;
    const slots = anchorSlots(this.shipList);
    const byType = new Map<string, ShipDisplay[]>();
    for (const s of this.shipList) {
      let list = byType.get(s.type);
      if (!list) byType.set(s.type, (list = []));
      list.push(s);
    }
    for (const [type, inst] of this.ships) if (!byType.has(type)) inst.resize(0);
    this.shipPoints.clear();
    for (const [type, list] of byType) {
      const inst = this.shipInstances(type);
      inst.resize(list.length);
      list.forEach((s, i) => {
        const p = shipPlacement(s, this.placements, nowMs, slots.get(s.id) ?? 0);
        let point = p?.point ?? { x: 0, y: 0 };
        if (this.dragged?.shipId === s.id) point = this.dragged.point;
        this.shipPoints.set(s.id, point);
        shipMatrix(inst.matrices, i, point.x, SHIP_Y, -point.y, p?.heading ?? 0, p ? SHIP_SCALE : 0);
        inst.setColor(i, s.state === "anchored_unpaid" ? SHIP_UNPAID : SHIP_ACTIVE);
      });
      inst.commit();
    }
    this.placeRing();
  }

  private placeRing(): void {
    const sel = this.selection;
    let at: ArchPoint | null = null;
    let size = 0;
    if (sel.kind === "island") {
      const p = this.placements.get(sel.id);
      if (p) {
        at = islandAnchor(p);
        size = Math.max(p.width, p.height) * 1.1;
      }
    } else if (sel.kind === "ship") {
      at = this.shipPoints.get(sel.id) ?? null;
      size = SHIP_SCALE * 1.6;
    }
    if (!at) {
      this.ring.setEnabled(false);
      return;
    }
    this.ring.position.set(at.x, SHIP_Y, -at.y);
    this.ring.scaling.set(size, 1, size);
    this.ring.setEnabled(true);
  }

  /** Archipelago position of a ship in the last frame. */
  shipPoint(id: number): ArchPoint | undefined {
    return this.shipPoints.get(id);
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

  dispose(): void {
    this.root.dispose();
  }
}
