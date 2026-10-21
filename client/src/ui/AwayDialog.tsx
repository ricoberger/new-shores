import type { Content } from "../api/client";
import { type AwaySummary, summaryView } from "../display/summary";
import styles from "./hud.module.css";

interface Props {
  summary: AwaySummary;
  content: Content;
  islandName: (id: string) => string;
  /** Closes the dialog and acknowledges the summary. */
  onDismiss: () => void;
}

/** "While you were away" (UI.md §2): what happened since the last command. */
export function AwayDialog({ summary, content, islandName, onDismiss }: Props) {
  const v = summaryView(summary, content, islandName);
  return (
    <div className={styles.backdrop}>
      <div className={`${styles.panel} ${styles.dialog} ${styles.awayDialog}`} role="dialog" aria-modal="true" aria-labelledby="away-dialog-title" data-testid="away-dialog">
        <h2 className={styles.title} id="away-dialog-title">
          While you were away
        </h2>
        <div className={styles.small}>
          <span data-testid="away-from">{v.from}</span> – <span data-testid="away-to">{v.to}</span> ({v.duration})
        </div>
        <div className={styles.section}>
          Gold: {v.gold.before} → {v.gold.after} (<span data-testid="away-gold-change">{v.gold.change}</span>)
        </div>
        {v.population.length > 0 && (
          <div className={styles.section}>
            {v.population.map((p) => (
              <div key={p.tier} data-testid={`away-population-${p.tier}`}>
                {p.name}: {p.text}
              </div>
            ))}
          </div>
        )}
        {v.islands.map((is) => (
          <div key={is.id} className={styles.section}>
            <div className={styles.sectionTitle}>{is.name}</div>
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
                    <td>{g.name}</td>
                    <td>{g.produced}</td>
                    <td>{g.consumed}</td>
                    <td className={g.lost !== "0" ? styles.warn : undefined}>{g.lost}</td>
                    <td>
                      {g.stock}
                      {g.atCapacity && <span className={styles.badge}>at capacity</span>}
                    </td>
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
            Ships arrived: {v.shipsArrived}
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
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={onDismiss} data-testid="away-dismiss">
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
