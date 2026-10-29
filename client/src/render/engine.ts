// Babylon engine and scene of the game view. Created once per canvas and
// disposed once (React Strict Mode safe: the owner disposes in its effect
// cleanup). One continuous world (D-048): every island at its archipelago
// position with sea between, one free camera (pan, continuous zoom, free
// rotation easing to 45° steps, D-051), zoom-based LOD and frustum culling per island.
// Fixed golden-hour light with blob shadows everywhere and, at "high"
// quality (desktop layout), a sun shadow map, warm grading and FXAA
// (render/lighting.ts). Scene coordinates are archipelago coordinates: island
// tile (x, y) of an island at `position` is world
// (position.x + x, 0, −(position.y + y)).
import { Engine } from "@babylonjs/core/Engines/engine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { BuildingDisplay, ContentBuilding, Island, IslandDisplay, WorldResponse } from "../api/client";
import type { SyncSnapshot } from "../api/sync";
import { archipelagoRect, type CameraView, JUMP_MS, NEAR_DEFAULT_HALF_HEIGHT, seaMargin, snapRotation } from "../display/camera";
import { farmChain, fieldHintText, fieldPlacementHint } from "../display/fields";
import { fieldsUnder, type PaintDrag, paintAnchors, paintCountText, paintTiles, planPaint } from "../display/fieldpaint";
import { servedRelated } from "../display/served";
import { focusedIsland, islandRect, rectIntersectsQuad } from "../display/frustum";
import { type DecodedMask, decodeMask, MASK_BLOCK } from "../display/mask";
import { visibleChunks } from "../display/chunks";
import { BUILD_BUDGET_MS, type BuildItem, buildOrder, BuildScheduler } from "../display/buildqueue";
import { islandSeed } from "../display/scatter";
import { type MaskIsland, MaskLayer } from "./farmesh";
import { type LandmarkIsland, LandmarkLayer, showsLandmarks } from "./landmarks";
import { gridOverlayVisible } from "../display/grid";
import { buildingAt, lPath, missingDepositHint, missingRoadHint, type TilePos, tileKey, waterEdgeHint, waterRows } from "../display/geometry";
import { detailForLod, initialLod, type Lod, lodFor } from "../display/lod";
import type { LifeStats } from "../display/life";
import { type Quality, softwareRenderer } from "../display/quality";
import { type ArchPoint, dockPoints, seaPoint, shipLengthRatio } from "../display/ships";
import { depositText, fertilityNeed, missingFertilityText, waterEdgeText } from "../display/tiers";
import { WHEEL_ZOOM_RATE } from "../display/view";
import { type IslandTile, isGhostTool, type Tool } from "../ui/tools";
import { ArchipelagoLayer, type ArchSelection, DOCK_STERN } from "./archipelago";
import { CameraRig } from "./camera";
import { footprintBox } from "./coords";
import { FootprintMarks, type Mark } from "./fields";
import { islandBerths } from "./harbour";
import { PlacementGhost } from "./ghost";
import { GridOverlay } from "./grid";
import { IslandDetail } from "./island";
import { GHOST, GHOST_INVALID, GHOST_NO_ROAD, HAZE } from "./palette";
import { type AssetsStatus, buildingAnchor, type Detail, ModelRegistry } from "./models";
import { type Point, PointerInput, type PointerKind } from "./picking";
import { JumpLatch } from "./latch";
import { LIFE_CLASSES, LifeLayer } from "./life";
import { setSwayTime } from "./sway";
import { SceneLighting } from "./lighting";
import { RoadPreview } from "./roads";
import { PaintPreview, type PaintMark } from "./paint";

/**
 * Render resolution cap (render pixels per CSS pixel). High-DPR phones
 * (2.6–3) would otherwise shade 2–4× the pixels for little visible gain
 * on flat low-poly meshes; measured in the M3 perf notes.
 */
export const MAX_RENDER_DPR = 1.5;
/** Pick radius of ships (CSS pixels). */
const SHIP_PICK_PX = 18;
/** Right-drag rotation: quarter turns per CSS pixel of horizontal movement (45° per 120 px). */
const DRAG_TURN_PER_PX = 0.5 / 120;
const LABEL_Y = 0.4;

/** Where the camera starts: an island (default: the first) at the near default zoom, or the whole archipelago. */
export type InitialCamera = { kind: "island"; id?: string } | { kind: "fit" };


/** What the HUD needs to know about the camera. */
export interface CameraInfo {
  /** The focused island: under the camera target, else the nearest (UI only). */
  focus: string;
  lod: Lod;
  /** The rotation's nearest 45° step (quarter turns; reported on change only, not every frame of a free turn). */
  rotation: number;
}

export interface RendererEvents {
  /**
   * A tap on island land (ships first; within one tile of land). At near
   * LOD `building` is the building under the tile (null: none); at mid and
   * far LOD it is undefined (the island itself is meant).
   */
  tapIsland(id: string, building?: number | null): void;
  tapShip(id: number): void;
  /** Nothing hit (open sea or water away from land). */
  tapSea(): void;
  place(at: IslandTile): void;
  /** Touch: a tap put the placement ghost on a tile; Confirm places it. */
  pend(at: IslandTile): void;
  /**
   * A mouse or pen took over: the touch-pending tile of a ghost tool is
   * dropped (the preview follows the pointer).
   */
  unpend(): void;
  /** Two-finger twist with a ghost tool: rotate it by quarter turns (signed; one per 45° of twist). */
  rotateGhost(steps: number): void;
  move(at: IslandTile): void;
  found(at: IslandTile): void;
  road(island: string, from: TilePos, to: TilePos): void;
  /** Field tool (D-051 part 4): a mouse click on a tile places the ghost's field there. */
  placeField(at: IslandTile): void;
  /**
   * Field tool (D-054): a rectangle was painted — one place_fields with its
   * anchors (`clipped`: the drag was larger than one command takes).
   * Resolves to the server's per-tile results (null: the command failed).
   */
  paintFields(paint: FieldPaint): Promise<readonly { x: number; y: number; ok: boolean }[] | null>;
  /**
   * Removal rectangle (the field tool's "Remove fields" or the Demolish
   * tool over fields): one demolish_fields per farm with the rectangle's
   * tiles on its fields.
   */
  removeFields(island: string, farmId: number, tiles: TilePos[], clipped: boolean): void;
  /** The live count of a painted or removal rectangle ("n / max …"), null when no rectangle is dragged. */
  paintStatus(text: string | null): void;
  demolish(at: IslandTile): void;
  cancelTool(): void;
  /**
   * The placement ghost's hint changed: why the server would reject the
   * placement under the pointer (missing fertility or deposit), or null.
   */
  ghostHint(text: string | null): void;
  /** Long-press on a building, ship or island: select it and open its panel (no tool acts). */
  inspectBuilding(id: number): void;
  inspectShip(id: number): void;
  inspectIsland(id: string): void;
  /** The focused island, the LOD or the rotation changed. */
  camera(info: CameraInfo): void;
}

/** A painted field rectangle: the anchors of one place_fields. */
export interface FieldPaint {
  island: string;
  farmId: number;
  buildingType: string;
  rotation: number;
  tiles: TilePos[];
  clipped: boolean;
}

/** The part of GameSync the renderer reads. */
export interface RenderSource {
  subscribe(l: () => void): () => void;
  getSnapshot(): SyncSnapshot;
  serverNowMs(): number;
  /** The lazy tile loads' priorities: the island under the camera, then those in view (nearest first). */
  setTilePriority?(focus: string | null, inView: readonly string[]): void;
}

export interface FrameStats {
  frames: number;
  fps: number;
  avgMs: number;
  p95Ms: number;
  /** The longest frame of the window (hitches). */
  maxMs: number;
}

/** Lookups of one island for the ghost hints (rebuilt when its data changes). */
interface IslandLookups {
  display: IslandDisplay;
  statics: Island | undefined;
  deposits: Map<string, string>;
  roads: Set<string>;
}

const FRAME_RING = 2048;
/** Longest wait (ms) before loaded models replace their placeholders while more are still loading. */
const MODEL_REFRESH_MS = 400;

