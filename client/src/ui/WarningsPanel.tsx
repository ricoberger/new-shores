import type { Content, DisplayState } from "../api/client";
import { statusText } from "../display/status";
import { StatusIcon } from "./InfoPanel";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  onFocus: (buildingId: number) => void;
  onClose: () => void;
}

/** Every building whose status is not ok, with its sentence (MECHANICS §14). */
export function WarningsPanel({ model, content, onFocus, onClose }: Props) {
  const entries = warningEntries(model, content);
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="warnings-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>Warnings</h2>
        <div className={styles.spacer} />
        <button type="button" className={styles.link} onClick={onClose} data-testid="warnings-close">
          close
        </button>
      </div>
      {entries.length === 0 && <p className={styles.small}>No warnings.</p>}
      <ul className={styles.trayList}>
        {entries.map(({ b, text }) => (
          <li key={b.id}>
            <button type="button" className={styles.trayEntry} onClick={() => onFocus(b.id)} data-testid="warning-entry">
              <StatusIcon building={b} />
              <span>
                {content.buildings.find((d) => d.id === b.type)?.name ?? b.type}: {text.sentence}
                {text.fix && <span className={styles.fix}> — {text.fix}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The buildings with a status other than ok, with their sentences. */
export function warningEntries(model: DisplayState, content: Content) {
  return model.islands.flatMap((is) => is.buildings.filter((b) => b.status !== "ok").map((b) => ({ b, is, text: statusText(b, is, model, content) })));
}
