import type { Content, DisplayState, Island } from "../api/client";
import { founderFor, islandSummary, shipsAt } from "../display/archipelago";
import { units } from "../display/format";
import { islandResources } from "../display/hud";
import { CloseButton } from "./CloseButton";
import styles from "./hud.module.css";
import { ResourceBadges } from "./ResourceBadges";

interface Props {
  islandId: string;
  model: DisplayState;
  content: Content;
  /** Static island data (fertilities, deposits); undefined while loading. */
  statics: Island | undefined;
  nowMs: number;
  /** "Go to island": the camera jumps to it. */
  onGoTo: () => void;
  /** "Found settlement here" with the given ship (it sails there first unless it is idle here). */
  onFound: (shipId: number) => void;
  /** The founding chained to this island (D-051): what it waits for; null when none. */
  pendingFounding?: string | null;
  onCancelFounding?: () => void;
  onNewRoute: () => void;
  onSelectShip: (shipId: number) => void;
  onClose: () => void;
}

/**
 * Island card (UI.md §1/§6): a summary of the island from display numbers
 * and static data, and its actions.
 */
export function IslandCard({
  islandId,
  model,
  content,
  statics,
  nowMs,
  onGoTo,
  onFound,
  pendingFounding = null,
  onCancelFounding,
  onNewRoute,
  onSelectShip,
  onClose,
}: Props) {
  const is = model.islands.find((i) => i.id === islandId);
  if (!is) return null;
  const sum = islandSummary(is);
  const ships = shipsAt(model.ships, is.id, nowMs);
  const shipType = (type: string) => content.ships.find((t) => t.id === type)?.name ?? type;
  // An idle ship whose cargo covers the Trading Post (a content lookup).
  const founder = founderFor(model, content, is.id);
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
        <div className={styles.small} data-testid="island-card-settled">
          {is.settled ? "Settled" : "Unsettled"}
        </div>
        <table className={`${styles.table} ${styles.section}`}>
          <tbody>
            <tr>
              <td>Population</td>
              <td data-testid="island-card-population">{units(sum.population)}</td>
            </tr>
            <tr>
              <td>Trading Post fill</td>
              <td data-testid="island-card-fill">{sum.fillPercent === null ? "—" : `${sum.fillPercent} %`}</td>
            </tr>
            <tr>
              <td>Warnings</td>
              <td data-testid="island-card-warnings">{sum.warnings}</td>
            </tr>
          </tbody>
        </table>
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Fertilities</div>
          <div className={styles.small} data-testid="island-card-fertilities">
            {resources ? <ResourceBadges resources={resources} prefix="island-card" only={["fertilities"]} /> : "…"}
          </div>
          <div className={styles.sectionTitle}>Deposits</div>
          <div className={styles.small} data-testid="island-card-deposits">
            {resources ? <ResourceBadges resources={resources} prefix="island-card" only={["deposits"]} /> : "…"}
          </div>
          <div className={styles.sectionTitle}>Coast</div>
          <div className={styles.small} data-testid="island-card-coast">
            {resources ? <ResourceBadges resources={resources} prefix="island-card" only={["coast"]} /> : "…"}
          </div>
        </div>
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Ships here</div>
          {ships.length === 0 && <div className={styles.small}>none</div>}
          <div className={styles.row}>
            {ships.map((s) => (
              <button key={s.id} type="button" className={styles.link} onClick={() => onSelectShip(s.id)} data-testid={`island-card-ship-${s.id}`}>
                {shipType(s.type)} #{s.id}
                {s.state === "anchored_unpaid" ? " (unpaid)" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className={`${styles.row} ${styles.section}`}>
          <button type="button" className={styles.button} onClick={onGoTo} data-testid="island-card-enter">
            Go to island
          </button>
          {is.settled && (
            <button type="button" className={styles.button} onClick={onNewRoute} data-testid="island-card-new-route">
              New route from here
            </button>
          )}
          {founder && !pendingFounding && (
            <button type="button" className={styles.button} onClick={() => onFound(founder.id)} data-testid="island-card-found">
              Found settlement here
            </button>
          )}
        </div>
        {founder && !pendingFounding && (
          <div className={styles.small} data-testid="island-card-found-note">
            {founder.island_id === is.id
              ? `Ship #${founder.id} is here: place the Trading Post with its pier on the water.`
              : `Ship #${founder.id} sails here with the Trading Post's materials and founds it where you place it.`}
          </div>
        )}
        {pendingFounding && (
          <div className={styles.small} data-testid="island-card-pending">
            {pendingFounding}{" "}
            {onCancelFounding && (
              <button type="button" className={styles.link} onClick={onCancelFounding} data-testid="island-card-pending-cancel">
                cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
