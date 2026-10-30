import { useState } from "react";
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { t } from "../i18n";
import { footprintText } from "../display/fields";
import { perMin, units } from "../display/format";
import { depositText, fertilityName, fertilityNeed, listedInBuildMenu, lockReason, missingFertilityText, tierUnlocked } from "../display/tiers";
import { categoryIcon, goodIcon, toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
import type { Tool } from "./tools";

const CATEGORIES: ContentBuilding["category"][] = ["houses", "production", "public", "harbour", "roads", "other"];

interface Props {
  content: Content | null;
  model: DisplayState | null;
  /** The island shown (materials are shown from its inventory). */
  islandId: string;
  /** Fertility tags of the island shown (static island data). */
  fertilities: readonly string[] | undefined;
  /** The island's full tiles are still loading: every card is locked ("Loading island…"). */
  loading?: boolean;
  tool: Tool;
  onSelect: (b: ContentBuilding) => void;
  onDemolishTool: () => void;
  /** Short landscape phones: the same menu with a tighter density (smaller cards and thumbnails). */
  dense?: boolean;
}

// i18n-ignore: Roman numerals are the same in every language
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Tier numeral (I, II, …) of a tier's position in the content tiers. */
/** URL of a content ID's build-card thumbnail: 128 px PNGs rendered by the asset build (assets/voxel, `make assets`). */
export function thumbUrl(id: string): string {
  return `/models/thumbs/${id}.png`;
}

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
export function BuildMenu({ content, model, islandId, fertilities, loading = false, tool, onSelect, onDemolishTool, dense = false }: Props) {
  const [category, setCategory] = useState<ContentBuilding["category"]>("houses");
  if (!content) return null;
  // Fields are not listed: they are added from their farm's panel (D-051 part 4).
  const listed = content.buildings.filter((b) => listedInBuildMenu(b, content));
  const present = CATEGORIES.filter((c) => listed.some((b) => b.category === c));
  // The first present category when the chosen one has no buildings.
  const shown = present.includes(category) ? category : (present[0] ?? category);
  const inventory = model?.islands.find((is) => is.id === islandId)?.inventory ?? {};
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const activeId = tool.kind === "build" ? tool.buildingType : tool.kind === "road" ? tool.roadType : null;

  return (
    <div className={`${styles.buildMenu} ${dense ? styles.buildMenuDense : ""}`} data-testid="build-menu">
      <div className={styles.tabBar}>
        <div className={styles.tabs} role="group" aria-label={t("build.categories")}>
          {present.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === shown}
              className={`${styles.tab} ${c === shown ? styles.tabActive : ""}`}
              onClick={() => setCategory(c)}
              data-testid={`build-tab-${c}`}
            >
              <Icon path={categoryIcon(c)} /> {t(`build.category.${c}`)}
            </button>
          ))}
        </div>
        <span className={styles.tabDivider} aria-hidden="true" />
        <button
          type="button"
          className={`${styles.toolButton} ${tool.kind === "demolish" ? styles.itemActive : ""}`}
          onClick={onDemolishTool}
          aria-pressed={tool.kind === "demolish"}
          aria-label={t("infoPanel.demolish")}
          title={t("infoPanel.demolish")}
          data-testid="tool-demolish"
        >
          <Icon path={toolIcon("demolish")} />
        </button>
      </div>
      <div className={styles.items}>
        {listed
          .filter((b) => b.category === shown)
          .map((b) => {
            const tierLocked = !tierUnlocked(model, b.tier);
            const locked = tierLocked || loading;
            const fertility = fertilityNeed(b, fertilities);
            const tierIndex = content.tiers.findIndex((x) => x.id === b.tier);
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
                  <span className={styles.tierBadge} title={t("build.tierTitle", { name: tierName, tier: tierIndex + 1 })}>
                    <span aria-hidden="true">{tierNumeral(tierIndex)}</span>
                    <span className={styles.srOnly}>, {tierName}</span>
                  </span>
                )}
                {/* The model's thumbnail from the asset build (decorative: the name is the label); hidden when it has none. */}
                <img
                  className={styles.itemThumb}
                  src={thumbUrl(b.id)}
                  alt=""
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    e.currentTarget.hidden = true;
                  }}
                />
                <span className={styles.itemName}>{b.name}</span>
                <span className={styles.small}>
                  {t("build.cost", { gold: units(b.cost.gold), upkeep: perMin(b.upkeep_per_min) })}
                </span>
                <span className={styles.small} data-testid={`build-size-${b.id}`}>
                  {footprintText(b, content)}
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
                    {fertility.present ? t("build.fertilityOk", { name: fertilityName(fertility.fertility) }) : missingFertilityText(fertility.fertility, fertilities)}
                  </span>
                )}
                {b.requires_deposit && (
                  <span className={styles.small} data-testid={`build-deposit-${b.id}`}>
                    {depositText(b.requires_deposit)}
                  </span>
                )}
                {locked && (
                  <span className={styles.lock} data-testid={`build-lock-${b.id}`}>
                    {loading ? t("build.loadingIsland") : lockReason(model, content, b.tier)}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
