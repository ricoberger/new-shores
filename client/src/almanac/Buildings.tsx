import styles from "./almanac.module.css";
import { buildingGroups, buildingView, num, tierViews, type BuildingView, type FlowView, type Index } from "./model";
import { A, BuildingLink, Cost, GoodAlternatives, Row, Thumb } from "./parts";

function Flows({ idx, flows, empty }: { idx: Index; flows: FlowView[]; empty: string }) {
  if (flows.length === 0) return <>{empty}</>;
  return (
    <>
      {flows.map((f, i) => (
        <span key={f.goods.join("|")}>
          {i > 0 && ", "}
          <GoodAlternatives idx={idx} goods={f.goods} /> {num(f.perMin)}/min
        </span>
      ))}
    </>
  );
}

/** One building: everything the content says about it, rates per minute from the cycle time. */
export function BuildingCard({ idx, view, linked, level = 3 }: { idx: Index; view: BuildingView; linked?: boolean; level?: 3 | 4 }) {
  const H = `h${level}` as "h3" | "h4";
  const house = view.residents ? tierViews(idx).find((t) => t.id === view.residents?.tier) : undefined;
  return (
    <article className={styles.card} id={`building-${view.id}`} aria-labelledby={`building-h-${view.id}`}>
      <div className={styles.cardHead}>
        <Thumb id={view.id} name={view.name} />
        <div>
          <H id={`building-h-${view.id}`}>{linked ? <A section="buildings" id={view.id}>{view.name}</A> : view.name}</H>
          <span className={styles.small}>
            {idx.tierName(view.tier)} · {view.category}
          </span>
        </div>
      </div>
      <dl className={styles.defs}>
        <Row label="Footprint">
          {view.footprint}
          {view.requiresRoad ? ", needs a road" : ""}
        </Row>
        <Row label="Cost">
          <Cost idx={idx} parts={view.cost} />
        </Row>
        {view.upkeep > 0 && <Row label="Upkeep">{num(view.upkeep)} gold/min</Row>}
        {view.workforce && (
          <Row label="Workers">
            {num(view.workforce.amount)} {idx.tierName(view.workforce.tier)}
          </Row>
        )}
        {house && (
          <Row label="Residents">
            {idx.tierName(house.id)}: {num(house.residentsFloor)}–{num(house.residentsMax)} per house
          </Row>
        )}
        {view.outputs.length > 0 && (
          <>
            <Row label="Takes">
              <Flows idx={idx} flows={view.inputs} empty="nothing" />
            </Row>
            <Row label="Makes">
              <Flows idx={idx} flows={view.outputs} empty="nothing" />
            </Row>
            {view.cycleSeconds !== undefined && <Row label="Cycle">{num(view.cycleSeconds)} s</Row>}
          </>
        )}
        {view.needsSite.length > 0 && (
          <Row label="Site">
            <ul className={styles.list}>
              {view.needsSite.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Row>
        )}
        {view.radius !== undefined && <Row label="Service radius">{view.levels.length > 1 ? view.levels.map((l) => l.radius).join(" / ") : view.radius} tiles</Row>}
        {view.roadSecondsPerTile !== undefined && <Row label="Transfer">{num(view.roadSecondsPerTile)} s per tile</Row>}
        {view.ships.length > 0 && (
          <Row label="Builds">
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
          <Row label="Fields">
            <ul className={styles.list}>
              {view.modules.map((m) => (
                <li key={m.building}>
                  <BuildingLink idx={idx} id={m.building} />
                  {m.required !== undefined && ` — ${m.required} needed${m.max !== undefined && m.max !== m.required ? `, up to ${m.max}` : ""}`}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {view.fieldOf.length > 0 && (
          <Row label="Belongs to">
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
          Levels
        </caption>
        <thead>
          <tr>
            <th scope="col">Level</th>
            {has("capacity") && <th scope="col" className={styles.num}>Capacity per good</th>}
            {has("throughput") && <th scope="col" className={styles.num}>Throughput/min</th>}
            {has("berths") && <th scope="col" className={styles.num}>Berths</th>}
            {has("radius") && <th scope="col" className={styles.num}>Radius</th>}
            <th scope="col">Upgrade cost</th>
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
              <td>{l.level === 1 ? <span className={styles.small}>built as is</span> : <Cost idx={idx} parts={l.cost} />}</td>
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
          <A section="buildings">← All buildings</A>
        </p>
        <BuildingCard idx={idx} view={buildingView(idx, one)} level={4} />
      </>
    );
  }
  return (
    <>
      <h2>Buildings</h2>
      <p className={styles.lead}>Every building of the game by tier and group. Rates are per minute at full efficiency, from the cycle time.</p>
      {id && <p role="status">There is no building “{id}”.</p>}
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
