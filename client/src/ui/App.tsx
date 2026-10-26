import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import {
  ApiError,
  type BuildingDisplay,
  type Command,
  type ContentBuilding,
  NetworkError,
  type Player,
  type RouteDisplay,
  type ShipDisplay,
  type WorldResponse,
} from "../api/client";
import { GameSync, type SyncError, SyncStoppedError } from "../api/sync";
import { founderFor, type PendingFounding, pendingFoundingStep } from "../display/archipelago";
import { serverTimeMs } from "../display/extrapolate";
import { units } from "../display/format";
import { countdown } from "../display/ships";
import { buildingAt, lPath, nextRotation, type TilePos } from "../display/geometry";
import { createdRouteId, draftFromRoute, stopsFromDraft } from "../display/routes";
import { shouldShowSummary } from "../display/summary";
import { collapseLandscapeChrome, isPhoneLayout, isTouchLayout, usesSheets } from "../display/layout";
import { insolvencyBanner } from "../display/insolvency";
import type { Lod } from "../display/lod";
import { lifeEnabled } from "../display/life";
import { fxaaForced, type Quality, resolveQuality } from "../display/quality";
import { initialViewState, viewReducer } from "../display/view";
import { type CameraInfo, GameRenderer, type InitialCamera, type RendererEvents, type RenderSource } from "../render/engine";
import { AccountMenu } from "./AccountMenu";
import styles from "./App.module.css";
import hud from "./hud.module.css";
import { BuildMenu } from "./BuildMenu";
import { CloseButton } from "./CloseButton";
import { type ConfirmRequest, ConfirmDialog } from "./Dialogs";
import { GameCanvas } from "./GameCanvas";
import { InfoPanel } from "./InfoPanel";
import { IslandCard } from "./IslandCard";
import { Minimap } from "./Minimap";
import { RouteEditor } from "./RouteEditor";
import { RoutesPanel } from "./RoutesPanel";
import { ShipmentDialog } from "./ShipmentDialog";
import { ShipPanel } from "./ShipPanel";
import { ShipsPanel } from "./ShipsPanel";
import { type Toast, Toasts } from "./Toasts";
import { DemolishBar, PlacementBar, RoadBar } from "./PlacementBar";
import { Sheet } from "./Sheet";
import { useLayout } from "./useLayout";
import { type GhostTool, type IslandTile, isGhostTool, NO_TOOL, rotateSteps, type Tool } from "./tools";
import { AwayDialog } from "./AwayDialog";
import { InsolvencyBanner } from "./InsolvencyBanner";
import { QuestsPanel } from "./QuestsPanel";
import { TopBar } from "./TopBar";
import { warningEntries, WarningsPanel } from "./WarningsPanel";
import { SideDock, type DockPanel } from "./SideDock";
import { claimableCount } from "../display/quests";
import { WorldOverlay } from "./WorldOverlay";
import { StatsBadge } from "./StatsBadge";
import { statsRequested } from "../dev/stats";

/** Demolishing anything that cost more than this (milli-gold) is confirmed. */
const CONFIRM_DEMOLISH_GOLD = 100_000;
const TOAST_MS = 5000;

/** Test hook (dev and E2E builds only; tree-shaken from production builds). */
export interface TestHook {
  /** Viewport position of the centre of an island tile, any island at any LOD (NaN for unknown islands and during a camera animation). */
  tileToScreen(islandId: string, x: number, y: number): { x: number; y: number };
  getServer(): WorldResponse | null;
  /** The level of detail of the last frame. */
  lod(): Lod;
  /**
   * Camera target in world coordinates (x, z = −archipelago y; y is the
   * archipelago y for convenience), ortho half extent and rotation in quarter turns, continuous in [0, 4) (0.5 = 45°).
   */
  camera(): { x: number; z: number; y: number; half: number; rotation: number };
  /** Sets parts of the camera (target x/z or y, half extent, rotation in quarter turns), clamped like user input. */
  setCamera(c: { x?: number; z?: number; y?: number; half?: number; rotation?: number }): void;
  /** Viewport position of a ship drawn in the last frame (NaN during a camera animation). */
  shipToScreen(id: number): { x: number; y: number };
  /** Viewport position of an archipelago point (tiles), also during a camera animation. */
  archToScreen(x: number, y: number): { x: number; y: number };
  /** Draw calls of the last frame. */
  drawCalls(): number;
  /** Meshes created since the renderer started (geometry builds). */
  meshesCreated(): number;
  /** Triangles drawn in the last frame (shadow passes included). */
  triangles(): number;
  /** Load milestones (first frame, first frame with the focused island's full tiles) and their marks in ms since navigation start (null: not yet, or a faked clock). */
  timing(): { firstFrame: boolean; focusTiles: boolean; firstFrameMs: number | null; focusTilesMs: number | null };
  /** Jumps the camera to an island (the island card's "Go to island"; tests trigger jumps without a visible card). */
  jumpToIsland(id: string): void;
  /** Validity colour of the placement ghost in the last frame: neutral, yellow (no road) or red (null: hidden). */
  ghostValidity(): "ok" | "no_road" | "invalid" | null;
  /** Render quality in force ("high": shadow map, grading, FXAA; "low": blob shadows and vignette). */
  quality(): Quality;
  /** Pins the renderer's animation time (server ms: sea, foam, carts, ships), or releases it with null. */
  freezeTime(ms: number | null): void;
  /**
   * Model loading (render/models.ts): manifest loaded; model files (GLB
   * paths) loaded, pending and failed; GLB bytes fetched; the time of the
   * first rendered frame with a model (performance.now(), ms); the content
   * IDs drawn with a placeholder now (islands at near LOD and ships) and
   * the buildings drawn with the other detail's model until the wanted
   * one has swapped in (bridged).
   */
  assets(): { manifest: boolean; loaded: string[]; pending: string[]; failed: string[]; placeholders: string[]; bridged: number; bytes: number; firstModelMs: number | null };
}

declare global {
  interface Window {
    __newShores?: TestHook;
  }
}

