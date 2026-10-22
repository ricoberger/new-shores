import { type ReactNode, useEffect, useState } from "react";
import type { Content, DisplayState } from "../api/client";
import { perMin, units } from "../display/format";
import { claimableCount } from "../display/quests";
import { populationTotals } from "../display/tiers";
import { toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

interface Props {
  model: DisplayState | null;
  content: Content | null;
  /** The focused island (under the camera; its tab is selected). */
  islandId: string;
  /** An island tab: the camera jumps there. */
  onSelectIsland: (id: string) => void;
  /** Opens or closes the Ships / Routes panels. */
  onShips: () => void;
  onRoutes: () => void;
  /** Opens or closes the quests panel. */
  onQuests: () => void;
  /** The account menu. */
  account?: ReactNode;
  /**
   * Touch layouts (phones, tablets): population collapses into one
   * tap-to-expand chip; the navigation scrolls horizontally between the
   * pinned stats and quests/account (a second row on portrait phones).
   */
  compact?: "portrait" | "landscape" | null;
}

export function TopBar({
  model,
  content,
  islandId,
  onSelectIsland,
  onShips,
  onRoutes,
  onQuests,
  account,
  compact = null,
}: Props) {
  const [populationOpen, setPopulationOpen] = useState(false);
  const ready = model !== null;
  useEffect(() => {
    if (ready && performance.getEntriesByName("ns-hud-gold").length === 0) {
      performance.mark("ns-hud-gold");
    }
  }, [ready]);

  const balance = model?.balance_rate_per_min ?? 0;
  const population = populationTotals(model);
  const claimable = claimableCount(model);
  const tiers = content?.tiers ?? [];
  const totalPopulation = [...population.values()].reduce((a, b) => a + b, 0);

  const gold = (
    <div className={styles.stat}>
      <span className={styles.label}>Gold</span>
      <span className={styles.value} data-testid="hud-gold">
        {model ? units(model.gold) : "…"}
      </span>
    </div>
  );
  const balanceStat = (
    <div className={styles.stat}>
      <span className={styles.srOnly}>Balance per minute (taxes − upkeep)</span>
      <span className={balance < 0 ? styles.negative : styles.positive} aria-hidden="true">
        {balance < 0 ? "▼" : "▲"}
      </span>
      <span className={`${styles.value} ${balance < 0 ? styles.negative : styles.positive}`} data-testid="hud-balance">
        {perMin(balance, true)}/min
      </span>
    </div>
  );
  const tierStat = (t: { id: string; name: string }) => (
    <div className={styles.stat} key={t.id}>
      <span className={`${styles.label} ${styles.withIcon}`}>
        <Icon path={toolIcon("population")} />
        {t.name}
        <span className={styles.srOnly}> residents</span>
      </span>
      <span className={styles.value} data-testid={`hud-population-${t.id}`}>
        {units(population.get(t.id) ?? 0)}
      </span>
    </div>
  );
  const nav = (
    <>
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
        <Icon path={toolIcon("ships")} /> Ships <span data-testid="hud-ship-count">{model?.ships.length ?? 0}</span>
      </button>
      <button type="button" className={styles.hudButton} onClick={onRoutes} data-testid="hud-routes">
        <Icon path={toolIcon("routes")} /> Routes {model?.routes.length ?? 0}
      </button>
    </>
  );
  const quests = (
    <button
      type="button"
      className={styles.hudButton}
      onClick={onQuests}
      aria-label={claimable > 0 ? `Quests, ${claimable} rewards to claim` : "Quests"}
      data-testid="hud-quests"
    >
      <Icon path={toolIcon("quests")} />
      {compact ? "" : " Quests"}
      {claimable > 0 && (
        <span className={styles.badge} data-testid="hud-quests-badge">
          {claimable}
        </span>
      )}
    </button>
  );

  if (compact) {
    return (
      <div className={`${styles.topBar} ${styles.compactTop} ${compact === "portrait" ? styles.compactPortrait : ""}`}>
        <div className={styles.compactStats}>
          {gold}
          {balanceStat}
          <div className={styles.populationChipWrap}>
            <button
              type="button"
              className={styles.hudButton}
              aria-expanded={populationOpen}
              aria-label={`Population ${units(totalPopulation)} residents, per tier`}
              onClick={() => setPopulationOpen((o) => !o)}
              data-testid="hud-population-chip"
            >
              <Icon path={toolIcon("population")} /> {units(totalPopulation)}
            </button>
            {populationOpen && (
              <div className={`${styles.panel} ${styles.populationPopover}`} data-testid="hud-population-list">
                {tiers.map(tierStat)}
              </div>
            )}
          </div>
        </div>
        <div className={styles.compactNav}>{nav}</div>
        <div className={styles.compactEnd}>
          {quests}
          {account}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.topBar}>
      {gold}
      {balanceStat}
      {tiers.map(tierStat)}
      {nav}
      <div className={styles.spacer} />
      {quests}
      <span className={styles.version} data-testid="hud-content-version">
        {content?.region.version ?? ""}
      </span>
      {account}
    </div>
  );
}
