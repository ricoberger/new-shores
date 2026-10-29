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
            <Icon path={needIcon({ category: n.category }, n.icon)} /> {n.categoryName}{" "}
            <span className={styles.small}>
              — {num(n.ownPercent, 0)} % of the tier&apos;s needs{n.kind === "optional" ? ", optional" : ""}
            </span>
          </h5>
        </caption>
        <thead>
          <tr>
            <th scope="col">{n.services ? "Building" : "Good"}</th>
            <th scope="col" className={styles.num}>
              Covers
            </th>
            <th scope="col" className={styles.num}>
              {n.services ? "Radius" : "Per resident/min"}
            </th>
            <th scope="col">{n.services ? "Levels" : "Made by"}</th>
          </tr>
        </thead>
        <tbody>
          {n.alternatives.map((a) => (
            <tr key={a.id}>
              <td>{a.kind === "good" ? <GoodLink idx={idx} id={a.id} /> : <BuildingLink idx={idx} id={a.id} />}</td>
              <td className={styles.num}>{ppmPercent(a.share * 1_000_000)}</td>
              <td className={styles.num}>{a.kind === "good" ? num(a.perResident ?? 0, 4) : a.radius === undefined ? "—" : `${a.radius} tiles`}</td>
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
      <h2>Needs</h2>
      <p className={styles.lead}>
        A category is covered by the sum of the shares of its supplied alternatives, at most 100 %. Services cover a house when the building stands within its radius and is connected. Rates are per resident and minute.
      </p>
      {needsByTier(idx).map((t) => (
        <section key={t.tier} id={`needs-page-${t.tier}`} className={styles.card} style={{ marginBottom: 12 }} aria-labelledby={`needs-page-h-${t.tier}`}>
          <h3 id={`needs-page-h-${t.tier}`} style={{ marginTop: 0 }}>
            {t.name}
          </h3>
          {t.own.length === 0 && <p className={styles.small}>No needs.</p>}
          {t.own.map((n) => (
            <Need key={n.id} idx={idx} n={n} />
          ))}
          {t.carried.length > 0 && (
            <p className={styles.small}>Also carries the goods categories of {t.carried.map((c) => idx.tierName(c)).join(", ")} at reduced rates.</p>
          )}
        </section>
      ))}
    </>
  );
}
