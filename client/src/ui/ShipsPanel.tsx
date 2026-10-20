import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { units } from "../display/format";
import { cargoTotals, countdown, legTiming } from "../display/ships";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  /** Server time the model was extrapolated to (ms since the epoch). */
  nowMs: number;
  onSelect: (ship: ShipDisplay) => void;
  onClose: () => void;
}

export const SHIP_STATES: Record<string, string> = {
  idle: "Idle",
  on_route: "On route",
  manual_leg: "Shipment",
  anchored_unpaid: "Anchored (unpaid)",
  on_world_map: "World map",
};

/** Where a ship is or its countdown ("departs in" / "arrives in" from the leg timestamps). */
export function shipWhere(s: ShipDisplay, nowMs: number, islandName: (id: string) => string): string {
  if (!s.leg) return `at ${islandName(s.island_id)}`;
  const t = legTiming(s.leg, nowMs);
  return t.phase === "handling" ? `departs in ${countdown(t.departsInMs)}` : `arrives in ${countdown(t.arrivesInMs)}`;
}

/** The player's ships as a list; an entry selects the ship (its info panel holds the actions). */
export function ShipsPanel({ model, content, nowMs, onSelect, onClose }: Props) {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
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
      {model.ships.map((s) => {
        const cargo = cargoTotals(s.cargo);
        return (
          <button key={s.id} type="button" className={`${styles.trayEntry} ${styles.shipEntry}`} onClick={() => onSelect(s)} data-testid={`ship-${s.id}`}>
            <span>
              <strong>
                {content.ships.find((t) => t.id === s.type)?.name ?? s.type} #{s.id}
              </strong>{" "}
              <span data-testid={`ship-state-${s.id}`}>{SHIP_STATES[s.state] ?? s.state}</span>
              {s.paused && <span className={styles.warn}> $ unpaid</span>}
              <br />
              <span className={styles.small}>
                <span data-testid={`ship-eta-${s.id}`}>{shipWhere(s, nowMs, islandName)}</span> ·{" "}
                <span data-testid={`ship-cargo-${s.id}`}>
                  {Object.keys(cargo).length === 0
                    ? "empty"
                    : Object.entries(cargo)
                        .map(([g, a]) => `${units(a)} ${goodName(g)}`)
                        .join(", ")}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
