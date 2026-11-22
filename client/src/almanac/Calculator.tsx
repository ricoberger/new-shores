import { tonsPerMinText } from "../display/format";
import { depositName } from "../display/tiers";
import { t } from "../i18n";
import styles from "./almanac.module.css";
import { calculate, clampResidents, parseQuery, writeQuery, MAX_RESIDENTS, type CalcInput, type CalcResult } from "./calc";
import { num, ppmPercent, titleCase, type Index } from "./model";
import { BuildingLink, GoodLink, Row } from "./parts";
import { replaceSearch, useSearch } from "./route";

/** A category with two or more alternatives of a tier that has residents: one checkbox group (a good's state is global, D-084 §1). */
interface Group {
  key: string;
  /** The tier the category belongs to (the lower tier for a carried one). */
  tier: string;
  category: string;
  goods: string[];
}

function groups(idx: Index, input: CalcInput): Group[] {
  const out: Group[] = [];
  for (const n of idx.content.needs ?? []) {
    if (clampResidents(input.residents[n.tier] ?? 0) <= 0 || (n.goods?.length ?? 0) < 2) continue;
    const goods = (n.goods ?? []).map((g) => g.good);
    const key = [...goods].sort().join("|");
    if (out.some((g) => g.key === key)) continue;
    out.push({ key, tier: n.from_tier ?? n.tier, category: n.category ?? "", goods });
  }
  return out;
}

/** An input as a whole number, "" for none. */
const parse = (v: string) => (/^\d{1,6}$/.test(v.trim()) ? clampResidents(Number(v)) : 0);

