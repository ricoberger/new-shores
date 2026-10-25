import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { serverTimeMs } from "../display/extrapolate";
import { countdown, legTiming } from "../display/ships";
import { CloseButton } from "./CloseButton";
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
  waiting_for_berth: "Waiting for berth",
  anchored_unpaid: "Anchored (unpaid)",
  on_world_map: "World map",
};

/**
 * Where a ship is or its countdown ("departs in" / "arrives in" from the
 * leg timestamps; "unloading" until berth_until; "at sea" for the start
 * ship before it sails).
 */
export function shipWhere(s: ShipDisplay, nowMs: number, islandName: (id: string) => string): string {
  if (!s.leg) {
    if (!s.island_id) return s.position ? "at sea" : "";
    if (s.state === "waiting_for_berth") return `waiting for a berth at ${islandName(s.island_id)}`;
    if (s.berth_until) return `unloading at ${islandName(s.island_id)} (${countdown(Math.max(0, serverTimeMs(s.berth_until) - nowMs))})`;
    return `at ${islandName(s.island_id)}`;
  }
  const t = legTiming(s.leg, nowMs);
  return t.phase === "handling" ? `departs in ${countdown(t.departsInMs)}` : `arrives in ${countdown(t.arrivesInMs)}`;
}

/**
 * A ship's state with its live countdown or place ("On route · arrives in
 * 19:00"), the same line in the list and in the ship panel. A ship paused
 * for lack of gold shows "$ unpaid" after the state.
 */
export function ShipStatusLine({
  ship: s,
  nowMs,
  islandName,
  className,
  stateTestId,
  etaTestId,
  routeName,
}: {
  ship: ShipDisplay;
  nowMs: number;
  islandName: (id: string) => string;
  className?: string;
  stateTestId: string;
  etaTestId: string;
  /** The route name, shown after "On route". */
  routeName?: string;
}) {
  // The state already says "Waiting for berth": the place alone follows it.
  const where = s.state === "waiting_for_berth" && !s.leg && s.island_id ? `at ${islandName(s.island_id)}` : shipWhere(s, nowMs, islandName);
  return (
    <span className={className}>
      <span data-testid={stateTestId}>
        {SHIP_STATES[s.state] ?? s.state}
        {s.state === "on_route" && routeName ? `: ${routeName}` : ""}
      </span>
      {s.paused && <span className={styles.warn}> $ unpaid</span>}
      {where && (
        <>
          {" · "}
          <span data-testid={etaTestId}>{where}</span>
        </>
      )}
    </span>
  );
}

/** The player's ships as a list; an entry selects the ship (its info panel holds the actions). */
export function ShipsPanel({ model, content, nowMs, onSelect, onClose }: Props) {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="ships-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>Ships</h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="ships-close" />
      </div>
      <div className={styles.panelBody}>
        {model.ships.length === 0 && <div className={styles.small}>No ships yet. Build a shipyard and order a sloop.</div>}
        {model.ships.map((s) => (
          <button key={s.id} type="button" className={`${styles.trayEntry} ${styles.shipEntry}`} onClick={() => onSelect(s)} data-testid={`ship-${s.id}`}>
            <span>
              <strong>
                {content.ships.find((t) => t.id === s.type)?.name ?? s.type} #{s.id}
              </strong>
              <br />
              <ShipStatusLine ship={s} nowMs={nowMs} islandName={islandName} className={styles.small} stateTestId={`ship-state-${s.id}`} etaTestId={`ship-eta-${s.id}`} routeName={model.routes.find((r) => r.id === s.route_id)?.name} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
