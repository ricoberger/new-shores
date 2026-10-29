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
      <h2>Ships</h2>
      <p className={styles.lead}>Ships carry goods between your islands along routes. All of them are ordered at a shipyard once their tier is unlocked.</p>
      {ships.length === 0 && <p className={styles.small}>No ships in the content.</p>}
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
              <Row label="Cargo">
                {s.slots} slots × {num(s.slotSize)} ({num(s.totalCapacity)} in all)
              </Row>
              <Row label="Speed">{num(s.speed)} × the reference speed</Row>
              <Row label="Cost">
                <Cost idx={idx} parts={s.cost} />
              </Row>
              <Row label="Upkeep">{num(s.upkeep)} gold/min</Row>
              <Row label="Build time">{num(s.buildMinutes)} min</Row>
              {s.lengthTiles !== undefined && <Row label="Length">{num(s.lengthTiles)} tiles</Row>}
              <Row label="Unlocked with">{idx.tierName(s.tier)}</Row>
              {s.shipyards.length > 0 && (
                <Row label="Built at">
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
