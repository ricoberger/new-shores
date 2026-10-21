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
import { units } from "../display/format";
import { buildingAt, lPath, nextRotation, type TilePos } from "../display/geometry";
import { createdRouteId, draftFromRoute, stopsFromDraft } from "../display/routes";
import { shouldShowSummary } from "../display/summary";
import { collapseLandscapeChrome, isPhoneLayout, isTouchLayout, usesSheets } from "../display/layout";
import { insolvencyBanner } from "../display/insolvency";
import { blankStop, initialViewState, type View, viewReducer } from "../display/view";
import { type FrameStats, GameRenderer, type RendererEvents, type RenderSource } from "../render/engine";
import { AccountMenu } from "./AccountMenu";
import styles from "./App.module.css";
import hud from "./hud.module.css";
import { ArchipelagoOverlay } from "./ArchipelagoOverlay";
import { BuildMenu } from "./BuildMenu";
import { type ConfirmRequest, ConfirmDialog } from "./Dialogs";
import { GameCanvas } from "./GameCanvas";
import { InfoPanel } from "./InfoPanel";
import { IslandCard } from "./IslandCard";
import { RouteEditor } from "./RouteEditor";
import { RoutesPanel } from "./RoutesPanel";
import { ShipmentDialog } from "./ShipmentDialog";
import { ShipPanel } from "./ShipPanel";
import { ShipsPanel } from "./ShipsPanel";
import { type Toast, Toasts } from "./Toasts";
import { DemolishBar, PlacementBar, RoadBar } from "./PlacementBar";
import { Sheet } from "./Sheet";
import { useLayout } from "./useLayout";
import { type GhostTool, isGhostTool, NO_TOOL, rotateSteps, type Tool } from "./tools";
import { AwayDialog } from "./AwayDialog";
import { InsolvencyBanner } from "./InsolvencyBanner";
import { QuestsPanel } from "./QuestsPanel";
import { TopBar } from "./TopBar";
import { WarningsTray } from "./WarningsTray";

/** Demolishing anything that cost more than this (milli-gold) is confirmed. */
const CONFIRM_DEMOLISH_GOLD = 100_000;
const TOAST_MS = 5000;

/** Test hook (dev and E2E builds only; tree-shaken from production builds). */
export interface TestHook {
  tileToScreen(islandId: string, x: number, y: number): { x: number; y: number };
  getDisplay(): unknown;
  getServer(): WorldResponse | null;
  engineCount(): number;
  /** The view the renderer shows: "archipelago" or the island ID, "transition" while the camera moves between views. */
  view(): string;
  /** Viewport position of an island's anchor, or of one of its tiles (archipelago view; NaN otherwise). */
  islandToScreen(id: string, x?: number, y?: number): { x: number; y: number };
  /** Viewport position of a ship (archipelago view, or at the harbour in the island view). */
  shipToScreen(id: number): { x: number; y: number };
  /** Viewport position of an archipelago point (tiles) in any view, also during a transition. */
  archToScreen(x: number, y: number): { x: number; y: number };
  /** Draw calls of the last frame. */
  drawCalls(): number;
  /** Instance style a ship was drawn with in the last frame ("active" / "unpaid"), null if not drawn. */
  shipStyle(id: number): "active" | "unpaid" | null;
  /** Shipyard construction hulls drawn in the last island-view frame. */
  constructionMarkers(): { buildingId: number; scale: number }[];
  /** Frame times over the last windowMs (default 5 s). */
  frameStats(windowMs?: number): FrameStats;
  /** Carts drawn in the island view. */
  carts(): number;
  /** Tile the placement ghost was drawn on in the last frame (null: hidden). */
  ghostTile(): { x: number; y: number } | null;
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
  /** First view (default: the first island). */
  initialView?: View;
}

