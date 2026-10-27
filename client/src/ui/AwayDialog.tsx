import type { Content } from "../api/client";
import { type AwaySummary, summaryView } from "../display/summary";
import { goodIcon } from "../theme/iconSet";
import { DialogPanel } from "./DialogPanel";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

interface Props {
  summary: AwaySummary;
  content: Content;
  islandName: (id: string) => string;
  /** A ship's name by ID (D-055). */
  shipName?: (id: number) => string;
  /** Time zone of the times (tests); the player's when undefined. */
  timeZone?: string;
  /** Closes the dialog and acknowledges the summary. */
  onDismiss: () => void;
}

/** "While you were away" (UI.md §2): what happened since the last command, as a letter from the advisor (ART_DIRECTION §6). */
export function AwayDialog({ summary, content, islandName, shipName, timeZone, onDismiss }: Props) {
  const v = summaryView(summary, content, islandName, shipName, timeZone);
  return (
    <div className={styles.backdrop}>
      <DialogPanel className={`${styles.panel} ${styles.dialog} ${styles.awayDialog} ${styles.letter}`} labelledBy="away-dialog-title" testId="away-dialog">
        <div className={styles.letterFrom}>A letter from your advisor</div>
        <h2 className={styles.title} id="away-dialog-title">
          While you were away
        </h2>
        <div className={styles.small}>
          <span data-testid="away-from">{v.from}</span> – <span data-testid="away-to">{v.to}</span> ({v.duration})
        </div>
        {/* Gold and the population of each tier as a list: was → is (the ships list's style). */}
        <div className={styles.section} data-testid="away-overview">
          <div className={styles.sectionTitle}>Overview</div>
          <div className={styles.small} data-testid="away-gold">
            Gold: {v.gold.before} → {v.gold.after} (<span data-testid="away-gold-change">{v.gold.change}</span>)
          </div>
          {v.population.map((p) => (
            <div key={p.tier} className={styles.small} data-testid={`away-population-${p.tier}`}>
              {p.name}: {p.before} → {p.after}
            </div>
          ))}
        </div>
        {v.islands.map((is) => (
          <div key={is.id} className={styles.section}>
            <div className={styles.sectionTitle} data-testid={`away-island-${is.id}`}>
              {is.name}
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Good</th>
                  <th>Produced</th>
                  <th>Consumed</th>
                  <th>Lost</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {is.goods.map((g) => (
                  <tr key={g.good} data-testid={`away-good-${is.id}-${g.good}`}>
                    <td>
                      <span className={styles.withIcon}>
                        <Icon path={goodIcon(g.good)} />
                        {g.name}
                      </span>
                    </td>
                    <td>{g.produced}</td>
                    <td>{g.consumed}</td>
                    <td className={g.lost !== "0" ? styles.warn : undefined}>{g.lost}</td>
                    <td>{g.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {(v.paused > 0 || v.resumed > 0 || v.stillPaused.length > 0) && (
          <div className={styles.section} data-testid="away-paused">
            Paused for unpaid upkeep: {v.paused}, resumed: {v.resumed}
            {v.stillPaused.length > 0 && <div className={styles.warn}>Still paused: {v.stillPaused.join(", ")}</div>}
          </div>
        )}
        {v.shipsArrived > 0 && (
          <div className={styles.section} data-testid="away-ships">
            <div className={styles.sectionTitle}>Ships arrived ({v.shipsArrived})</div>
            <div className={styles.arrivals}>
              {v.arrivals.map((a, i) => (
                <div key={i} className={styles.small}>
                  {a}
                </div>
              ))}
            </div>
          </div>
        )}
        {v.quests.length > 0 && <div className={styles.section}>Quests completed: {v.quests.join(", ")}</div>}
        <div className={`${styles.buttons} ${styles.letterEnd}`} data-testid="away-end">
          <span className={styles.letterSign}>Your humble advisor</span>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onDismiss} data-testid="away-dismiss">
            Continue
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}
