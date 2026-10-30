import { t } from "../i18n";
import { depositName, fertilityName } from "../display/tiers";
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
  /** Only these kinds (the island card lists them in separate rows); all by default. */
  only?: ResourceKind[];
  /** One badge per line (the island card) instead of a wrapping row. */
  stacked?: boolean;
}

type ResourceKind = "fertilities" | "deposits" | "coast";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * An island's resources as badges (D-051 part 7): fertilities, deposits
 * with their tile counts and the free coast tiles. Every badge carries
 * its icon and text (the short form keeps the text for screen readers and
 * the tooltip; the island card shows it in full).
 */
export function ResourceBadges({ resources, prefix, short = false, only, stacked = false }: Props) {
  const show = (k: ResourceKind) => !only || only.includes(k);
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
    <span className={`${styles.resourceBadges} ${stacked ? styles.resourceStacked : ""}`} data-testid={only ? undefined : `${prefix}-resources`}>
      {show("fertilities") && resources.fertilities.map((f) => badge(`f-${f}`, `${prefix}-fertility-${f}`, resourceIcon("fertility", f), t("resource.fertility", { name: cap(fertilityName(f)) })))}
      {show("deposits") &&
        resources.deposits.map((d) =>
        badge(`d-${d.kind}`, `${prefix}-deposit-${d.kind}`, resourceIcon("deposit", d.kind), t("resource.deposit", { name: cap(depositName(d.kind)), count: d.tiles }), String(d.tiles)),
      )}
      {show("coast") && badge("coast", `${prefix}-coast`, resourceIcon("coast"), t("resource.coast", { free: resources.coast.free, count: resources.coast.tiles }), String(resources.coast.free))}
      {!only && resources.fertilities.length === 0 && resources.deposits.length === 0 && !short && (
        <span className={styles.small}>{t("resource.none")}</span>
      )}
      {only?.includes("fertilities") && resources.fertilities.length === 0 && t("resource.noneShort")}
      {only?.includes("deposits") && resources.deposits.length === 0 && t("resource.noneShort")}
    </span>
  );
}
