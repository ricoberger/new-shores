// World layers of the continuous world (D-048): the sea with a haze toward
// its edges and, at every LOD, the ships, the selection ring and route
// ribbons with direction arrows — only for the selected ship's route or,
// while the route editor is open, every route (display/routes.ts
// ribbonsShown). Scene coordinates are
// archipelago coordinates (tile (x, y) is world (x, 0, −y); archipelago
// tiles equal island tiles). Everything is a view of the display payload
// (D-027): ship positions are lerps of server leg timestamps between the
// islands' harbour berths.
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { Island, IslandDisplay, RouteDisplay, ShipDisplay } from "../api/client";
import type { Rect } from "../display/camera";
import type { Lod } from "../display/lod";
import type { Quality } from "../display/quality";
import { ribbonLegs, ribbonsShown } from "../display/routes";
import { alongPath, anchorSlots, type ArchPoint, berthAnchor, type Berths, type Dock, islandAnchor, type IslandPlacement, seaPoint, shipPlacement } from "../display/ships";
import { BlobLayer, blobMatrix } from "./shadows";
import { Sea } from "./water";
import { SEA_LEVEL as TERRAIN_SEA_LEVEL } from "./terrain";
import { type DecodedMask, decodeMask, MASK_WATER, maskAt, maskTerrain } from "../display/mask";
import { ColoredInstances, shipColor, shipMatrix, type ShipStyle, shipTemplate } from "./shipmesh";
import { anchorBob, SAILING_ALPHA, sailing, waiting } from "./sway";
import { type ModelRegistry, shipMeshes, shipModel } from "./models";
import { ARROW_BRIGHT, ARROW_DIM, HAZE, SELECTION } from "./palette";
import { ShipWake, type WakeShip } from "./wake";

/** Top of the islands' ground (every LOD draws the island detail). */
const GROUND_TOP = 0;
/** Height of the sea surface (the islands' coast columns drop into it). */
export const SEA_LEVEL = TERRAIN_SEA_LEVEL;
/** Ships slightly above the water at far LOD (drawn larger); at near/mid on the water. */
const SHIP_Y_FAR = GROUND_TOP + 0.05;
const SHIP_Y = 0;
/** Ship instance scale at near/mid LOD and at far LOD (≥ 1.5×, so ships stay visible zoomed out). */
export const SHIP_SCALE = 5;
export const SHIP_SCALE_FAR = 4;
/** From a ship's origin back to its stern at near LOD (tiles): the sloop's stern lies 0.443 ship lengths behind; a hand's breadth off the pier. */
export const DOCK_STERN = 0.45 * SHIP_SCALE + 0.1;
const ROUTE_Y = GROUND_TOP + 0.25;
/** The haze starts this far (tiles) outside the islands' bounding box. */
const HAZE_INNER = 30;


