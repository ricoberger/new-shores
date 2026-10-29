import { goodIcon } from "../theme/iconSet";
import { Icon } from "../ui/Icon";
import styles from "./almanac.module.css";
import { chain, goodView, num, titleCase, type ChainNode, type Index } from "./model";
import { A, BuildingLink, GoodLink } from "./parts";

/** Upstream chain as nested cards: the good, who makes it, what that takes, recursively down to raw goods. */
function ChainTree({ idx, node }: { idx: Index; node: ChainNode }) {
  const construction = idx.good(node.good)?.type === "construction";
  const raw = node.via.length === 0 && !node.cycle;
  return (
    <li>
      <span className={`${styles.chainNode} ${raw ? styles.chainRaw : ""}`}>
        <GoodLink idx={idx} id={node.good} />
        {construction && <span className={styles.badge}>construction</span>}
        {raw && <span className={styles.badge}>raw</span>}
        {node.cycle && <span className={styles.small}> (see above)</span>}
      </span>
      {node.via.map((v) => (
        <ul key={v.building}>
          <li>
            <span className={styles.chainSlot}>
              made by <BuildingLink idx={idx} id={v.building} />, {num(v.perMin)}/min
              {v.inputs.length === 0 ? (v.site.length > 0 ? ` with ${v.site.join(", ")}` : " from the land") : " from:"}
            </span>
            {v.inputs.length > 0 && (
              <ul>
                {v.inputs.map((slot) =>
                  slot.goods.length === 1 && slot.goods[0] ? (
                    <ChainTree key={slot.goods[0].good} idx={idx} node={slot.goods[0]} />
                  ) : (
                    <li key={slot.goods.map((g) => g.good).join("|")}>
                      <span className={styles.chainSlot}>one of:</span>
                      <ul>
                        {slot.goods.map((g) => (
                          <ChainTree key={g.good} idx={idx} node={g} />
                        ))}
                      </ul>
                    </li>
                  ),
                )}
              </ul>
            )}
          </li>
        </ul>
      ))}
    </li>
  );
}

function GoodPage({ idx, id }: { idx: Index; id: string }) {
  const g = idx.good(id);
  if (!g) return null;
  const v = goodView(idx, g);
  const tree = chain(idx, g.id);
  return (
    <>
      <h2>
        <Icon path={goodIcon(g.id)} /> {g.name}
        {v.construction && <span className={styles.badge}>construction material</span>}
      </h2>
      <p className={styles.lead}>
        <A section="goods">← All goods</A> · {titleCase(g.type)}
        {v.usedToBuild > 0 && ` · part of the cost of ${v.usedToBuild} ${v.usedToBuild === 1 ? "building" : "buildings"}`}
      </p>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="good-made">
          <h4 id="good-made">Made by</h4>
          {v.producedBy.length === 0 ? (
            <p className={styles.small}>Nothing makes it: it comes with the start or as a quest reward.</p>
          ) : (
            <ul className={styles.list}>
              {v.producedBy.map((p) => (
                <li key={p.building}>
                  <BuildingLink idx={idx} id={p.building} /> — {num(p.perMin)}/min
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={styles.card} aria-labelledby="good-used">
          <h4 id="good-used">Used by</h4>
          {v.consumedBy.length === 0 && v.neededBy.length === 0 ? (
            <p className={styles.small}>Nothing uses it up.</p>
          ) : (
            <ul className={styles.list}>
              {v.consumedBy.map((c) => (
                <li key={c.building}>
                  <BuildingLink idx={idx} id={c.building} /> — {num(c.perMin)}/min{c.alternative ? " (or an alternative)" : ""}
                </li>
              ))}
              {v.neededBy.map((n) => (
                <li key={n.need}>
                  <A section="needs" id={n.tier}>
                    {idx.tierName(n.tier)}
                  </A>{" "}
                  want it ({idx.categoryName(n.category) || n.category})
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <h3>Chain upstream</h3>
      <p className={styles.lead}>From raw goods to {g.name}, at one building per step; “one of” lists alternatives.</p>
      <ul className={styles.chain} data-testid="good-chain">
        <ChainTree idx={idx} node={tree} />
      </ul>
    </>
  );
}

/** Goods by type; /almanac/goods/<id> shows one good with its chain. */
export function Goods({ idx, id }: { idx: Index; id?: string }) {
  if (id && idx.good(id)) return <GoodPage idx={idx} id={id} />;
  const goods = idx.content.goods ?? [];
  const types = [...new Set(goods.map((g) => g.type))];
  return (
    <>
      <h2>Goods</h2>
      <p className={styles.lead}>Select a good to see who makes it, who needs it and the chain that leads to it.</p>
      {id && <p role="status">There is no good “{id}”.</p>}
      {types.map((t) => (
        <section key={t} aria-labelledby={`gt-${t}`}>
          <h3 id={`gt-${t}`}>{titleCase(t)}</h3>
          <ul className={styles.tags}>
            {goods
              .filter((g) => g.type === t)
              .map((g) => (
                <li key={g.id}>
                  <GoodLink idx={idx} id={g.id} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}
