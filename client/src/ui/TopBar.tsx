import { type ReactNode, useEffect } from "react";
import type { Content, DisplayState } from "../api/client";
import { perMin, units } from "../display/format";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState | null;
  content: Content | null;
  /** The island shown. */
  islandId: string;
  onSelectIsland: (id: string) => void;
  /** Opens or closes the Ships / Routes panels. */
  onShips: () => void;
  onRoutes: () => void;
  /** The account menu. */
  account?: ReactNode;
}

export function TopBar({ model, content, islandId, onSelectIsland, onShips, onRoutes, account }: Props) {
  const ready = model !== null;
  useEffect(() => {
    if (ready && performance.getEntriesByName("ns-hud-gold").length === 0) {
      performance.mark("ns-hud-gold");
    }
  }, [ready]);

  const balance = model?.balance_rate_per_min ?? 0;
  const population = new Map<string, number>();
  for (const is of model?.islands ?? []) {
    for (const [tier, n] of Object.entries(is.population)) {
      population.set(tier, (population.get(tier) ?? 0) + n);
    }
  }
  return (
    <div className={styles.topBar}>
      <div className={styles.stat} title="Gold">
        <span className={styles.label}>Gold</span>
        <span className={styles.value} data-testid="hud-gold">
          {model ? units(model.gold) : "…"}
        </span>
      </div>
      <div className={styles.stat} title="Balance per minute (taxes − upkeep)">
        <span className={balance < 0 ? styles.negative : styles.positive}>{balance < 0 ? "▼" : "▲"}</span>
        <span className={`${styles.value} ${balance < 0 ? styles.negative : styles.positive}`} data-testid="hud-balance">
          {perMin(balance, true)}/min
        </span>
      </div>
      {(content?.tiers ?? []).map((t) => (
        <div className={styles.stat} key={t.id} title={`${t.name} (residents)`}>
          <span className={styles.label}>⌂ {t.name}</span>
          <span className={styles.value} data-testid={`hud-population-${t.id}`}>
            {units(population.get(t.id) ?? 0)}
          </span>
        </div>
      ))}
      <div className={styles.islandTabs} role="tablist" aria-label="Islands">
        {(model?.islands ?? []).map((is) => (
          <button
            key={is.id}
            type="button"
            role="tab"
            aria-selected={is.id === islandId}
            className={`${styles.islandTab} ${is.id === islandId ? styles.tabActive : ""}`}
            onClick={() => onSelectIsland(is.id)}
            data-testid={`island-tab-${is.id}`}
          >
            {is.name || is.id}
            {!is.settled && <span className={styles.badge}>unsettled</span>}
          </button>
        ))}
      </div>
      <button type="button" className={styles.hudButton} onClick={onShips} data-testid="hud-ships">
        ⛵ Ships <span data-testid="hud-ship-count">{model?.ships.length ?? 0}</span>
      </button>
      <button type="button" className={styles.hudButton} onClick={onRoutes} data-testid="hud-routes">
        ⇄ Routes {model?.routes.length ?? 0}
      </button>
      <div className={styles.spacer} />
      <span className={styles.version} data-testid="hud-content-version">
        {content?.region.version ?? ""}
      </span>
      {account}
    </div>
  );
}
