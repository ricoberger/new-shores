import styles from "./almanac.module.css";
import { percentSpace, t } from "../i18n";
import { A, BuildingLink, Row } from "./parts";
import { needsByTier, num, ppmPercent, tierViews, type Index } from "./model";
import { useScrollTo } from "./useScrollTo";

/** Tiers, the services ladder and the need categories per tier, all from content. */
export function Overview({ idx, id }: { idx: Index; id?: string }) {
  useScrollTo(id, "tier-");
  const tiers = tierViews(idx);
  const needs = needsByTier(idx);
  const ladder = needs.flatMap((tier) =>
    tier.servicesAdded.map((b) => ({ building: b, tier: tier.name, radii: idx.building(b)?.service?.levels?.map((l) => l.radius) ?? [] })),
  );
  return (
    <>
      <h2>{t("almanac.section.overview")}</h2>
      <p className={styles.lead}>
        {idx.content.region?.name ? `${idx.content.region.name}: ` : ""}
        {t("almanac.o.lead")}
      </p>

      <h3>{t("almanac.o.tiers")}</h3>
      <div className={styles.cards}>
        {tiers.map((tier) => (
          <section key={tier.id} id={`tier-${tier.id}`} className={styles.card} aria-labelledby={`tier-h-${tier.id}`}>
            <h4 id={`tier-h-${tier.id}`}>
              {tier.index + 1}. {tier.name}
            </h4>
            <dl className={styles.defs}>
              <Row label={t("almanac.o.house")}>{tier.house ? <BuildingLink idx={idx} id={tier.house} /> : t("almanac.o.notBuilt")}</Row>
              <Row label={t("infoPanel.residents")}>
                {t("almanac.o.perHouse", { min: num(tier.residentsFloor), max: num(tier.residentsMax) })}
              </Row>
              <Row label={t("almanac.o.tax")}>
                {t("almanac.o.taxValue", { tax: num(tier.tax), full: num(tier.taxFullHouse) })}
              </Row>
              <Row label={t("almanac.o.unlockedBy")}>
                {tier.unlock.population.length === 0 && tier.unlock.buildings.length === 0 ? (
                  t("almanac.o.fromStart")
                ) : (
                  <>
                    {tier.unlock.population.map((p, i) => (
                      <span key={p.tier}>
                        {i > 0 && ", "}
                        {num(p.amount)} {idx.tierName(p.tier)}
                      </span>
                    ))}
                    {tier.unlock.population.length > 0 && tier.unlock.buildings.length > 0 && ", "}
                    {tier.unlock.buildings.map((b, i) => (
                      <span key={b}>
                        {i > 0 && ", "}
                        <BuildingLink idx={idx} id={b} />
                      </span>
                    ))}
                  </>
                )}
              </Row>
            </dl>
          </section>
        ))}
      </div>

      <h3>{t("almanac.o.ladder")}</h3>
      <p className={styles.lead}>{t("almanac.o.ladderLead")}</p>
      {ladder.length === 0 ? (
        <p className={styles.small}>{t("almanac.o.noServices")}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("almanac.o.building")}</th>
                <th scope="col">{t("almanac.o.askedBy")}</th>
                <th scope="col" className={styles.num}>
                  {t("almanac.o.radiusPerLevel")}
                </th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((s) => (
                <tr key={s.building}>
                  <td>
                    <BuildingLink idx={idx} id={s.building} />
                  </td>
                  <td>{s.tier}</td>
                  <td className={styles.num}>{s.radii.join(" / ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>{t("almanac.o.asks")}</h3>
      <p className={styles.lead}>
        {t("almanac.o.asksLead")}
      </p>
      {needs.map((tier) => (
        <section key={tier.tier} id={`needs-${tier.tier}`} aria-labelledby={`needs-h-${tier.tier}`}>
          <h4 id={`needs-h-${tier.tier}`}>
            <A section="needs" id={tier.tier}>
              {tier.name}
            </A>
          </h4>
          {tier.own.length === 0 ? (
            <p className={styles.small}>{t("almanac.o.noNeeds")}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t("almanac.o.category")}</th>
                    <th scope="col" className={styles.num}>
                      {t("almanac.o.weight")}
                    </th>
                    <th scope="col">{t("almanac.o.alternatives")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tier.own.map((n) => (
                    <tr key={n.id}>
                      <td>{n.categoryName}</td>
                      <td className={styles.num}>{num(n.ownPercent, 0)}{percentSpace()}%</td>
                      <td>
                        {n.alternatives.map((a, i) => (
                          <span key={a.id}>
                            {i > 0 && " · "}
                            {a.kind === "good" ? idx.goodName(a.id) : idx.buildingName(a.id)} {ppmPercent(a.share * 1_000_000)}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tier.carried.length > 0 && (
            <p className={styles.small}>{t("almanac.o.carries", { tiers: tier.carried.map((c) => idx.tierName(c)).join(", ") })}</p>
          )}
        </section>
      ))}
    </>
  );
}
