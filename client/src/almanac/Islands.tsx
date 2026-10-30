import { depositName, fertilityName } from "../display/tiers";
import { t } from "../i18n";
import styles from "./almanac.module.css";
import { islandsView, titleCase, type Index } from "./model";
import { useScrollTo } from "./useScrollTo";

const range = (r: { min: number; max: number } | undefined) => (r ? (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`) : "—");

/** Island size classes, fertility and deposit pools and the home island guarantees, as far as the content serves them. */
export function Islands({ idx, id }: { idx: Index; id?: string }) {
  useScrollTo(id, "class-");
  const v = islandsView(idx.content);
  const has = (k: "size" | "count" | "fertilities" | "deposits" | "shape") => v.sizeClasses.some((s) => s[k] !== undefined);
  return (
    <>
      <h2>{t("almanac.section.islands")}</h2>
      <p className={styles.lead}>{t("almanac.i.lead")}</p>
      {v.sizeClasses.length === 0 && <p className={styles.small}>{t("almanac.i.none")}</p>}
      {v.sizeClasses.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("almanac.i.class")}</th>
                {has("size") && <th scope="col" className={styles.num}>{t("almanac.i.size")}</th>}
                {has("count") && <th scope="col" className={styles.num}>{t("almanac.i.perArchipelago")}</th>}
                {has("fertilities") && <th scope="col" className={styles.num}>{t("almanac.i.fertilities")}</th>}
                {has("deposits") && <th scope="col" className={styles.num}>{t("almanac.i.depositSlots")}</th>}
                {has("shape") && <th scope="col">{t("almanac.i.shape")}</th>}
                <th scope="col">{t("almanac.i.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {v.sizeClasses.map((s) => (
                <tr key={s.id} id={`class-${s.id}`}>
                  <th scope="row" style={{ color: "inherit" }}>{s.name}</th>
                  {has("size") && <td className={styles.num}>{s.size ?? "—"}</td>}
                  {has("count") && <td className={styles.num}>{range(s.count)}</td>}
                  {has("fertilities") && <td className={styles.num}>{range(s.fertilities)}</td>}
                  {has("deposits") && <td className={styles.num}>{range(s.deposits)}</td>}
                  {has("shape") && <td>{s.shape ?? "—"}</td>}
                  <td>
                    {s.rock ? t("almanac.i.rock") : s.scenic ? t("almanac.i.scenic") : ""}
                    {s.home ? t("almanac.i.home") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.fertilities.length > 0 && (
        <>
          <h3>{t("almanac.i.fertilities")}</h3>
          <p className={styles.lead}>{t("almanac.i.fertilitiesLead")}</p>
          <ul className={styles.tags}>
            {v.fertilities.map((f) => (
              <li key={f.id}>
                {titleCase(fertilityName(f.id))} {f.count ? `(${range(f.count)})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {v.deposits.length > 0 && (
        <>
          <h3>{t("almanac.home.deposits")}</h3>
          <p className={styles.lead}>{t("almanac.i.depositsLead")}</p>
          <ul className={styles.tags}>
            {v.deposits.map((f) => (
              <li key={f.id}>
                {titleCase(depositName(f.id))} {f.count ? `(${range(f.count)})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {v.home.length > 0 && (
        <>
          <h3>{t("almanac.i.homeIsland")}</h3>
          <dl className={styles.defs}>
            {v.home.map((h) => (
              <div key={h.label} className={styles.row}>
                <dt>{h.label}</dt>
                <dd>{h.items.map(titleCase).join(", ")}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {v.basicOnly && <p className={styles.small}>{t("almanac.i.basicOnly")}</p>}
    </>
  );
}
