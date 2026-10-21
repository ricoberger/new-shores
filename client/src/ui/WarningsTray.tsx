import { useState } from "react";
import type { Content, DisplayState } from "../api/client";
import { statusText } from "../display/status";
import { StatusIcon } from "./InfoPanel";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  onFocus: (buildingId: number) => void;
  /** Open state when controlled by the parent (the insolvency banner opens it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Every building whose status is not ok, with its sentence (MECHANICS §14). */
export function WarningsTray({ model, content, onFocus, open: controlled, onOpenChange }: Props) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (v: boolean) => {
    setOwn(v);
    onOpenChange?.(v);
  };
  const entries = model.islands.flatMap((is) =>
    is.buildings.filter((b) => b.status !== "ok").map((b) => ({ b, is, text: statusText(b, is, model, content) })),
  );
  return (
    <div className={`${styles.panel} ${styles.tray}`} data-testid="warnings-tray">
      <button type="button" className={styles.trayHeader} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="warnings-toggle">
        ⚠ <span data-testid="warnings-count">{entries.length}</span> warnings {open ? "▾" : "▸"}
      </button>
      {open && (
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
      )}
    </div>
  );
}
