import type { DisplayState } from "../api/client";
import { insolvencyBanner } from "../display/insolvency";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState | null;
  /** Opens the warnings tray (the per-building unpaid sentences). */
  onOpenWarnings: () => void;
}

/** One HUD banner that explains the insolvency state (server numbers only). */
export function InsolvencyBanner({ model, onOpenWarnings }: Props) {
  const text = insolvencyBanner(model);
  if (!text) return null;
  return (
    <button type="button" className={`${styles.panel} ${styles.insolvencyBanner}`} onClick={onOpenWarnings} data-testid="insolvency-banner">
      ⚠ {text}
    </button>
  );
}
