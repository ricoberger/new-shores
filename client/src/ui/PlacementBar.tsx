import { t } from "../i18n";
import { toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
import type { GhostTool } from "./tools";

interface Props {
  tool: GhostTool;
  /** Why the server would reject the pending tile (missing fertility or deposit), or null. */
  hint: string | null;
  /** The live count of a painted field rectangle (D-054), or null. */
  paintStatus?: string | null;
  onConfirm: () => void;
  onRotate: () => void;
  onCancel: () => void;
}

/**
 * Touch placement (UI.md §6): a tap positions the ghost, Confirm sends the
 * same command as the desktop click. Confirm is disabled until a tile is
 * pending; the ghost's validity colour is drawn in the scene and its
 * reason is repeated here.
 */
export function PlacementBar({ tool, hint, paintStatus = null, onConfirm, onRotate, onCancel }: Props) {
  const what = tool.kind === "move" ? t("placement.move") : tool.kind === "found" ? t("placement.found") : tool.kind === "field" ? t("placement.field") : t("placement.place");
  const removing = tool.kind === "field" && tool.remove === true;
  let text = removing
    ? t("placement.removeFields")
    : tool.kind === "field"
      ? t("placement.addFields")
      : t("placement.tap");
  if (tool.pending && !removing) text = hint ?? t("placement.ask", { what, x: tool.pending.x, y: tool.pending.y });
  // A rectangle being painted: its live count.
  if (paintStatus) text = paintStatus;
  return (
    <div className={`${styles.panel} ${styles.toolBar}`} role="toolbar" aria-label={t("placement.label")} data-testid="placement-bar">
      <span className={`${styles.toolBarText} ${tool.pending && hint && !paintStatus && !removing ? styles.lock : ""}`} data-testid="placement-hint">
        {text}
      </span>
      <div className={styles.toolBarButtons}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onConfirm} disabled={!tool.pending} data-testid="placement-confirm">
          <Icon path={toolIcon("confirm")} /> {t("common.confirm")}
        </button>
        <button type="button" className={styles.button} onClick={onRotate} aria-label={t("placement.rotate", { degrees: tool.rotation })} data-testid="placement-rotate">
          <Icon path={toolIcon("rotate")} /> {tool.rotation}°
        </button>
        <button type="button" className={styles.button} onClick={onCancel} data-testid="placement-cancel">
          <Icon path={toolIcon("cancel")} /> {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * Demolish mode on touch: a persistent tinted bar so that the player
 * always knows a tap demolishes; Done leaves the mode.
 */
export function DemolishBar({ onDone }: { onDone: () => void }) {
  return (
    <div className={`${styles.toolBar} ${styles.demolishBar}`} role="status" data-testid="demolish-bar">
      <span className={styles.toolBarText}>
        <Icon path={toolIcon("demolish")} /> {t("placement.demolishMode")}
      </span>
      <button type="button" className={`${styles.button} ${styles.demolishDone}`} onClick={onDone} data-testid="demolish-done">
        {t("common.done")}
      </button>
    </div>
  );
}

/** The road tool on touch: drag to draw; Done leaves the tool (there is no right click). */
export function RoadBar({ onDone }: { onDone: () => void }) {
  return (
    <div className={`${styles.panel} ${styles.toolBar}`} role="status" data-testid="road-bar">
      <span className={styles.toolBarText}>{t("placement.road")}</span>
      <button type="button" className={styles.button} onClick={onDone} data-testid="road-done">
        {t("common.done")}
      </button>
    </div>
  );
}
