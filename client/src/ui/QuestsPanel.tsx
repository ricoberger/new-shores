import { useState } from "react";
import type { Content, DisplayState } from "../api/client";
import { units } from "../display/format";
import { objectiveText, questDef, questTitle, rewardText, rewardsGoods } from "../display/quests";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  /** Claims a quest; island is set for quests that reward goods. */
  onClaim: (questId: string, islandId: string | null) => void;
  onClose: () => void;
}

/** Active, claimable and completed quests (server state only). */
export function QuestsPanel({ model, content, onClaim, onClose }: Props) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const claimed = new Set(model.quests.completed.filter((q) => q.claimed).map((q) => q.id));
  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="quests-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>Quests</h2>
        <div className={styles.spacer} />
        <button type="button" className={styles.link} onClick={onClose} data-testid="quests-close">
          close
        </button>
      </div>
      {model.quests.claimable.map((id) => {
        const q = questDef(content, id);
        return (
          <div key={id} className={styles.shipEntry} data-testid={`quest-claimable-${id}`}>
            <div className={styles.row}>
              <strong>{questTitle(content, id)}</strong>
              <span className={styles.ok}>✓ completed</span>
            </div>
            {q && <div className={styles.small}>Reward: {rewardText(q, content)}</div>}
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
                Claim
              </button>
            )}
          </div>
        );
      })}
      {model.quests.active.map((aq) => {
        const q = questDef(content, aq.id);
        return (
          <div key={aq.id} className={styles.shipEntry} data-testid={`quest-active-${aq.id}`}>
            <strong>{questTitle(content, aq.id)}</strong>
            {q && <p className={styles.small}>{q.text}</p>}
            <ul className={styles.trayList}>
              {aq.objectives.map((o, i) => (
                <li key={i} data-testid="quest-objective">
                  {o.met ? <span className={styles.ok}>✓ </span> : "○ "}
                  {objectiveText(o, content)}
                </li>
              ))}
            </ul>
            {q && <div className={styles.small}>Reward: {rewardText(q, content)}</div>}
          </div>
        );
      })}
      {model.quests.active.length === 0 && model.quests.claimable.length === 0 && (
        <div className={styles.small}>No open quests.</div>
      )}
      {model.quests.completed.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Completed</div>
          {model.quests.completed.map((q) => (
            <div key={q.id} className={styles.small} data-testid={`quest-completed-${q.id}`}>
              {questTitle(content, q.id)} {claimed.has(q.id) ? "· claimed" : "· reward waiting"}
            </div>
          ))}
        </div>
      )}
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
          Deliver to{" "}
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
              +{units(amount)} {goodName(good)} · in stock {units(g?.stock ?? 0)}/{units(g?.capacity ?? 0)}
            </div>
          );
        })}
      <div className={`${styles.small} ${styles.warn}`}>Goods beyond the warehouse capacity are lost.</div>
      <div className={styles.buttons}>
        <button type="button" className={styles.button} disabled={!island} onClick={() => onClaim(islandId)} data-testid="quest-claim-confirm">
          Claim
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
