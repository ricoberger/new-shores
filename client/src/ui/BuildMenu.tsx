import { useState } from "react";
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { perMin, units } from "../display/format";
import { fertilityNeed, listedInBuildMenu, lockReason, missingFertilityText, tierUnlocked } from "../display/tiers";
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
  /** Fertility tags of the island shown (static island data). */
  fertilities: readonly string[] | undefined;
  tool: Tool;
  onSelect: (b: ContentBuilding) => void;
  onDemolishTool: () => void;
  /** Phone layouts: categories as a scrollable chip row, items as compact cards in one scrolling row. */
  compact?: boolean;
  /** Landscape phones: categories and items share one row. */
  singleRow?: boolean;
}

/**
 * Build menu grouped by the server-derived category. Items are never
 * disabled for cost (the server decides, D-027); each material shows the
 * island stock next to the cost (have/need) for information only. Items of
 * a tier that is not unlocked show the server's unmet unlock conditions;
 * houses of later tiers are reached by upgrading only and not listed.
 * Fertility and deposit requirements are shown with a lookup of the
 * island's static data.
 */
export function BuildMenu({ content, model, islandId, fertilities, tool, onSelect, onDemolishTool, compact = false, singleRow = false }: Props) {
  const [category, setCategory] = useState<ContentBuilding["category"]>("houses");
  if (!content) return null;
  const listed = content.buildings.filter((b) => listedInBuildMenu(b, content));
  const present = CATEGORIES.filter((c) => listed.some((b) => b.category === c.id));
  const inventory = model?.islands.find((is) => is.id === islandId)?.inventory ?? {};
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const activeId = tool.kind === "build" ? tool.buildingType : tool.kind === "road" ? tool.roadType : null;

  return (
    <div
      className={`${styles.buildMenu} ${compact ? styles.buildMenuCompact : ""} ${singleRow ? styles.buildMenuRow : ""}`}
      data-testid="build-menu"
    >
      <div className={styles.tabs} role="group" aria-label="Build categories">
        {present.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === category}
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
          aria-pressed={tool.kind === "demolish"}
          data-testid="tool-demolish"
        >
          ⚒ Demolish
        </button>
      </div>
      <div className={styles.items}>
        {listed
          .filter((b) => b.category === category)
          .map((b) => {
            const locked = !tierUnlocked(model, b.tier);
            const fertility = fertilityNeed(b, fertilities);
            return (
              <button
                key={b.id}
                type="button"
                className={`${styles.item} ${activeId === b.id ? styles.itemActive : ""}`}
                disabled={locked}
                aria-pressed={activeId === b.id}
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
                {fertility && (
                  <span
                    className={`${styles.small} ${fertility.present ? styles.ok : styles.lock}`}
                    data-testid={`build-fertility-${b.id}`}
                  >
                    {fertility.present ? `✓ ${fertility.fertility} fertility` : missingFertilityText(fertility.fertility, fertilities)}
                  </span>
                )}
                {b.requires_deposit && (
                  <span className={styles.small} data-testid={`build-deposit-${b.id}`}>
                    Must cover a {b.requires_deposit} deposit
                  </span>
                )}
                {locked && (
                  <span className={styles.lock} data-testid={`build-lock-${b.id}`}>
                    {lockReason(model, content, b.tier)}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
