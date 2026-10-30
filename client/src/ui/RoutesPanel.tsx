import type { DisplayState, RouteDisplay } from "../api/client";
import { t } from "../i18n";
import { CloseButton } from "./CloseButton";
import { RouteSummary } from "./RouteSummary";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  /** Opens the route editor on a saved route or a new one (null). */
  onEdit: (route: RouteDisplay | null) => void;
  onClose: () => void;
}

/** Routes: a list with stops, loop time and ship count; a route opens in the route editor (which also deletes). */
export function RoutesPanel({ model, onEdit, onClose }: Props) {
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="routes-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>{t("routes.title")}</h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="routes-close" />
      </div>
      <div className={styles.panelBody}>
        {model.routes.length === 0 && <div className={styles.small}>{t("routes.none")}</div>}
        {model.routes.map((r) => (
          <button key={r.id} type="button" className={`${styles.trayEntry} ${styles.shipEntry}`} onClick={() => onEdit(r)} data-testid={`route-${r.id}`}>
            <span>
              <RouteSummary route={r} islandName={islandName} />
            </span>
          </button>
        ))}
        <div className={`${styles.buttons} ${styles.shipEntry}`}>
          <button type="button" className={styles.button} onClick={() => onEdit(null)} data-testid="route-new">
            {t("routes.new")}
          </button>
        </div>
      </div>
    </div>
  );
}