export type ArchSelection = { kind: "none" } | { kind: "island"; id: string } | { kind: "ship"; id: number };

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
  private readonly sea: Sea;
  private readonly haze: Mesh;
  /** Ship instances per type, with the cargo attachment where the model has one; model: the voxel model (else the placeholder). */
  private readonly ships = new Map<string, { inst: ColoredInstances; cargo: ColoredInstances | null; model: boolean }>();
  private readonly arrows: ColoredInstances;
  private readonly routeLines = new Map<string, RouteLine>();
  private ring: Mesh;
  private readonly ringMat: StandardMaterial;
  /** Diameter and tube width the ring mesh was built for. */
  private ringShape = { size: 0, width: 0 };
  /** Blob shadows of the ships at near and mid LOD (matrices rewritten every frame). */
  private readonly shipBlobs: BlobLayer;
  private shipBlobBuffer = new Float32Array(0);
  /** Foam wakes of the sailing ships at near and mid LOD. */
  readonly wake: ShipWake;
  private readonly wakeShips: WakeShip[] = [];
  private placements = new Map<string, IslandPlacement>();
  /** The islands' decoded 1:4 terrain masks (land of the islands whose tiles are still loading). */
  private masks = new Map<string, DecodedMask>();
  private berths: Berths = new Map();
  /** Ships at a Trading Post's pier or in its queue: their mooring points (archipelago tiles). */
  private docks: ReadonlyMap<number, Dock> = new Map();
  /** Hull length of each ship type relative to the reference ship (content length_tiles; 1 when unknown). */
  private lengthRatios: ReadonlyMap<string, number> = new Map();
  /** Waiting ships bob at anchor (the life layer; off with ?life=0). */
  bobbing = true;
  private shipList: ShipDisplay[] = [];
  /** Where each ship's last leg ended (its island and the path's last point): an idle ship at an island without berths stays there (D-058). */
  private legEnds = new Map<number, { island: string; point: ArchPoint }>();
  private routes: RouteDisplay[] = [];
  private draft: string[] | null = null;
  private highlight: number | null = null;
  private selection: ArchSelection = { kind: "none" };
  private lod: Lod = "near";
  /** Positions (archipelago tiles) of the ships in the last frame. */
  private readonly shipPoints = new Map<number, ArchPoint>();
  /** Instance style of every ship drawn in the last frame. */
  private readonly shipStyles = new Map<number, ShipStyle>();
  private seaKey = "";
  private landKey = "";
  private seaMargin = 400;

  constructor(
    private readonly scene: Scene,
    private readonly registry: ModelRegistry | null = null,
  ) {
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


    this.shipBlobs = new BlobLayer(scene, "blob_ships", null, 0.45);
    this.wake = new ShipWake(scene, SEA_LEVEL, registry);
    this.shipBlobs.mesh.alwaysSelectAsActiveMesh = true;

    this.ringMat = new StandardMaterial("arch_selection", scene);
    this.ringMat.disableLighting = true;
    this.ringMat.emissiveColor = SELECTION;
    this.ring = this.makeRing(1, 0.06);
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
   * Rebuilds what changed in the payload: sea extent, berths, routes and
   * the ship list. `berths` are the islands' harbour
   * berths in archipelago tiles.
   */
  /** Sets the ship types' hull lengths relative to the reference ship (content ships, shipLengthRatio): ships are drawn that much longer. */
  setShipLengths(ratios: ReadonlyMap<string, number>): void {
    this.lengthRatios = ratios;
  }

  /** Hull length of a ship type relative to the reference ship. */
  private lengthRatio(type: string): number {
    return this.lengthRatios.get(type) ?? 1;
  }

  /** Replaces the pier and queue points (the berth anchors arrived with the model manifest). */
  setDocks(docks: ReadonlyMap<number, Dock>): void {
    this.docks = docks;
  }

  update(
    islands: readonly IslandDisplay[],
    ships: readonly ShipDisplay[],
    routes: readonly RouteDisplay[],
    berths: Berths,
    docks: ReadonlyMap<number, Dock> = new Map(),
  ): void {
    this.placements = new Map(islands.map((is) => [is.id, { position: is.position, width: is.width, height: is.height }]));
    this.masks = new Map(islands.map((is) => [is.id, decodeMask(is.terrain_mask, is.width, is.height)]));
    this.berths = berths;
    this.docks = docks;
    // The sea's shallows follow the islands' land from their 1:4 masks (every
    // island, also before its tiles arrive; recomputed only when it moved or changed).
    const landKey = islands.map((is) => `${is.id}|${is.position.x},${is.position.y}|${is.width}x${is.height}|${is.terrain_mask}`).join(";");
    if (landKey !== this.landKey) {
      this.landKey = landKey;
      this.sea.setIslands(
        islands.map((is) => ({ position: is.position, width: is.width, height: is.height, terrain: maskTerrain(decodeMask(is.terrain_mask, is.width, is.height), is.width, is.height) })),
      );
    }
    this.layoutSea();
    this.shipList = [...ships];
    for (const s of ships) {
      const end = s.leg?.path?.[s.leg.path.length - 1];
      if (s.leg && end) this.legEnds.set(s.id, { island: s.leg.to_island_id, point: seaPoint(end) });
    }
    this.routes = [...routes];
    this.rebuildRoutes();
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

  /** Stops of the route being edited (island IDs), drawn live; non-null (also empty) means the editor is open: every route shows. null: closed. */
  setDraft(stops: readonly string[] | null): void {
    const next = stops ? [...stops] : null;
    if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
    this.draft = next;
    this.rebuildRoutes();
  }

  /** The highlighted route (the selected ship's or the edited one); without one and outside the editor no ribbon is drawn. */
  setHighlight(routeId: number | null): void {
    if (routeId === this.highlight) return;
    this.highlight = routeId;
    this.rebuildRoutes();
  }

  setSelection(sel: ArchSelection): void {
    this.selection = sel;
  }

  /** Level of detail (the sea and the ships follow it). */
  show(lod: Lod): void {
    const changed = lod !== this.lod;
    this.lod = lod;
    this.sea.setLod(lod);
    // The selected ship's route ribbon is as wide as the selection ring, which follows the LOD.
    if (changed) this.rebuildRoutes();
  }

  /** Anchor point of an island's legs and route ribbons (its first berth, else its centre). */
  anchor(id: string): ArchPoint | null {
    return berthAnchor(id, this.placements, this.berths);
  }

  private rebuildRoutes(): void {
    // Every ribbon is the selection's yellow, as wide as the selection ring: the selected ship's
    // route, or in the editor the edited route and the draft at full strength and the other routes translucent.
    const width = this.ringWidth();
    const lines = ribbonsShown(this.routes, this.highlight, this.draft).map((r) => ({ ...r, color: SELECTION }));
    const keep = new Set<string>();
    const arrows: { x: number; y: number; heading: number; bright: boolean }[] = [];
    // In the editor every route but the edited one (and the draft) is translucent, also before the first stop is added.
    const editing = this.draft !== null;
    for (const l of lines) {
      // Each leg along its voyage around land (D-058), the loop closed back to the first stop.
      const legs = ribbonLegs(l.stops, l.paths, (id) => this.anchor(id));
      const pts = legs.flatMap((leg) => leg.slice(0, -1));
      if (pts.length < 2) continue;
      keep.add(l.key);
      const geomKey = JSON.stringify([pts, width]);
      let line = this.routeLines.get(l.key);
      if (!line || line.key !== geomKey) {
        line?.mesh.dispose();
        line?.material.dispose();
        const material = new StandardMaterial(l.key, this.scene);
        material.disableLighting = true;
        const mesh = this.buildLine(l.key, pts, width);
        mesh.material = material;
        line = { mesh, material, key: geomKey, color: l.color };
        this.routeLines.set(l.key, line);
      }
      line.color = l.color;
      // The highlighted route is opaque, the others (editor open) translucent.
      const dim = editing && !l.bright;
      line.material.emissiveColor = l.color;
      line.material.alpha = dim ? 0.45 : 1;
      for (const leg of legs) {
        if (leg.length < 2) continue;
        const mid = alongPath(leg, 0.5);
        arrows.push({ x: mid.point.x, y: mid.point.y, heading: mid.heading, bright: l.bright });
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
  private buildLine(name: string, pts: readonly ArchPoint[], width: number): Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const h = width / 2;
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

  /** Width of the selection ring's tube (and of the highlighted route's ribbon), the same at every diameter. */
  private ringWidth(): number {
    return 0.06 * 1.6 * this.shipScale();
  }

  /** Ship instance scale at the current LOD. */
  shipScale(): number {
    return this.lod === "far" ? SHIP_SCALE_FAR : SHIP_SCALE;
  }

  /** Positions ships, the selection ring and the sea at server time nowMs (every frame). */
  frame(nowMs: number): void {
    this.sea.frame(nowMs);
    const slots = anchorSlots(this.shipList, this.docks);
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
    const baseScale = this.shipScale();
    const y = this.lod === "far" ? SHIP_Y_FAR : SHIP_Y;
    const blobs = this.lod !== "far";
    if (blobs && this.shipBlobBuffer.length !== this.shipList.length * 16) {
      this.shipBlobBuffer = new Float32Array(this.shipList.length * 16);
      this.shipBlobs.set(this.shipList.length ? this.shipBlobBuffer : null);
    }
    this.shipBlobs.setEnabled(blobs && this.shipList.length > 0);
    let blob = 0;
    this.wakeShips.length = 0;
    for (const [type, list] of byType) {
      const { inst, cargo, model } = this.shipInstances(type);
      const scale = baseScale * this.lengthRatio(type);
      // A model's origin is its waterline (at the sea surface); the placeholder floats on y = SHIP_Y.
      const sy = model && this.lod !== "far" ? SEA_LEVEL : y;
      inst.resize(list.length);
      const loaded = cargo ? list.filter((s) => s.cargo.length > 0).length : 0;
      cargo?.resize(loaded);
      let c = 0;
      list.forEach((s, i) => {
        const end = this.legEnds.get(s.id);
        const p = shipPlacement(s, this.placements, nowMs, slots.get(s.id) ?? 0, this.berths, this.docks.get(s.id), end?.island === s.island_id ? end.point : undefined);
        const point = p?.point ?? { x: 0, y: 0 };
        this.shipPoints.set(s.id, point);
        const dock = this.docks.get(s.id);
        const bob = p && this.bobbing && this.lod !== "far" && waiting(s, dock) ? anchorBob(s.id, nowMs) : null;
        shipMatrix(inst.matrices, i, point.x, sy + (bob?.dy ?? 0), -point.y, p?.heading ?? 0, p ? scale : 0, bob?.rock ?? 0);
        if (blobs) blobMatrix(this.shipBlobBuffer, blob++, point.x, -point.y, p ? 1.25 * scale : 0, p ? 0.5 * scale : 0, 0.5 * scale, p?.heading ?? 0, SEA_LEVEL + 0.02);
        const style: ShipStyle = s.state === "anchored_unpaid" ? "unpaid" : "active";
        this.shipStyles.set(s.id, style);
        inst.setColor(i, shipColor(style));
        // Sails fill while under way (the sway shader's sentinel).
        if (sailing(s, p)) {
          inst.colors[i * 4 + 3] = SAILING_ALPHA;
          if (p && this.bobbing && this.lod !== "far") this.wakeShips.push({ id: s.id, x: point.x, y: point.y, heading: p.heading, stern: 0.42 * scale, scale });
        }
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
    this.wake.frame(this.wakeShips, nowMs);
    this.placeRing();
  }

  /** A ring of diameter 1 whose tube is `thickness` wide once scaled to its final size (the mesh is built unit-sized). */
  private makeRing(size: number, width: number): Mesh {
    const ring = CreateTorus("arch_selection", { diameter: 1, thickness: width / size, tessellation: 32 }, this.scene);
    ring.material = this.ringMat;
    ring.isPickable = false;
    ring.setEnabled(false);
    this.ringShape = { size, width };
    return ring;
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
      const ship = this.shipList.find((s) => s.id === sel.id);
      size = this.shipScale() * 1.6 * (ship ? this.lengthRatio(ship.type) : 1);
    }
    if (!at) {
      this.ring.setEnabled(false);
      return;
    }
    // Every ring has the width of a ship's, whatever its diameter; the tube stays as flat as a ship's.
    const width = this.ringWidth();
    if (this.ringShape.size !== size || this.ringShape.width !== width) {
      this.ring.dispose();
      this.ring = this.makeRing(size, width);
    }
    this.ring.scaling.set(size, (0.06 * size) / width, size);
    this.ring.position.set(at.x, this.lod === "far" ? SHIP_Y_FAR : SHIP_Y + 0.05, -at.y);
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
      // The full tiles where loaded, else the island's 1:4 mask.
      const st = statics.get(id);
      const mask = this.masks.get(id);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = lx + dx;
          const y = ly + dy;
          if (x < 0 || y < 0 || x >= pl.width || y >= pl.height) continue;
          if (st ? st.terrain[y * st.width + x] !== "water" : !mask || maskAt(mask, x, y) !== MASK_WATER) return id;
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
