// Babylon engine and scene of the game view. Created once per canvas and
// disposed once (React Strict Mode safe: the owner disposes in its effect
// cleanup). Renders only what the payloads contain: the island view
// (terrain, buildings, roads, carts, status icons, ships at the harbour)
// and the archipelago view (island silhouettes, sea, ships, routes) in the
// same scene — no shadows, sky or post-processing. View switches are
// camera animations inside the one scene.
import { Engine } from "@babylonjs/core/Engines/engine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, IslandDisplay, WorldResponse } from "../api/client";
import type { SyncSnapshot } from "../api/sync";
import { buildingAt, lPath, missingDepositHint, missingRoadHint, rotatedFootprint, type TilePos, tileKey } from "../display/geometry";
import type { ArchPoint } from "../display/ships";
import { fertilityNeed, missingFertilityText } from "../display/tiers";
import type { Tool } from "../ui/tools";
import { ArchipelagoLayer, type ArchSelection } from "./archipelago";
import { BuildingLayer } from "./buildings";
import { CameraRig, type CameraState, fitHalfHeight, ISLAND_DEFAULT_HALF_HEIGHT } from "./camera";
import { CartLayer } from "./carts";
import { footprintBox, tileCenter, worldToTile } from "./coords";
import { HarbourLayer } from "./harbour";
import { IconLayer } from "./icons";
import { GHOST, GHOST_INVALID, GHOST_NO_ROAD } from "./palette";
import { type Point, PointerInput } from "./picking";
import { RoadLayer } from "./roads";
import type { ShipStyle } from "./shipmesh";
import { buildTerrain } from "./terrain";

/** Duration of the island ↔ archipelago camera transition (≤ 400 ms). */
export const TRANSITION_MS = 350;
/** Pick radius of ships (CSS pixels). */
const SHIP_PICK_PX = 18;
/** Margin (tiles) around the islands for the archipelago camera bounds. */
const ARCH_MARGIN = 30;
const LABEL_Y = 0.4;

/** What the renderer shows; the island view shows one island in detail. */
export type RenderView = { kind: "island"; id: string } | { kind: "archipelago" };

export interface RendererEvents {
  select(buildingId: number | null): void;
  place(x: number, y: number): void;
  move(x: number, y: number): void;
  found(x: number, y: number): void;
  road(from: TilePos, to: TilePos): void;
  demolish(x: number, y: number): void;
  cancelTool(): void;
  /**
   * The placement ghost's hint changed: why the server would reject the
   * placement under the pointer (missing fertility or deposit), or null.
   */
  ghostHint(text: string | null): void;
  /** A zoom-out gesture while the island view is at its maximum extent. */
  zoomOutAtMax(amount: number): void;
  /** Any other zoom gesture in the island view. */
  zoomReset(): void;
  /** Taps in the archipelago view (ship before island; nothing hit: sea). */
  tapIsland(id: string): void;
  tapShip(id: number): void;
  tapSea(): void;
  /** An idle ship is dragged from its island; dropShip ends the drag (island null: the sea). */
  dragShip(shipId: number, from: string): void;
  dropShip(island: string | null): void;
}

/** The part of GameSync the renderer reads. */
export interface RenderSource {
  subscribe(l: () => void): () => void;
  getSnapshot(): SyncSnapshot;
  serverNowMs(): number;
}

export interface FrameStats {
  frames: number;
  fps: number;
  avgMs: number;
  p95Ms: number;
}

const FRAME_RING = 2048;

