import { useState } from "react";
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { perMin, units } from "../display/format";
import styles from "./hud.module.css";
import type { Tool } from "./tools";

const CATEGORIES: { id: ContentBuilding["category"]; label: string }[] = [
  { id: "houses", label: "Houses" },
  { id: "production", label: "Production" },
  { id: "public", label: "Public" },
  { id: "harbour", label: "Harbour" },
  { id: "roads", label: "Roads" },
  { id: "other", label: "Other" },
];

interface Props {
  content: Content | null;
  model: DisplayState | null;
  /** The island shown (materials are shown from its inventory). */
  islandId: string;
  tool: Tool;
  onSelect: (b: ContentBuilding) => void;
  onDemolishTool: () => void;
}

/**
 * Build menu grouped by the server-derived category. Items are never
 * disabled for cost (the server decides, D-027); each material shows the
 * island stock next to the cost (have/need) for information only. Items of
 * a tier that is not unlocked show the lock reason.
 */
export function BuildMenu({ content, model, islandId, tool, onSelect, onDemolishTool }: Props) {
  const [category, setCategory] = useState<ContentBuilding["category"]>("houses");
  if (!content) return null;
  const present = CATEGORIES.filter((c) => content.buildings.some((b) => b.category === c.id));
  const inventory = model?.islands.find((is) => is.id === islandId)?.inventory ?? {};
  const tierName = (id: string) => content.tiers.find((t) => t.id === id)?.name ?? id;
  const unlocked = (tier: string) => model?.tiers.find((t) => t.id === tier)?.unlocked ?? false;
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const activeId = tool.kind === "build" ? tool.buildingType : tool.kind === "road" ? tool.roadType : null;

  return (
    <div className={styles.buildMenu} data-testid="build-menu">
      <div className={styles.tabs}>
        {present.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.tab} ${c.id === category ? styles.tabActive : ""}`}
            onClick={() => setCategory(c.id)}
            data-testid={`build-tab-${c.id}`}
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.toolButton} ${tool.kind === "demolish" ? styles.itemActive : ""}`}
          onClick={onDemolishTool}
          data-testid="tool-demolish"
        >
          ⚒ Demolish
        </button>
      </div>
      <div className={styles.items}>
        {content.buildings
          .filter((b) => b.category === category)
          .map((b) => {
            const locked = !unlocked(b.tier);
            return (
              <button
                key={b.id}
                type="button"
                className={`${styles.item} ${activeId === b.id ? styles.itemActive : ""}`}
                disabled={locked}
                onClick={() => onSelect(b)}
                data-testid={`build-${b.id}`}
              >
                <span className={styles.itemName}>{b.name}</span>
                <span className={styles.small}>
                  {units(b.cost.gold)} gold · upkeep {perMin(b.upkeep_per_min)}/min
                </span>
                {Object.entries(b.cost.materials).map(([good, need]) => (
                  <span key={good} className={styles.small}>
                    {goodName(good)}: {units(inventory[good]?.stock ?? 0)}/{units(need)}
                  </span>
                ))}
                {locked && <span className={styles.lock}>Needs {tierName(b.tier)}</span>}
              </button>
            );
          })}
      </div>
    </div>
  );
}
