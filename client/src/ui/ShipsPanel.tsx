import { useState } from "react";
import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { perMin, units } from "../display/format";
import { cargoTotals, countdown, legTiming } from "../display/ships";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  /** Server time the model was extrapolated to (ms since the epoch). */
  nowMs: number;
  onShipment: (ship: ShipDisplay) => void;
  onAssign: (shipId: number, routeId: number) => void;
  onUnassign: (shipId: number) => void;
  onScrap: (ship: ShipDisplay) => void;
  onFound: (ship: ShipDisplay) => void;
  onClose: () => void;
}

const STATES: Record<string, string> = {
  idle: "Idle",
  on_route: "On route",
  manual_leg: "Shipment",
  anchored_unpaid: "Anchored (unpaid)",
  on_world_map: "World map",
};

/** The player's ships: state, location or leg with countdowns, cargo and actions. */
export function ShipsPanel({ model, content, nowMs, onShipment, onAssign, onUnassign, onScrap, onFound, onClose }: Props) {
  const islandName = (id: string) => {
    const is = model.islands.find((i) => i.id === id);
    return is?.name || id;
  };
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="ships-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>Ships</h2>
        <div className={styles.spacer} />
        <button type="button" className={styles.link} onClick={onClose} data-testid="ships-close">
          close
        </button>
      </div>
      {model.ships.length === 0 && <div className={styles.small}>No ships yet. Build a shipyard and order a sloop.</div>}
      {model.ships.map((s) => (
        <ShipEntry
          key={s.id}
          ship={s}
          model={model}
          content={content}
          nowMs={nowMs}
          islandName={islandName}
          goodName={goodName}
          onShipment={onShipment}
          onAssign={onAssign}
          onUnassign={onUnassign}
          onScrap={onScrap}
          onFound={onFound}
        />
      ))}
    </div>
  );
}

interface EntryProps {
  ship: ShipDisplay;
  model: DisplayState;
  content: Content;
  nowMs: number;
  islandName: (id: string) => string;
  goodName: (id: string) => string;
  onShipment: (ship: ShipDisplay) => void;
  onAssign: (shipId: number, routeId: number) => void;
  onUnassign: (shipId: number) => void;
  onScrap: (ship: ShipDisplay) => void;
  onFound: (ship: ShipDisplay) => void;
}

function ShipEntry({ ship: s, model, content, nowMs, islandName, goodName, onShipment, onAssign, onUnassign, onScrap, onFound }: EntryProps) {
  const [picked, setRoute] = useState<number>(0);
  // The picked route, or the first one (routes may appear after mounting).
  const route = model.routes.some((r) => r.id === picked) ? picked : (model.routes[0]?.id ?? 0);
  const name = content.ships.find((t) => t.id === s.type)?.name ?? s.type;
  const cargo = cargoTotals(s.cargo);
  const timing = s.leg ? legTiming(s.leg, nowMs) : null;
  const here = model.islands.find((i) => i.id === s.island_id);
  const idle = s.state === "idle";
  const routeName = model.routes.find((r) => r.id === s.route_id)?.name;
  return (
    <div className={styles.shipEntry} data-testid={`ship-${s.id}`}>
      <div className={styles.row}>
        <strong>
          {name} #{s.id}
        </strong>
        <span data-testid={`ship-state-${s.id}`}>{STATES[s.state] ?? s.state}</span>
        {s.paused && <span className={styles.warn}>$ unpaid</span>}
      </div>
      <div className={styles.small}>
        {s.leg ? (
          <>
            {islandName(s.leg.from_island_id)} → {islandName(s.leg.to_island_id)}
            {routeName ? ` (${routeName})` : ""} ·{" "}
            <span data-testid={`ship-eta-${s.id}`}>
              {timing?.phase === "handling"
                ? `departs in ${countdown(timing.departsInMs)}`
                : `arrives in ${countdown(timing?.arrivesInMs ?? 0)}`}
            </span>
          </>
        ) : (
          <>at {islandName(s.island_id)}</>
        )}
      </div>
      <div className={styles.small} data-testid={`ship-cargo-${s.id}`}>
        Cargo ({s.cargo.length}/{s.slots} slots of {units(s.slot_size)}):{" "}
        {Object.keys(cargo).length === 0
          ? "empty"
          : Object.entries(cargo)
              .map(([g, a]) => `${units(a)} ${goodName(g)}`)
              .join(", ")}
        {" · "}upkeep {perMin(s.upkeep_per_min)}/min
      </div>
      <div className={styles.row}>
        {idle && (
          <button type="button" className={styles.button} onClick={() => onShipment(s)} data-testid={`ship-send-${s.id}`}>
            Send…
          </button>
        )}
        {idle && here && !here.settled && (
          <button type="button" className={styles.button} onClick={() => onFound(s)} data-testid={`ship-found-${s.id}`}>
            Found settlement
          </button>
        )}
        {idle && model.routes.length > 0 && (
          <>
            <select
              className={styles.input}
              value={route}
              onChange={(e) => setRoute(Number(e.target.value))}
              data-testid={`ship-route-${s.id}`}
            >
              {model.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button type="button" className={styles.button} onClick={() => onAssign(s.id, route)} data-testid={`ship-assign-${s.id}`}>
              Assign
            </button>
          </>
        )}
        {s.route_id !== 0 && (
          <button type="button" className={styles.button} onClick={() => onUnassign(s.id)} data-testid={`ship-unassign-${s.id}`}>
            Unassign
          </button>
        )}
        {(idle || s.state === "anchored_unpaid") && (
          <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => onScrap(s)} data-testid={`ship-scrap-${s.id}`}>
            Scrap
          </button>
        )}
      </div>
    </div>
  );
}
