import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ApiError,
  type BuildingDisplay,
  type Command,
  type ContentBuilding,
  NetworkError,
  type Player,
  type RouteStop,
  type ShipDisplay,
  type WorldResponse,
} from "../api/client";
import { GameSync, SyncStoppedError } from "../api/sync";
import { units } from "../display/format";
import { buildingAt, lPath, nextRotation, type TilePos } from "../display/geometry";
import { GameRenderer } from "../render/engine";
import { AccountMenu } from "./AccountMenu";
import styles from "./App.module.css";
import hud from "./hud.module.css";
import { BuildMenu } from "./BuildMenu";
import { type ConfirmRequest, ConfirmDialog } from "./Dialogs";
import { GameCanvas } from "./GameCanvas";
import { InfoPanel } from "./InfoPanel";
import { RoutesPanel } from "./RoutesPanel";
import { ShipmentDialog } from "./ShipmentDialog";
import { ShipsPanel } from "./ShipsPanel";
import { type Toast, Toasts } from "./Toasts";
import { NO_TOOL, type Tool } from "./tools";
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
}

declare global {
  interface Window {
    __newShores?: TestHook;
  }
}

interface AppProps {
  player: Player;
  /** The player changed (a guest registered; same world). */
  onPlayerChange: (player: Player) => void;
  /** A request answered 401: back to the start screen. */
  onSessionEnded: () => void;
  onLoggedOut: () => void;
}

