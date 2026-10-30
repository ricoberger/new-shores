import styles from "./almanac.module.css";
import { t } from "../i18n";
import { buildingGroups, categoryName, buildingView, num, tierViews, type BuildingView, type FlowView, type Index } from "./model";
import { A, BuildingLink, Cost, GoodAlternatives, Row, Thumb } from "./parts";

function Flows({ idx, flows, empty }: { idx: Index; flows: FlowView[]; empty: string }) {
  if (flows.length === 0) return <>{empty}</>;
  return (
    <>
      {flows.map((f, i) => (
        <span key={f.goods.join("|")}>
          {i > 0 && ", "}
          <GoodAlternatives idx={idx} goods={f.goods} /> {t("infoPanel.perMinute", { rate: num(f.perMin) })}
        </span>
      ))}
    </>
  );
}

/** One building: everything the content says about it, rates per minute from the cycle time. */
export function BuildingCard({ idx, view, linked, level = 3 }: { idx: Index; view: BuildingView; linked?: boolean; level?: 3 | 4 }) {
  const H = `h${level}` as "h3" | "h4";
  const house = view.residents ? tierViews(idx).find((x) => x.id === view.residents?.tier) : undefined;
  return (
    <article className={styles.card} id={`building-${view.id}`} aria-labelledby={`building-h-${view.id}`}>
      <div className={styles.cardHead}>
        <Thumb id={view.id} name={view.name} />
        <div>
          <H id={`building-h-${view.id}`}>{linked ? <A section="buildings" id={view.id}>{view.name}</A> : view.name}</H>
          <span className={styles.small}>
            {idx.tierName(view.tier)} · {categoryName(view.category)}
          </span>
        </div>
      </div>
      <dl className={styles.defs}>
        <Row label={t("almanac.b.footprint")}>
          {view.footprint}
          {view.requiresRoad ? t("almanac.b.needsRoad") : ""}
        </Row>
        <Row label={t("almanac.b.cost")}>
          <Cost idx={idx} parts={view.cost} />
        </Row>
        {view.upkeep > 0 && <Row label={t("infoPanel.upkeep")}>{t("almanac.b.goldPerMin", { amount: num(view.upkeep) })}</Row>}
        {view.workforce && (
          <Row label={t("infoPanel.workers")}>
            {num(view.workforce.amount)} {idx.tierName(view.workforce.tier)}
          </Row>
        )}
        {house && (
          <Row label={t("infoPanel.residents")}>
            {t("almanac.b.perHouse", { tier: idx.tierName(house.id), min: num(house.residentsFloor), max: num(house.residentsMax) })}
          </Row>
        )}
        {view.outputs.length > 0 && (
          <>
            <Row label={t("almanac.b.takes")}>
              <Flows idx={idx} flows={view.inputs} empty={t("almanac.b.nothing")} />
            </Row>
            <Row label={t("almanac.b.makes")}>
              <Flows idx={idx} flows={view.outputs} empty={t("almanac.b.nothing")} />
            </Row>
            {view.cycleSeconds !== undefined && <Row label={t("infoPanel.cycle")}>{t("infoPanel.seconds", { count: num(view.cycleSeconds) })}</Row>}
          </>
        )}
        {view.needsSite.length > 0 && (
          <Row label={t("almanac.b.site")}>
            <ul className={styles.list}>
              {view.needsSite.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Row>
        )}
        {view.radius !== undefined && <Row label={t("almanac.b.serviceRadius")}>{t("infoPanel.tiles", { count: view.levels.length > 1 ? view.levels.map((l) => l.radius).join(" / ") : view.radius })}</Row>}
        {view.roadSecondsPerTile !== undefined && <Row label={t("almanac.b.transfer")}>{t("almanac.b.secondsPerTile", { count: num(view.roadSecondsPerTile) })}</Row>}
        {view.shallows && <Row label={t("almanac.b.site")}>{t("almanac.b.shallows")}</Row>}
        {view.pierBerths !== undefined && <Row label={t("infoPanel.berths")}>{t("almanac.b.pierBerths", { count: view.pierBerths })}</Row>}
        {view.ships.length > 0 && (
          <Row label={t("almanac.b.builds")}>
            {view.ships.map((s, i) => (
              <span key={s}>
                {i > 0 && ", "}
                <A section="ships" id={s}>
                  {idx.shipName(s)}
                </A>
              </span>
            ))}
          </Row>
        )}
        {view.modules.length > 0 && (
          <Row label={t("almanac.b.fields")}>
            <ul className={styles.list}>
              {view.modules.map((m) => (
                <li key={m.building}>
                  <BuildingLink idx={idx} id={m.building} />
                  {m.required !== undefined && ` — ${m.max !== undefined && m.max !== m.required ? t("almanac.b.neededUpTo", { required: m.required, max: m.max }) : t("almanac.b.needed", { required: m.required })}`}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {view.fieldOf.length > 0 && (
          <Row label={t("almanac.b.belongsTo")}>
            {view.fieldOf.map((f, i) => (
              <span key={f}>
                {i > 0 && ", "}
                <BuildingLink idx={idx} id={f} />
              </span>
            ))}
          </Row>
        )}
      </dl>
      {view.levels.length > 1 && <Levels idx={idx} view={view} />}
    </article>
  );
}

function Levels({ idx, view }: { idx: Index; view: BuildingView }) {
  const has = (k: "capacity" | "throughput" | "berths" | "radius") => view.levels.some((l) => l[k] !== undefined);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.small} style={{ textAlign: "left" }}>
          {t("almanac.b.levels")}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("infoPanel.level")}</th>
            {has("capacity") && <th scope="col" className={styles.num}>{t("almanac.b.capacityPerGood")}</th>}
            {has("throughput") && <th scope="col" className={styles.num}>{t("almanac.b.throughputPerMin")}</th>}
            {has("berths") && <th scope="col" className={styles.num}>{t("infoPanel.berths")}</th>}
            {has("radius") && <th scope="col" className={styles.num}>{t("infoPanel.radius")}</th>}
            <th scope="col">{t("almanac.b.upgradeCost")}</th>
          </tr>
        </thead>
        <tbody>
          {view.levels.map((l) => (
            <tr key={l.level}>
              <td>
                {l.level}
                {l.tier ? <span className={styles.small}> ({idx.tierName(l.tier)})</span> : null}
              </td>
              {has("capacity") && <td className={styles.num}>{l.capacity === undefined ? "" : num(l.capacity)}</td>}
              {has("throughput") && <td className={styles.num}>{l.throughput === undefined ? "" : num(l.throughput)}</td>}
              {has("berths") && <td className={styles.num}>{l.berths ?? ""}</td>}
              {has("radius") && <td className={styles.num}>{l.radius ?? ""}</td>}
              <td>{l.level === 1 ? <span className={styles.small}>{t("almanac.b.builtAsIs")}</span> : <Cost idx={idx} parts={l.cost} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Buildings by tier, then category; /almanac/buildings/<id> shows one building. */
export function Buildings({ idx, id }: { idx: Index; id?: string }) {
  const one = idx.building(id);
  if (id && one) {
    return (
      <>
        <h2>{one.name}</h2>
        <p className={styles.lead}>
          <A section="buildings">{t("almanac.b.all")}</A>
        </p>
        <BuildingCard idx={idx} view={buildingView(idx, one)} level={4} />
      </>
    );
  }
  return (
    <>
      <h2>{t("almanac.section.buildings")}</h2>
      <p className={styles.lead}>{t("almanac.b.lead")}</p>
      {id && <p role="status">{t("almanac.b.noSuch", { id })}</p>}
      {buildingGroups(idx).map((g) => (
        <section key={g.tier} aria-labelledby={`bt-${g.tier}`}>
          <h3 id={`bt-${g.tier}`}>{g.tierName}</h3>
          {g.categories.map((c) => (
            <div key={c.category}>
              <h4>{c.name}</h4>
              <div className={styles.cards}>
                {c.buildings.map((b) => (
                  <BuildingCard key={b.id} idx={idx} view={buildingView(idx, b)} linked level={4} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
