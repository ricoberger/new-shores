import { useState } from "react";
import type { Content, DisplayState } from "../api/client";
import { t } from "../i18n";
import { units } from "../display/format";
import { objectiveText, questDef, questTitle, rewardText, rewardsGoods } from "../display/quests";
import { CloseButton } from "./CloseButton";
import { questChains } from "./questChains";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  /** Claims a quest; island is set for quests that reward goods. */
  onClaim: (questId: string, islandId: string | null) => void;
  onClose: () => void;
}

/**
 * Claimable and active quests (server state only), grouped by chain in
 * content order: the chain's name and progress, each quest's step and the
 * chain's next quest. Claimed quests are not listed.
 */
export function QuestsPanel({ model, content, onClaim, onClose }: Props) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const active = new Map(model.quests.active.map((aq) => [aq.id, aq]));
  const chains = questChains(model, content);
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="quests-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>{t("quests.title")}</h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="quests-close" />
      </div>
      <div className={styles.panelBody}>
        {chains.map((c) => (
          <section key={c.id} className={styles.questChain} data-testid={`quest-chain-${c.id}`}>
            <div className={`${styles.row} ${styles.sectionTitle}`}>
              <span>{c.name}</span>
              <div className={styles.spacer} />
              <span data-testid={`quest-chain-progress-${c.id}`}>{t("quests.chainProgress", { done: c.done, total: c.total })}</span>
            </div>
            {c.open.map(({ id, claimable, step }) => {
              const q = questDef(content, id);
              const aq = active.get(id);
              const stepLabel = (
                <span className={styles.small} data-testid={`quest-step-${id}`}>
                  {t("quests.step", { step, total: c.total })}
                </span>
              );
              if (claimable)
                return (
                  <div key={id} className={styles.shipEntry} data-testid={`quest-claimable-${id}`}>
                    {stepLabel}
                    <div className={styles.row}>
                      <strong>{questTitle(content, id)}</strong>
                      <span className={styles.ok}>{t("quests.completed")}</span>
                    </div>
                    {q && <p className={styles.small}>{q.text}</p>}
                    {q && <div className={styles.small}>{t("quests.reward", { reward: rewardText(q, content) })}</div>}
                    {choosing === id ? (
                      <ClaimIsland
                        model={model}
                        content={content}
                        questId={id}
                        onClaim={(island) => {
                          setChoosing(null);
                          onClaim(id, island);
                        }}
                        onCancel={() => setChoosing(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => (rewardsGoods(q) ? setChoosing(id) : onClaim(id, null))}
                        data-testid={`quest-claim-${id}`}
                      >
                        {t("quests.claim")}
                      </button>
                    )}
                  </div>
                );
              return (
                <div key={id} className={styles.shipEntry} data-testid={`quest-active-${id}`}>
                  {stepLabel}
                  <div>
                    <strong>{questTitle(content, id)}</strong>
                  </div>
                  {q && <p className={styles.small}>{q.text}</p>}
                  {q && <div className={styles.small}>{t("quests.reward", { reward: rewardText(q, content) })}</div>}
                  <ul className={styles.trayList}>
                    {(aq?.objectives ?? []).map((o, i) => (
                      <li key={i} data-testid="quest-objective">
                        {o.met ? <span className={styles.ok}>✓ </span> : "○ "}
                        {objectiveText(o, content)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {c.next && (
              <div className={`${styles.small} ${styles.questNext}`} data-testid={`quest-next-${c.id}`}>
                {t("quests.next", { title: questTitle(content, c.next) })}
              </div>
            )}
          </section>
        ))}
        {chains.length === 0 && <div className={styles.small}>{t("quests.none")}</div>}
      </div>
    </div>
  );
}

interface ClaimIslandProps {
  model: DisplayState;
  content: Content;
  questId: string;
  onClaim: (islandId: string) => void;
  onCancel: () => void;
}

/** Island choice for goods rewards with the island's stock and capacity. */
function ClaimIsland({ model, content, questId, onClaim, onCancel }: ClaimIslandProps) {
  const settled = model.islands.filter((is) => is.settled);
  const [islandId, setIslandId] = useState(settled[0]?.id ?? "");
  const island = settled.find((is) => is.id === islandId);
  const goods = Object.entries(questDef(content, questId)?.rewards.goods ?? {});
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  return (
    <div className={styles.stop} data-testid="quest-claim-island">
      <div className={styles.row}>
        <label>
          {t("quests.deliverTo")}{" "}
          <select className={styles.input} value={islandId} onChange={(e) => setIslandId(e.target.value)} data-testid="quest-claim-island-select">
            {settled.map((is) => (
              <option key={is.id} value={is.id}>
                {is.name || is.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {island &&
        goods.map(([good, amount]) => {
          const g = island.inventory[good];
          return (
            <div key={good} className={styles.small} data-testid={`quest-claim-stock-${good}`}>
              {t("quests.claimStock", { amount: units(amount), good: goodName(good), stock: units(g?.stock ?? 0), capacity: units(g?.capacity ?? 0) })}
            </div>
          );
        })}
      <div className={`${styles.small} ${styles.warn}`}>{t("quests.lostBeyondCapacity")}</div>
      <div className={styles.buttons}>
        <button type="button" className={styles.button} disabled={!island} onClick={() => onClaim(islandId)} data-testid="quest-claim-confirm">
          {t("quests.claim")}
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