export function App({ player, onPlayerChange, onSessionEnded, onLoggedOut }: AppProps) {
  const [sync] = useState(() => new GameSync());
  useEffect(() => sync.start(), [sync]);
  useEffect(() => sync.subscribeUnauthorized(onSessionEnded), [sync, onSessionEnded]);
  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const { model, content } = snap;

  const [tool, setTool] = useState<Tool>(NO_TOOL);
  const [selected, setSelected] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [chosenIsland, setChosenIsland] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "ships" | "routes">("none");
  const [shipment, setShipment] = useState<ShipDisplay | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const toastId = useRef(0);

  // The island shown (D-027: the client only chooses what to look at).
  const island = model?.islands.find((is) => is.id === chosenIsland) ?? model?.islands[0];
  const islandId = island?.id ?? "";
  const defs = new Map((content?.buildings ?? []).map((b) => [b.id, b]));
  const selectedBuilding = island?.buildings.find((b) => b.id === selected);
  const warehouseType = content?.buildings.find((b) => b.warehouse)?.id ?? "";

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts, { id, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  /** Sends a command; errors are toasts. Resolves to ok and the API error. */
  const sendCommand = async (cmd: Command): Promise<{ ok: boolean; error: ApiError | null }> => {
    try {
      await sync.send(cmd);
      return { ok: true, error: null };
    } catch (err) {
      if (err instanceof SyncStoppedError) return { ok: false, error: null }; // logged out meanwhile
      if (err instanceof ApiError) {
        toast(err.message);
        return { ok: false, error: err };
      }
      toast(err instanceof NetworkError ? "Server unreachable" : String(err));
      return { ok: false, error: null };
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
      setSelected(null);
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

  const selectIsland = (id: string) => {
    if (id === islandId) return;
    setChosenIsland(id);
    setSelected(null);
    setTool(NO_TOOL);
    rendererRef.current?.setIsland(id);
  };

  /** Founding: show the ship's island and place the warehouse ghost there. */
  const startFounding = (ship: ShipDisplay) => {
    setChosenIsland(ship.island_id);
    rendererRef.current?.setIsland(ship.island_id);
    setSelected(null);
    setPanel("none");
    setTool({ kind: "found", shipId: ship.id, buildingType: warehouseType, rotation: 0 });
  };

  const saveRoute = async (id: number | null, name: string, stops: RouteStop[]): Promise<boolean> => {
    const cmd: Command =
      id === null ? { type: "create_route", name, stops } : { type: "update_route", route_id: id, name, stops };
    return (await sendCommand(cmd)).ok;
  };

  const events = {
    select: (id: number | null) => setSelected(id),
    place: (x: number, y: number) => {
      if (tool.kind !== "build") return;
      void send({ type: "place_building", island_id: islandId, building_type: tool.buildingType, x, y, rotation: tool.rotation });
    },
    move: (x: number, y: number) => {
      if (tool.kind !== "move") return;
      const moving = tool;
      void sendCommand({
        type: "move_building",
        island_id: islandId,
        building_id: moving.buildingId,
        x,
        y,
        rotation: moving.rotation,
      }).then(({ ok }) => {
        // On success the building stays selected at its new position; on an
        // error the move tool stays active so the player can retry.
        if (ok) setTool((t) => (t === moving ? NO_TOOL : t));
      });
    },
    found: (x: number, y: number) => {
      if (tool.kind !== "found") return;
      const founding = tool;
      void sendCommand({
        type: "found_island",
        ship_id: founding.shipId,
        island_id: islandId,
        building_type: founding.buildingType,
        x,
        y,
        rotation: founding.rotation,
      }).then(({ ok }) => {
        if (ok) setTool((t) => (t === founding ? NO_TOOL : t));
      });
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
  };

  const selectBuildItem = (b: ContentBuilding) => {
    setSelected(null);
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
  }, []);

  // The renderer shows the chosen island (also after it was re-created).
  useEffect(() => {
    if (islandId) rendererRef.current?.setIsland(islandId);
  }, [islandId, snap.server]);

  useEffect(() => rendererRef.current?.setSelected(selected), [selected, snap.server]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        setTool(NO_TOOL);
        setConfirm(null);
      } else if (e.key === "r" || e.key === "R") {
        setTool((t) => (t.kind === "build" || t.kind === "move" || t.kind === "found" ? { ...t, rotation: nextRotation(t.rotation) } : t));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") {
      window.__newShores = {
        tileToScreen: (id, x, y) => rendererRef.current?.tileToScreen(id, x, y) ?? { x: NaN, y: NaN },
        getDisplay: () => sync.getSnapshot().model,
        getServer: () => sync.getSnapshot().server,
        engineCount: () => GameRenderer.engineCount(),
      };
    }
  }, [sync]);

  const focus = (id: number) => {
    const owner = model?.islands.find((is) => is.buildings.some((b) => b.id === id));
    if (owner && owner.id !== islandId) {
      setChosenIsland(owner.id);
      setTool(NO_TOOL);
      rendererRef.current?.setIsland(owner.id);
    }
    setSelected(id);
    rendererRef.current?.focusBuilding(id);
  };

  const idleShipsHere = model?.ships.filter((s) => s.state === "idle" && s.island_id === islandId) ?? [];

  return (
    <div className={styles.root}>
      <GameCanvas sync={sync} tool={() => tool} events={events} onRenderer={onRenderer} />
      <div className={styles.overlay}>
        <div className={styles.top}>
          <TopBar
            model={model}
            content={content}
            islandId={islandId}
            onSelectIsland={selectIsland}
            onShips={() => setPanel((p) => (p === "ships" ? "none" : "ships"))}
            onRoutes={() => setPanel((p) => (p === "routes" ? "none" : "routes"))}
            account={<AccountMenu player={player} onRegistered={onPlayerChange} onLoggedOut={onLoggedOut} />}
          />
        </div>
        <div className={styles.left}>{model && content && <WarningsTray model={model} content={content} onFocus={focus} />}</div>
        <div className={styles.right}>
          {panel === "ships" && model && content && (
            <ShipsPanel
              model={model}
              content={content}
              nowMs={snap.nowMs}
              onShipment={setShipment}
              onAssign={(shipId, routeId) => void send({ type: "assign_ship", ship_id: shipId, route_id: routeId })}
              onUnassign={(shipId) => void send({ type: "unassign_ship", ship_id: shipId })}
              onScrap={(ship) =>
                setConfirm({
                  title: `Scrap ship #${ship.id}?`,
                  body: "Its cargo is unloaded where it lies (above capacity it is lost); half of its materials are refunded, no gold.",
                  confirmLabel: "Scrap",
                  onConfirm: () => void send({ type: "scrap_ship", ship_id: ship.id }),
                })
              }
              onFound={startFounding}
              onClose={() => setPanel("none")}
            />
          )}
          {panel === "routes" && model && content && (
            <RoutesPanel
              model={model}
              content={content}
              onSave={saveRoute}
              onDelete={(id) => void send({ type: "delete_route", route_id: id })}
              onClose={() => setPanel("none")}
            />
          )}
          {panel === "none" && selectedBuilding && island && model && content && (
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
              onSelectBuilding={focus}
              nowMs={snap.nowMs}
              onOrderShip={(shipType) =>
                void send({ type: "order_ship", island_id: islandId, building_id: selectedBuilding.id, ship_type: shipType })
              }
              onCancelShipOrder={() => void send({ type: "cancel_ship_order", island_id: islandId, building_id: selectedBuilding.id })}
            />
          )}
        </div>
        <div className={styles.bottom}>
          {island && !island.settled ? (
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
              tool={tool}
              onSelect={selectBuildItem}
              onDemolishTool={() => setTool((t) => (t.kind === "demolish" ? NO_TOOL : { kind: "demolish" }))}
            />
          )}
        </div>
      </div>
      {tool.kind !== "none" && (
        <div className={styles.hint} data-testid="tool-hint">
          {tool.kind === "build" && `Click to place (${tool.rotation}°) · R rotate · Esc / right click cancel`}
          {tool.kind === "move" && `Click to move (${tool.rotation}°) · R rotate · Esc / right click cancel`}
          {tool.kind === "found" && `Click to place the warehouse from ship #${tool.shipId} (${tool.rotation}°) · R rotate · Esc cancel`}
          {tool.kind === "road" && "Drag to draw a road · Esc / right click cancel"}
          {tool.kind === "demolish" && "Click a building or road to demolish · Esc / right click cancel"}
        </div>
      )}
      {snap.unreachable && (
        <div className={styles.banner} data-testid="unreachable-banner">
          Server unreachable — retrying…
        </div>
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
      {shipment && model && content && (
        <ShipmentDialog
          ship={shipment}
          model={model}
          content={content}
          onClose={() => setShipment(null)}
          onSend={(to, cargo) => void send({ type: "manual_shipment", ship_id: shipment.id, to_island_id: to, cargo })}
        />
      )}
    </div>
  );
}
