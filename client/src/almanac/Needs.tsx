import { needGroupName } from "../display/needs";
import { t } from "../i18n";
import { needIcon } from "../theme/iconSet";
import { Icon } from "../ui/Icon";
import styles from "./almanac.module.css";
import { needsByTier, num, ppmPercent, type Index, type NeedView } from "./model";
import { BuildingLink, GoodLink } from "./parts";
import { useScrollTo } from "./useScrollTo";

function Need({ idx, n }: { idx: Index; n: NeedView }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption style={{ textAlign: "left" }}>
          <h5 style={{ margin: "8px 0 2px", fontSize: "1rem" }}>
            <Icon path={needIcon({ category: n.category }, n.icon)} />{" "}
            {n.group ? t("needs.groupedLabel", { group: needGroupName(n.group), name: n.categoryName }) : n.categoryName}{" "}
            <span className={styles.small}>
              — {t("almanac.n.share", { percent: num(n.ownPercent, 0) })}
              {n.kind === "optional" ? t("almanac.n.optional") : ""}
              {n.chain ? `, ${t("almanac.n.chainRank", { rank: n.minRank ?? 1 })}` : ""}
            </span>
          </h5>
        </caption>
        <thead>
          <tr>
            <th scope="col">{n.services ? t("almanac.o.building") : t("away.good")}</th>
            <th scope="col" className={styles.num}>
              {t("almanac.n.covers")}
            </th>
            <th scope="col" className={styles.num}>
              {n.services ? t("infoPanel.radius") : t("almanac.n.perResident")}
            </th>
            <th scope="col">{n.services ? t("almanac.b.levels") : t("almanac.goods.madeByTitle")}</th>
          </tr>
        </thead>
        <tbody>
          {n.alternatives.map((a) => (
            <tr key={a.id}>
              <td>{a.kind === "good" ? <GoodLink idx={idx} id={a.id} /> : <BuildingLink idx={idx} id={a.id} />}</td>
              <td className={styles.num}>{ppmPercent(a.share * 1_000_000)}</td>
              <td className={styles.num}>{a.kind === "good" ? num(a.perResident ?? 0, 4) : a.radius === undefined ? "—" : t("infoPanel.tiles", { count: a.radius })}</td>
              <td>
                {a.kind === "good"
                  ? a.providers.map((b, i) => (
                      <span key={b}>
                        {i > 0 && ", "}
                        <BuildingLink idx={idx} id={b} />
                      </span>
                    ))
                  : (a.radii ?? []).join(" / ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Needs per tier: categories, their alternatives with shares, who provides them. */
export function Needs({ idx, id }: { idx: Index; id?: string }) {
  useScrollTo(id, "needs-page-");
  return (
    <>
      <h2>{t("almanac.section.needs")}</h2>
      <p className={styles.lead}>
        {t("almanac.n.lead")}
      </p>
      {needsByTier(idx).map((tier) => (
        <section key={tier.tier} id={`needs-page-${tier.tier}`} className={styles.card} style={{ marginBottom: 12 }} aria-labelledby={`needs-page-h-${tier.tier}`}>
          <h3 id={`needs-page-h-${tier.tier}`} style={{ marginTop: 0 }}>
            {tier.name}
          </h3>
          {tier.own.length === 0 && <p className={styles.small}>{t("almanac.o.noNeeds")}</p>}
          {tier.own.map((n) => (
            <Need key={n.id} idx={idx} n={n} />
          ))}
          {tier.carried.length > 0 && (
            <p className={styles.small}>{t("almanac.n.carries", { tiers: tier.carried.map((c) => idx.tierName(c)).join(", ") })}</p>
          )}
        </section>
      ))}
    </>
  );
}
