import type { RouteDisplay } from "../api/client";
import { t } from "../i18n";
import { countdown } from "../display/ships";
import styles from "./hud.module.css";

interface Props {
  route: RouteDisplay;
  islandName: (id: string) => string;
}

/** A route in a list: its name, then "Island 1 → Island 2 (15:00 min)", then its ship count. */
export function RouteSummary({ route: r, islandName }: Props) {
  // m:ss reads as minutes; from an hour the h:mm:ss countdown stands alone.
  const loop = countdown(r.loop_ms);
  const loopText = r.loop_ms < 3_600_000 ? t("routes.minutes", { time: loop }) : loop;
  return (
    <>
      <strong className={styles.block}>{r.name}</strong>
      <span className={`${styles.block} ${styles.small}`} data-testid={`route-stops-${r.id}`}>
        {r.stops.map((s) => islandName(s.island_id)).join(" → ")} ({loopText})
      </span>
      <span className={`${styles.block} ${styles.small}`} data-testid={`route-ship-count-${r.id}`}>
        {t("routes.shipCount", { count: r.ship_ids.length })}
      </span>
    </>
  );
}
