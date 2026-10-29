import styles from "./almanac.module.css";
import { A, BuildingLink, Row } from "./parts";
import { needsByTier, num, ppmPercent, tierViews, type Index } from "./model";
import { useScrollTo } from "./useScrollTo";

/** Tiers, the services ladder and the need categories per tier, all from content. */
export function Overview({ idx, id }: { idx: Index; id?: string }) {
  useScrollTo(id, "tier-");
  const tiers = tierViews(idx);
  const needs = needsByTier(idx);
  const ladder = needs.flatMap((t) =>
    t.servicesAdded.map((b) => ({ building: b, tier: t.name, radii: idx.building(b)?.service?.levels?.map((l) => l.radius) ?? [] })),
  );
  return (
    <>
      <h2>Overview</h2>
      <p className={styles.lead}>
        {idx.content.region?.name ? `${idx.content.region.name}: ` : ""}the tiers of your settlers, what unlocks them and what they ask for. Everything on these pages is read from the game&apos;s content.
      </p>

      <h3>Tiers</h3>
      <div className={styles.cards}>
        {tiers.map((t) => (
          <section key={t.id} id={`tier-${t.id}`} className={styles.card} aria-labelledby={`tier-h-${t.id}`}>
            <h4 id={`tier-h-${t.id}`}>
              {t.index + 1}. {t.name}
            </h4>
            <dl className={styles.defs}>
              <Row label="House">{t.house ? <BuildingLink idx={idx} id={t.house} /> : "Not built yet"}</Row>
              <Row label="Residents">
                {num(t.residentsFloor)}–{num(t.residentsMax)} per house
              </Row>
              <Row label="Tax">
                {num(t.tax)} gold per resident per minute ({num(t.taxFullHouse)} per full house)
              </Row>
              <Row label="Unlocked by">
                {t.unlock.population.length === 0 && t.unlock.buildings.length === 0 ? (
                  "Available from the start"
                ) : (
                  <>
                    {t.unlock.population.map((p, i) => (
                      <span key={p.tier}>
                        {i > 0 && ", "}
                        {num(p.amount)} {idx.tierName(p.tier)}
                      </span>
                    ))}
                    {t.unlock.population.length > 0 && t.unlock.buildings.length > 0 && ", "}
                    {t.unlock.buildings.map((b, i) => (
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

      <h3>The services ladder</h3>
      <p className={styles.lead}>Public buildings serve the houses within their radius; each tier adds more of them. Upgraded levels reach further.</p>
      {ladder.length === 0 ? (
        <p className={styles.small}>No services in the content.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Building</th>
                <th scope="col">Asked by</th>
                <th scope="col" className={styles.num}>
                  Radius per level
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

      <h3>What each tier asks for</h3>
      <p className={styles.lead}>
        A need is a category with one or more alternatives. A category is covered by the sum of the shares of the alternatives that are supplied, at most 100 %: one of two alternatives covers 60 %, both cover it fully. Satisfaction is the weighted mean of the categories.
      </p>
      {needs.map((t) => (
        <section key={t.tier} id={`needs-${t.tier}`} aria-labelledby={`needs-h-${t.tier}`}>
          <h4 id={`needs-h-${t.tier}`}>
            <A section="needs" id={t.tier}>
              {t.name}
            </A>
          </h4>
          {t.own.length === 0 ? (
            <p className={styles.small}>No needs.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col" className={styles.num}>
                      Weight
                    </th>
                    <th scope="col">Alternatives (share of the category)</th>
                  </tr>
                </thead>
                <tbody>
                  {t.own.map((n) => (
                    <tr key={n.id}>
                      <td>{n.categoryName}</td>
                      <td className={styles.num}>{num(n.ownPercent, 0)} %</td>
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
          {t.carried.length > 0 && (
            <p className={styles.small}>Also carries the categories of {t.carried.map((c) => idx.tierName(c)).join(", ")} at reduced rates.</p>
          )}
        </section>
      ))}
    </>
  );
}
