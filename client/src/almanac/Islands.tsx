import styles from "./almanac.module.css";
import { islandsView, titleCase, type Index } from "./model";
import { useScrollTo } from "./useScrollTo";

const range = (r: { min: number; max: number } | undefined) => (r ? (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`) : "—");

/** Island size classes, fertility and deposit pools and the home island guarantees, as far as the content serves them. */
export function Islands({ idx, id }: { idx: Index; id?: string }) {
  useScrollTo(id, "class-");
  const v = islandsView(idx.content);
  const has = (k: "size" | "count" | "fertilities" | "deposits") => v.sizeClasses.some((s) => s[k] !== undefined);
  return (
    <>
      <h2>Islands</h2>
      <p className={styles.lead}>Every archipelago is generated; its islands come in these size classes. Every island can be settled from the start; skerries are scenery.</p>
      {v.sizeClasses.length === 0 && <p className={styles.small}>No island classes in the content.</p>}
      {v.sizeClasses.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Class</th>
                {has("size") && <th scope="col" className={styles.num}>Size (tiles)</th>}
                {has("count") && <th scope="col" className={styles.num}>Per archipelago</th>}
                {has("fertilities") && <th scope="col" className={styles.num}>Fertilities</th>}
                {has("deposits") && <th scope="col" className={styles.num}>Deposit slots</th>}
                <th scope="col">Notes</th>
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
                  <td>{s.rock ? "Mines and the Trading Post only; no houses or fields" : s.scenic ? "Scenery only (skerries); cannot be settled or sailed to" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.fertilities.length > 0 && (
        <>
          <h3>Fertilities</h3>
          <p className={styles.lead}>Islands that carry a fertility can grow the crops that need it. Islands per archipelago:</p>
          <ul className={styles.tags}>
            {v.fertilities.map((f) => (
              <li key={f.id}>
                {titleCase(f.id)} {f.count ? `(${range(f.count)})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {v.deposits.length > 0 && (
        <>
          <h3>Deposits</h3>
          <p className={styles.lead}>Mines and quarries need a deposit under them. Slots per archipelago:</p>
          <ul className={styles.tags}>
            {v.deposits.map((f) => (
              <li key={f.id}>
                {titleCase(f.id)} {f.count ? `(${range(f.count)})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {v.home.length > 0 && (
        <>
          <h3>The home island</h3>
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
      {v.basicOnly && <p className={styles.small}>Counts, pools and the home island&apos;s guarantees are not part of the served content.</p>}
    </>
  );
}
