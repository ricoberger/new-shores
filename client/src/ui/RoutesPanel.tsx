import type { DisplayState, RouteDisplay } from "../api/client";
import { countdown } from "../display/ships";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  /** Opens the route editor on a saved route or a new one (null). */
  onEdit: (route: RouteDisplay | null) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

/** Routes: a list with loop time, stops and ship count; editing happens in the route editor. */
export function RoutesPanel({ model, onEdit, onDelete, onClose }: Props) {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="routes-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>Routes</h2>
        <div className={styles.spacer} />
        <button type="button" className={styles.link} onClick={onClose} data-testid="routes-close">
          close
        </button>
      </div>
      {model.routes.length === 0 && <div className={styles.small}>No routes yet.</div>}
      {model.routes.map((r) => (
        <div key={r.id} className={styles.shipEntry} data-testid={`route-${r.id}`}>
          <div className={styles.row}>
            <strong>{r.name}</strong>
            <span className={styles.small}>loop time {countdown(r.loop_ms)}</span>
          </div>
          <div className={styles.small}>{r.stops.map((s) => islandName(s.island_id)).join(" → ")}</div>
          <div className={styles.small} data-testid={`route-ship-count-${r.id}`}>
            Ships: {r.ship_ids.length}
          </div>
          <div className={styles.row}>
            <button type="button" className={styles.button} onClick={() => onEdit(r)} data-testid={`route-edit-${r.id}`}>
              Edit
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              disabled={r.ship_ids.length > 0}
              title={r.ship_ids.length > 0 ? "Unassign its ships first (route in use)" : undefined}
              onClick={() => onDelete(r.id)}
              data-testid={`route-delete-${r.id}`}
            >
              Delete
            </button>
            {r.ship_ids.length > 0 && <span className={styles.small}>in use: unassign its ships to delete</span>}
          </div>
        </div>
      ))}
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={() => onEdit(null)} data-testid="route-new">
          + New route
        </button>
      </div>
    </div>
  );
}
