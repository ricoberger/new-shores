import type { DisplayState } from "../api/client";
import { insolvencyBanner } from "../display/insolvency";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState | null;
  /** Opens the warnings tray (the per-building unpaid sentences). */
  onOpenWarnings: () => void;
  /** Phone layouts: at most two lines (the full text is in the warnings tray). */
  compact?: boolean;
}

/** One HUD banner that explains the insolvency state (server numbers only). */
export function InsolvencyBanner({ model, onOpenWarnings, compact = false }: Props) {
  const text = insolvencyBanner(model);
  if (!text) return null;
  return (
    <button type="button" className={`${styles.panel} ${styles.insolvencyBanner} ${compact ? styles.bannerCompact : ""}`} onClick={onOpenWarnings} data-testid="insolvency-banner">
      <span className={compact ? styles.clamp2 : undefined}>⚠ {text}</span>
    </button>
  );
}
