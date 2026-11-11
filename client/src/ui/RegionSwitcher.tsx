import { t } from "../i18n";
import type { Content, DisplayState } from "../api/client";
import { regionName, showRegionSwitcher } from "../display/regions";
import styles from "./hud.module.css";

interface Props {
  model: Pick<DisplayState, "regions">;
  content: Content | null;
  /** The region shown on the map. */
  current: string;
  /** Warnings per region (the tab badge). */
  warnings: ReadonlyMap<string, number>;
  onSelect: (id: string) => void;
}

/**
 * The region tabs (D-076 §5–6): one per unlocked region, the current one
 * pressed, each with its warning count. Hidden while the world has one
 * unlocked region, so a single-region game looks as before.
 */
export function RegionSwitcher({ model, content, current, warnings, onSelect }: Props) {
  if (!showRegionSwitcher(model)) return null;
  return (
    <nav className={styles.regionTabs} aria-label={t("regions.label")} data-testid="region-switcher">
      {model.regions
        .filter((r) => r.unlocked)
        .map((r) => {
          const name = regionName(content, r.id);
          const n = warnings.get(r.id) ?? 0;
          return (
            <button
              key={r.id}
              type="button"
              className={`${styles.regionTab} ${r.id === current ? styles.regionTabActive : ""}`}
              aria-pressed={r.id === current}
              aria-label={n > 0 ? t("regions.tabWarnings", { region: name, count: n }) : name}
              onClick={() => onSelect(r.id)}
              data-testid={`region-tab-${r.id}`}
            >
              {name}
              {n > 0 && <span className={styles.dockCount}>{n}</span>}
            </button>
          );
        })}
    </nav>
  );
}