/** What App needs from GameSync (a fixture source implements it in dev builds). */
export interface SyncLike extends RenderSource {
  start(): () => void;
  subscribeUnauthorized(l: () => void): () => void;
  subscribeErrors(l: (e: SyncError) => void): () => void;
  send(command: Command): Promise<WorldResponse>;
  /** Re-fetches the world (e.g. after a rejected field rectangle: the client's data was stale). */
  refresh(): Promise<void>;
}

interface AppProps {
  player: Player;
  /** The player changed (a guest registered; same world). */
  onPlayerChange: (player: Player) => void;
  /** A request answered 401: back to the start screen. */
  onSessionEnded: () => void;
  onLoggedOut: () => void;
  /** Data source (default: a GameSync against the server). */
  sync?: SyncLike;
  /** Where the camera starts (default: the first island at the near zoom). */
  initialCamera?: InitialCamera;
}

export function App({ player, onPlayerChange, onSessionEnded, onLoggedOut, sync: source, initialCamera }: AppProps) {
  const [sync] = useState<SyncLike>(() => source ?? new GameSync());
  useEffect(() => sync.start(), [sync]);
  useEffect(() => sync.subscribeUnauthorized(onSessionEnded), [sync, onSessionEnded]);
  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const { model, content } = snap;

  const [vs, dispatch] = useReducer(viewReducer, undefined, initialViewState);
  const [tool, setTool] = useState<Tool>(NO_TOOL);
  const [buildOpen, setBuildOpen] = useState(loadBuildOpen);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [panel, setPanel] = useState<"none" | "ships" | "routes" | "quests" | "warnings">("none");
  // Summaries the player closed in this session: a re-fetch with the same
  // id does not re-open the dialog, a new id does.
  const [closedSummaries, setClosedSummaries] = useState<ReadonlySet<number>>(() => new Set());
  const [ghostHint, setGhostHint] = useState<string | null>(null);
  // A founding the client chains (D-051): sail_ship was sent, found_island
  // follows when the ship is idle at the island. Kept across reloads.
  const [storedPendingFound, setPendingFoundState] = useState<PendingFounding | null>(() => loadPendingFounding());
  const setPendingFound = useCallback((p: PendingFounding | null) => {
    setPendingFoundState(p);
    savePendingFounding(p);
  }, []);
  // The last pointer was a finger (pointerType per gesture, never the
  // device): touch gets the placement confirm step and the demolish bar.
  const [touchInput, setTouchInput] = useState(false);
  const layout = useLayout();
  const phone = isPhoneLayout(layout.mode);
  // Phones and tablets (44 px targets) need the scrolling top bar and build bar.
  const compactHud = isTouchLayout(layout.mode);
  const sheets = usesSheets(layout.mode, layout.width);
  const quality = resolveQuality(layout.mode, globalThis.location?.search ?? "");
  const [forceFxaa] = useState(() => fxaaForced(globalThis.location?.search ?? ""));
  // ?life=0 renders without the life layer (A/B comparisons; read when the renderer is created).
  const [life] = useState(() => lifeEnabled(globalThis.location?.search ?? ""));
  // Dev/E2E builds only (the constant folds to false in production): the ?stats=1 fps badge.
  const [showStats] = useState(() => (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && statsRequested(globalThis.location?.search ?? ""));
  useEffect(() => {
    // A mouse or pen switches back only on the canvas, so that clicking a
    // touch bar's button with the mouse does not remove it mid-click.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") setTouchInput(true);
      else if (e.target instanceof HTMLCanvasElement) setTouchInput(false);
    };
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", onDown, { capture: true });
  }, []);
  const [renderer, setRenderer] = useState<GameRenderer | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const toastId = useRef(0);
  // The camera's focused island, LOD and rotation (the renderer reports changes).
  const [cam, setCam] = useState<CameraInfo>({ focus: "", lod: "near", rotation: 0 });

  // The focused island (D-048, UI only): its tab is selected, the build
  // menu shows its stock and an unsettled one shows the founding panel.
  // Commands use the island of the tile or building acted on.
  const focused = model?.islands.find((is) => is.id === cam.focus) ?? model?.islands[0];
  // The chained founding while it is still valid (dropped once the ship
  // went elsewhere or the island got settled).
  const pendingFound = storedPendingFound && model && pendingFoundingStep(storedPendingFound, model) !== "drop" ? storedPendingFound : null;
  const focusId = focused?.id ?? "";
  const staticFocused = snap.islands.get(focusId);
  const defs = new Map((content?.buildings ?? []).map((b) => [b.id, b]));
  const selected = vs.selection.kind === "building" ? vs.selection.id : null;
  const selectedOwner = selected === null ? undefined : model?.islands.find((is) => is.buildings.some((b) => b.id === selected));
  const selectedBuilding = selectedOwner?.buildings.find((b) => b.id === selected);
  // A fields-list hover ends with the panel it belongs to.
  const selectedBuildingId = selectedBuilding?.id ?? null;
  useEffect(() => {
    rendererRef.current?.setHoverBuilding(null);
  }, [selectedBuildingId]);
  const selectedShipId = vs.selection.kind === "ship" ? vs.selection.id : null;
  const selectedShip = selectedShipId === null ? undefined : model?.ships.find((s) => s.id === selectedShipId);
  const warehouseType = content?.buildings.find((b) => b.trading_post)?.id ?? "";

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts, { id, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  /** Sends a command; errors are toasts. Resolves to ok, the API error and the response. */
  const sendCommand = async (cmd: Command): Promise<{ ok: boolean; error: ApiError | null; res: WorldResponse | null }> => {
    try {
      const res = await sync.send(cmd);
      return { ok: true, error: null, res };
    } catch (err) {
      if (err instanceof SyncStoppedError) return { ok: false, error: null, res: null }; // logged out meanwhile
      if (err instanceof ApiError) {
        toast(err.message);
        return { ok: false, error: err, res: null };
      }
      toast(err instanceof NetworkError ? "Server unreachable" : String(err));
      return { ok: false, error: null, res: null };
    }
  };

  const send = async (cmd: Command): Promise<ApiError | null> => (await sendCommand(cmd)).error;

  const demolish = async (islandId: string, b: BuildingDisplay, acceptSurplusLoss: boolean) => {
    const err = await send({ type: "demolish", island_id: islandId, building_id: b.id, accept_surplus_loss: acceptSurplusLoss });
    if (err?.code === "surplus_loss") {
      setConfirm({
        title: "Goods would be lost",
        body: `${err.message}. Without the Trading Post the island cannot hold its goods; the excess will be lost.`,
        confirmLabel: "Demolish and lose goods",
        onConfirm: () => void demolish(islandId, b, true),
      });
    } else if (!err && selected === b.id) {
      dispatch({ type: "clearSelection" });
    }
  };

  const requestDemolish = (islandId: string, b: BuildingDisplay) => {
    const def = defs.get(b.type);
    if (def && def.cost.gold > CONFIRM_DEMOLISH_GOLD) {
      const materials = Object.entries(def.cost.materials)
        .map(([g, n]) => `${units(n)} ${content?.goods.find((x) => x.id === g)?.name ?? g}`)
        .join(", ");
      setConfirm({
        title: `Demolish ${def.name}?`,
        body: `It cost ${units(def.cost.gold)} gold${materials ? ` and ${materials}` : ""}.`,
        confirmLabel: "Demolish",
        onConfirm: () => void demolish(islandId, b, false),
      });
      return;
    }
    void demolish(islandId, b, false);
  };

  /** The camera jumps to an island (tabs, island card, Enter). */
  const goTo = (id: string) => rendererRef.current?.jumpToIsland(id);

  /**
   * Founding (D-051): the camera jumps to the island with the Trading Post
   * ghost; the player places it. A ship already idle there founds at once,
   * any other sails there first (sail_ship) and founds on arrival.
   */
  const startFounding = (ship: ShipDisplay, islandId: string = ship.island_id) => {
    goTo(islandId);
    dispatch({ type: "clearSelection" });
    setPanel("none");
    setTool({ kind: "found", shipId: ship.id, buildingType: warehouseType, rotation: 0 });
  };

  const openEditor = (route: RouteDisplay | null) => {
    setPanel("none");
    dispatch({
      type: "openEditor",
      routeId: route?.id ?? null,
      draft: route ? draftFromRoute(route) : { name: "", stops: [] },
    });
  };

  const assign = (shipId: number, routeId: number) => sendCommand({ type: "assign_ship", ship_id: shipId, route_id: routeId });

  /**
   * Saves the editor's draft; the editor stays open on the saved route. The
   * response applies to the editor session that saved only (another route
   * may be open in the editor by the time it arrives).
   */
  const saveEditor = async () => {
    if (vs.editor.kind !== "open") return;
    const ed = vs.editor;
    const stops = stopsFromDraft(ed.draft);
    const before = sync.getSnapshot().server?.display.routes ?? [];
    const cmd: Command =
      ed.routeId === null
        ? { type: "create_route", name: ed.draft.name, stops }
        : { type: "update_route", route_id: ed.routeId, name: ed.draft.name, stops };
    const r = await sendCommand(cmd);
    if (!r.ok || !r.res) {
      dispatch({ type: "saveFailed", session: ed.session, error: r.error?.message ?? "The route could not be saved." });
      return;
    }
    const id = ed.routeId ?? createdRouteId(before, r.res.display.routes);
    if (id === null) return;
    dispatch({ type: "saved", session: ed.session, routeId: id });
  };

  /**
   * Places the ghost of a build, move or found tool at a tile (a mouse
   * click, or Confirm of a touch-pending tile). Build stays active (without
   * a pending tile) for the next building; move and found end on success.
   * On an error the tool stays so the player can retry.
   */
  const placeGhost = (t: GhostTool, at: IslandTile) => {
    const { island: islandId, x, y } = at;
    if (t.kind === "found") {
      const ship = model?.ships.find((s) => s.id === t.shipId);
      if (ship && !(ship.state === "idle" && ship.island_id === islandId)) {
        // Two steps: sail now, found when the ship is idle at the island.
        void sendCommand({ type: "sail_ship", ship_id: t.shipId, to_island_id: islandId }).then(({ ok }) => {
          if (!ok) return;
          setPendingFound({ shipId: t.shipId, islandId, x, y, rotation: t.rotation });
          setTool((cur) => (cur === t ? NO_TOOL : cur));
          toast(`Ship #${t.shipId} sails to ${islandName(islandId)} and founds the Trading Post on arrival`);
        });
        return;
      }
    }
    const cmd: Command =
      t.kind === "build"
        ? { type: "place_building", island_id: islandId, building_type: t.buildingType, x, y, rotation: t.rotation }
        : t.kind === "field"
          ? { type: "place_field", island_id: islandId, farm_id: t.farmId, building_type: t.buildingType, x, y, rotation: t.rotation }
          : t.kind === "move"
            ? { type: "move_building", island_id: islandId, building_id: t.buildingId, x, y, rotation: t.rotation }
            : { type: "found_island", ship_id: t.shipId, island_id: islandId, building_type: t.buildingType, x, y, rotation: t.rotation };
    void sendCommand(cmd).then(({ ok, error, res }) => {
      // A rejected field means the hint's data was stale: the world is re-fetched.
      if (!ok) {
        if (t.kind === "field" && error) void sync.refresh();
        return;
      }
      if (t.kind === "field") {
        // The tool stays for the next field until the farm has its maximum.
        const farm = res?.display.islands.flatMap((is) => is.buildings).find((b) => b.id === t.farmId);
        if (!farm || (farm.fields && farm.fields.ids.length >= farm.fields.max)) {
          setTool((cur) => (cur === t || (cur.kind === "field" && cur.farmId === t.farmId) ? NO_TOOL : cur));
          if (farm) toast(`${defs.get(farm.type)?.name ?? "The farm"} has all the ${(defs.get(t.buildingType)?.name ?? "field").toLowerCase()}s it can use`);
        } else setTool((cur) => (cur === t && cur.pending ? { ...cur, pending: undefined } : cur));
        return;
      }
      // Build stays active (without a pending tile) for the next building;
      // move and found end on success. On a move the building stays selected
      // at its new position.
      if (t.kind === "build") setTool((cur) => (cur === t && cur.kind === "build" && cur.pending ? { ...cur, pending: undefined } : cur));
      else setTool((cur) => (cur === t ? NO_TOOL : cur));
    });
  };

  const confirmPlacement = () => {
    if (isGhostTool(tool) && tool.pending) placeGhost(tool, tool.pending);
  };

  /** Shows or hides the build menu (remembered); hiding it ends the tools it offers (build, road, demolish). */
  const toggleBuild = () => {
    const next = !buildOpen;
    setBuildOpen(next);
    saveBuildOpen(next);
    if (!next) setTool((t) => (t.kind === "build" || t.kind === "road" || t.kind === "demolish" ? NO_TOOL : t));
  };

  const rotateTool = (steps: number) =>
    setTool((t) => (isGhostTool(t) ? { ...t, rotation: rotateSteps(t.rotation, steps) } : t));

  /**
   * Opens a list panel (or closes it when it is open). Opening one deselects
   * the current building, ship or island, so closing the list does not bring
   * its details back; `onlyOpen` never closes.
   */
  const togglePanel = (p: DockPanel, onlyOpen = false) => {
    if (panel === p && !onlyOpen) {
      setPanel("none");
      return;
    }
    dispatch({ type: "clearSelection" });
    setPanel(p);
  };

  /** A tap on island land or its label: the reducer selects the island or (near LOD) a building. */
  const tapIsland = (id: string, building?: number | null) => {
    // Opening an island card or a building's info closes a list panel (it would take precedence).
    if ((building === undefined || typeof building === "number") && vs.editor.kind === "closed") setPanel("none");
    dispatch({ type: "tapIsland", id, building });
  };

  const events: RendererEvents = {
    tapIsland,
    tapShip: (id: number) => {
      setPanel("none");
      dispatch({ type: "tapShip", id });
    },
    tapSea: () => dispatch({ type: "tapSea" }),
    place: (at: IslandTile) => {
      if (tool.kind === "build") placeGhost(tool, at);
    },
    placeField: (at: IslandTile) => {
      if (tool.kind === "field") placeGhost(tool, at);
    },
    pend: (at: IslandTile) => setTool((t) => (isGhostTool(t) ? { ...t, pending: at } : t)),
    unpend: () => setTool((t) => (isGhostTool(t) && t.pending ? { ...t, pending: undefined } : t)),
    rotateGhost: rotateTool,
    move: (at: IslandTile) => {
      if (tool.kind === "move") placeGhost(tool, at);
    },
    found: (at: IslandTile) => {
      if (tool.kind === "found") placeGhost(tool, at);
    },
    road: (islandId: string, from: TilePos, to: TilePos) => {
      const is = model?.islands.find((x) => x.id === islandId);
      if (tool.kind !== "road" || !is) return;
      const existing = new Set(is.roads.map((r) => `${r.x},${r.y}`));
      const tiles = lPath(from, to).filter((t) => !existing.has(`${t.x},${t.y}`));
      if (tiles.length === 0) return;
      void send({ type: "place_road", island_id: islandId, road_type: tool.roadType, tiles });
    },
    demolish: (at: IslandTile) => {
      const is = model?.islands.find((x) => x.id === at.island);
      if (!is) return;
      const b = buildingAt(is.buildings, defs, at.x, at.y);
      if (b) {
        requestDemolish(is.id, b);
      } else if (is.roads.some((r) => r.x === at.x && r.y === at.y)) {
        void send({ type: "demolish_road", island_id: is.id, tiles: [{ x: at.x, y: at.y }] });
      }
    },
    cancelTool: () => setTool(NO_TOOL),
    ghostHint: (text: string | null) => setGhostHint(text),
    // Inspecting closes a list panel (it would take precedence over the
    // info panel); the active tool stays and nothing is sent.
    inspectBuilding: (id: number) => {
      setPanel("none");
      dispatch({ type: "selectBuilding", id });
    },
    inspectShip: (id: number) => {
      setPanel("none");
      dispatch({ type: "selectShip", id });
    },
    inspectIsland: (id: string) => {
      setPanel("none");
      dispatch({ type: "selectIsland", id });
    },
    camera: (info: CameraInfo) => setCam(info),
  };

  const selectBuildItem = (b: ContentBuilding) => {
    dispatch({ type: "clearSelection" });
    setTool(b.road ? { kind: "road", roadType: b.id } : { kind: "build", buildingType: b.id, rotation: 0 });
  };

  // The chained founding (D-051): found_island as soon as the ship is idle
  // at the island; dropped when it went elsewhere or the island got settled.
  const foundingSent = useRef(false);
  useEffect(() => {
    if (storedPendingFound && model && !pendingFound) savePendingFounding(null);
    if (!pendingFound || !model) return;
    const step = pendingFoundingStep(pendingFound, model);
    if (step !== "found" || foundingSent.current) return;
    foundingSent.current = true;
    const p = pendingFound;
    void sendCommand({ type: "found_island", ship_id: p.shipId, island_id: p.islandId, building_type: warehouseType, x: p.x, y: p.y, rotation: p.rotation as 0 | 90 | 180 | 270 }).then(
      ({ ok }) => {
        foundingSent.current = false;
        setPendingFound(null);
        if (!ok) {
          // The site did not fit after all: the player picks another one.
          const s = sync.getSnapshot().model?.ships.find((x) => x.id === p.shipId);
          if (s) startFounding(s, p.islandId);
        }
      },
    );
  });

  // Background request failures (GET world, content, island) are toasts too
  // (G.41); GameSync keeps retrying them.
  useEffect(
    () => sync.subscribeErrors(({ what, error }) => toast(`Could not load ${what}: ${error.message} (retrying)`)),
    [sync, toast],
  );

  const onRenderer = useCallback((r: GameRenderer | null) => {
    rendererRef.current = r;
    setRenderer(r);
  }, []);

  useEffect(() => renderer?.setSelected(selected), [renderer, selected, snap.server]);

  // Selection ring, highlighted route and the editor's live draft.
  const archSel = vs.selection.kind === "ship" || vs.selection.kind === "island" ? vs.selection : ({ kind: "none" } as const);
  const editing = vs.editor.kind === "open" && vs.editor.active ? vs.editor : null;
  const highlight = editing ? editing.routeId : selectedShip?.route_id || null;
  const draftStops = editing ? editing.draft.stops.map((s) => s.island) : null;
  useEffect(() => renderer?.setArchState(archSel, highlight, draftStops));

  // Keyboard: Esc steps back one thing per press, Enter jumps to the
  // selected island, Q / E turn the camera by 45°, R rotates the ghost.
  const latest = useRef({ tool, confirm, dialog: vs.dialog, panel, sheets, selection: vs.selection });
  useEffect(() => {
    latest.current = { tool, confirm, dialog: vs.dialog, panel, sheets, selection: vs.selection };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      const cur = latest.current;
      if (e.key === "Escape") {
        if (cur.confirm) setConfirm(null);
        else if (cur.dialog) dispatch({ type: "closeShipment" });
        else if (cur.tool.kind !== "none") setTool(NO_TOOL);
        // A list sheet (ships, routes, quests) closes with Esc on phones.
        else if (cur.sheets && cur.panel !== "none") setPanel("none");
        else dispatch({ type: "escape" });
      } else if (e.key === "Enter") {
        if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement) return;
        if (cur.selection.kind === "island") rendererRef.current?.jumpToIsland(cur.selection.id);
      } else if (e.key === "q" || e.key === "Q") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        rendererRef.current?.rotateCamera(-1);
      } else if (e.key === "e" || e.key === "E") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        rendererRef.current?.rotateCamera(1);
      } else if (e.key === "r" || e.key === "R") {
        setTool((x) => (isGhostTool(x) ? { ...x, rotation: nextRotation(x.rotation) } : x));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") {
      const nan = { x: NaN, y: NaN };
      window.__newShores = {
        tileToScreen: (id, x, y) => rendererRef.current?.tileToScreen(id, x, y) ?? nan,
        getServer: () => sync.getSnapshot().server,
        lod: () => rendererRef.current?.currentLod() ?? "near",
        camera: () => {
          const v = rendererRef.current?.cameraView() ?? { x: NaN, y: NaN, half: NaN, rotation: 0 };
          return { x: v.x, z: -v.y, y: v.y, half: v.half, rotation: v.rotation };
        },
        setCamera: (c) => {
          const y = c.y ?? (c.z === undefined ? undefined : -c.z);
          rendererRef.current?.setCamera({
            ...(c.x === undefined ? {} : { x: c.x }),
            ...(y === undefined ? {} : { y }),
            ...(c.half === undefined ? {} : { half: c.half }),
            ...(c.rotation === undefined ? {} : { rotation: c.rotation }),
          });
        },
        shipToScreen: (id) => rendererRef.current?.shipToScreen(id) ?? nan,
        archToScreen: (x, y) => rendererRef.current?.archToClient({ x, y }) ?? nan,
        drawCalls: () => rendererRef.current?.lastDrawCalls() ?? 0,
        meshesCreated: () => rendererRef.current?.meshesCreated() ?? 0,
        triangles: () => rendererRef.current?.renderStats().triangles ?? 0,
        timing: () => rendererRef.current?.timing() ?? { firstFrame: false, focusTiles: false, firstFrameMs: null, focusTilesMs: null },
        jumpToIsland: (id) => rendererRef.current?.jumpToIsland(id),
        ghostValidity: () => rendererRef.current?.ghostValidity() ?? null,
        quality: () => rendererRef.current?.quality() ?? "low",
        freezeTime: (ms) => rendererRef.current?.freezeTime(ms),
        assets: () =>
          rendererRef.current?.assets() ?? { manifest: false, loaded: [], pending: [], failed: [], placeholders: [], bridged: 0, bytes: 0, firstModelMs: null },
      };
    }
  }, [sync]);

  /** Warnings tray and info-panel links: the camera jumps to the building, which is selected. */
  const focus = (id: number) => {
    rendererRef.current?.jumpToBuilding(id);
    dispatch({ type: "selectBuilding", id });
  };

  const scrap = (ship: ShipDisplay) =>
    setConfirm({
      title: `Scrap ship #${ship.id}?`,
      body: "Its cargo is unloaded where it lies (above capacity it is lost); half of its materials are refunded, no gold.",
      confirmLabel: "Scrap",
      onConfirm: () => void send({ type: "scrap_ship", ship_id: ship.id }),
    });

  /**
   * "Another archipelago" (D-053): the server generates the next roll of
   * the world's seed; allowed while `archipelago.rerollable`. A pending
   * founding and the founding ghost refer to the old islands and end.
   */
  const requestReroll = () =>
    setConfirm({
      title: "Another archipelago?",
      body: "These islands are replaced by a new archipelago of the same size and resources; your sloop and its cargo move to its centre. You cannot come back to this one.",
      confirmLabel: "Another archipelago",
      onConfirm: () => {
        setPendingFound(null);
        setTool(NO_TOOL);
        dispatch({ type: "clearSelection" });
        void send({ type: "reroll_archipelago" });
      },
    });

  const selectShipFromList = (ship: ShipDisplay) => {
    setPanel("none");
    dispatch({ type: "selectShip", id: ship.id });
  };

  const islandName = (id: string) => model?.islands.find((is) => is.id === id)?.name || id;
  const founderHere = model && content && focused && !focused.settled ? founderFor(model, content, focused.id) : null;
  const nothingSettled = model ? !model.islands.some((is) => is.settled) : false;
  const pendingShip = pendingFound ? model?.ships.find((s) => s.id === pendingFound.shipId) : undefined;
  const pendingText =
    pendingFound && pendingShip
      ? `Ship #${pendingShip.id} sails to ${islandName(pendingFound.islandId)} to found the Trading Post${
          pendingShip.leg ? ` · arrives in ${countdown(Math.max(0, serverTimeMs(pendingShip.leg.arrive_at) - snap.nowMs))}` : ""
        }`
      : null;
  const awaySummary = model?.away_summary;
  const dismissSummary = (id: number) => {
    setClosedSummaries((s) => new Set(s).add(id));
    void send({ type: "ack_summary", summary_id: id });
  };
  const dialogShip = vs.dialog ? model?.ships.find((s) => s.id === vs.dialog?.shipId) : undefined;
  const editor = vs.editor.kind === "open" ? vs.editor : null;

  let right: React.ReactNode = null;
  /** Sheet identity (a new kind opens at half), title and close action of the panel slot. */
  let rightKey = "";
  let rightTitle = "";
  let rightClose = () => {};
  if (model && content) {
    if (panel === "warnings") {
      rightKey = "warnings";
      rightTitle = "Warnings";
      rightClose = () => setPanel("none");
      right = <WarningsPanel model={model} content={content} onFocus={focus} onClose={() => setPanel("none")} />;
    } else if (panel === "ships") {
      rightKey = "ships";
      rightTitle = "Ships";
      rightClose = () => setPanel("none");
      right = <ShipsPanel model={model} content={content} nowMs={snap.nowMs} onSelect={selectShipFromList} onClose={() => setPanel("none")} />;
    } else if (panel === "quests") {
      rightKey = "quests";
      rightTitle = "Quests";
      rightClose = () => setPanel("none");
      right = (
        <QuestsPanel
          model={model}
          content={content}
          onClaim={(questId, is) =>
            void send(is ? { type: "claim_quest", quest_id: questId, island_id: is } : { type: "claim_quest", quest_id: questId })
          }
          onClose={() => setPanel("none")}
        />
      );
    } else if (panel === "routes") {
      rightKey = "routes";
      rightTitle = "Routes";
      rightClose = () => setPanel("none");
      right = (
        <RoutesPanel
          model={model}
          onEdit={(r) => openEditor(r)}
          onClose={() => setPanel("none")}
        />
      );
    } else if (editor?.active) {
      rightKey = "editor";
      rightTitle = editor.routeId === null ? "New route" : `Route #${editor.routeId}`;
      rightClose = () => dispatch({ type: "closeEditor" });
      right = (
        <RouteEditor
          model={model}
          content={content}
          routeId={editor.routeId}
          draft={editor.draft}
          error={editor.error}
          onChange={(draft) => dispatch({ type: "setDraft", draft })}
          onAddStop={(is) => dispatch({ type: "appendStop", island: is })}
          onRemoveStop={(index) => dispatch({ type: "removeStop", index })}
          onMoveStop={(index, delta) => dispatch({ type: "moveStop", index, delta })}
          onSave={() => void saveEditor()}
          onDelete={() => {
            const id = editor.routeId;
            if (id === null) return;
            void sendCommand({ type: "delete_route", route_id: id }).then(({ ok }) => {
              if (!ok) return;
              dispatch({ type: "closeEditor" });
              setPanel("routes");
            });
          }}
          onClose={() => dispatch({ type: "closeEditor" })}
          onUnassign={(shipId) => void send({ type: "unassign_ship", ship_id: shipId })}
          onAssign={(shipId, routeId) => void assign(shipId, routeId)}
        />
      );
    } else if (selectedShip) {
      const ship = selectedShip;
      rightKey = "ship";
      rightTitle = `Ship #${ship.id}`;
      rightClose = () => dispatch({ type: "clearSelection" });
      right = (
        <ShipPanel
          key={ship.id}
          ship={ship}
          model={model}
          content={content}
          nowMs={snap.nowMs}
          pendingFounding={pendingFound && pendingFound.shipId === ship.id ? islandName(pendingFound.islandId) : null}
          onAssign={(routeId) => void assign(ship.id, routeId)}
          onOpenRoutes={() => {
            dispatch({ type: "clearSelection" });
            setPanel("routes");
          }}
          onUnassign={() => void send({ type: "unassign_ship", ship_id: ship.id })}
          onSend={() => dispatch({ type: "openShipment", shipId: ship.id, to: null })}
          onFound={() => startFounding(ship)}
          onScrap={() => scrap(ship)}
          onClose={() => dispatch({ type: "clearSelection" })}
        />
      );
    } else if (vs.selection.kind === "island") {
      const id = vs.selection.id;
      rightKey = "island";
      rightTitle = model.islands.find((is) => is.id === id)?.name || id;
      rightClose = () => dispatch({ type: "clearSelection" });
      right = (
        <IslandCard
          islandId={id}
          model={model}
          content={content}
          statics={snap.islands.get(id)}
          onClose={() => dispatch({ type: "clearSelection" })}
          onRename={async (name) => (await send({ type: "rename_island", island_id: id, name })) === null}
        />
      );
    } else if (selectedBuilding && selectedOwner) {
      const island = selectedOwner;
      const islandId = island.id;
      rightKey = "building";
      rightTitle = defs.get(selectedBuilding.type)?.name ?? selectedBuilding.type;
      rightClose = () => dispatch({ type: "clearSelection" });
      right = (
        <InfoPanel
          onClose={() => dispatch({ type: "clearSelection" })}
          building={selectedBuilding}
          island={island}
          model={model}
          content={content}
          onSetPaused={(paused) => void send({ type: "set_paused", island_id: islandId, building_id: selectedBuilding.id, paused })}
          onDemolish={() => requestDemolish(islandId, selectedBuilding)}
          onMove={() =>
            setTool({
              kind: "move",
              buildingId: selectedBuilding.id,
              buildingType: selectedBuilding.type,
              rotation: selectedBuilding.rotation,
            })
          }
          onUpgrade={() => void send({ type: "upgrade_house", island_id: islandId, building_id: selectedBuilding.id })}
          onUpgradeWarehouse={() => void send({ type: "upgrade_warehouse", island_id: islandId, building_id: selectedBuilding.id })}
          onUpgradeTradingPost={() => void send({ type: "upgrade_trading_post", island_id: islandId, building_id: selectedBuilding.id })}
          onSelectBuilding={focus}
          onAddField={(fieldType) => {
            setTool({ kind: "field", farmId: selectedBuilding.id, island: islandId, buildingType: fieldType, rotation: 0 });
          }}
          nowMs={snap.nowMs}
          onOrderShip={(shipType) =>
            void send({ type: "order_ship", island_id: islandId, building_id: selectedBuilding.id, ship_type: shipType })
          }
          onCancelShipOrder={() => void send({ type: "cancel_ship_order", island_id: islandId, building_id: selectedBuilding.id })}
        />
      );
    }
  }

  // Touch affordances: shown for touch input (the last pointer was a finger).
  const touchUI = touchInput || isTouchLayout(layout.mode);
  const placementBar = touchUI && isGhostTool(tool);
  const demolishBar = touchUI && tool.kind === "demolish";
  const roadBar = touchUI && tool.kind === "road";


  const resumeBar = editor && !editor.active && (
    <div className={`${hud.panel} ${hud.resumeBar}`}>
      <div className={hud.row}>
        <h2 className={`${hud.title} ${hud.resumeTitle}`} data-testid="route-editor-paused-title">
          {editor.draft.name.trim() || (editor.routeId === null ? "New route" : `Route #${editor.routeId}`)}
        </h2>
        <div className={hud.spacer} />
        <CloseButton onClick={() => dispatch({ type: "closeEditor" })} testId="route-editor-paused-close" />
      </div>
      <span className={hud.small}>Route editor paused</span>
      <button
        type="button"
        className={hud.button}
        onClick={() => {
          // The editor becomes the only side panel again.
          setPanel("none");
          dispatch({ type: "resumeEditor" });
        }}
        data-testid="route-editor-resume"
      >
        Back to route editor
      </button>
    </div>
  );
  if (resumeBar && !right) {
    rightKey = "editor-paused";
    rightTitle = "Route editor paused";
    rightClose = () => dispatch({ type: "closeEditor" });
  }

  let rightSlot: React.ReactNode;
  if (sheets) {
    rightSlot = (
      <div className={styles.sheetHost}>
        {(right || resumeBar) && (
          <Sheet key={rightKey} title={rightTitle} onClose={rightClose}>
            {resumeBar}
            {right}
          </Sheet>
        )}
      </div>
    );
  } else {
    rightSlot = (
      <div className={phone ? `${styles.right} ${styles.rightNarrow}` : styles.right}>
        {resumeBar}
        {right}
      </div>
    );
  }

  // Short landscape phones: the side panel keeps a usable height; the hint
  // bar is hidden and the insolvency banner keeps one line.
  const hintShown = (tool.kind !== "none" && !placementBar && !demolishBar && !roadBar);
  const tightLandscape = collapseLandscapeChrome({
    mode: layout.mode,
    sheets,
    panelOpen: right !== null || Boolean(resumeBar),
    height: layout.height,
    banner: insolvencyBanner(model) !== null,
    hint: hintShown,
  });
  const fieldPlural = tool.kind === "field" ? `${(defs.get(tool.buildingType)?.name ?? "field").toLowerCase()}s` : "";
  const toolHint = !tightLandscape && tool.kind !== "none" && !placementBar && !demolishBar && !roadBar && (
    <div className={phone ? styles.hintInline : styles.hint} data-testid="tool-hint">
      {tool.kind === "build" && `Click to place (${tool.rotation}°) · R rotate · Esc / right click cancel`}
      {tool.kind === "move" && `Click to move (${tool.rotation}°) · R rotate · Esc / right click cancel`}
      {tool.kind === "found" &&
        `Click to place the Trading Post (its pier on the water) — ship #${tool.shipId} ${
          model?.ships.find((s) => s.id === tool.shipId)?.state === "idle" && model?.ships.find((s) => s.id === tool.shipId)?.island_id === cam.focus
            ? "founds it at once"
            : "sails there and founds it on arrival"
        } (${tool.rotation}°) · R rotate · Esc cancel`}
      {tool.kind === "road" && "Drag to draw a road · Esc / right click cancel"}
      {tool.kind === "field" && `Click to add a ${fieldPlural.slice(0, -1)} next to the farm or its fields (${tool.rotation}°) · R rotate · Esc / right click leave`}
      {tool.kind === "demolish" && "Click a building, field or road to demolish · Esc / right click cancel"}
      {ghostHint && (tool.kind === "build" || tool.kind === "move" || tool.kind === "found" || tool.kind === "field") && (
        <div className={styles.hintReason} data-testid="tool-hint-reason">
          {ghostHint}
        </div>
      )}
    </div>
  );
  const unreachable = snap.unreachable && (
    <div className={phone ? styles.bannerInline : styles.banner} data-testid="unreachable-banner">
      Server unreachable — retrying…
    </div>
  );

  return (
    <div className={`${styles.root} ${phone ? styles.phone : ""}`} data-layout={layout.mode} data-touch={isTouchLayout(layout.mode) ? "true" : undefined}>
      {model && (
        <WorldOverlay renderer={renderer} model={model} selectedShip={selectedShip?.id ?? null} nowMs={snap.nowMs} onIsland={(id) => tapIsland(id)} />
      )}
      <div className={styles.overlay}>
        <div className={styles.top}>
          <TopBar
            model={model}
            content={content}
            islandId={focusId}
            statics={staticFocused}
            onOpenIsland={() => focusId && dispatch({ type: "selectIsland", id: focusId })}
            account={<AccountMenu player={player} onRegistered={onPlayerChange} onLoggedOut={onLoggedOut} />}
            compact={layout.mode === "phone-portrait" ? "portrait" : compactHud ? "landscape" : null}
          />
          <InsolvencyBanner model={model} onOpenWarnings={() => togglePanel("warnings", true)} compact={phone} oneLine={tightLandscape} />
          {placementBar && isGhostTool(tool) && (
            <PlacementBar tool={tool} hint={ghostHint} onConfirm={confirmPlacement} onRotate={() => rotateTool(1)} onCancel={() => setTool(NO_TOOL)} />
          )}
          {demolishBar && <DemolishBar onDone={() => setTool(NO_TOOL)} />}
          {roadBar && <RoadBar onDone={() => setTool(NO_TOOL)} />}
          {phone && toolHint}
          {phone && unreachable}
        </div>
        {/* In the overlay after the top bar: focus order top bar → canvas → panel → build bar. */}
        <GameCanvas sync={sync} tool={() => tool} events={events} onRenderer={onRenderer} initialCamera={initialCamera} quality={quality} forceFxaa={forceFxaa} life={life} />
        {showStats && <StatsBadge renderer={renderer} />}
        {model && (
          <div className={styles.mapCorner}>
            <Minimap
              renderer={renderer}
              model={model}
              statics={snap.islands}
              viewport={{ width: layout.width, height: layout.height }}
              collapsible={phone}
              initiallyCollapsed={layout.mode === "phone-portrait"}
              heading={cam.rotation}
            />
          </div>
        )}
        {rightSlot}
        <div className={styles.bottom}>
          {focused && !focused.settled ? (
            <div className={`${hud.panel} ${hud.unsettledPanel}`} data-testid={nothingSettled ? "seafaring-panel" : "unsettled-panel"}>
              {nothingSettled && (
                <div data-testid="seafaring-hint">
                  <strong>Choose your home island.</strong> Your sloop carries the planks and sails. Use the minimap to
                  see the whole archipelago and tap it to look around; look at the islands&apos; fertilities and deposits (tap one for its
                  card) and found a Trading Post where you want to start.
                </div>
              )}
              <div>
                <strong>{focused.name || focused.id}</strong> is not settled.{" "}
                {founderHere
                  ? `"Found settlement here" lets you place the Trading Post with its pier on the water; ship #${founderHere.id} ${
                      founderHere.island_id === focused.id ? "is here" : "sails there first"
                    }.`
                  : "Send a ship with the Trading Post's materials to found a settlement."}
              </div>
              {pendingText && (
                <div className={hud.small} data-testid="pending-founding">
                  {pendingText}{" "}
                  <button type="button" className={hud.link} onClick={() => setPendingFound(null)} data-testid="pending-founding-cancel">
                    cancel
                  </button>
                </div>
              )}
              {((founderHere && !pendingText) || model?.archipelago.rerollable) && (
                <div className={`${hud.buttons} ${hud.centred}`}>
                  {founderHere && !pendingText && (
                    <button type="button" className={hud.button} onClick={() => startFounding(founderHere, focused.id)} data-testid="found-settlement-here">
                      Found settlement here
                    </button>
                  )}
                  {model?.archipelago.rerollable && (
                    <button type="button" className={hud.button} onClick={requestReroll} data-testid="reroll-archipelago">
                      Another archipelago
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            buildOpen && (
              <BuildMenu
                content={content}
                model={model}
                islandId={focusId}
                fertilities={staticFocused?.fertilities}
                tool={tool}
                onSelect={selectBuildItem}
                onDemolishTool={() => setTool((t) => (t.kind === "demolish" ? NO_TOOL : { kind: "demolish" }))}
                dense={layout.mode === "phone-landscape"}
              />
            )
          )}
        </div>
        {model && content && (
          <SideDock
            active={panel}
            onToggle={(p) => togglePanel(p)}
            buildOpen={buildOpen}
            onToggleBuild={toggleBuild}
            counts={{ warnings: warningEntries(model, content).length, quests: claimableCount(model), ships: model.ships.length, routes: model.routes.length }}
          />
        )}
      </div>
      {!phone && toolHint}
      {!phone && unreachable}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} phone={phone} />
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
      {awaySummary && content && shouldShowSummary(awaySummary, closedSummaries) && (
        <AwayDialog summary={awaySummary} content={content} islandName={islandName} onDismiss={() => dismissSummary(awaySummary.id)} />
      )}
      {vs.dialog && dialogShip && model && content && dialogShip.island_id !== "" && (
        <ShipmentDialog
          key={`${dialogShip.id}-${vs.dialog.to ?? ""}`}
          ship={dialogShip}
          initialTo={vs.dialog.to}
          model={model}
          content={content}
          onClose={() => dispatch({ type: "closeShipment" })}
          onSend={(to, cargo) => void send({ type: "manual_shipment", ship_id: dialogShip.id, to_island_id: to, cargo })}
        />
      )}
    </div>
  );
}

const BUILD_OPEN_KEY = "newShores.buildMenu";

/** Whether the build menu was left open in this browser (closed by default). */
function loadBuildOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(BUILD_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveBuildOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(BUILD_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage unavailable (private mode): the choice lasts for this session.
  }
}

const PENDING_FOUNDING_KEY = "newShores.pendingFounding";

/** The chained founding saved in this browser (a hint only: the next payload validates it). */
function loadPendingFounding(): PendingFounding | null {
  try {
    const raw = globalThis.localStorage?.getItem(PENDING_FOUNDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingFounding>;
    if (typeof p.shipId !== "number" || typeof p.islandId !== "string" || typeof p.x !== "number" || typeof p.y !== "number" || typeof p.rotation !== "number") {
      return null;
    }
    return { shipId: p.shipId, islandId: p.islandId, x: p.x, y: p.y, rotation: p.rotation };
  } catch {
    return null;
  }
}

function savePendingFounding(p: PendingFounding | null): void {
  try {
    if (p) globalThis.localStorage?.setItem(PENDING_FOUNDING_KEY, JSON.stringify(p));
    else globalThis.localStorage?.removeItem(PENDING_FOUNDING_KEY);
  } catch {
    // Storage unavailable (private mode): the pending founding lives in memory only.
  }
}
