import { useState } from "react";
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { buildMenuOrder } from "../display/fields";
import { perMin, units } from "../display/format";
import { fertilityNeed, listedInBuildMenu, lockReason, missingFertilityText, tierUnlocked } from "../display/tiers";
import { categoryIcon, goodIcon, toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
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

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Tier numeral (I, II, …) of a tier's position in the content tiers. */
export function tierNumeral(index: number): string {
  return ROMAN[index] ?? String(index + 1);
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
  // Fields are listed right after the farm that accepts them (D-049).
  const listed = buildMenuOrder(content.buildings).filter((b) => listedInBuildMenu(b, content));
  const present = CATEGORIES.filter((c) => listed.some((b) => b.category === c.id));
  // The first present category when the chosen one has no buildings.
  const shown = present.some((c) => c.id === category) ? category : (present[0]?.id ?? category);
  const inventory = model?.islands.find((is) => is.id === islandId)?.inventory ?? {};
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const activeId =
    tool.kind === "build" ? tool.buildingType : tool.kind === "road" ? tool.roadType : tool.kind === "field" ? tool.fieldType : null;

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
            aria-pressed={c.id === shown}
            className={`${styles.tab} ${c.id === shown ? styles.tabActive : ""}`}
            onClick={() => setCategory(c.id)}
            data-testid={`build-tab-${c.id}`}
          >
            <Icon path={categoryIcon(c.id)} /> {c.label}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.toolButton} ${tool.kind === "demolish" ? styles.itemActive : ""}`}
          onClick={onDemolishTool}
          aria-pressed={tool.kind === "demolish"}
          data-testid="tool-demolish"
        >
          <Icon path={toolIcon("demolish")} /> Demolish
        </button>
      </div>
      <div className={styles.items}>
        {listed
          .filter((b) => b.category === shown)
          .map((b) => {
            const locked = !tierUnlocked(model, b.tier);
            const fertility = fertilityNeed(b, fertilities);
            const tierIndex = content.tiers.findIndex((t) => t.id === b.tier);
            const tierName = content.tiers[tierIndex]?.name ?? b.tier;
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
                {tierIndex >= 0 && (
                  <span className={styles.tierBadge} title={`${tierName} (tier ${tierIndex + 1})`}>
                    <span aria-hidden="true">{tierNumeral(tierIndex)}</span>
                    <span className={styles.srOnly}>, {tierName}</span>
                  </span>
                )}
                <span className={styles.itemName}>{b.name}</span>
                <span className={styles.small}>
                  {units(b.cost.gold)} gold · upkeep {perMin(b.upkeep_per_min)}/min
                </span>
                {Object.entries(b.cost.materials).map(([good, need]) => (
                  <span key={good} className={`${styles.small} ${styles.withIcon}`}>
                    <Icon path={goodIcon(good)} />
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
