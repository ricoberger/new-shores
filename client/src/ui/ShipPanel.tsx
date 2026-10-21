import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { perMin, units } from "../display/format";
import { shipWhere, SHIP_STATES } from "./ShipsPanel";
import styles from "./hud.module.css";

interface Props {
  ship: ShipDisplay;
  model: DisplayState;
  content: Content;
  nowMs: number;
  /** The archipelago view is shown ("Send to…" picks the destination there). */
  archipelago: boolean;
  onAssignToRoute: () => void;
  onUnassign: () => void;
  onSend: () => void;
  onSendTo: () => void;
  onFound: () => void;
  onScrap: () => void;
  onClose: () => void;
}

/**
 * Ship info panel (UI.md §4): type, state, cargo slots, current leg with a
 * live countdown, route and upkeep. Actions are offered only in the states
 * the server accepts them; the server validates.
 */
export function ShipPanel({ ship: s, model, content, nowMs, archipelago, onAssignToRoute, onUnassign, onSend, onSendTo, onFound, onScrap, onClose }: Props) {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const type = content.ships.find((t) => t.id === s.type)?.name ?? s.type;
  const idle = s.state === "idle";
  const here = model.islands.find((i) => i.id === s.island_id);
  const route = model.routes.find((r) => r.id === s.route_id);
  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="ship-panel">
      <div className={styles.row}>
        <h2 className={styles.title} data-testid="ship-panel-name">
          {type} #{s.id}
        </h2>
        <div className={styles.spacer} />
        <button type="button" className={styles.link} onClick={onClose} data-testid="ship-panel-close">
          close
        </button>
      </div>
      <div className={styles.row}>
        <span data-testid="ship-panel-state">{SHIP_STATES[s.state] ?? s.state}</span>
        {s.paused && <span className={styles.warn}>$ unpaid</span>}
      </div>
      <div className={styles.small}>
        {s.leg && (
          <>
            {islandName(s.leg.from_island_id)} → {islandName(s.leg.to_island_id)} ·{" "}
          </>
        )}
        <span data-testid="ship-panel-eta">{shipWhere(s, nowMs, islandName)}</span>
      </div>
      <div className={styles.small} data-testid="ship-panel-route">
        Route: {route ? route.name : "none"}
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          Cargo ({s.cargo.length}/{s.slots} slots of {units(s.slot_size)})
        </div>
        <div className={styles.small} data-testid="ship-panel-cargo">
          {s.cargo.length === 0 ? "empty" : s.cargo.map((c, i) => <div key={i}>{`${units(c.amount)} ${goodName(c.good)}`}</div>)}
        </div>
      </div>
      <div className={styles.small}>upkeep {perMin(s.upkeep_per_min)}/min</div>
      <div className={`${styles.row} ${styles.section}`}>
        {idle && (
          <button type="button" className={styles.button} onClick={onAssignToRoute} data-testid="ship-panel-assign">
            Assign to route…
          </button>
        )}
        {s.route_id !== 0 && (
          <button type="button" className={styles.button} onClick={onUnassign} data-testid="ship-panel-unassign">
            Unassign
          </button>
        )}
        {idle && (
          <button type="button" className={styles.button} onClick={onSend} data-testid="ship-panel-send">
            Send…
          </button>
        )}
        {idle && archipelago && (
          <button type="button" className={styles.button} onClick={onSendTo} data-testid="ship-panel-send-to">
            Send to… (pick island)
          </button>
        )}
        {idle && here && !here.settled && (
          <button type="button" className={styles.button} onClick={onFound} data-testid="ship-panel-found">
            Found settlement
          </button>
        )}
        {(idle || s.state === "anchored_unpaid") && (
          <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onScrap} data-testid="ship-panel-scrap">
            Scrap
          </button>
        )}
      </div>
    </div>
  );
}