export class GameRenderer {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly rig: CameraRig;
  private readonly islandRoot: TransformNode;
  private readonly buildings: BuildingLayer;
  private readonly roads: RoadLayer;
  private readonly carts: CartLayer;
  private readonly icons: IconLayer;
  private readonly harbour: HarbourLayer;
  private readonly arch: ArchipelagoLayer;
  private readonly ghost: Mesh;
  private readonly ghostMaterial: StandardMaterial;
  /** Server road tiles (tileKey) for the ghost's road hint. */
  private roadTiles = new Set<string>();
  /** Deposit kinds by tile (tileKey) of the island shown, for the ghost hint. */
  private deposits = new Map<string, string>();
  private fertilities: readonly string[] = [];
  private lastGhostHint: string | null = null;
  private readonly input: PointerInput;
  private readonly unsubscribe: () => void;
  private terrain: Mesh[] = [];
  private terrainRevision = "";
  private lastServer: WorldResponse | null = null;
  private lastArchServer: WorldResponse | null = null;
  private lastIslands: ReadonlyMap<string, Island> | null = null;
  private lastContent: unknown = null;
  private defs = new Map<string, ContentBuilding>();
  private hover: Point | null = null;
  private roadStart: TilePos | null = null;
  private selected: number | null = null;
  /** The island whose detail is built (its local tiles are the scene coordinates). */
  private islandId: string | null = null;
  private shownIslandId = "";
  /** The requested view; the island view shows islandId. */
  private view: RenderView = { kind: "island", id: "" };
  /** Displayed mode (changes at the end of a transition to the archipelago). */
  private archMode = false;
  private readonly islandCams = new Map<string, CameraState>();
  /** Last archipelago camera (target in archipelago tiles). */
  private archCam: { x: number; y: number; half: number } | null = null;
  private placedInitially = false;
  private draggingShip: number | null = null;
  private readonly frameListeners = new Set<() => void>();
  private readonly hoverListeners = new Set<(island: string | null, at: { x: number; y: number } | null) => void>();
  private readonly frameTimes = new Float64Array(FRAME_RING);
  private frameCount = 0;
  private lastFrameAt = 0;
  private drawCalls = 0;
  private firstFrameMarked = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sync: RenderSource,
    private readonly tool: () => Tool,
    private readonly events: RendererEvents,
    initialView: RenderView = { kind: "island", id: "" },
  ) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.12, 0.27, 0.42, 1);
    this.scene.skipPointerMovePicking = true;
    const light = new HemisphericLight("light", new Vector3(0.3, 1, -0.5), this.scene);
    light.intensity = 0.95;
    light.groundColor = new Color3(0.45, 0.45, 0.5);
    this.rig = new CameraRig(this.scene, this.engine);
    this.islandRoot = new TransformNode("island", this.scene);
    this.buildings = new BuildingLayer(this.scene, this.islandRoot);
    this.roads = new RoadLayer(this.scene, this.islandRoot);
    this.carts = new CartLayer(this.scene, this.islandRoot);
    this.icons = new IconLayer(this.scene, this.islandRoot);
    this.harbour = new HarbourLayer(this.scene, this.islandRoot);
    this.arch = new ArchipelagoLayer(this.scene);

    this.ghost = CreateBox("ghost", { size: 1 }, this.scene);
    this.ghostMaterial = new StandardMaterial("ghost", this.scene);
    this.ghostMaterial.diffuseColor = GHOST;
    this.ghostMaterial.alpha = 0.45;
    this.ghost.material = this.ghostMaterial;
    this.ghost.isPickable = false;
    this.ghost.parent = this.islandRoot;
    this.ghost.setEnabled(false);

    this.view = initialView;
    if (initialView.kind === "island" && initialView.id) this.islandId = initialView.id;
    this.archMode = initialView.kind === "archipelago";
    this.applyMode();

    this.input = new PointerInput(canvas, () => this.ratio(), {
      tap: (p, button) => this.onTap(p, button),
      dragStart: (p, button) => this.onDragStart(p, button),
      dragMove: (prev, cur, button) => this.onDragMove(prev, cur, button),
      dragEnd: (p, button) => this.onDragEnd(p, button),
      cancel: () => this.onPointerCancel(),
      hover: (p) => this.onHover(p),
      wheel: (p, dy) => this.onWheel(p, dy),
    });

    this.unsubscribe = sync.subscribe(() => this.onSnapshot(sync.getSnapshot()));
    this.onSnapshot(sync.getSnapshot());
    window.addEventListener("resize", this.onResize);
    this.engine.runRenderLoop(() => this.renderFrame());
  }

  private renderFrame(): void {
    const t = performance.now();
    if (this.lastFrameAt > 0) {
      this.frameTimes[this.frameCount % FRAME_RING] = t - this.lastFrameAt;
      this.frameCount++;
    }
    this.lastFrameAt = t;
    const now = this.sync.serverNowMs();
    this.rig.tick(t);
    this.carts.frame(now);
    this.harbour.frame(now);
    this.arch.frame(now);
    this.updateGhost();
    this.engine._drawCalls.fetchNewFrame();
    this.scene.render();
    this.drawCalls = this.engine._drawCalls.current;
    for (const l of this.frameListeners) l();
    if (!this.firstFrameMarked && (this.terrain.length > 0 || this.archMode)) {
      this.firstFrameMarked = true;
      performance.mark("ns-first-frame");
    }
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.unsubscribe();
    this.input.dispose();
    this.frameListeners.clear();
    this.hoverListeners.clear();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  /** Number of live Babylon engines (Strict Mode check). */
  static engineCount(): number {
    return EngineStore.Instances.length;
  }

  /** Called after every rendered frame (HTML overlays follow the camera). */
  onFrame(l: () => void): () => void {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }

  /**
   * The island under the pointer in the archipelago view with the
   * pointer's canvas-relative CSS position (null when none or in the
   * island view).
   */
  onHoverIsland(l: (island: string | null, at: { x: number; y: number } | null) => void): () => void {
    this.hoverListeners.add(l);
    return () => this.hoverListeners.delete(l);
  }

  private onHover(p: Point | null): void {
    this.hover = p;
    if (this.hoverListeners.size === 0) return;
    let id: string | null = null;
    let at: { x: number; y: number } | null = null;
    if (p && this.archMode && this.draggingShip === null) {
      id = this.islandUnder(p);
      const k = this.ratio();
      at = { x: p.x / k, y: p.y / k };
    }
    for (const l of this.hoverListeners) l(id, at);
  }

  /** Draw calls of the last frame. */
  lastDrawCalls(): number {
    return this.drawCalls;
  }

  /** Frame time statistics over the frames of the last windowMs. */
  frameStats(windowMs = 5000): FrameStats {
    const n = Math.min(this.frameCount, FRAME_RING);
    const times: number[] = [];
    let total = 0;
    for (let i = 0; i < n && total < windowMs; i++) {
      const v = this.frameTimes[(this.frameCount - 1 - i + FRAME_RING) % FRAME_RING] as number;
      times.push(v);
      total += v;
    }
    if (times.length === 0) return { frames: 0, fps: 0, avgMs: 0, p95Ms: 0 };
    const sorted = [...times].sort((a, b) => a - b);
    const avg = total / times.length;
    return {
      frames: times.length,
      fps: 1000 / avg,
      avgMs: avg,
      p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number,
    };
  }

  private readonly onResize = (): void => {
    this.engine.resize();
    this.rig.update();
  };

  /** Render pixels per CSS pixel. */
  private ratio(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.canvas.clientWidth);
  }

  /** ID of the island whose detail is shown: the chosen one, else the first one. */
  private currentIslandId(): string {
    const islands = this.sync.getSnapshot().server?.display.islands ?? [];
    if (this.islandId && islands.some((is) => is.id === this.islandId)) return this.islandId;
    return islands[0]?.id ?? "";
  }

  /** Server display state of the island shown. */
  private displayIsland(): IslandDisplay | undefined {
    const id = this.currentIslandId();
    return this.sync.getSnapshot().server?.display.islands.find((is) => is.id === id);
  }

  private island(): Island | undefined {
    const id = this.currentIslandId();
    return id ? this.sync.getSnapshot().islands.get(id) : undefined;
  }

  /** Shows another island in the island view (a transition from the current view). */
  setIsland(id: string): void {
    this.setView({ kind: "island", id });
  }

  /**
   * Switches the view with a camera transition of TRANSITION_MS inside the
   * one scene: island → archipelago zooms out to the last archipelago
   * camera (or the whole archipelago); archipelago (or another island) →
   * island moves to that island's remembered camera (or its centre).
   */
  setView(view: RenderView): void {
    const cur = this.view;
    if (cur.kind === view.kind && (view.kind === "archipelago" || (cur.kind === "island" && cur.id === view.id))) return;
    this.view = view;
    if (view.kind === "island" && !this.archMode && !this.rig.animating() && view.id === this.shownIslandId) {
      // The island shown already (e.g. the first island resolved by ID): nothing moves.
      this.islandId = view.id;
      return;
    }
    if (!this.placedInitially) {
      if (view.kind === "island") this.islandId = view.id;
      this.archMode = view.kind === "archipelago";
      this.lastServer = null;
      this.onSnapshot(this.sync.getSnapshot());
      return;
    }
    const now = performance.now();
    this.roadStart = null;
    this.roads.setPreview([]);
    if (this.draggingShip !== null) {
      this.input.cancel(); // emits dropShip(null)
    }
    if (view.kind === "archipelago") {
      // A camera in the middle of a transition is not remembered.
      if (!this.archMode && !this.rig.animating()) this.islandCams.set(this.shownIslandId, this.rig.state());
      const target = this.archTarget();
      // Archipelago layers appear at once; the island's detail stays until
      // the camera has zoomed out (no blank frame).
      this.arch.setMode(true, this.shownIslandId);
      this.rig.animateTo(target, TRANSITION_MS, now, () => {
        this.archMode = true;
        this.applyMode();
      });
      return;
    }
    if (!this.rig.animating()) {
      if (this.archMode) this.saveArchCam();
      else this.islandCams.set(this.shownIslandId, this.rig.state());
    }
    this.archMode = false;
    // Re-base and start the animation before anything rebuilds: nothing may
    // clamp the camera into the destination's bounds before the first frame
    // (the transition starts exactly where the camera is).
    if (view.id !== this.shownIslandId) this.rebase(view.id);
    const target = this.islandCams.get(view.id) ?? this.islandCentre(view.id);
    this.rig.animateTo(target, TRANSITION_MS, now, () => this.applyMode());
    this.islandId = view.id;
    this.lastServer = null;
    this.onSnapshot(this.sync.getSnapshot());
    this.islandRoot.setEnabled(true);
    this.arch.setMode(true, view.id);
  }

  /** A view transition (camera animation) is running. */
  transitioning(): boolean {
    return this.rig.animating();
  }

  /** The displayed view (for tests and overlays). */
  currentView(): RenderView {
    return this.archMode ? { kind: "archipelago" } : { kind: "island", id: this.shownIslandId };
  }

  /** Re-bases the scene on another island: its tile (0,0) becomes the scene origin; the camera moves along. */
  private rebase(id: string): void {
    const to = this.arch.placement(id);
    if (!to) return;
    const from = this.arch.getOrigin();
    this.rig.shift(from.x - to.position.x, to.position.y - from.y);
    this.arch.setOrigin(to.position);
  }

  private islandCentre(id: string): CameraState {
    const st = this.sync.getSnapshot().islands.get(id);
    const p = this.arch.placement(id);
    const w = st?.width ?? p?.width ?? 0;
    const h = st?.height ?? p?.height ?? 0;
    return { x: w / 2, z: -h / 2, half: ISLAND_DEFAULT_HALF_HEIGHT };
  }

  private saveArchCam(): void {
    const s = this.rig.state();
    const p = this.arch.toArch(new Vector3(s.x, 0, s.z));
    this.archCam = { x: p.x, y: p.y, half: s.half };
  }

  /** Zoom range and bounds of the archipelago camera. */
  private archLimits(): { minHalf: number; maxHalf: number; centre: ArchPoint } | null {
    const b = this.arch.bounds();
    if (!b) return null;
    const aspect = this.rig.aspect();
    const maxHalf = fitHalfHeight(b.maxX - b.minX, b.maxY - b.minY, aspect);
    let largest = 0;
    for (const is of this.sync.getSnapshot().server?.display.islands ?? []) {
      largest = Math.max(largest, fitHalfHeight(is.width, is.height, aspect));
    }
    return { minHalf: Math.min(maxHalf, Math.max(8, largest)), maxHalf, centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } };
  }

  private archTarget(): CameraState {
    const lim = this.archLimits();
    if (this.archCam) {
      const w = this.arch.toWorld(this.archCam);
      const half = lim ? Math.min(lim.maxHalf, Math.max(lim.minHalf, this.archCam.half)) : this.archCam.half;
      return { x: w.x, z: w.z, half };
    }
    if (!lim) return this.rig.state();
    const w = this.arch.toWorld(lim.centre);
    return { x: w.x, z: w.z, half: lim.maxHalf };
  }

  /** Visibility and camera limits of the displayed mode. */
  private applyMode(): void {
    this.islandRoot.setEnabled(!this.archMode);
    this.arch.setMode(this.archMode, this.shownIslandId);
    this.harbour.setEnabled(!this.archMode);
    if (this.archMode) {
      const lim = this.archLimits();
      const b = this.arch.bounds();
      if (lim && b) {
        const o = this.arch.getOrigin();
        this.rig.setLimits(
          {
            minX: b.minX - ARCH_MARGIN - o.x,
            maxX: b.maxX + ARCH_MARGIN - o.x,
            minZ: -(b.maxY + ARCH_MARGIN - o.y),
            maxZ: -(b.minY - ARCH_MARGIN - o.y),
          },
          lim.minHalf,
          lim.maxHalf,
        );
      }
    } else {
      const st = this.island();
      if (st) this.rig.setBounds(st.width, st.height, false);
    }
  }

  private onSnapshot(snap: SyncSnapshot): void {
    if (snap.content !== this.lastContent && snap.content) {
      this.lastContent = snap.content;
      this.defs = new Map(snap.content.buildings.map((b) => [b.id, b]));
      this.lastServer = null; // rebuild with the new definitions
      this.lastArchServer = null;
    }
    if (snap.server && (snap.server !== this.lastArchServer || snap.islands !== this.lastIslands)) {
      this.lastArchServer = snap.server;
      this.lastIslands = snap.islands;
      const d = snap.server.display;
      this.arch.update(d.islands, snap.islands, d.ships, d.routes);
      if (!this.placedInitially || this.archMode) this.applyMode();
    }
    const shown = this.currentIslandId();
    if (shown && shown !== this.shownIslandId) {
      if (this.shownIslandId && this.arch.placement(shown)) this.rebase(shown);
      else {
        const p = this.arch.placement(shown);
        if (p) this.arch.setOrigin(p.position);
      }
      this.shownIslandId = shown;
      this.lastServer = null;
      if (!this.archMode) this.arch.setMode(false, shown);
    }
    const island = this.island();
    if (island && island.revision + island.id !== this.terrainRevision) {
      for (const m of this.terrain) m.dispose();
      this.terrain = buildTerrain(this.scene, island, this.islandRoot);
      this.terrainRevision = island.revision + island.id;
      this.deposits = new Map(island.deposits.map((d) => [tileKey(d), d.kind]));
      this.fertilities = island.fertilities;
      this.lastServer = null; // the harbour berths need the terrain
      if (!this.archMode && !this.rig.animating()) this.rig.setBounds(island.width, island.height, false);
    }
    if (!this.placedInitially && snap.server && (this.archMode ? this.arch.bounds() !== null : island !== undefined)) {
      this.placedInitially = true;
      if (this.archMode) {
        this.rig.setState(this.archTarget());
        this.applyMode();
      } else if (island) {
        this.rig.setBounds(island.width, island.height, true);
        this.rig.setState({ ...this.rig.state(), half: ISLAND_DEFAULT_HALF_HEIGHT });
      }
    }
    if (snap.server !== this.lastServer && snap.server && this.defs.size > 0) {
      this.lastServer = snap.server;
      const is = this.displayIsland();
      this.buildings.update(is?.buildings ?? [], this.defs);
      this.roads.update(is?.roads ?? []);
      this.roadTiles = new Set((is?.roads ?? []).map(tileKey));
      this.carts.update(is, this.defs);
      this.icons.update(is?.buildings ?? [], this.defs);
      this.harbour.update(is, island, snap.server.display.ships, this.defs);
      this.setSelected(this.selected);
    }
  }

  setSelected(id: number | null): void {
    this.selected = id;
    const b = this.displayIsland()?.buildings.find((x) => x.id === id);
    this.buildings.select(b, b ? this.defs.get(b.type) : undefined);
  }

  /** Archipelago selection ring, highlighted route and the edited route's draft stops. */
  setArchState(sel: ArchSelection, highlightRoute: number | null, draft: readonly string[] | null): void {
    this.arch.setSelection(sel);
    this.arch.setHighlight(highlightRoute);
    this.arch.setDraft(draft);
  }

  /** Centres the camera on a building. */
  focusBuilding(id: number): void {
    const b = this.displayIsland()?.buildings.find((x) => x.id === id);
    const def = b && this.defs.get(b.type);
    if (!b || !def) return;
    const { cx, cz } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
    this.rig.focus(new Vector3(cx, 0, cz));
  }

  /** Client (viewport CSS pixel) position of a scene point. */
  private worldToClient(v: Vector3): { x: number; y: number } {
    const p = this.rig.project(v);
    const r = this.canvas.getBoundingClientRect();
    const k = this.ratio();
    return { x: r.left + p.x / k, y: r.top + p.y / k };
  }

  /** Viewport position of an archipelago point in any view, also during transitions (tests). */
  archToClient(p: ArchPoint): { x: number; y: number } {
    return this.worldToClient(this.arch.toWorld(p, 0));
  }

  /** Canvas-relative CSS pixel position of an archipelago point (HTML overlays). */
  archToCanvas(p: ArchPoint, y = LABEL_Y): { x: number; y: number } {
    const s = this.rig.project(this.arch.toWorld(p, y));
    const k = this.ratio();
    return { x: s.x / k, y: s.y / k };
  }

  /** CSS-pixel viewport position of the centre of a tile of the island shown (NaN for another island or the archipelago view). */
  tileToScreen(islandId: string, x: number, y: number): { x: number; y: number } {
    if (this.archMode || this.rig.animating() || islandId !== this.currentIslandId()) return { x: NaN, y: NaN };
    return this.worldToClient(tileCenter(x, y));
  }

  /**
   * Viewport position of an island's anchor in the archipelago view, or of
   * the centre of one of its tiles when x and y are given (NaN in the island
   * view and during a transition).
   */
  islandToScreen(id: string, x?: number, y?: number): { x: number; y: number } {
    const p = this.arch.placement(id);
    if (!this.archMode || this.rig.animating() || !p) return { x: NaN, y: NaN };
    const at = x === undefined || y === undefined ? { x: p.width / 2, y: p.height / 2 } : { x: x + 0.5, y: y + 0.5 };
    return this.worldToClient(this.arch.toWorld({ x: p.position.x + at.x, y: p.position.y + at.y }, LABEL_Y));
  }

  /** Viewport position of a ship in the archipelago view, or of a ship at the harbour in the island view. */
  shipToScreen(id: number): { x: number; y: number } {
    if (this.rig.animating()) return { x: NaN, y: NaN };
    if (this.archMode) {
      const p = this.arch.shipPoint(id);
      return p ? this.worldToClient(this.arch.toWorld(p, LABEL_Y)) : { x: NaN, y: NaN };
    }
    for (const [sid, t] of this.harbour.drawnShips()) {
      if (sid === id) return this.worldToClient(new Vector3(t.x, 0, -t.y));
    }
    return { x: NaN, y: NaN };
  }

  /**
   * Instance style a ship was drawn with in the last frame ("unpaid" is the
   * greyed anchored_unpaid style), in the archipelago or at the harbour;
   * null when it was not drawn.
   */
  shipStyle(id: number): ShipStyle | null {
    if (this.archMode) return this.arch.shipStyle(id) ?? null;
    for (const [sid, d] of this.harbour.drawnShips()) if (sid === id) return d.style;
    return null;
  }

  /** Shipyard construction hulls drawn in the last frame of the island view. */
  constructionMarkers(): { buildingId: number; scale: number }[] {
    return this.archMode ? [] : this.harbour.constructionMarkers();
  }

  /** Archipelago position of a ship in the last frame (archipelago view). */
  shipPoint(id: number): ArchPoint | undefined {
    return this.archMode ? this.arch.shipPoint(id) : undefined;
  }

  /** The island under a render-pixel position (archipelago view). */
  private islandUnder(p: Point): string | null {
    const g = this.rig.groundAt(p.x, p.y);
    return g ? this.arch.islandAt(this.arch.toArch(g), this.sync.getSnapshot().islands) : null;
  }

  /** Nearest ship within the pick radius of a render-pixel position. */
  private shipUnder(p: Point): number | null {
    const k = this.ratio();
    let best: number | null = null;
    let bestD = SHIP_PICK_PX * k;
    const consider = (id: number, v: Vector3) => {
      const s = this.rig.project(v);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    };
    if (this.archMode) {
      for (const [id, a] of this.arch.shipPointEntries()) consider(id, this.arch.toWorld(a, LABEL_Y));
    } else {
      for (const [id, t] of this.harbour.drawnShips()) consider(id, new Vector3(t.x, 0.2, -t.y));
    }
    return best;
  }

  private tileAt(p: Point): TilePos | null {
    const g = this.rig.groundAt(p.x, p.y);
    return g ? worldToTile(g) : null;
  }

  private onWheel(p: Point, dy: number): void {
    if (this.rig.animating()) return;
    if (!this.archMode) {
      if (dy > 0 && this.rig.atMaxZoom()) this.events.zoomOutAtMax(dy);
      else this.events.zoomReset();
    }
    this.rig.zoom(Math.exp(dy * 0.0015), p);
  }

  private onTap(p: Point, button: number): void {
    if (this.rig.animating()) return;
    if (this.archMode) {
      if (button !== 0) return;
      const ship = this.shipUnder(p);
      if (ship !== null) {
        this.events.tapShip(ship);
        return;
      }
      const id = this.islandUnder(p);
      if (id) this.events.tapIsland(id);
      else this.events.tapSea();
      return;
    }
    const tool = this.tool();
    if (button === 2) {
      if (tool.kind !== "none") this.events.cancelTool();
      return;
    }
    if (button !== 0) return;
    const t = this.tileAt(p);
    if (!t) return;
    switch (tool.kind) {
      case "build":
        this.events.place(t.x, t.y);
        return;
      case "move":
        this.events.move(t.x, t.y);
        return;
      case "found":
        this.events.found(t.x, t.y);
        return;
      case "road":
        this.events.road(t, t);
        return;
      case "demolish":
        this.events.demolish(t.x, t.y);
        return;
      case "none": {
        const ship = this.shipUnder(p);
        if (ship !== null) {
          this.events.tapShip(ship);
          return;
        }
        const is = this.displayIsland();
        const b = is ? buildingAt(is.buildings, this.defs, t.x, t.y) : undefined;
        this.events.select(b?.id ?? null);
      }
    }
  }

  private pans(button: number): boolean {
    if (this.archMode) return button === 0 || button === 1 || button === 2;
    return button === 1 || button === 2 || (button === 0 && this.tool().kind === "none");
  }

  private onDragStart(p: Point, button: number): void {
    if (this.rig.animating()) return;
    if (this.archMode) {
      if (button !== 0) return;
      const id = this.shipUnder(p);
      const ship = id === null ? undefined : this.sync.getSnapshot().server?.display.ships.find((s) => s.id === id);
      // Only an idle ship can be sent; dragging any other ship pans.
      if (ship && ship.state === "idle" && ship.island_id) {
        this.draggingShip = ship.id;
        this.events.dragShip(ship.id, ship.island_id);
      }
      return;
    }
    if (button === 0 && this.tool().kind === "road") this.roadStart = this.tileAt(p);
  }

  private onDragMove(prev: Point, cur: Point, button: number): void {
    if (this.draggingShip !== null) {
      const g = this.rig.groundAt(cur.x, cur.y);
      if (g) this.arch.setDragged({ shipId: this.draggingShip, point: this.arch.toArch(g) });
      return;
    }
    if (this.roadStart && button === 0) {
      const t = this.tileAt(cur);
      if (t) this.roads.setPreview(lPath(this.roadStart, t));
      return;
    }
    if (this.pans(button)) this.rig.pan(prev, cur);
  }

  /** The pointer's press or drag was cancelled: drop any ship drag or road preview. */
  private onPointerCancel(): void {
    this.roadStart = null;
    this.roads.setPreview([]);
    if (this.draggingShip !== null) {
      this.draggingShip = null;
      this.arch.setDragged(null);
      this.events.dropShip(null);
    }
  }

  /**
   * Cancels a ship drag from outside (Esc, a view switch): the ship returns
   * to its place and the held pointer neither drags nor pans any more.
   */
  cancelShipDrag(): void {
    if (this.draggingShip === null) return;
    this.input.cancel();
    this.draggingShip = null;
    this.arch.setDragged(null);
  }

  /** A ship is being dragged. */
  draggingShipId(): number | null {
    return this.draggingShip;
  }

  private onDragEnd(p: Point, button: number): void {
    if (this.draggingShip !== null) {
      this.draggingShip = null;
      this.arch.setDragged(null);
      this.events.dropShip(this.archMode ? this.islandUnder(p) : null);
      return;
    }
    if (this.roadStart && button === 0) {
      const t = this.tileAt(p);
      const start = this.roadStart;
      this.roadStart = null;
      this.roads.setPreview([]);
      if (t && this.tool().kind === "road") this.events.road(start, t);
    }
  }

  /**
   * Placement/move ghost under the pointer. It turns red when the island
   * lacks the building's fertility or the footprint covers no deposit of
   * the required kind (lookups of the island's static data, with the reason
   * as hint text), and yellow when the building requires a road and none of
   * the server's road tiles touches the footprint (a "not connected" hint).
   * The click is never blocked; the server validates.
   */
  private updateGhost(): void {
    const tool = this.tool();
    const ghostTool = !this.archMode && (tool.kind === "build" || tool.kind === "move" || tool.kind === "found");
    const def = ghostTool ? this.defs.get(tool.buildingType) : undefined;
    const t = this.hover && def ? this.tileAt(this.hover) : null;
    if (!ghostTool || !def || !t) {
      this.ghost.setEnabled(false);
      this.setGhostHint(null);
      return;
    }
    const [w, h] = rotatedFootprint(def.width, def.height, tool.rotation);
    this.ghost.scaling.set(w, 0.6, h);
    this.ghost.position.set(t.x + w / 2, 0.3, -(t.y + h / 2));
    const fertility = fertilityNeed(def, this.fertilities);
    let hint: string | null = null;
    if (fertility && !fertility.present) {
      hint = missingFertilityText(fertility.fertility, this.fertilities);
    } else if (missingDepositHint(def, this.deposits, t.x, t.y, tool.rotation)) {
      hint = `Must cover a ${def.requires_deposit ?? ""} deposit`;
    }
    const color = hint ? GHOST_INVALID : missingRoadHint(def, this.roadTiles, t.x, t.y, tool.rotation) ? GHOST_NO_ROAD : GHOST;
    if (this.ghostMaterial.diffuseColor !== color) this.ghostMaterial.diffuseColor = color;
    this.ghost.setEnabled(true);
    this.setGhostHint(hint);
  }

  private setGhostHint(hint: string | null): void {
    if (hint === this.lastGhostHint) return;
    this.lastGhostHint = hint;
    this.events.ghostHint(hint);
  }
}
