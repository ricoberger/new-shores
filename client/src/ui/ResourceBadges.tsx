import type { IslandResources } from "../display/hud";
import { resourceIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

interface Props {
  resources: IslandResources;
  /** Test-ID prefix ("hud", "island-card"). */
  prefix: string;
  /** Icons with counts only (the top bar); the full text otherwise (island card, phone popover). */
  short?: boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * An island's resources as badges (D-051 part 7): fertilities, deposits
 * with their tile counts and the free coast tiles. Every badge carries
 * its icon and text (the short form keeps the text for screen readers and
 * the tooltip; the island card shows it in full).
 */
export function ResourceBadges({ resources, prefix, short = false }: Props) {
  const badge = (key: string, testId: string, icon: string, text: string, count?: string) => (
    <span key={key} className={`${styles.resourceBadge} ${short ? styles.resourceShort : ""}`} title={text} data-testid={testId}>
      <Icon path={icon} />
      {short ? (
        <>
          <span className={styles.srOnly}>{text}</span>
          {count !== undefined && <span aria-hidden="true">{count}</span>}
        </>
      ) : (
        text
      )}
    </span>
  );
  return (
    <span className={styles.resourceBadges} data-testid={`${prefix}-resources`}>
      {resources.fertilities.map((f) => badge(`f-${f}`, `${prefix}-fertility-${f}`, resourceIcon("fertility", f), `${cap(f)} fertility`))}
      {resources.deposits.map((d) =>
        badge(`d-${d.kind}`, `${prefix}-deposit-${d.kind}`, resourceIcon("deposit", d.kind), `${cap(d.kind)} deposit (${d.tiles} ${d.tiles === 1 ? "tile" : "tiles"})`, String(d.tiles)),
      )}
      {badge("coast", `${prefix}-coast`, resourceIcon("coast"), `Free coast: ${resources.coast.free} of ${resources.coast.tiles} tiles`, String(resources.coast.free))}
      {resources.fertilities.length === 0 && resources.deposits.length === 0 && !short && (
        <span className={styles.small}>No fertility or deposit</span>
      )}
    </span>
  );
}