export class GameRenderer {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly rig: CameraRig;
  private readonly lighting: SceneLighting;
  private readonly arch: ArchipelagoLayer;
  /** Asset manifest and lazily loaded models of this scene. */
  private readonly models: ModelRegistry;
  /** A model finished loading since the last refresh (the layers swap placeholders in batches, see renderFrame). */
  private modelsDirty = false;
  private modelsRefreshedAt = 0;
  /** Model detail of the current LOD (full at near and mid, lite at far). */
  private detail: Detail = "full";
  private readonly details = new Map<string, IslandDetail>();
  /** Life layer (carts, walkers, smoke, …; docs/LIFE_LAYER.md): one mesh per element class for the scene. */
  private readonly life: LifeLayer;
  private readonly marks: FootprintMarks;
  private readonly roadPreview: RoadPreview;
  private readonly grid: GridOverlay;
  /** Ground point of the last touch tap or drag position (archipelago tiles): the grid's centre on touch. */
  private lastTouch: ArchPoint | null = null;
  /** The current drag is a finger's (its moves update lastTouch). */
  private touchDrag = false;
  /** Cache key of the field marks (recomputed only when they change) and the building the UI hovers (a fields list row). */
  private marksKey = "";
  private hoverBuilding: number | null = null;
  private readonly ghost: PlacementGhost;
  private lookups = new Map<string, IslandLookups>();
  private lastGhostHint: string | null = null;
  /** Validity the placement ghost was drawn with in the last frame (null: hidden). */
  private ghostValid: "ok" | "no_road" | "invalid" | null = null;
  /** The last pointer was a mouse or pen (the ghost follows it, not a touch-pending tile). */
  private precise = false;
  private readonly input: PointerInput;
  private readonly unsubscribe: () => void;
  private lastServer: WorldResponse | null = null;
  private lastIslands: ReadonlyMap<string, Island> | null = null;
  private lastContent: unknown = null;
  private defs = new Map<string, ContentBuilding>();
  private hover: Point | null = null;
  private roadStart: IslandTile | null = null;
  /** The rectangle being dragged with the field tool (place or remove) or the Demolish tool (remove fields). */
  private paint: (PaintDrag & { island: string; mode: "place" | "remove" }) | null = null;
  private readonly paintPreview: PaintPreview;
  /** Cache key of the painted rectangle's preview, and its marks' state for the release. */
  private paintKey = "";
  private lastPaintStatus: string | null = null;
  private selected: number | null = null;
  private placedInitially = false;
  /** Seed and roll of the archipelago on screen: a reroll (D-053) frames the new one. */
  private archipelagoKey = "";
  /** Presses that began during a camera jump are ignored until all their pointers are up. */
  private readonly latch = new JumpLatch();
  private lod: Lod = "near";
  private visible = new Set<string>();
  private viewKey = "";
  private info: CameraInfo = { focus: "", lod: "near", rotation: 0 };
  /** Rotation the status icons face (follows every frame of a turn). */
  private iconRotation = 0;
  /** The island whose HTML name label is at a client (viewport CSS) position, or null (set by the overlay). */
  private labelAt: ((clientX: number, clientY: number) => string | null) | null = null;
  private readonly frameListeners = new Set<() => void>();
  private readonly hoverListeners = new Set<(island: string | null, at: { x: number; y: number } | null) => void>();
  private readonly frameTimes = new Float64Array(FRAME_RING);
  private meshCount = 0;
  private frameCount = 0;
  private lastFrameAt = 0;
  private drawCalls = 0;
  private firstFrameMarked = false;
  /** The focused island was first drawn with its full tiles (the "ns-focus-tiles" mark). */
  private focusTilesMarked = false;
  /** Islands drawn from their 1:4 masks (no tiles yet; at far LOD all but the focused one). */
  private readonly mask: MaskLayer;
  /** Trading Posts and shipyards of the settled mask-drawn islands at far LOD. */
  private readonly landmarks: LandmarkLayer;
  /** The tile priorities last sent to the sync (focus and islands in view). */
  private priorityKey = "";
  /** The focused island at far LOD when the view was last applied (null at near and mid). */
  private maskFocus: string | null = null;
  /** Whether far LOD draws the islands other than the focused one from their masks. */
  private readonly farMask: boolean;
  /** Decoded masks by island ID. */
  private readonly masks = new Map<string, { raw: string; mask: DecodedMask }>();
  /** Animation time pinned by a test (server ms; null: live). */
  private frozenAt: number | null = null;
  /** The island builds' budget per frame; they start only after the first frame (sea, masks, ships and HUD come first). */
  private readonly builds = new BuildScheduler();
  /** Models loaded so far, and the count when each running island build started (a load during the build refreshes the island at its end). */
  private modelLoads = 0;
  private readonly buildLoads = new Map<string, number>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sync: RenderSource,
    private readonly tool: () => Tool,
    private readonly events: RendererEvents,
    private readonly initialCamera: InitialCamera = { kind: "island" },
    quality: Quality = "high",
    /** Keep FXAA at "high" also on software WebGL (?fxaa=1, the visual test of the FXAA path). */
    forceFxaa = false,
    /** The life layer (off with ?life=0, A/B comparisons). */
    life = true,
  ) {
    // The canvas renders at most MAX_RENDER_DPR pixels per CSS pixel (HTML
    // text and the HUD stay at the device resolution). Edges: multisampling
    // at "low"; "high" smooths them with FXAA instead (both together cost
    // twice for no visible gain). The context keeps the choice of the
    // quality it was created with.
    this.engine = new Engine(canvas, quality === "low", { stencil: false, preserveDrawingBuffer: false, limitDeviceRatio: MAX_RENDER_DPR }, true);
    this.scene = new Scene(this.engine);
    this.scene.onNewMeshAddedObservable.add(() => this.meshCount++);
    this.scene.clearColor = new Color4(HAZE.r, HAZE.g, HAZE.b, 1);
    this.scene.skipPointerMovePicking = true;
    this.rig = new CameraRig(this.scene, this.engine);
    const software = softwareRenderer(this.engine.getGlInfo().renderer);
    this.lighting = new SceneLighting(this.scene, this.rig.camera, quality, software && !forceFxaa, software);
    this.models = new ModelRegistry(this.scene);
    this.models.onChange(() => {
      this.modelsDirty = true;
      this.modelLoads++;
    });
    void this.models.loadManifest();
    this.arch = new ArchipelagoLayer(this.scene, this.models);
    this.mask = new MaskLayer(this.scene);
    this.landmarks = new LandmarkLayer(this.scene, this.models);
    // Measurement switch: ?farmask=0 keeps the full detail of every island in view at far LOD.
    this.farMask = new URLSearchParams(globalThis.location?.search ?? "").get("farmask") !== "0";
    this.life = new LifeLayer(this.scene, LIFE_CLASSES, quality, life, this.models);
    this.arch.setQuality(quality);
    this.marks = new FootprintMarks(this.scene);
    this.roadPreview = new RoadPreview(this.scene);
    this.grid = new GridOverlay(this.scene);
    this.paintPreview = new PaintPreview(this.scene);

    this.ghost = new PlacementGhost(this.scene, this.models);

    this.input = new PointerInput(canvas, () => this.ratio(), {
      pointerDown: (kind, first) => this.onPointerDown(kind, first),
      released: () => {
        this.latch.released();
        // A free turn (right-drag or twist) ends: ease to the nearest 45°.
        this.rig.snap();
      },
      tap: (p, button, kind) => this.onTap(p, button, kind),
      longPress: (p) => this.onLongPress(p),
      dragStart: (p, button, kind) => this.onDragStart(p, button, kind),
      dragMove: (prev, cur, button) => this.onDragMove(prev, cur, button),
      dragEnd: (p, button) => this.onDragEnd(p, button),
      pinch: (centre, prev, scale) => this.onPinch(centre, prev, scale),
      rotate: (steps, delta, centre) => this.onRotate(steps, delta, centre),
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
    const now = this.frozenAt ?? this.sync.serverNowMs();
    this.rig.tick(t);
    this.updateView();
    // Island builds run under the frame's time budget, never before the first frame.
    this.drainBuild();
    // Loaded models swap in once the requests in flight have settled (or
    // every MODEL_REFRESH_MS while many load): each swap re-merges chunks.
    if (this.modelsDirty && (this.models.status().pending.length === 0 || t - this.modelsRefreshedAt >= MODEL_REFRESH_MS)) {
      this.modelsDirty = false;
      this.modelsRefreshedAt = t;
      if (!this.docksAnchored && this.lastServer && this.models.manifest()) {
        this.docksAnchored = true;
        this.arch.setDocks(this.docks(this.lastServer.display));
      }
      for (const d of this.details.values()) d.refreshModels();
      this.landmarks.refresh();
      this.refreshCasters();
    }
    let casters = false;
    for (const d of this.details.values()) casters = d.frame(now) || casters;
    // Rise-ins that finished re-merged their chunks: new caster meshes.
    if (casters) this.refreshCasters();
    this.life.frame(now, this.lifeIslands(), this.lod);
    setSwayTime(now, this.life.isEnabled());
    this.arch.bobbing = this.life.isEnabled();
    this.arch.frame(now);
    this.updateGhost();
    this.updatePaint();
    // A pinned clock (shots) holds the flash of rejected tiles.
    this.paintPreview.tick(t, this.frozenAt !== null);
    this.updateGrid();
    this.updateMarks();
    this.engine._drawCalls.fetchNewFrame();
    this.scene.render();
    this.builds.frameRendered();
    this.drawCalls = this.engine._drawCalls.current;
    if (!this.models.rendered() && (this.arch.drawsModels() || [...this.details.values()].some((d) => d.drawsModels()))) this.models.markRendered();
    for (const l of this.frameListeners) l();
    if (!this.firstFrameMarked && this.placedInitially) {
      this.firstFrameMarked = true;
      performance.mark("ns-first-frame");
    }
    if (!this.focusTilesMarked && this.info.focus !== "" && this.details.get(this.info.focus)?.hasTiles()) {
      this.focusTilesMarked = true;
      performance.mark("ns-focus-tiles");
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

  /** The loaded static tiles of the islands (the minimap draws their relief; islands without tiles use their masks). */
  islandStatics(): ReadonlyMap<string, Island> {
    return this.sync.getSnapshot().islands;
  }

  /** Called after every rendered frame (HTML overlays follow the camera). */
  onFrame(l: () => void): () => void {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }

  /**
   * The island under the pointer at mid and far LOD with the pointer's
   * canvas-relative CSS position (null when none or at near LOD).
   */
  onHoverIsland(l: (island: string | null, at: { x: number; y: number } | null) => void): () => void {
    this.hoverListeners.add(l);
    return () => this.hoverListeners.delete(l);
  }

  private onHover(p: Point | null): void {
    this.hover = p;
    if (p) this.takePrecisePointer();
    if (this.hoverListeners.size === 0) return;
    let id: string | null = null;
    let at: { x: number; y: number } | null = null;
    if (p && this.lod === "far") {
      id = this.islandUnder(p);
      const k = this.ratio();
      at = { x: p.x / k, y: p.y / k };
    }
    for (const l of this.hoverListeners) l(id, at);
  }

  /**
   * Hit test of the island name labels (HTML buttons over the canvas that
   * do not take the pointer): taps and long-presses on a label mean its
   * island, after ships (a ship under a label stays pickable) and only
   * without a tool.
   */
  setLabelHitTest(f: ((clientX: number, clientY: number) => string | null) | null): void {
    this.labelAt = f;
  }

  /** The island whose label is under a render-pixel position. */
  private labelUnder(p: Point): string | null {
    if (!this.labelAt) return null;
    const r = this.canvas.getBoundingClientRect();
    const k = this.ratio();
    return this.labelAt(r.left + p.x / k, r.top + p.y / k);
  }

  /** The life plans of the islands in view with their archipelago origins. */
  /** The shown islands' life plans, with the chunks in view (life spawns only there). */
  private *lifeIslands(): Generator<{ origin: { x: number; y: number }; plan: IslandDetail["life"]; chunks: ReadonlySet<string> | null }> {
    for (const d of this.details.values()) {
      const o = d.lifeOrigin();
      if (o) yield { origin: o, plan: d.life, chunks: d.chunksInView() };
    }
  }

  /** Life instances and particles drawn in the last frame (null: the layer is off, ?life=0). */
  lifeStats(): LifeStats | null {
    return this.life.isEnabled() ? this.life.lastStats() : null;
  }

  /**
   * Pins the animation time (sea ripples, foam, carts, ships) to a server
   * time in ms, or releases it with null — deterministic screenshots.
   */
  freezeTime(ms: number | null): void {
    this.frozenAt = ms;
  }

  /** Render quality (high: shadow map and FXAA here, grading as the canvas overlay; low: blob shadows and the vignette only). */
  setQuality(q: Quality): void {
    this.lighting.setQuality(q);
    this.arch.setQuality(q);
    this.life.setQuality(q);
    this.refreshCasters();
  }

  quality(): Quality {
    return this.lighting.quality();
  }

  /** Shadow-map casters: the islands shown at near LOD. */
  private refreshCasters(): void {
    const out = [];
    for (const d of this.details.values()) out.push(...d.shadowCasters());
    this.lighting.setCasters(out);
  }

  /**
   * Load milestones: the first rendered frame with the camera placed and
   * the first frame that drew the focused island with its full tiles,
   * with their performance marks (ms since navigation start; null until
   * then or under a faked clock, where `make shots STATS=1` times the
   * flags itself).
   */
  timing(): { firstFrame: boolean; focusTiles: boolean; firstFrameMs: number | null; focusTilesMs: number | null } {
    const at = (name: string) => performance.getEntriesByName?.(name, "mark")[0]?.startTime ?? null;
    return { firstFrame: this.firstFrameMarked, focusTiles: this.focusTilesMarked, firstFrameMs: at("ns-first-frame"), focusTilesMs: at("ns-focus-tiles") };
  }

  /** Draw calls of the last frame. */
  lastDrawCalls(): number {
    return this.drawCalls;
  }

  /** Meshes created since start (a zoom must not create any: LOD changes only toggle pre-built geometry). */
  meshesCreated(): number {
    return this.meshCount;
  }

  /** The last frame's active meshes grouped by layer (the name up to its first "_" or digit): meshes and triangles (perf notes). */
  activeLayers(): Record<string, { meshes: number; tris: number }> {
    const out: Record<string, { meshes: number; tris: number }> = {};
    const meshes = this.scene.getActiveMeshes();
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes.data[i];
      if (!m) continue;
      const layer = m.name.replace(/^(island|models|trees|tree_shadows|scatter|terrain_lite|terrain|roads|field_decor|field|mask_terrain|blob_buildings|decor)[_].*$/, "$1");
      const e = (out[layer] ??= { meshes: 0, tris: 0 });
      e.meshes++;
      for (const sm of m.subMeshes ?? []) e.tris += Math.round(sm.indexCount / 3);
    }
    return out;
  }

  /** Draw calls, triangles (the scene's active indices of the last frame ÷ 3; shadow passes included) and the current LOD and model detail (the fps badge). */
  renderStats(): { drawCalls: number; triangles: number; lod: Lod | null; detail: Detail; queue: number } {
    let queue = 0;
    for (const d of this.details.values()) if (d.building()) queue += d.pendingChunks().length + (d.headPending() ? 1 : 0);
    // No level before the camera is placed on the world.
    return { drawCalls: this.drawCalls, triangles: Math.round(this.scene.getActiveIndices() / 3), lod: this.placedInitially ? this.lod : null, detail: this.detail, queue };
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
    if (times.length === 0) return { frames: 0, fps: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
    const sorted = [...times].sort((a, b) => a - b);
    const avg = total / times.length;
    return {
      frames: times.length,
      fps: 1000 / avg,
      avgMs: avg,
      p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number,
      maxMs: sorted[sorted.length - 1] as number,
    };
  }

  private readonly onResize = (): void => {
    this.engine.resize();
    this.rig.update();
    this.layoutSea();
  };

  /** Render pixels per CSS pixel. */
  private ratio(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.canvas.clientWidth);
  }

  // Camera ------------------------------------------------------------------

  /** Current level of detail. */
  currentLod(): Lod {
    return this.lod;
  }

  /** Whether the camera is zoomed out to its maximum (the region's cap or the whole archipelago; a pinch may stop within 2 %). */
  atZoomCap(): boolean {
    return this.rig.view().half >= this.rig.zoomRange().max * 0.98;
  }

  /** The island the camera is focused on ("" before the first view). */
  focusedIsland(): string {
    return this.info.focus;
  }

  /** Camera target (archipelago tiles), zoom and rotation step. */
  cameraView(): CameraView {
    return this.rig.view();
  }

  /** Sets (parts of) the camera at once, clamped like user input (tests, perf check). */
  setCamera(v: Partial<CameraView>): void {
    this.rig.setCamera(v);
  }

  /** The camera's ground footprint (archipelago tiles). */
  footprint(): [ArchPoint, ArchPoint, ArchPoint, ArchPoint] {
    return this.rig.footprint();
  }

  /** Turns the camera by 45° steps about its target, eased (positive: clockwise orbit seen from above; Q/E); target and zoom stay. */
  rotateCamera(steps: number): void {
    this.rig.step(steps);
  }

  /** Turns the camera freely by quarter turns about its target (compass drag); settleCamera() ends the turn. */
  turnCamera(quarters: number): void {
    if (this.rig.animating()) return;
    this.rig.rotateBy(quarters);
  }

  /** A free turn ended: ease to the nearest 45°. */
  settleCamera(): void {
    this.rig.snap();
  }

  /** Eases the camera back to the default heading (rotation 0; the compass's "north"). */
  faceDefaultHeading(): void {
    this.rig.face(0);
  }

  /** The camera moves on its own: a jump or a rotation ease runs (projected positions are NaN meanwhile). */
  private moving(): boolean {
    return this.rig.animating() || this.rig.turning();
  }

  /** Jumps to an island's centre (zooms in to the near default if farther out). */
  jumpToIsland(id: string): void {
    const p = this.arch.placement(id);
    if (!p) return;
    this.jump({ x: p.position.x + p.width / 2, y: p.position.y + p.height / 2 }, true);
  }

  /** Jumps to a building (zooms in to the near default if farther out). */
  jumpToBuilding(id: number): void {
    const found = this.findBuilding(id);
    const def = found && this.defs.get(found.b.type);
    if (!found || !def) return;
    const { cx, cz } = footprintBox(found.b.x, found.b.y, def.width, def.height, found.b.rotation);
    this.jump({ x: found.island.position.x + cx, y: found.island.position.y - cz }, true);
  }

  /** Pans to an archipelago point without changing the zoom (minimap). */
  jumpToPoint(p: ArchPoint): void {
    this.jump(p, false);
  }

  /**
   * Starts a camera animation of JUMP_MS. A gesture in progress is
   * cancelled (not continued after the jump); input is ignored while the
   * camera moves; a new jump replaces a running one.
   */
  private jump(to: ArchPoint, zoomIn: boolean): void {
    this.input.cancel();
    this.onPointerCancel();
    const cur = this.rig.view();
    const half = zoomIn ? Math.min(cur.half, NEAR_DEFAULT_HALF_HEIGHT) : cur.half;
    this.rig.animateTo({ x: to.x, y: to.y, half }, JUMP_MS, performance.now());
  }

  /** Pointer input is ignored: a camera jump runs or the current press began during one. */
  private blocked(): boolean {
    return this.latch.blocks(this.rig.animating());
  }

  /**
   * LOD, culling and the focused island for the current camera; work only
   * when the camera (or the islands) changed since the last frame.
   */
  private updateView(): void {
    const v = this.rig.view();
    const islands = this.sync.getSnapshot().server?.display.islands;
    if (!islands) return;
    const key = `${v.x}|${v.y}|${v.half}|${v.rotation}|${this.rig.aspect()}|${this.lastServer?.version ?? 0}|${islands.length}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    const lod = lodFor(v.half, this.lod);
    const detail = detailForLod(lod);
    if (detail !== this.detail) {
      this.detail = detail;
      for (const d of this.details.values()) d.setDetail(detail);
      this.refreshCasters();
    }
    const fp = this.rig.footprint();
    let changed = lod !== this.lod;
    for (const is of islands) {
      const vis = rectIntersectsQuad(islandRect(is), fp);
      if (vis !== this.visible.has(is.id)) {
        changed = true;
        if (vis) this.visible.add(is.id);
        else this.visible.delete(is.id);
      }
    }
    for (const id of this.visible) if (!islands.some((is) => is.id === id)) this.visible.delete(id);
    // At far LOD only the focused island keeps its detail: a new focus swaps it with the mask.
    const maskFocus = lod === "far" ? focusedIsland(islands, v) : null;
    if (maskFocus !== this.maskFocus) {
      this.maskFocus = maskFocus;
      changed = true;
    }
    this.lod = lod;
    if (changed) {
      this.applyView();
      // The hover tooltip is far-LOD only: drop or show it without waiting for a pointer move.
      if (this.hover) this.onHover(this.hover);
    }
    if (v.rotation !== this.iconRotation) {
      // Status icons face the camera at every azimuth.
      this.iconRotation = v.rotation;
      for (const d of this.details.values()) d.setRotation(v.rotation);
    }
    const focus = focusedIsland(islands, v);
    this.cullChunks(islands);
    // Tile priorities: the focused island, then the islands in view by distance from the view's centre.
    const dist = (is: IslandDisplay) => Math.hypot(is.position.x + is.width / 2 - v.x, is.position.y + is.height / 2 - v.y);
    const inView = islands
      .filter((is) => this.visible.has(is.id))
      .sort((a, b) => dist(a) - dist(b))
      .map((is) => is.id);
    const priorityKey = `${focus}|${inView.join(",")}`;
    if (priorityKey !== this.priorityKey) {
      this.priorityKey = priorityKey;
      this.sync.setTilePriority?.(focus, inView);
    }
    const heading = snapRotation(v.rotation);
    if (focus !== this.info.focus || lod !== this.info.lod || heading !== this.info.rotation) {
      this.info = { focus, lod, rotation: heading };
      this.events.camera(this.info);
    }
  }

  /**
   * Shows the layers of the current LOD for the islands in view. An
   * island's detail (both model and terrain details) is built the
   * first time it is in view with its tiles, so zooming and panning
   * afterwards only toggle pre-built geometry; an island in view is
   * brought up to date with its payload. An island without its tiles yet
   * is drawn from its 1:4 mask (render/farmesh.ts), and so is every island
   * but the focused one at far LOD (?farmask=0 turns that off for
   * measurements); a settled one of those keeps its Trading Post and
   * shipyards as lite models (render/landmarks.ts).
   */
  private applyView(): void {
    this.arch.show(this.lod);
    const snap = this.sync.getSnapshot();
    const d0 = snap.server?.display;
    const islands = d0?.islands ?? [];
    const v = this.rig.view();
    const focus = islands.length > 0 ? focusedIsland(islands, v) : null;
    const masked: MaskIsland[] = [];
    const landmarks: LandmarkIsland[] = [];
    for (const is of islands) {
      const shown = this.visible.has(is.id);
      let d = this.details.get(is.id);
      if (shown) d = this.ensureDetail(is, snap);
      const farMasked = this.farMask && this.lod === "far" && is.id !== focus;
      const useMask = !d?.hasTiles() || farMasked;
      d?.setShown(shown && !useMask, this.lod);
      if (useMask) masked.push({ id: is.id, position: is.position, mask: this.maskOf(is), seed: islandSeed(is.id, this.archipelagoKey), tiles: d?.farTerrain() ?? null });
      // At far LOD a settled island drawn from its mask keeps its Trading Post and shipyards.
      if (showsLandmarks(is, this.lod, focus, useMask)) landmarks.push(is);
    }
    this.mask.show(masked);
    this.landmarks.show(landmarks, this.defs);
    this.cullChunks(islands);
    this.refreshCasters();
  }

  /** Per-chunk culling: the chunks of each shown island in the camera's ground footprint. */
  private cullChunks(islands: readonly IslandDisplay[]): void {
    const fp = this.rig.footprint();
    for (const is of islands) {
      if (!this.visible.has(is.id)) continue;
      this.details.get(is.id)?.setVisibleChunks(visibleChunks(is, fp));
    }
  }

  /** The decoded mask of an island (cached per mask string). */
  private maskOf(is: IslandDisplay): DecodedMask {
    const c = this.masks.get(is.id);
    if (c && c.raw === is.terrain_mask && c.mask.width === Math.ceil(is.width / MASK_BLOCK)) return c.mask;
    const mask = decodeMask(is.terrain_mask, is.width, is.height);
    this.masks.set(is.id, { raw: is.terrain_mask, mask });
    return mask;
  }

  /** The detail of an island, created and brought up to date with its payload (null without content or statics). */
  private ensureDetail(is: IslandDisplay, snap: SyncSnapshot): IslandDetail | undefined {
    const statics = snap.islands.get(is.id);
    // Content (the building definitions) first: an island's layers are built with them (a fixture may define none).
    if (!statics || !this.lastContent) return this.details.get(is.id);
    let d = this.details.get(is.id);
    if (!d) {
      d = new IslandDetail(this.scene, is.id, is.position, this.models);
      d.setRotation(this.rig.view().rotation);
      d.setDetail(this.detail);
      d.setStages(this.life.isEnabled());
      this.details.set(is.id, d);
    }
    d.setPosition(is.position);
    if (d.hasTiles() && d.hasStatics(statics)) {
      // Built: payload changes rebuild only the touched chunks (a founding changes no terrain: settled or not, the colours are the same).
      d.setStatics(statics);
      if (!d.builtWith(is, this.defs)) {
        d.update(is, this.defs);
        this.applySelection();
      }
      return d;
    }
    // The first build (or new static data): queued in steps, drawn from the mask until done.
    const b = d.building();
    if (!b || b.statics !== statics) {
      d.startBuild(statics, is, this.defs);
      this.buildLoads.set(is.id, this.modelLoads);
    }
    return d;
  }

  /**
   * The pending island build steps in build order (display/buildqueue.ts):
   * the focused island first, then visible chunks before culled ones,
   * nearest to the camera's target first; an island's head steps stand for
   * it until they are done.
   */
  private buildItems(): BuildItem[] {
    const islands = this.sync.getSnapshot().server?.display.islands ?? [];
    const v = this.rig.view();
    const fp = this.rig.footprint();
    const items: BuildItem[] = [];
    for (const is of islands) {
      const d = this.details.get(is.id);
      if (!d?.building()) continue;
      const focus = is.id === this.info.focus;
      const shown = this.visible.has(is.id);
      const inView = shown ? visibleChunks(is, fp) : null;
      const head = d.headPending();
      let nearest = Infinity;
      for (const c of d.pendingChunks()) {
        const dist = Math.hypot(is.position.x + c.x + c.width / 2 - v.x, is.position.y + c.y + c.height / 2 - v.y);
        nearest = Math.min(nearest, dist);
        if (!head) items.push({ island: is.id, chunk: c.key, focus, visible: inView?.has(c.key) ?? false, dist });
      }
      if (head) items.push({ island: is.id, chunk: null, focus, visible: shown, dist: Number.isFinite(nearest) ? nearest : 0 });
    }
    return buildOrder(items);
  }

  /** Steps of the island builds within this frame's budget; finished islands replace their masks. */
  private drainBuild(): void {
    if (![...this.details.values()].some((d) => d.building())) return;
    let order: BuildItem[] | null = null;
    let i = 0;
    const done: string[] = [];
    this.builds.drain(
      () => {
        order ??= this.buildItems();
        const it = order[i];
        if (!it) return false;
        const d = this.details.get(it.island);
        if (d?.buildStep(it.chunk)) done.push(it.island);
        // An unfinished head or chunk keeps its place.
        if (it.chunk === null ? d?.headPending() : d?.chunkInProgress() === it.chunk) return true;
        if (it.chunk === null) {
          // The head is done: its chunks join the order.
          order = this.buildItems();
          i = 0;
        } else i++;
        return true;
      },
      () => performance.now(),
      BUILD_BUDGET_MS[this.quality()],
      // Builds wait for the decoration models (no chunk built with fallbacks and rebuilt on their arrival).
      this.models.decorReady(),
    );
    if (done.length === 0) return;
    for (const id of done) {
      // Models that loaded during the build: swap the island's placeholders now.
      if (this.buildLoads.get(id) !== this.modelLoads) this.details.get(id)?.refreshModels();
      this.buildLoads.delete(id);
    }
    this.viewKey = "";
    this.applyView();
    this.applySelection();
  }

  /** The pending island build steps in build order (`island/chunk`, `island/head`; stats and the test hook). */
  buildQueue(): string[] {
    return this.buildItems().map((it) => `${it.island}/${it.chunk ?? "head"}`);
  }

  private layoutSea(): void {
    const b = this.arch.bounds();
    if (b) this.arch.setSeaMargin(seaMargin(b, this.rig.aspect(), this.rig.zoomCap()));
  }

  // Data ----------------------------------------------------------------------

  /** Hull length of each ship type relative to the reference ship (content). */
  private shipLengths: ReadonlyMap<string, number> = new Map();
  /** The docks were laid with the model manifest (the berth anchors) at hand. */
  private docksAnchored = false;

  /** Pier and queue points of the ships at the Trading Posts (the berth anchors of the loaded models, else the front row). */
  private docks(d: { islands: readonly IslandDisplay[]; ships: readonly { id: number; type: string }[] }) {
    const types = new Map(d.ships.map((s) => [s.id, s.type]));
    return dockPoints(
      d.islands,
      this.defs,
      (b, def, name) => {
        const entry = this.models.entry(b.type);
        return entry ? buildingAnchor(entry, def, b, name) : null;
      },
      DOCK_STERN,
      (id) => this.shipLengths.get(types.get(id) ?? "") ?? 1,
    );
  }

  private onSnapshot(snap: SyncSnapshot): void {
    if (snap.content !== this.lastContent && snap.content) {
      this.lastContent = snap.content;
      this.defs = new Map(snap.content.buildings.map((b) => [b.id, b]));
      this.shipLengths = new Map(snap.content.ships.map((s) => [s.id, shipLengthRatio(s)]));
      this.arch.setShipLengths(this.shipLengths);
      // The zoom-out cap of the region (an older server sends none: no cap).
      this.rig.setZoomCap((snap.content.region.camera as { max_half_extent?: number } | undefined)?.max_half_extent ?? null);
      this.lastServer = null; // rebuild with the new definitions
    }
    if (!snap.server || (snap.server === this.lastServer && snap.islands === this.lastIslands)) return;
    this.lastServer = snap.server;
    this.lastIslands = snap.islands;
    const d = snap.server.display;
    // Harbour berths of every island with static data (archipelago tiles).
    const berths = new Map<string, ArchPoint[]>();
    for (const is of d.islands) {
      const st = snap.islands.get(is.id);
      if (!st) continue;
      berths.set(
        is.id,
        islandBerths(is, st, this.defs).map((t) => ({ x: is.position.x + t.x + 0.5, y: is.position.y + t.y + 0.5 })),
      );
    }
    // Ships at a Trading Post's pier moor at its berth anchors and queue beyond them (D-051, D-054).
    this.docksAnchored = !!this.models.manifest();
    this.arch.update(d.islands, d.ships, d.routes, berths, this.docks(d));
    this.lookups.clear();
    // The payload's bounds (D-053) cover every island, also those whose static data is still loading.
    this.rig.setIslandBounds(archipelagoRect(d.archipelago) ?? this.arch.bounds());
    this.layoutSea();
    const archipelagoKey = `${d.archipelago.seed}/${d.archipelago.roll}`;
    const rerolled = this.archipelagoKey !== "" && archipelagoKey !== this.archipelagoKey;
    this.archipelagoKey = archipelagoKey;
    if ((!this.placedInitially || rerolled) && d.islands.length > 0) {
      this.placedInitially = true;
      this.placeInitialCamera();
    }
    // Bring the islands in view up to date (the others when they come into view).
    this.viewKey = "";
    this.updateView();
    this.applyView();
    this.applySelection();
  }

  private placeInitialCamera(): void {
    const ic = this.initialCamera;
    if (ic.kind === "fit") {
      const b = this.arch.bounds();
      if (b) this.rig.setCamera({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, half: this.rig.zoomRange().max });
    } else {
      const d = this.sync.getSnapshot().server?.display;
      const islands = d?.islands ?? [];
      // The start at sea (D-051, D-053): nothing settled yet and the ship
      // at sea near the archipelago's centre — the camera opens on the
      // ship at the far zoom that shows the whole archipelago for the
      // choice of the home island.
      const sea = ic.id === undefined && !islands.some((x) => x.settled) ? d?.ships.find((s) => s.position) : undefined;
      const is = islands.find((x) => x.id === ic.id) ?? islands.find((x) => x.settled) ?? islands[0];
      if (sea?.position) {
        const p = seaPoint(sea.position);
        this.rig.setCamera({ x: p.x, y: p.y, half: this.rig.zoomRange().max });
      } else if (is) {
        this.rig.setCamera({ x: is.position.x + is.width / 2, y: is.position.y + is.height / 2, half: NEAR_DEFAULT_HALF_HEIGHT });
      }
    }
    this.lod = initialLod(this.rig.view().half);
  }

  private findBuilding(id: number): { b: BuildingDisplay; island: IslandDisplay } | undefined {
    for (const island of this.sync.getSnapshot().server?.display.islands ?? []) {
      const b = island.buildings.find((x) => x.id === id);
      if (b) return { b, island };
    }
    return undefined;
  }

  setSelected(id: number | null): void {
    this.selected = id;
    this.applySelection();
  }

  private applySelection(): void {
    const found = this.selected === null ? undefined : this.findBuilding(this.selected);
    for (const [islandId, d] of this.details) {
      const b = found && found.island.id === islandId ? found.b : undefined;
      const chain = b && found ? farmChain(b, found.island.buildings) : null;
      const def = b ? this.defs.get(b.type) : undefined;
      const related = b && found ? servedRelated(b, found.island.buildings, def) : [];
      d.select(b, def, chain?.farm ? [chain.farm.id, ...chain.fields.map((f) => f.id), ...related] : related);
    }
    // Tinting rebuilds the chunk meshes, which are the shadow casters.
    this.refreshCasters();
  }

  /** Selection ring, highlighted route and the edited route's draft stops. */
  setArchState(sel: ArchSelection, highlightRoute: number | null, draft: readonly string[] | null): void {
    this.arch.setSelection(sel);
    this.arch.setHighlight(highlightRoute);
    this.arch.setDraft(draft);
  }

  // Projections (overlays and tests) -----------------------------------------------

  /** Client (viewport CSS pixel) position of a world point. */
  private worldToClient(v: Vector3): { x: number; y: number } {
    const p = this.rig.project(v);
    const r = this.canvas.getBoundingClientRect();
    const k = this.ratio();
    return { x: r.left + p.x / k, y: r.top + p.y / k };
  }

  /** Viewport position of an archipelago point, also during camera animations (tests). */
  archToClient(p: ArchPoint): { x: number; y: number } {
    return this.worldToClient(new Vector3(p.x, 0, -p.y));
  }

  /** Canvas-relative CSS pixel position of an archipelago point (HTML overlays). */
  archToCanvas(p: ArchPoint, y = LABEL_Y): { x: number; y: number } {
    const s = this.rig.project(new Vector3(p.x, y, -p.y));
    const k = this.ratio();
    return { x: s.x / k, y: s.y / k };
  }

  /** CSS-pixel viewport position of the centre of an island tile, any island at any LOD (NaN for unknown islands and during a camera animation). */
  tileToScreen(islandId: string, x: number, y: number): { x: number; y: number } {
    const p = this.arch.placement(islandId);
    if (this.moving() || !p) return { x: NaN, y: NaN };
    return this.worldToClient(new Vector3(p.position.x + x + 0.5, 0, -(p.position.y + y + 0.5)));
  }

  /** Viewport position of a ship drawn in the last frame (NaN when not drawn or during a camera animation). */
  shipToScreen(id: number): { x: number; y: number } {
    const p = this.arch.shipPoint(id);
    if (this.moving() || !p) return { x: NaN, y: NaN };
    return this.worldToClient(new Vector3(p.x, this.shipPickY(), -p.y));
  }

  /** Height ships are picked and projected at (their hull). */
  private shipPickY(): number {
    return this.lod === "far" ? 0.6 : 0.2;
  }

  /** Archipelago position of a ship in the last frame. */
  shipPoint(id: number): ArchPoint | undefined {
    return this.arch.shipPoint(id);
  }

  /** Ship IDs with their last-frame position (minimap dots). */
  shipPoints(): IterableIterator<[number, ArchPoint]> {
    return this.arch.shipPointEntries();
  }

  /** Landmark markers drawn (far LOD). */
  /**
   * Asset loading state, the content IDs drawn with a placeholder (islands
   * at near LOD, ships) and the buildings still drawn with the other
   * detail's model (bridged) until the wanted file has loaded and swapped in.
   */
  assets(): AssetsStatus & { placeholders: string[]; bridged: number } {
    const placeholders = new Set<string>(this.arch.shipPlaceholders());
    let bridged = 0;
    for (const d of this.details.values()) {
      for (const id of d.placeholders()) placeholders.add(id);
      bridged += d.bridged();
    }
    return { ...this.models.status(), placeholders: [...placeholders].sort(), bridged };
  }

  // Picking ----------------------------------------------------------------------

  /** Archipelago point on the ground under a render-pixel position. */
  private groundPoint(p: Point): ArchPoint | null {
    const g = this.rig.groundAt(p.x, p.y);
    return g ? { x: g.x, y: -g.z } : null;
  }

  /** The island whose land is under (or within one tile of) a render-pixel position. */
  private islandUnder(p: Point): string | null {
    const g = this.groundPoint(p);
    return g ? this.arch.islandAt(g, this.sync.getSnapshot().islands) : null;
  }

  /** The tile under a render-pixel position, on the island whose rectangle contains it (null over the open sea). */
  private tileAt(p: Point): IslandTile | null {
    const g = this.groundPoint(p);
    if (!g) return null;
    const id = this.arch.islandRectAt(g);
    const pl = id ? this.arch.placement(id) : undefined;
    if (!id || !pl) return null;
    return { island: id, x: Math.floor(g.x - pl.position.x), y: Math.floor(g.y - pl.position.y) };
  }

  /** The tile under a render-pixel position in the local coordinates of a given island (also outside its rectangle). */
  private tileOn(island: string, p: Point): TilePos | null {
    const g = this.groundPoint(p);
    const pl = this.arch.placement(island);
    if (!g || !pl) return null;
    return { x: Math.floor(g.x - pl.position.x), y: Math.floor(g.y - pl.position.y) };
  }

  /** Nearest ship within the pick radius of a render-pixel position. */
  private shipUnder(p: Point): number | null {
    const k = this.ratio();
    const y = this.shipPickY();
    let best: number | null = null;
    let bestD = SHIP_PICK_PX * k;
    for (const [id, a] of this.arch.shipPointEntries()) {
      const s = this.rig.project(new Vector3(a.x, y, -a.y));
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private displayIsland(id: string): IslandDisplay | undefined {
    return this.sync.getSnapshot().server?.display.islands.find((is) => is.id === id);
  }

  // Input ------------------------------------------------------------------------

  private onWheel(p: Point, dy: number): void {
    // The wheel is not part of a press: only a running jump ignores it.
    if (this.rig.animating()) return;
    this.rig.zoom(Math.exp(dy * WHEEL_ZOOM_RATE), p);
  }

  /**
   * Touch has no hover: a stale mouse position must not place the ghost.
   * A mouse or pen press takes over from a pending touch tile. A press
   * that begins during a camera jump is ignored until all its pointers are
   * up (JumpLatch), also when it turns into another gesture meanwhile.
   */
  private onPointerDown(kind: PointerKind, first: boolean): void {
    this.latch.down(first, this.rig.animating());
    if (kind === "touch") {
      this.precise = false;
      if (this.hover) this.onHover(null);
    } else {
      this.takePrecisePointer();
    }
  }

  /**
   * A mouse or pen is in use: the ghost follows it at once (also before
   * the UI state drops the pending tile), so a click places exactly what
   * the preview shows.
   */
  private takePrecisePointer(): void {
    this.precise = true;
    const tool = this.tool();
    if (isGhostTool(tool) && tool.pending) this.events.unpend();
  }

  /** Validity colour of the placement ghost in the last frame: neutral, yellow (no road) or red (null: hidden). */
  ghostValidity(): "ok" | "no_road" | "invalid" | null {
    return this.ghostValid;
  }

  /** The farm's field row the UI hovers (a building ID) is outlined; null clears it. */
  setHoverBuilding(id: number | null): void {
    this.hoverBuilding = id;
  }

  /** Two-finger pan and pinch zoom (any tool). */
  private onPinch(centre: Point, prev: Point, scale: number): void {
    if (this.blocked()) return;
    this.rig.pan(prev, centre);
    this.rig.zoom(1 / scale, centre);
  }

  /**
   * Two-finger twist: with a ghost tool every 45° of twist rotates the
   * ghost by a quarter turn; otherwise the camera turns continuously about
   * the fingers' midpoint so that the world follows the fingers (a
   * clockwise twist turns the map clockwise on screen) and eases to the
   * nearest 45° when the fingers lift.
   */
  private onRotate(steps: number, delta: number, centre: Point): void {
    if (this.blocked()) return;
    if (isGhostTool(this.tool())) {
      if (steps !== 0) this.events.rotateGhost(steps);
    } else if (delta !== 0) this.rig.rotateBy(-delta / (Math.PI / 2), centre);
  }

  /**
   * Long-press inspects: a ship, a building (near and mid LOD) or an island (far
   * LOD) under the finger is selected and its panel opens; the
   * active tool stays and nothing is placed or demolished.
   */
  private onLongPress(p: Point): void {
    if (this.blocked()) return;
    const ship = this.shipUnder(p);
    if (ship !== null) {
      this.events.inspectShip(ship);
      return;
    }
    const label = this.labelUnder(p);
    if (label) {
      this.events.inspectIsland(label);
      return;
    }
    if (this.lod === "far") {
      const id = this.islandUnder(p);
      if (id) this.events.inspectIsland(id);
      return;
    }
    const t = this.tileAt(p);
    const is = t ? this.displayIsland(t.island) : undefined;
    const b = t && is ? buildingAt(is.buildings, this.defs, t.x, t.y) : undefined;
    if (b) this.events.inspectBuilding(b.id);
  }

  private onTap(p: Point, button: number, kind: PointerKind): void {
    if (this.blocked()) return;
    if (kind === "touch") this.lastTouch = this.groundPoint(p);
    const tool = this.tool();
    if (button === 2) {
      if (tool.kind !== "none") this.events.cancelTool();
      return;
    }
    if (button !== 0) return;
    if (tool.kind === "none") {
      const ship = this.shipUnder(p);
      if (ship !== null) {
        this.events.tapShip(ship);
        return;
      }
      // A name label (far LOD only) means its island (the island card).
      const label = this.labelUnder(p);
      if (label) {
        this.events.tapIsland(label);
        return;
      }
      const id = this.islandUnder(p);
      if (!id) {
        this.events.tapSea();
        return;
      }
      if (this.lod === "far") {
        this.events.tapIsland(id);
        return;
      }
      const t = this.tileOn(id, p);
      const is = this.displayIsland(id);
      const b = t && is ? buildingAt(is.buildings, this.defs, t.x, t.y) : undefined;
      this.events.tapIsland(id, b?.id ?? null);
      return;
    }
    // A tool acts on the island whose rectangle is under the pointer.
    const t = this.tileAt(p);
    if (!t) return;
    // Removing fields acts at once (mouse and touch), like the Demolish tool.
    if (tool.kind === "field" && tool.remove) {
      this.removeFieldsAt(t.island, [t], tool.farmId, false);
      return;
    }
    // Touch has no hover: a tap only positions the ghost; Confirm places it.
    if (kind === "touch" && isGhostTool(tool)) {
      this.events.pend(t);
      return;
    }
    switch (tool.kind) {
      case "build":
        this.events.place(t);
        return;
      case "move":
        this.events.move(t);
        return;
      case "found":
        this.events.found(t);
        return;
      case "road":
        this.events.road(t.island, t, t);
        return;
      case "field":
        this.events.placeField(t);
        return;
      case "demolish":
        this.events.demolish(t);
    }
  }

  /** The middle button pans, and the left one without a tool; the right button turns the camera (right-drag). */
  private pans(button: number): boolean {
    return button === 1 || (button === 0 && this.tool().kind === "none");
  }

  private onDragStart(p: Point, button: number, kind: PointerKind): void {
    if (this.blocked()) return;
    this.touchDrag = kind === "touch";
    if (kind === "touch") this.lastTouch = this.groundPoint(p);
    const tool = this.tool();
    if (button !== 0) return;
    if (tool.kind === "none") return;
    if (tool.kind === "road") this.roadStart = this.tileAt(p);
    // Field tool: paint (or remove) a rectangle; the Demolish tool removes the fields under one.
    if (tool.kind === "field" || tool.kind === "demolish") {
      const t = this.tileAt(p);
      if (t) this.paint = { island: t.island, start: t, end: t, mode: tool.kind === "field" && !tool.remove ? "place" : "remove" };
    }
  }

  private onDragMove(prev: Point, cur: Point, button: number): void {
    if (this.blocked()) return;
    if (this.touchDrag) this.lastTouch = this.groundPoint(cur) ?? this.lastTouch;
    if (this.paint && button === 0) {
      const t = this.tileOn(this.paint.island, cur);
      if (t) this.paint.end = { x: t.x, y: t.y };
      return;
    }
    if (this.roadStart && button === 0) {
      const t = this.tileOn(this.roadStart.island, cur);
      const pl = this.arch.placement(this.roadStart.island);
      if (t && pl) this.roadPreview.set(lPath(this.roadStart, t).map((q) => ({ x: q.x + pl.position.x, y: q.y + pl.position.y })));
      return;
    }
    // Right-drag turns the camera about its target: dragging right turns the map counter-clockwise on screen.
    if (button === 2) {
      this.rig.rotateBy(((cur.x - prev.x) / this.ratio()) * DRAG_TURN_PER_PX);
      return;
    }
    if (this.pans(button)) this.rig.pan(prev, cur);
  }

  /** The pointer's press or drag was cancelled: drop any road preview or painted rectangle; a free turn eases to 45°. */
  private onPointerCancel(): void {
    this.rig.snap();
    this.roadStart = null;
    this.roadPreview.set([]);
    this.paint = null;
  }

  /**
   * Esc during a drag: the painted rectangle or road is dropped and the
   * tool stays (true); false when no such drag runs.
   */
  cancelDrag(): boolean {
    if (!this.paint && !this.roadStart) return false;
    this.input.cancel();
    this.onPointerCancel();
    return true;
  }

  private onDragEnd(p: Point, button: number): void {
    if (button === 2) this.rig.snap();
    if (this.blocked()) {
      this.onPointerCancel();
      return;
    }
    if (this.paint && button === 0) {
      const paint = this.paint;
      const t = this.tileOn(paint.island, p);
      if (t) paint.end = { x: t.x, y: t.y };
      this.paint = null;
      this.commitPaint(paint);
      return;
    }
    if (this.roadStart && button === 0) {
      const start = this.roadStart;
      const t = this.tileOn(start.island, p);
      this.roadStart = null;
      this.roadPreview.set([]);
      if (t && this.tool().kind === "road") this.events.road(start.island, start, t);
    }
  }

  // Tool previews ---------------------------------------------------------------------

  /** Lookups of an island for the ghost hints (cached per payload). */
  private lookup(id: string): IslandLookups | undefined {
    const display = this.displayIsland(id);
    if (!display) return undefined;
    const statics = this.sync.getSnapshot().islands.get(id);
    let l = this.lookups.get(id);
    if (!l || l.display !== display || l.statics !== statics) {
      l = {
        display,
        statics,
        deposits: new Map((statics?.deposits ?? []).map((d) => [tileKey(d), d.kind])),
        roads: new Set(display.roads.map(tileKey)),
      };
      this.lookups.set(id, l);
    }
    return l;
  }

  /**
   * Outlines of a farm's chain (D-051 part 4): the farm and its fields of the
   * selected building (a farm or one of its fields) and of the farm the field
   * tool adds to — active fields green, inactive ones yellow, the farm blue
   * (the selected chain is tinted green like the selected building instead:
   * only its inactive fields keep a mark) —
   * and the field row the UI hovers. Drawn at near LOD only; recomputed when
   * the selection, the tool, the hover or the server state changes.
   */
  private updateMarks(): void {
    const tool = this.tool();
    const server = this.sync.getSnapshot().server;
    const key = `${this.selected ?? ""}|${this.hoverBuilding ?? ""}|${tool.kind === "field" ? tool.farmId : ""}|${server?.version ?? 0}|${this.lod}`;
    if (key === this.marksKey) return;
    this.marksKey = key;
    const marks: Mark[] = [];
    if (this.lod === "near") {
      const add = (island: IslandDisplay, b: BuildingDisplay, kind: Mark["kind"]) => {
        const def = this.defs.get(b.type);
        if (!def) return;
        const { cx, cz, w, h } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
        marks.push({ cx: cx + island.position.x, cz: cz - island.position.y, w, h, kind });
      };
      const chainOf = (found: { b: BuildingDisplay; island: IslandDisplay } | undefined, selection = false) => {
        if (!found) return;
        const { farm, fields } = farmChain(found.b, found.island.buildings);
        if (!farm) return;
        // The selected chain is tinted green like the building; only the inactive fields keep a (yellow) mark.
        if (!selection) add(found.island, farm, "farm");
        for (const f of fields) {
          if (f.active === false) add(found.island, f, "inactive");
          else if (!selection) add(found.island, f, "active");
        }
      };
      if (this.selected !== null) chainOf(this.findBuilding(this.selected), true);
      if (tool.kind === "field" && tool.farmId !== this.selected) chainOf(this.findBuilding(tool.farmId));
      const hover = this.hoverBuilding === null ? undefined : this.findBuilding(this.hoverBuilding);
      if (hover) add(hover.island, hover.b, "hover");
    }
    this.marks.set(marks);
  }

  /**
   * Placement/move ghost under the pointer, on the island whose rectangle
   * it is over: the building's model, translucent and tinted (render/
   * ghost.ts), at the tool's rotation. It turns red when that island lacks the building's
   * fertility or the footprint covers no deposit of the required kind
   * (lookups of the island's static data, with the reason as hint text),
   * and yellow when the building requires a road and none of the server's
   * road tiles touches the footprint (a "not connected" hint). The click is
   * never blocked; the server validates.
   */
  private updateGhost(): void {
    const tool = this.tool();
    const ghostTool = isGhostTool(tool);
    const def = ghostTool ? this.defs.get(tool.buildingType) : undefined;
    // Touch: the pending tile; mouse or pen: the tile under the pointer.
    const hovered = this.hover ? this.tileAt(this.hover) : null;
    const t = !ghostTool || !def ? null : this.precise ? hovered : (tool.pending ?? hovered);
    const l = t ? this.lookup(t.island) : undefined;
    const pl = t ? this.arch.placement(t.island) : undefined;
    // A painted rectangle and the removal mode have their own preview (updatePaint).
    const painting = this.paint !== null || (tool.kind === "field" && tool.remove === true);
    if (!ghostTool || !def || !t || !pl || painting) {
      this.ghost.hide();
      this.ghostValid = null;
      this.setGhostHint(null);
      return;
    }
    const fertilities = l?.statics?.fertilities ?? [];
    const fertility = fertilityNeed(def, fertilities);
    let hint: string | null = null;
    if (fertility && !fertility.present) {
      hint = missingFertilityText(fertility.fertility, fertilities);
    } else if (missingDepositHint(def, l?.deposits ?? new Map(), t.x, t.y, tool.rotation)) {
      hint = depositText(def.requires_deposit ?? "");
    } else if (l?.statics && def.water_tiles) {
      const st = l.statics;
      const terrain = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= st.width || ty >= st.height ? "water" : (st.terrain[ty * st.width + tx] ?? "water"));
      const edge = waterEdgeHint(def, terrain, t.x, t.y, tool.rotation);
      if (edge) hint = waterEdgeText(edge, def.water_tiles);
    }
    // A field is checked against its farm's chain (a hint; the server validates).
    if (tool.kind === "field" && !hint) {
      const farm = this.findBuilding(tool.farmId);
      if (!farm || farm.island.id !== t.island) {
        hint = "Fields are added on the island of their farm";
      } else if (l?.statics) {
        const h = fieldPlacementHint(farm.b, def, t.x, t.y, tool.rotation, {
          island: l.statics,
          buildings: l.display.buildings,
          roads: l.display.roads,
          defs: this.defs,
        });
        if (h) hint = fieldHintText(h, def.name, this.defs.get(farm.b.type)?.name ?? farm.b.type);
      }
    }
    // Founding needs no road (the island has none yet); a field has none either.
    const noRoad = tool.kind !== "found" && missingRoadHint(def, l?.roads ?? new Set(), t.x, t.y, tool.rotation);
    this.ghostValid = hint ? "invalid" : noRoad ? "no_road" : "ok";
    const color = this.ghostValid === "invalid" ? GHOST_INVALID : this.ghostValid === "no_road" ? GHOST_NO_ROAD : GHOST;
    const moved = tool.kind === "move" ? this.findBuilding(tool.buildingId)?.b : undefined;
    this.ghost.show(
      {
        def,
        island: pl.position,
        x: t.x,
        y: t.y,
        rotation: tool.rotation,
        waterRows: waterRows(def, t.x, t.y, tool.rotation),
        ...(moved ? { buildingId: moved.id, level: moved.level ?? 1 } : {}),
      },
      color,
    );
    this.setGhostHint(hint);
  }

  /**
   * The painted rectangle's preview (D-054) and its live count while a
   * rectangle is dragged: the field tool's anchors coloured by the client
   * hint (display/fieldpaint.ts), or the fields a removal rectangle takes;
   * in the field tool's removal mode without a drag, the field under the
   * mouse. Recomputed only when the rectangle, the tool or the server
   * state changes.
   */
  private updatePaint(): void {
    const tool = this.tool();
    const server = this.sync.getSnapshot().server;
    let drag = this.paint;
    if (!drag && tool.kind === "field" && tool.remove && this.precise && this.hover) {
      const t = this.tileAt(this.hover);
      if (t) drag = { island: t.island, start: t, end: t, mode: "remove" };
    }
    const toolKey = tool.kind === "field" ? `${tool.farmId}|${tool.buildingType}|${tool.rotation}|${tool.remove ? 1 : 0}` : tool.kind;
    const key = drag
      ? `${drag.mode}|${drag.island}|${drag.start.x},${drag.start.y}|${drag.end.x},${drag.end.y}|${toolKey}|${server?.version ?? 0}|${this.paint ? 1 : 0}`
      : "";
    if (key === this.paintKey) return;
    this.paintKey = key;
    const pl = drag ? this.arch.placement(drag.island) : undefined;
    if (!drag || !pl) {
      this.paintPreview.set([]);
      this.setPaintStatus(null);
      return;
    }
    const mark = (x: number, y: number, w: number, h: number, kind: PaintMark["kind"]): PaintMark => ({ cx: pl.position.x + x + w / 2, cz: -(pl.position.y + y + h / 2), w, h, kind });
    if (drag.mode === "place") {
      const p = this.paintPlanOf(drag);
      if (!p) {
        this.paintPreview.set([]);
        this.setPaintStatus(null);
        return;
      }
      const { plan } = p;
      this.paintPreview.set(plan.tiles.map((t) => mark(t.x, t.y, plan.w, plan.h, t.hint === null ? "ok" : t.hint === "max_reached" ? "max" : "bad")));
      this.setPaintStatus(p.wrongIsland ? "Fields are added on the island of their farm" : paintCountText(plan));
      return;
    }
    const { tiles, clipped } = paintTiles(drag);
    const l = this.lookup(drag.island);
    const groups = l ? fieldsUnder(tiles, l.display.buildings, this.defs, tool.kind === "field" ? tool.farmId : null) : new Map();
    const marks: PaintMark[] = [];
    let n = 0;
    for (const g of groups.values()) {
      for (const f of g.fields) {
        const def = this.defs.get(f.type);
        if (!def) continue;
        const { w, h } = footprintBox(f.x, f.y, def.width, def.height, f.rotation);
        marks.push(mark(f.x, f.y, w, h, "remove"));
        n++;
      }
    }
    this.paintPreview.set(marks);
    if (!this.paint) {
      this.setPaintStatus(null);
      return;
    }
    const name = tool.kind === "field" ? (this.defs.get(tool.buildingType)?.name ?? "field").toLowerCase() : "field";
    this.setPaintStatus(`Remove ${n} ${n === 1 ? name : `${name}s`}${clipped ? " · clipped to 512 tiles" : ""}`);
  }

  /** The anchors of a painted rectangle and their hint for the field tool (null: no field tool or its farm is gone). */
  private paintPlanOf(drag: PaintDrag & { island: string }): { plan: ReturnType<typeof planPaint>; wrongIsland: boolean } | null {
    const tool = this.tool();
    if (tool.kind !== "field") return null;
    const def = this.defs.get(tool.buildingType);
    const farm = this.findBuilding(tool.farmId);
    const l = this.lookup(drag.island);
    if (!def || !farm || !l?.statics) return null;
    const [w, h] = tool.rotation === 90 || tool.rotation === 270 ? [def.height, def.width] : [def.width, def.height];
    const { anchors, clipped } = paintAnchors(drag, w, h);
    const plan = planPaint(farm.b, def, anchors, tool.rotation, { island: l.statics, buildings: l.display.buildings, roads: l.display.roads, defs: this.defs }, clipped);
    const wrongIsland = farm.island.id !== drag.island;
    if (wrongIsland) for (const t of plan.tiles) t.hint = "not_adjacent";
    return { plan, wrongIsland };
  }

  /** A released rectangle: one place_fields (its rejected anchors flash), or the removal of the fields under it. */
  private commitPaint(paint: PaintDrag & { island: string; mode: "place" | "remove" }): void {
    const tool = this.tool();
    if (paint.mode === "remove") {
      const { tiles, clipped } = paintTiles(paint);
      this.removeFieldsAt(paint.island, tiles, tool.kind === "field" ? tool.farmId : null, clipped);
      return;
    }
    const p = this.paintPlanOf(paint);
    const pl = this.arch.placement(paint.island);
    if (tool.kind !== "field" || !p || p.wrongIsland || !pl) return;
    const { plan } = p;
    void this.events
      .paintFields({ island: paint.island, farmId: tool.farmId, buildingType: tool.buildingType, rotation: tool.rotation, tiles: plan.tiles.map((t) => ({ x: t.x, y: t.y })), clipped: plan.clipped })
      .then((results) => {
        if (!results) return;
        const rejected = results.filter((r) => !r.ok);
        this.paintPreview.flash(
          rejected.map((r) => ({ cx: pl.position.x + r.x + plan.w / 2, cz: -(pl.position.y + r.y + plan.h / 2), w: plan.w, h: plan.h })),
          performance.now(),
        );
      });
  }

  /** Removes the fields (of one farm, or of any farm: null) under tiles of an island: one demolish_fields per farm. */
  private removeFieldsAt(island: string, tiles: readonly TilePos[], farmId: number | null, clipped: boolean): void {
    const l = this.lookup(island);
    if (!l) return;
    for (const [farm, g] of fieldsUnder(tiles, l.display.buildings, this.defs, farmId)) this.events.removeFields(island, farm, g.tiles, clipped);
  }

  /** Marks of the painted rectangle by kind and the anchors flashing (tests and shots). */
  paintCounts(): Record<PaintMark["kind"] | "flash", number> {
    return this.paintPreview.counts();
  }

  private setPaintStatus(text: string | null): void {
    if (text === this.lastPaintStatus) return;
    this.lastPaintStatus = text;
    this.events.paintStatus(text);
  }

  /**
   * The grid overlay while a placement tool is active, centred on the
   * active drag's end (field rectangle corner, the finger or mouse of a
   * road drag), else the mouse, else the touch-pending tile or rectangle,
   * else the last touch, else the camera target. Decoration only.
   */
  private updateGrid(): void {
    const tool = this.tool();
    if (!gridOverlayVisible(tool.kind)) {
      if (this.grid.visible()) this.grid.set(null);
      return;
    }
    const toArch = (island: string, t: TilePos): ArchPoint | null => {
      const pl = this.arch.placement(island);
      return pl ? { x: pl.position.x + t.x + 0.5, y: pl.position.y + t.y + 0.5 } : null;
    };
    const mouse = this.precise && this.hover ? this.groundPoint(this.hover) : null;
    let at: ArchPoint | null = null;
    if (this.roadStart) at = mouse ?? (this.touchDrag ? this.lastTouch : null) ?? toArch(this.roadStart.island, this.roadStart);
    else if (mouse) at = mouse;
    else if (isGhostTool(tool) && tool.pending) at = toArch(tool.pending.island, tool.pending);
    at ??= this.lastTouch ?? { x: this.rig.view().x, y: this.rig.view().y };
    this.grid.set(at);
  }

  /** Trees and ground scatter items built on the islands with detail (near-LOD decoration). */
  decorationCounts(): { trees: number; scatter: number } {
    const n = { trees: 0, scatter: 0 };
    for (const d of this.details.values()) {
      const c = d.decorationCounts();
      n.trees += c.trees;
      n.scatter += c.scatter;
    }
    return n;
  }

  private setGhostHint(hint: string | null): void {
    if (hint === this.lastGhostHint) return;
    this.lastGhostHint = hint;
    this.events.ghostHint(hint);
  }
}
