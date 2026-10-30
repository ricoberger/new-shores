import { t } from "../i18n";
import styles from "./almanac.module.css";
import { num, shipView, type Index } from "./model";
import { BuildingLink, Cost, Row, Thumb } from "./parts";
import { useScrollTo } from "./useScrollTo";

/** Ship types: slots, capacity, speed, cost, length, build time, unlock tier. */
export function Ships({ idx, id }: { idx: Index; id?: string }) {
  useScrollTo(id, "ship-");
  const ships = (idx.content.ships ?? []).map((s) => shipView(idx, s));
  return (
    <>
      <h2>{t("almanac.section.ships")}</h2>
      <p className={styles.lead}>{t("almanac.s.lead")}</p>
      {ships.length === 0 && <p className={styles.small}>{t("almanac.s.none")}</p>}
      <div className={styles.cards}>
        {ships.map((s) => (
          <article key={s.id} id={`ship-${s.id}`} className={styles.card} aria-labelledby={`ship-h-${s.id}`}>
            <div className={styles.cardHead}>
              <Thumb id={s.id} name={s.name} />
              <div>
                <h3 id={`ship-h-${s.id}`}>{s.name}</h3>
                <span className={styles.small}>{idx.tierName(s.tier)}</span>
              </div>
            </div>
            <dl className={styles.defs}>
              <Row label={t("almanac.s.cargo")}>
                {t("almanac.s.cargoValue", { slots: s.slots, size: num(s.slotSize), total: num(s.totalCapacity) })}
              </Row>
              <Row label={t("almanac.s.speed")}>{t("almanac.s.speedValue", { factor: num(s.speed) })}</Row>
              <Row label={t("almanac.b.cost")}>
                <Cost idx={idx} parts={s.cost} />
              </Row>
              <Row label={t("infoPanel.upkeep")}>{t("almanac.b.goldPerMin", { amount: num(s.upkeep) })}</Row>
              <Row label={t("almanac.s.buildTime")}>{t("routes.minutes", { time: num(s.buildMinutes) })}</Row>
              {s.lengthTiles !== undefined && <Row label={t("almanac.s.length")}>{t("infoPanel.tiles", { count: num(s.lengthTiles) })}</Row>}
              <Row label={t("almanac.s.unlockedWith")}>{idx.tierName(s.tier)}</Row>
              {s.shipyards.length > 0 && (
                <Row label={t("almanac.s.builtAt")}>
                  {s.shipyards.map((b, i) => (
                    <span key={b}>
                      {i > 0 && ", "}
                      <BuildingLink idx={idx} id={b} />
                    </span>
                  ))}
                </Row>
              )}
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
