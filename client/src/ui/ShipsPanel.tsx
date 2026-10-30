import type { DisplayState, ShipDisplay } from "../api/client";
import { serverTimeMs } from "../display/extrapolate";
import { countdown, legTiming } from "../display/ships";
import { t, tOr } from "../i18n";
import { CloseButton } from "./CloseButton";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  /** Server time the model was extrapolated to (ms since the epoch). */
  nowMs: number;
  onSelect: (ship: ShipDisplay) => void;
  onClose: () => void;
}

/** A ship state's label ("On route"); the state code itself for an unknown one. */
export function shipStateLabel(state: string): string {
  return tOr(`ship.state.${state}`, state);
}

/**
 * Where a ship is or its countdown ("departs in" / "arrives in" from the
 * leg timestamps; "unloading" until berth_until; "at sea" for the start
 * ship before it sails).
 */
export function shipWhere(s: ShipDisplay, nowMs: number, islandName: (id: string) => string): string {
  if (!s.leg) {
    if (!s.island_id) return s.position ? t("ships.atSea") : "";
    if (s.state === "waiting_for_berth") return t("ships.waitingAt", { island: islandName(s.island_id) });
    if (s.berth_until) return t("ships.unloadingAt", { island: islandName(s.island_id), time: countdown(Math.max(0, serverTimeMs(s.berth_until) - nowMs)) });
    return t("ships.at", { island: islandName(s.island_id) });
  }
  const timing = legTiming(s.leg, nowMs);
  return timing.phase === "handling" ? t("ships.departsIn", { time: countdown(timing.departsInMs) }) : t("ships.arrivesIn", { time: countdown(timing.arrivesInMs) });
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
  const where = s.state === "waiting_for_berth" && !s.leg && s.island_id ? t("ships.at", { island: islandName(s.island_id) }) : shipWhere(s, nowMs, islandName);
  return (
    <span className={className}>
      <span data-testid={stateTestId}>
        {shipStateLabel(s.state)}
        {s.state === "on_route" && routeName ? `: ${routeName}` : ""}
      </span>
      {s.paused && <span className={styles.warn}> {t("ships.unpaid")}</span>}
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
export function ShipsPanel({ model, nowMs, onSelect, onClose }: Props) {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="ships-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>{t("ships.title")}</h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="ships-close" />
      </div>
      <div className={styles.panelBody}>
        {model.ships.length === 0 && <div className={styles.small}>{t("ships.none")}</div>}
        {model.ships.map((s) => (
          <button key={s.id} type="button" className={`${styles.trayEntry} ${styles.shipEntry}`} onClick={() => onSelect(s)} data-testid={`ship-${s.id}`}>
            <span>
              <strong>{s.name}</strong>
              <br />
              <ShipStatusLine ship={s} nowMs={nowMs} islandName={islandName} className={styles.small} stateTestId={`ship-state-${s.id}`} etaTestId={`ship-eta-${s.id}`} routeName={model.routes.find((r) => r.id === s.route_id)?.name} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
