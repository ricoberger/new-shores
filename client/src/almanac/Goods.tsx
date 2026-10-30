import { t, tRich } from "../i18n";
import { goodIcon } from "../theme/iconSet";
import { Icon } from "../ui/Icon";
import styles from "./almanac.module.css";
import { chain, goodTypeName, goodView, num, type ChainNode, type Index } from "./model";
import { A, BuildingLink, GoodLink } from "./parts";

/** Upstream chain as nested cards: the good, who makes it, what that takes, recursively down to raw goods. */
function ChainTree({ idx, node }: { idx: Index; node: ChainNode }) {
  const construction = idx.good(node.good)?.type === "construction";
  const raw = node.via.length === 0 && !node.cycle;
  return (
    <li>
      <span className={`${styles.chainNode} ${raw ? styles.chainRaw : ""}`}>
        <GoodLink idx={idx} id={node.good} />
        {construction && <span className={styles.badge}>{t("almanac.goods.construction")}</span>}
        {raw && <span className={styles.badge}>{t("almanac.goods.raw")}</span>}
        {node.cycle && <span className={styles.small}> {t("almanac.goods.seeAbove")}</span>}
      </span>
      {node.via.map((v) => (
        <ul key={v.building}>
          <li>
            <span className={styles.chainSlot}>
              {tRich("almanac.goods.madeBy", { building: <BuildingLink idx={idx} id={v.building} />, rate: num(v.perMin) })}
              {v.inputs.length === 0
                ? v.site.length > 0
                  ? t("almanac.goods.withSite", { site: v.site.join(", ") })
                  : t("almanac.goods.fromLand")
                : t("almanac.goods.from")}
            </span>
            {v.inputs.length > 0 && (
              <ul>
                {v.inputs.map((slot) =>
                  slot.goods.length === 1 && slot.goods[0] ? (
                    <ChainTree key={slot.goods[0].good} idx={idx} node={slot.goods[0]} />
                  ) : (
                    <li key={slot.goods.map((g) => g.good).join("|")}>
                      <span className={styles.chainSlot}>{t("almanac.goods.oneOf")}</span>
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
        {v.construction && <span className={styles.badge}>{t("almanac.goods.constructionMaterial")}</span>}
      </h2>
      <p className={styles.lead}>
        <A section="goods">{t("almanac.goods.all")}</A> · {goodTypeName(g.type)}
        {v.usedToBuild > 0 && t("almanac.goods.partOfCost", { count: v.usedToBuild })}
      </p>
      <div className={styles.cards}>
        <section className={styles.card} aria-labelledby="good-made">
          <h4 id="good-made">{t("almanac.goods.madeByTitle")}</h4>
          {v.producedBy.length === 0 ? (
            <p className={styles.small}>{t("almanac.goods.nothingMakes")}</p>
          ) : (
            <ul className={styles.list}>
              {v.producedBy.map((p) => (
                <li key={p.building}>
                  <BuildingLink idx={idx} id={p.building} /> — {t("infoPanel.perMinute", { rate: num(p.perMin) })}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={styles.card} aria-labelledby="good-used">
          <h4 id="good-used">{t("almanac.goods.usedBy")}</h4>
          {v.consumedBy.length === 0 && v.neededBy.length === 0 ? (
            <p className={styles.small}>{t("almanac.goods.nothingUses")}</p>
          ) : (
            <ul className={styles.list}>
              {v.consumedBy.map((c) => (
                <li key={c.building}>
                  <BuildingLink idx={idx} id={c.building} /> — {t("infoPanel.perMinute", { rate: num(c.perMin) })}{c.alternative ? ` ${t("almanac.goods.orAlternative")}` : ""}
                </li>
              ))}
              {v.neededBy.map((n) => (
                <li key={n.need}>
                  <A section="needs" id={n.tier}>
                    {idx.tierName(n.tier)}
                  </A>{" "}
                  {t("almanac.goods.wantIt", { category: idx.categoryName(n.category) || n.category })}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <h3>{t("almanac.goods.chain")}</h3>
      <p className={styles.lead}>{t("almanac.goods.chainLead", { good: g.name })}</p>
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
      <h2>{t("almanac.section.goods")}</h2>
      <p className={styles.lead}>{t("almanac.goods.lead")}</p>
      {id && <p role="status">{t("almanac.goods.noSuch", { id })}</p>}
      {types.map((type) => (
        <section key={type} aria-labelledby={`gt-${type}`}>
          <h3 id={`gt-${type}`}>{goodTypeName(type)}</h3>
          <ul className={styles.tags}>
            {goods
              .filter((g) => g.type === type)
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
