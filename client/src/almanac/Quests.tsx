import { t, tOr } from "../i18n";
import styles from "./almanac.module.css";
import { num, titleCase, type Index } from "./model";
import { A, GoodLink } from "./parts";
import { questViews } from "./questText";
import { useScrollTo } from "./useScrollTo";

/** The quest chains in content order with conditions in player words. */
export function Quests({ idx, id }: { idx: Index; id?: string }) {
  useScrollTo(id, "quest-");
  const quests = questViews(idx);
  const chains = [...new Set(quests.map((q) => q.chain))];
  return (
    <>
      <h2>{t("almanac.section.quests")}</h2>
      <p className={styles.lead}>{t("almanac.quests.lead")}</p>
      {quests.length === 0 && <p className={styles.small}>{t("almanac.quests.none")}</p>}
      {chains.map((c) => (
        <section key={c} aria-labelledby={`qc-${c}`}>
          <h3 id={`qc-${c}`}>{idx.tier(c)?.name ?? tOr(`almanac.questChain.${c}`, titleCase(c))}</h3>
          <div className={styles.cards}>
            {quests
              .filter((q) => q.chain === c)
              .map((q, i) => (
                <article key={q.id} id={`quest-${q.id}`} className={styles.card} aria-labelledby={`quest-h-${q.id}`}>
                  <h4 id={`quest-h-${q.id}`}>
                    {i + 1}. {q.title}
                  </h4>
                  <p style={{ margin: "0 0 6px" }}>{q.text}</p>
                  <ul className={styles.list} aria-label={t("almanac.quests.conditions")}>
                    {q.conditions.map((c2) => (
                      <li key={c2}>{c2}</li>
                    ))}
                  </ul>
                  <p style={{ margin: "6px 0 0" }}>
                    <strong>{t("almanac.quests.reward")}</strong> {q.gold > 0 ? t("almanac.goldAmount", { amount: num(q.gold) }) : ""}
                    {q.gold > 0 && q.goods.length > 0 ? ", " : ""}
                    {q.goods.map((g, k) => (
                      <span key={g.good}>
                        {k > 0 && ", "}
                        {num(g.amount)} × <GoodLink idx={idx} id={g.good} />
                      </span>
                    ))}
                    {q.gold === 0 && q.goods.length === 0 ? t("almanac.none") : ""}
                  </p>
                  {q.prerequisites.length > 0 && (
                    <p className={styles.small} style={{ margin: "4px 0 0" }}>
                      {t("almanac.quests.after")}{" "}
                      {q.prerequisites.map((p, k) => (
                        <span key={p.id}>
                          {k > 0 && ", "}
                          <A section="quests" id={p.id}>
                            {p.title}
                          </A>
                        </span>
                      ))}
                    </p>
                  )}
                  {q.unlocks.length > 0 && (
                    <p className={styles.small} style={{ margin: "2px 0 0" }}>
                      {t("almanac.quests.opens")}{" "}
                      {q.unlocks.map((p, k) => (
                        <span key={p.id}>
                          {k > 0 && ", "}
                          <A section="quests" id={p.id}>
                            {p.title}
                          </A>
                        </span>
                      ))}
                    </p>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