function Inputs({ idx, input, onChange }: { idx: Index; input: CalcInput; onChange: (next: CalcInput) => void }) {
  const set = (tier: string, residents: number) => onChange({ ...input, residents: { ...input.residents, [tier]: residents } });
  return (
    <div className={styles.tableWrap}>
      <table className={`${styles.table} ${styles.calcTable}`} data-testid="almanac-calc-inputs">
        <thead>
          <tr>
            <th scope="col">{t("almanac.calc.tier")}</th>
            <th scope="col" className={styles.num}>
              {t("infoPanel.residents")}
            </th>
            <th scope="col" className={styles.num}>
              {t("almanac.calc.houses")}
            </th>
          </tr>
        </thead>
        <tbody>
          {idx.tiers.map((tier) => {
            const max = (tier.residents_max ?? 0) / 1000;
            const n = clampResidents(input.residents[tier.id] ?? 0);
            return (
              <tr key={tier.id}>
                <th scope="row">
                  {tier.name} <span className={styles.small}>{t("almanac.calc.perHouse", { max: num(max) })}</span>
                </th>
                <td className={styles.num}>
                  <input
                    className={styles.calcInput}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_RESIDENTS}
                    step={1}
                    value={n > 0 ? n : ""}
                    placeholder="0"
                    aria-label={t("almanac.calc.residentsOf", { tier: tier.name })}
                    onChange={(e) => set(tier.id, parse(e.target.value))}
                  />
                </td>
                <td className={styles.num}>
                  <input
                    className={styles.calcInput}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    disabled={max <= 0}
                    value={n > 0 && max > 0 && n % max === 0 ? n / max : ""}
                    placeholder="0"
                    aria-label={t("almanac.calc.housesOf", { tier: tier.name })}
                    onChange={(e) => set(tier.id, clampResidents(parse(e.target.value) * max))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Supplied({ idx, input, onChange }: { idx: Index; input: CalcInput; onChange: (next: CalcInput) => void }) {
  const list = groups(idx, input);
  if (list.length === 0) return null;
  return (
    <>
      <h3>{t("almanac.calc.supplied")}</h3>
      <p className={styles.small}>{t("almanac.calc.suppliedLead")}</p>
      <div className={styles.cards}>
        {list.map((g) => (
          <fieldset key={g.key} className={styles.calcGroup}>
            <legend>{t("almanac.calc.category", { category: idx.categoryName(g.category), tier: idx.tierName(g.tier) })}</legend>
            {g.goods.map((good) => (
              <label key={good} className={styles.calcCheck}>
                <input
                  type="checkbox"
                  checked={!input.off.has(good)}
                  onChange={(e) => {
                    const off = new Set(input.off);
                    if (e.target.checked) off.delete(good);
                    else off.add(good);
                    onChange({ ...input, off });
                  }}
                />{" "}
                {idx.goodName(good)}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </>
  );
}

function Coverage({ idx, result }: { idx: Index; result: CalcResult }) {
  // A category with some but not all goods supplied; a fully unsupplied one shows nothing (D-084 §2).
  const partial = result.coverage.filter((c) => c.supplied.length > 0 && c.coverage < 1);
  if (partial.length === 0) return null;
  return (
    <ul className={styles.calcNotes} data-testid="almanac-calc-coverage">
      {partial.map((c) => (
        <li key={c.need}>
          {t("almanac.calc.coverage", {
            tier: idx.tierName(c.tier),
            category: idx.categoryName(c.category),
            goods: c.supplied.map((g) => idx.goodName(g)).join(", "),
            percent: ppmPercent(c.coverage * 1_000_000),
            max: num((idx.tier(c.tier)?.residents_max ?? 0) / 1000),
          })}
        </li>
      ))}
    </ul>
  );
}

function Demand({ idx, result }: { idx: Index; result: CalcResult }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-testid="almanac-calc-demand">
        <thead>
          <tr>
            <th scope="col">{t("away.good")}</th>
            <th scope="col" className={styles.num}>
              {t("almanac.calc.byResidents")}
            </th>
            <th scope="col" className={styles.num}>
              {t("almanac.calc.upstream")}
            </th>
            <th scope="col" className={styles.num}>
              {t("almanac.calc.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.demand.map((d) => (
            <tr key={d.good}>
              <td>
                <GoodLink idx={idx} id={d.good} />
              </td>
              <td className={styles.num}>{d.residents > 0 ? tonsPerMinText(num(d.residents)) : "—"}</td>
              <td className={styles.num}>{d.upstream > 0 ? tonsPerMinText(num(d.upstream)) : "—"}</td>
              <td className={styles.num}>{tonsPerMinText(num(d.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chain({ idx, group }: { idx: Index; group: CalcResult["groups"][number] }) {
  return (
    <section className={styles.card} style={{ marginBottom: 12 }} aria-labelledby={`calc-chain-${group.good}`}>
      <h4 id={`calc-chain-${group.good}`} style={{ marginTop: 0 }}>
        {idx.goodName(group.good)}
      </h4>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.calcTable}`}>
          <thead>
            <tr>
              <th scope="col">{t("almanac.o.building")}</th>
              <th scope="col">{t("away.good")}</th>
              <th scope="col" className={styles.num}>
                {t("almanac.calc.count")}
              </th>
              <th scope="col" className={styles.num}>
                {t("almanac.calc.used")}
              </th>
              <th scope="col">{t("almanac.b.fields")}</th>
              <th scope="col">{t("almanac.calc.deposit")}</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.good}>
                <td>
                  <BuildingLink idx={idx} id={r.building} />
                </td>
                <td>
                  <GoodLink idx={idx} id={r.good} />
                </td>
                <td className={styles.num}>{r.count}</td>
                <td className={styles.num}>{ppmPercent(r.used * 1_000_000)}</td>
                <td>{r.fields > 0 ? (r.count > 1 ? t("almanac.calc.fields", { total: r.fields, perFarm: r.fieldsPerFarm }) : r.fields) : "—"}</td>
                <td>{r.deposit ? titleCase(depositName(r.deposit)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Totals({ idx, result }: { idx: Index; result: CalcResult }) {
  const x = result.totals;
  return (
    <dl className={styles.defs} data-testid="almanac-calc-totals">
      <Row label={t("almanac.calc.totalBuildings")}>{x.buildings}</Row>
      <Row label={t("almanac.calc.totalFields")}>{x.fields}</Row>
      <Row label={t("almanac.calc.totalDeposits")}>
        {x.deposits.length === 0
          ? "—"
          : x.deposits.map((d, i) => (
              <span key={d.kind}>
                {i > 0 && ", "}
                {t("almanac.calc.depositSlots", { count: d.slots, name: titleCase(depositName(d.kind)) })}
              </span>
            ))}
      </Row>
      <Row label={t("almanac.calc.totalWorkforce")}>
        {x.workforce.length === 0
          ? "—"
          : x.workforce.map((w, i) => (
              <span key={w.tier}>
                {i > 0 && ", "}
                {num(w.amount)} {idx.tierName(w.tier)}
              </span>
            ))}
      </Row>
      <Row label={t("infoPanel.upkeep")}>{t("almanac.b.goldPerMin", { amount: num(x.upkeep) })}</Row>
      <Row label={t("almanac.calc.totalTax")}>{t("almanac.b.goldPerMin", { amount: num(x.tax) })}</Row>
    </dl>
  );
}

/**
 * The calculator (D-084): residents per tier → demand per good → producers up the chains. The inputs live in the
 * address bar (`?s=120&c=400&off=cider`), so a plan is a link; typing replaces the query without a history entry.
 */
export function Calculator({ idx, search }: { idx: Index; id?: string; search?: string }) {
  const query = useSearch(search ?? "");
  const input = parseQuery(idx, query);
  const result = calculate(idx, input);
  const change = (next: CalcInput) => replaceSearch(writeQuery(idx, next));
  return (
    <>
      <h2>{t("almanac.section.calculator")}</h2>
      <p className={styles.lead}>{t("almanac.calc.lead")}</p>
      <section className={styles.card} style={{ marginBottom: 12 }} aria-labelledby="calc-inputs-h">
        <h3 id="calc-inputs-h" style={{ marginTop: 0 }}>
          {t("almanac.calc.inputs")}
        </h3>
        <Inputs idx={idx} input={input} onChange={change} />
        <Supplied idx={idx} input={input} onChange={change} />
      </section>
      {result.residents <= 0 ? (
        <p className={styles.status} data-testid="almanac-calc-empty">
          {t("almanac.calc.empty")}
        </p>
      ) : (
        <>
          <Coverage idx={idx} result={result} />
          <h3>{t("almanac.calc.demand")}</h3>
          {result.demand.length === 0 ? <p className={styles.small}>{t("almanac.calc.noDemand")}</p> : <Demand idx={idx} result={result} />}
          <h3>{t("almanac.calc.production")}</h3>
          <p className={styles.small}>{t("almanac.calc.productionLead")}</p>
          {result.groups.map((g) => (
            <Chain key={g.good} idx={idx} group={g} />
          ))}
          {result.unproduced.length > 0 && (
            <p className={styles.small} data-testid="almanac-calc-unproduced">
              {t("almanac.calc.unproduced", { goods: result.unproduced.map((g) => idx.goodName(g)).join(", ") })}
            </p>
          )}
          <h3>{t("almanac.calc.totals")}</h3>
          <Totals idx={idx} result={result} />
          <p className={styles.small}>{t("almanac.calc.outOfScope")}</p>
        </>
      )}
    </>
  );
}
