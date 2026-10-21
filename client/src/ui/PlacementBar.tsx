import styles from "./hud.module.css";
import type { GhostTool } from "./tools";

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
          ✓ Confirm
        </button>
        <button type="button" className={styles.button} onClick={onRotate} aria-label={`Rotate (now ${tool.rotation}°)`} data-testid="placement-rotate">
          ⟳ {tool.rotation}°
        </button>
        <button type="button" className={styles.button} onClick={onCancel} data-testid="placement-cancel">
          ✕ Cancel
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
      <span className={styles.toolBarText}>⚒ Demolish mode — tap a building</span>
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
