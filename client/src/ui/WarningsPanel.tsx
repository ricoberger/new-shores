import type { Content, DisplayState } from "../api/client";
import { t } from "../i18n";
import { statusText } from "../display/status";
import { StatusIcon } from "./InfoPanel";
import { CloseButton } from "./CloseButton";
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
        <h2 className={styles.title}>{t("warnings.title")}</h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="warnings-close" />
      </div>
      <div className={styles.panelBody}>
        {entries.length === 0 && <p className={styles.small}>{t("warnings.none")}</p>}
        <ul className={styles.trayList}>
          {entries.map(({ b, text }) => (
            <li key={b.id} className={styles.shipEntry}>
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
    </div>
  );
}

/** The buildings with a status other than ok, with their sentences. */
export function warningEntries(model: DisplayState, content: Content) {
  return model.islands.flatMap((is) => is.buildings.filter((b) => b.status !== "ok").map((b) => ({ b, is, text: statusText(b, is, model, content) })));
}
