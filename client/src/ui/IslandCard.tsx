import type { Content, DisplayState, Island } from "../api/client";
import { units } from "../display/format";
import { islandResources } from "../display/hud";
import { CloseButton } from "./CloseButton";
import styles from "./hud.module.css";
import { toolIcon } from "../theme/iconSet";
import { Icon } from "./Icon";
import { ResourceBadges } from "./ResourceBadges";

interface Props {
  islandId: string;
  model: DisplayState;
  content: Content;
  /** Static island data (fertilities, deposits); undefined while loading. */
  statics: Island | undefined;
  onClose: () => void;
}

/**
 * Island card (UI.md §1/§6): an overview of what the island is: its
 * population per tier and its resources (fertilities, deposits, coast),
 * from display numbers and static data. No actions.
 */
export function IslandCard({ islandId, model, content, statics, onClose }: Props) {
  const is = model.islands.find((i) => i.id === islandId);
  if (!is) return null;
  const defs = new Map(content.buildings.map((b) => [b.id, b]));
  const resources = statics && statics.id === is.id ? islandResources(statics, is, defs) : null;
  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="island-card">
      <div className={styles.row}>
        <h2 className={styles.title} data-testid="island-card-name">
          {is.name || is.id}
        </h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="island-card-close" />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Population</div>
          <table className={styles.table}>
            <tbody>
              {content.tiers.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className={styles.withIcon}>
                      <Icon path={toolIcon("population")} />
                      {t.name}
                    </span>
                  </td>
                  <td data-testid={`island-card-population-${t.id}`}>{units(is.population[t.id] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${styles.section} ${styles.divided}`}>
          <div className={styles.sectionTitle}>Resources</div>
          <div className={styles.small} data-testid="island-card-resources-row">
            {resources ? <ResourceBadges resources={resources} prefix="island-card" stacked /> : "…"}
          </div>
        </div>
      </div>
    </div>
  );
}