export function App({ player, onPlayerChange, onSessionEnded, onLoggedOut, sync: source, initialView }: AppProps) {
  const [sync] = useState<SyncLike>(() => source ?? new GameSync());
  useEffect(() => sync.start(), [sync]);
  useEffect(() => sync.subscribeUnauthorized(onSessionEnded), [sync, onSessionEnded]);
  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const { model, content } = snap;

  const [vs, dispatch] = useReducer(viewReducer, initialView, (v: View | undefined) => initialViewState(v));
  const [tool, setTool] = useState<Tool>(NO_TOOL);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [panel, setPanel] = useState<"none" | "ships" | "routes" | "quests">("none");
  const [warningsOpen, setWarningsOpen] = useState(false);
  // Summaries the player closed in this session: a re-fetch with the same
  // id does not re-open the dialog, a new id does.
  const [closedSummaries, setClosedSummaries] = useState<ReadonlySet<number>>(() => new Set());
  const [ghostHint, setGhostHint] = useState<string | null>(null);
  // The last pointer was a finger (pointerType per gesture, never the
  // device): touch gets the placement confirm step and the demolish bar.
  const [touchInput, setTouchInput] = useState(false);
  const layout = useLayout();
  const phone = isPhoneLayout(layout.mode);
  // Phones and tablets (44 px targets) need the scrolling top bar and build bar.
  const compactHud = isTouchLayout(layout.mode);
  const sheets = usesSheets(layout.mode, layout.width);
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
  /** A building to centre on once the renderer shows its island. */
  const pendingFocus = useRef<number | null>(null);

  // The view (D-027: the client only chooses what to look at).
  const archView = vs.view.kind === "archipelago";
  const requestedIsland = vs.view.kind === "island" ? vs.view.id : "";
  const island = archView ? undefined : (model?.islands.find((is) => is.id === requestedIsland) ?? model?.islands[0]);
  const islandId = island?.id ?? "";
  const staticIsland = snap.islands.get(islandId);
  const defs = new Map((content?.buildings ?? []).map((b) => [b.id, b]));
  const selected = vs.selection.kind === "building" ? vs.selection.id : null;
  const selectedBuilding = island?.buildings.find((b) => b.id === selected);
  const selectedShipId = vs.selection.kind === "ship" ? vs.selection.id : null;
  const selectedShip = selectedShipId === null ? undefined : model?.ships.find((s) => s.id === selectedShipId);
  const warehouseType = content?.buildings.find((b) => b.warehouse)?.id ?? "";

  // Switching views clears any active tool (founding keeps its own).
  const viewKey = archView ? "archipelago" : `island:${islandId}`;
  const prevViewKey = useRef(viewKey);
  const keepTool = useRef(false);
  useEffect(() => {
    if (prevViewKey.current === viewKey) return;
    prevViewKey.current = viewKey;
    if (keepTool.current) keepTool.current = false;
    else setTool(NO_TOOL);
  }, [viewKey]);

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

  const demolish = async (b: BuildingDisplay, acceptSurplusLoss: boolean) => {
    const err = await send({ type: "demolish", island_id: islandId, building_id: b.id, accept_surplus_loss: acceptSurplusLoss });
    if (err?.code === "surplus_loss") {
      setConfirm({
        title: "Goods would be lost",
        body: `${err.message}. The remaining warehouses cannot hold all goods; the excess will be lost.`,
        confirmLabel: "Demolish and lose goods",
        onConfirm: () => void demolish(b, true),
      });
    } else if (!err && selected === b.id) {
      dispatch({ type: "clearSelection" });
    }
  };

  const requestDemolish = (b: BuildingDisplay) => {
    const def = defs.get(b.type);
    if (def && def.cost.gold > CONFIRM_DEMOLISH_GOLD) {
      const materials = Object.entries(def.cost.materials)
        .map(([g, n]) => `${units(n)} ${content?.goods.find((x) => x.id === g)?.name ?? g}`)
        .join(", ");
      setConfirm({
        title: `Demolish ${def.name}?`,
        body: `It cost ${units(def.cost.gold)} gold${materials ? ` and ${materials}` : ""}.`,
        confirmLabel: "Demolish",
        onConfirm: () => void demolish(b, false),
      });
      return;
    }
    void demolish(b, false);
  };

  const enterIsland = (id: string) => dispatch({ type: "enterIsland", id });

  /** Founding: show the ship's island and place the warehouse ghost there. */
  const startFounding = (ship: ShipDisplay) => {
    if (viewKey !== `island:${ship.island_id}`) keepTool.current = true;
    enterIsland(ship.island_id);
    dispatch({ type: "clearSelection" });
    setPanel("none");
    setTool({ kind: "found", shipId: ship.id, buildingType: warehouseType, rotation: 0 });
  };

  const openEditor = (route: RouteDisplay | null, pickingShip: number | null = null, from?: string) => {
    setPanel("none");
    dispatch({
      type: "openEditor",
      routeId: route?.id ?? null,
      draft: route ? draftFromRoute(route) : { name: "", stops: from ? [blankStop(from)] : [] },
      pickingShip,
    });
  };

  const assign = async (shipId: number, routeId: number) => {
    const { ok } = await sendCommand({ type: "assign_ship", ship_id: shipId, route_id: routeId });
    if (ok && vs.editor.kind === "open" && vs.editor.pickingShip === shipId) dispatch({ type: "clearPickingShip", session: vs.editor.session });
  };

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
    if (ed.pickingShip !== null) {
      const a = await sendCommand({ type: "assign_ship", ship_id: ed.pickingShip, route_id: id });
      if (a.ok) dispatch({ type: "clearPickingShip", session: ed.session });
    }
  };

  /**
   * Places the ghost of a build, move or found tool at a tile (a mouse
   * click, or Confirm of a touch-pending tile). Build stays active (without
   * a pending tile) for the next building; move and found end on success.
   * On an error the tool stays so the player can retry.
   */
  const placeGhost = (t: GhostTool, x: number, y: number) => {
    const cmd: Command =
      t.kind === "build"
        ? { type: "place_building", island_id: islandId, building_type: t.buildingType, x, y, rotation: t.rotation }
        : t.kind === "move"
          ? { type: "move_building", island_id: islandId, building_id: t.buildingId, x, y, rotation: t.rotation }
          : { type: "found_island", ship_id: t.shipId, island_id: islandId, building_type: t.buildingType, x, y, rotation: t.rotation };
    void sendCommand(cmd).then(({ ok }) => {
      if (!ok) return;
      // On a move the building stays selected at its new position.
      if (t.kind === "build") setTool((cur) => (cur === t && cur.kind === "build" && cur.pending ? { ...cur, pending: undefined } : cur));
      else setTool((cur) => (cur === t ? NO_TOOL : cur));
    });
  };

  const confirmPlacement = () => {
    if (isGhostTool(tool) && tool.pending) placeGhost(tool, tool.pending.x, tool.pending.y);
  };

  const rotateTool = (steps: number) =>
    setTool((t) => (isGhostTool(t) ? { ...t, rotation: rotateSteps(t.rotation, steps) } : t));

  const events: RendererEvents = {
    select: (id: number | null) => dispatch({ type: "selectBuilding", id }),
    place: (x: number, y: number) => {
      if (tool.kind === "build") placeGhost(tool, x, y);
    },
    pend: (x: number, y: number) => setTool((t) => (isGhostTool(t) ? { ...t, pending: { x, y } } : t)),
    unpend: () => setTool((t) => (isGhostTool(t) && t.pending ? { ...t, pending: undefined } : t)),
    rotateGhost: rotateTool,
    move: (x: number, y: number) => {
      if (tool.kind === "move") placeGhost(tool, x, y);
    },
    found: (x: number, y: number) => {
      if (tool.kind === "found") placeGhost(tool, x, y);
    },
    road: (from: TilePos, to: TilePos) => {
      if (tool.kind !== "road" || !island) return;
      const existing = new Set(island.roads.map((r) => `${r.x},${r.y}`));
      const tiles = lPath(from, to).filter((t) => !existing.has(`${t.x},${t.y}`));
      if (tiles.length === 0) return;
      void send({ type: "place_road", island_id: islandId, road_type: tool.roadType, tiles });
    },
    demolish: (x: number, y: number) => {
      if (!island) return;
      const b = buildingAt(island.buildings, defs, x, y);
      if (b) {
        requestDemolish(b);
      } else if (island.roads.some((r) => r.x === x && r.y === y)) {
        void send({ type: "demolish_road", island_id: islandId, tiles: [{ x, y }] });
      }
    },
    cancelTool: () => setTool(NO_TOOL),
    ghostHint: (text: string | null) => setGhostHint(text),
    zoomOutAtMax: (amount: number) => dispatch({ type: "zoomOutAtMax", amount, atMs: performance.now() }),
    zoomReset: () => dispatch({ type: "zoomReset" }),
    tapIsland: (id: string) => {
      if (vs.editor.kind === "closed" && vs.shipment.kind === "none") setPanel("none");
      dispatch({ type: "tapIsland", id });
    },
    tapShip: (id: number) => {
      setPanel("none");
      dispatch({ type: "tapShip", id });
    },
    tapSea: () => dispatch({ type: "tapSea" }),
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
    dragShip: (shipId: number, from: string) => dispatch({ type: "dragShip", shipId, from }),
    dropShip: (to: string | null) => dispatch({ type: "dropShip", island: to }),
  };

  const selectBuildItem = (b: ContentBuilding) => {
    dispatch({ type: "clearSelection" });
    setTool(b.road ? { kind: "road", roadType: b.id } : { kind: "build", buildingType: b.id, rotation: 0 });
  };

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

  // The renderer shows the chosen view (also after it was re-created).
  useEffect(() => {
    if (!renderer) return;
    if (archView) renderer.setView({ kind: "archipelago" });
    else if (islandId) renderer.setView({ kind: "island", id: islandId });
    if (!archView && islandId && pendingFocus.current !== null) {
      renderer.focusBuilding(pendingFocus.current);
      pendingFocus.current = null;
    }
  }, [renderer, archView, islandId, snap.server]);

  useEffect(() => renderer?.setSelected(selected), [renderer, selected, snap.server]);

  // A ship drag ends in the renderer too when the view state ends it (Esc,
  // a view switch): the ship returns to its place and stops following the pointer.
  const shipmentKind = vs.shipment.kind;
  useEffect(() => {
    if (shipmentKind !== "dragging") renderer?.cancelShipDrag();
  }, [renderer, shipmentKind]);

  // Archipelago selection ring, highlighted route and the editor's live draft.
  const archSel = vs.selection.kind === "ship" || vs.selection.kind === "island" ? vs.selection : ({ kind: "none" } as const);
  const editing = vs.editor.kind === "open" && vs.editor.active ? vs.editor : null;
  const highlight = editing ? editing.routeId : selectedShip?.route_id || null;
  const draftStops = editing ? editing.draft.stops.map((s) => s.island) : null;
  useEffect(() => renderer?.setArchState(archSel, highlight, draftStops));

  // Keyboard: Esc steps back one thing per press, Enter enters the selected
  // island, Backspace returns to the archipelago, R rotates the ghost.
  const latest = useRef({ tool, confirm, dialog: vs.dialog, panel, sheets });
  useEffect(() => {
    latest.current = { tool, confirm, dialog: vs.dialog, panel, sheets };
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
        dispatch({ type: "keyEnter" });
      } else if (e.key === "Backspace") {
        if (cur.confirm || cur.dialog) return;
        e.preventDefault();
        dispatch({ type: "keyBack" });
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
        getDisplay: () => sync.getSnapshot().model,
        getServer: () => sync.getSnapshot().server,
        engineCount: () => GameRenderer.engineCount(),
        view: () => {
          const r = rendererRef.current;
          if (!r) return "";
          if (r.transitioning()) return "transition";
          const v = r.currentView();
          return v.kind === "archipelago" ? "archipelago" : v.id;
        },
        islandToScreen: (id, x, y) => rendererRef.current?.islandToScreen(id, x, y) ?? nan,
        shipToScreen: (id) => rendererRef.current?.shipToScreen(id) ?? nan,
        archToScreen: (x, y) => rendererRef.current?.archToClient({ x, y }) ?? nan,
        drawCalls: () => rendererRef.current?.lastDrawCalls() ?? 0,
        shipStyle: (id) => rendererRef.current?.shipStyle(id) ?? null,
        constructionMarkers: () => rendererRef.current?.constructionMarkers() ?? [],
        frameStats: (windowMs) => rendererRef.current?.frameStats(windowMs) ?? { frames: 0, fps: 0, avgMs: 0, p95Ms: 0 },
        carts: () => rendererRef.current?.cartCount() ?? 0,
        ghostTile: () => rendererRef.current?.ghostTile() ?? null,
      };
    }
  }, [sync]);

  const focus = (id: number) => {
    const owner = model?.islands.find((is) => is.buildings.some((b) => b.id === id));
    if (owner && (archView || owner.id !== islandId)) {
      enterIsland(owner.id);
      pendingFocus.current = id;
    } else {
      rendererRef.current?.focusBuilding(id);
    }
    dispatch({ type: "selectBuilding", id });
  };

  const scrap = (ship: ShipDisplay) =>
    setConfirm({
      title: `Scrap ship #${ship.id}?`,
      body: "Its cargo is unloaded where it lies (above capacity it is lost); half of its materials are refunded, no gold.",
      confirmLabel: "Scrap",
      onConfirm: () => void send({ type: "scrap_ship", ship_id: ship.id }),
    });

  const selectShipFromList = (ship: ShipDisplay) => {
    setPanel("none");
    // A ship at sea is shown in the archipelago.
    if (ship.leg && !archView && ship.island_id === "") dispatch({ type: "toArchipelago" });
    dispatch({ type: "selectShip", id: ship.id });
  };

  const idleShipsHere = model?.ships.filter((s) => s.state === "idle" && s.island_id === islandId) ?? [];
  const islandName = (id: string) => model?.islands.find((is) => is.id === id)?.name || id;
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
    if (panel === "ships") {
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
          onDelete={(id) => void send({ type: "delete_route", route_id: id })}
          onClose={() => setPanel("none")}
        />
      );
    } else if (editor?.active && archView) {
      rightKey = "editor";
      rightTitle = editor.routeId === null ? "New route" : `Route #${editor.routeId}`;
      rightClose = () => dispatch({ type: "closeEditor" });
      right = (
        <RouteEditor
          model={model}
          content={content}
          routeId={editor.routeId}
          draft={editor.draft}
          pickingShip={editor.pickingShip}
          error={editor.error}
          onChange={(draft) => dispatch({ type: "setDraft", draft })}
          onAddStop={(is) => dispatch({ type: "appendStop", island: is })}
          onRemoveStop={(index) => dispatch({ type: "removeStop", index })}
          onMoveStop={(index, delta) => dispatch({ type: "moveStop", index, delta })}
          onSave={() => void saveEditor()}
          onClose={() => dispatch({ type: "closeEditor" })}
          onAssign={(shipId, routeId) => void assign(shipId, routeId)}
          onUnassign={(shipId) => void send({ type: "unassign_ship", ship_id: shipId })}
          onCancelPick={() => dispatch({ type: "clearPickingShip", session: editor.session })}
        />
      );
    } else if (selectedShip) {
      const ship = selectedShip;
      rightKey = "ship";
      rightTitle = `Ship #${ship.id}`;
      rightClose = () => dispatch({ type: "clearSelection" });
      right = (
        <ShipPanel
          ship={ship}
          model={model}
          content={content}
          nowMs={snap.nowMs}
          archipelago={archView}
          onAssignToRoute={() => openEditor(null, ship.id)}
          onUnassign={() => void send({ type: "unassign_ship", ship_id: ship.id })}
          onSend={() => dispatch({ type: "openShipment", shipId: ship.id, to: null })}
          onSendTo={() => dispatch({ type: "sendTo", shipId: ship.id, from: ship.island_id })}
          onFound={() => startFounding(ship)}
          onScrap={() => scrap(ship)}
          onClose={() => dispatch({ type: "clearSelection" })}
        />
      );
    } else if (archView && vs.selection.kind === "island") {
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
          nowMs={snap.nowMs}
          onEnter={() => enterIsland(id)}
          onFound={(shipId) => {
            const s = model.ships.find((x) => x.id === shipId);
            if (s) startFounding(s);
          }}
          onNewRoute={() => openEditor(null, null, id)}
          onSelectShip={(shipId) => dispatch({ type: "selectShip", id: shipId })}
          onClose={() => dispatch({ type: "clearSelection" })}
        />
      );
    } else if (!archView && selectedBuilding && island) {
      rightKey = "building";
      rightTitle = defs.get(selectedBuilding.type)?.name ?? selectedBuilding.type;
      rightClose = () => dispatch({ type: "clearSelection" });
      right = (
        <InfoPanel
          building={selectedBuilding}
          island={island}
          model={model}
          content={content}
          onSetPaused={(paused) => void send({ type: "set_paused", island_id: islandId, building_id: selectedBuilding.id, paused })}
          onDemolish={() => requestDemolish(selectedBuilding)}
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
          onSelectBuilding={focus}
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
  const placementBar = !archView && touchUI && isGhostTool(tool);
  const demolishBar = !archView && touchUI && tool.kind === "demolish";
  const roadBar = !archView && touchUI && tool.kind === "road";
  const verb = touchUI ? "Tap" : "Click";

  let archHint = "";
  if (archView) {
    const sh = vs.shipment;
    if (sh.kind === "awaitingTarget") archHint = `${verb} the destination island for ship #${sh.shipId} · Esc cancels`;
    else if (sh.kind === "dragging") archHint = `Drop ship #${sh.shipId} on an island to send it · the sea cancels`;
    else if (editor?.active) archHint = `${verb} islands to add stops · Esc closes the editor`;
    else archHint = `${verb} an island to select it, again to enter · drag an idle ship onto an island to send it`;
  }

  const resumeBar = editor && !editor.active && archView && (
    <div className={`${hud.panel} ${hud.resumeBar}`}>
      <span className={hud.small}>Route editor paused ({editor.routeId === null ? "new route" : `route #${editor.routeId}`})</span>
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
  const hintShown = archView || (tool.kind !== "none" && !placementBar && !demolishBar && !roadBar);
  const tightLandscape = collapseLandscapeChrome({
    mode: layout.mode,
    sheets,
    panelOpen: right !== null || Boolean(resumeBar),
    height: layout.height,
    buildBar: !archView,
    banner: insolvencyBanner(model) !== null,
    hint: hintShown,
  });
  const toolHint = !tightLandscape && !archView && tool.kind !== "none" && !placementBar && !demolishBar && !roadBar && (
    <div className={phone ? styles.hintInline : styles.hint} data-testid="tool-hint">
      {tool.kind === "build" && `Click to place (${tool.rotation}°) · R rotate · Esc / right click cancel`}
      {tool.kind === "move" && `Click to move (${tool.rotation}°) · R rotate · Esc / right click cancel`}
      {tool.kind === "found" && `Click to place the warehouse from ship #${tool.shipId} (${tool.rotation}°) · R rotate · Esc cancel`}
      {tool.kind === "road" && "Drag to draw a road · Esc / right click cancel"}
      {tool.kind === "demolish" && "Click a building or road to demolish · Esc / right click cancel"}
      {ghostHint && (tool.kind === "build" || tool.kind === "move") && (
        <div className={styles.hintReason} data-testid="tool-hint-reason">
          {ghostHint}
        </div>
      )}
    </div>
  );
  const archHintEl = !tightLandscape && archView && (
    <div className={phone ? styles.hintInline : styles.hint} data-testid="arch-hint">
      {archHint}
    </div>
  );
  const unreachable = snap.unreachable && (
    <div className={phone ? styles.bannerInline : styles.banner} data-testid="unreachable-banner">
      Server unreachable — retrying…
    </div>
  );

  return (
    <div className={`${styles.root} ${phone ? styles.phone : ""}`} data-layout={layout.mode} data-touch={isTouchLayout(layout.mode) ? "true" : undefined}>
      {archView && model && <ArchipelagoOverlay renderer={renderer} model={model} selectedShip={selectedShip?.id ?? null} nowMs={snap.nowMs} />}
      <div className={styles.overlay}>
        <div className={styles.top}>
          <TopBar
            model={model}
            content={content}
            islandId={islandId}
            archipelago={archView}
            onSelectIsland={enterIsland}
            onToArchipelago={() => dispatch({ type: "toArchipelago" })}
            onShips={() => setPanel((p) => (p === "ships" ? "none" : "ships"))}
            onRoutes={() => setPanel((p) => (p === "routes" ? "none" : "routes"))}
            onQuests={() => setPanel((p) => (p === "quests" ? "none" : "quests"))}
            account={<AccountMenu player={player} onRegistered={onPlayerChange} onLoggedOut={onLoggedOut} compact={compactHud} />}
            compact={layout.mode === "phone-portrait" ? "portrait" : compactHud ? "landscape" : null}
          />
          <InsolvencyBanner model={model} onOpenWarnings={() => setWarningsOpen(true)} compact={phone} oneLine={tightLandscape} />
          {placementBar && isGhostTool(tool) && (
            <PlacementBar tool={tool} hint={ghostHint} onConfirm={confirmPlacement} onRotate={() => rotateTool(1)} onCancel={() => setTool(NO_TOOL)} />
          )}
          {demolishBar && <DemolishBar onDone={() => setTool(NO_TOOL)} />}
          {roadBar && <RoadBar onDone={() => setTool(NO_TOOL)} />}
          {phone && toolHint}
          {phone && archHintEl}
          {phone && unreachable}
        </div>
        {/* In the overlay after the top bar: focus order top bar → canvas → panel → build bar. */}
        <GameCanvas sync={sync} tool={() => tool} events={events} onRenderer={onRenderer} initialView={initialView} />
        {rightSlot}
        <div className={styles.bottom}>
          {archView ? null : island && !island.settled ? (
            <div className={`${hud.panel} ${hud.unsettledPanel}`} data-testid="unsettled-panel">
              <div>
                <strong>{island.name || island.id}</strong> is not settled. Send a ship with the warehouse materials
                and found a settlement.
              </div>
              {idleShipsHere.map((s) => (
                <button key={s.id} type="button" className={hud.button} onClick={() => startFounding(s)} data-testid={`found-settlement-${s.id}`}>
                  Found settlement with ship #{s.id}
                </button>
              ))}
            </div>
          ) : (
            <BuildMenu
              content={content}
              model={model}
              islandId={islandId}
              fertilities={staticIsland?.fertilities}
              tool={tool}
              onSelect={selectBuildItem}
              onDemolishTool={() => setTool((t) => (t.kind === "demolish" ? NO_TOOL : { kind: "demolish" }))}
              compact={compactHud}
              singleRow={layout.mode === "phone-landscape"}
            />
          )}
        </div>
        <div className={styles.left}>
          {model && content && (
            <WarningsTray model={model} content={content} onFocus={focus} open={warningsOpen} onOpenChange={setWarningsOpen} />
          )}
        </div>
      </div>
      {!phone && archHintEl}
      {!phone && toolHint}
      {!phone && unreachable}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} phone={phone} />
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
      {awaySummary && content && shouldShowSummary(awaySummary, closedSummaries) && (
        <AwayDialog summary={awaySummary} content={content} islandName={islandName} onDismiss={() => dismissSummary(awaySummary.id)} />
      )}
      {vs.dialog && dialogShip && model && content && (
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
