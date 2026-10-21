import { toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
import type { GhostTool, Tool } from "./tools";

interface Props {
  tool: GhostTool;
  /** Why the server would reject the pending tile (missing fertility or deposit), or null. */
  hint: string | null;
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
export function PlacementBar({ tool, hint, onConfirm, onRotate, onCancel }: Props) {
  const what = tool.kind === "move" ? "Move" : tool.kind === "found" ? "Found settlement" : "Place";
  let text = "Tap the map to position the building";
  if (tool.pending) text = hint ?? `${what} at ${tool.pending.x}, ${tool.pending.y}?`;
  return (
    <div className={`${styles.panel} ${styles.toolBar}`} role="toolbar" aria-label="Placement" data-testid="placement-bar">
      <span className={`${styles.toolBarText} ${tool.pending && hint ? styles.lock : ""}`} data-testid="placement-hint">
        {text}
      </span>
      <div className={styles.toolBarButtons}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onConfirm} disabled={!tool.pending} data-testid="placement-confirm">
          <Icon path={toolIcon("confirm")} /> Confirm
        </button>
        <button type="button" className={styles.button} onClick={onRotate} aria-label={`Rotate (now ${tool.rotation}°)`} data-testid="placement-rotate">
          <Icon path={toolIcon("rotate")} /> {tool.rotation}°
        </button>
        <button type="button" className={styles.button} onClick={onCancel} data-testid="placement-cancel">
          <Icon path={toolIcon("cancel")} /> Cancel
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
        <Icon path={toolIcon("demolish")} /> Demolish mode — tap a building, field or road
      </span>
      <button type="button" className={`${styles.button} ${styles.demolishDone}`} onClick={onDone} data-testid="demolish-done">
        Done
      </button>
    </div>
  );
}

/** The road tool on touch: drag to draw; Done leaves the tool (there is no right click). */
export function RoadBar({ onDone }: { onDone: () => void }) {
  return (
    <div className={`${styles.panel} ${styles.toolBar}`} role="status" data-testid="road-bar">
      <span className={styles.toolBarText}>Drag along the ground to draw a road</span>
      <button type="button" className={styles.button} onClick={onDone} data-testid="road-done">
        Done
      </button>
    </div>
  );
}

/**
 * The field tool on touch (D-049): a tap or a one-finger drag selects a
 * rectangle (previewed green/yellow in the scene); Confirm places the
 * green tiles with one command, Cancel drops the rectangle (and leaves the
 * tool when there is none).
 */
export function FieldBar({
  tool,
  fieldName,
  hint,
  onConfirm,
  onCancel,
}: {
  tool: Extract<Tool, { kind: "field" }>;
  fieldName: string;
  /** The rectangle's counts (from the renderer's preview), or null. */
  hint: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const text = tool.pending ? (hint ?? fieldName) : `Tap or drag over the ground to place ${fieldName.toLowerCase()}s`;
  return (
    <div className={`${styles.panel} ${styles.toolBar}`} role="toolbar" aria-label="Field placement" data-testid="field-bar">
      <span className={styles.toolBarText} data-testid="field-hint">
        {text}
      </span>
      <div className={styles.toolBarButtons}>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onConfirm} disabled={!tool.pending} data-testid="field-confirm">
          <Icon path={toolIcon("confirm")} /> Confirm
        </button>
        <button type="button" className={styles.button} onClick={onCancel} data-testid="field-cancel">
          <Icon path={toolIcon("cancel")} /> Cancel
        </button>
      </div>
    </div>
  );
}
