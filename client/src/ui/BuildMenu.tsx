import { Fragment, useState } from "react";
import type { Content, ContentBuilding, DisplayState } from "../api/client";
import { t } from "../i18n";
import { buildCost, buildMenuGroups, buildTierTabs, defaultBuildTier, serviceNeedCategory } from "../display/buildMenu";
import { perMin, tons, units } from "../display/format";
import { depositName, fertilityName, fertilityNeed, lockReason } from "../display/tiers";
import { goodIcon, needIcon, resourceIcon, toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
import type { Tool } from "./tools";

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
  /** The tier tab opened first instead of the current one (screenshots, tests). */
  initialTier?: string;
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
 * Build menu: one tab per content tier (numeral and name; a locked tier is dimmed with its unmet unlock
 * conditions as subtitle, and can be opened to look ahead), inside a tab the cards in groups General,
 * Production (along the chains), Public and Harbour. Items are never disabled for cost (the server decides,
 * D-027): cost parts the player cannot cover right now are only shown red. Items of a tier that is not
 * unlocked are dimmed with the server's unmet unlock conditions; houses of later tiers are reached by
 * upgrading only and not listed. Fertility requirements are shown with a lookup of the island's static data.
 */
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function BuildMenu({ content, model, islandId, fertilities, loading = false, tool, onSelect, onDemolishTool, dense = false, initialTier }: Props) {
  const [chosen, setChosen] = useState<string | null>(initialTier ?? null);
  if (!content) return null;
  const tabs = buildTierTabs(model, content);
  // The current tier unless the player opened another one (or the chosen one is gone).
  const shown = tabs.find((tab) => tab.id === chosen)?.id ?? defaultBuildTier(tabs);
  const island = model?.islands.find((is) => is.id === islandId);
  const stock = (good: string) => island?.inventory[good]?.stock ?? 0;
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const activeId = tool.kind === "build" ? tool.buildingType : tool.kind === "road" ? tool.roadType : null;
  const lockText = (b: ContentBuilding) => (loading ? t("build.loadingIsland") : (lockReason(model, content, b.tier) ?? ""));
  const goodChip = (good: string, key: string, extra?: string) => (
    <span key={key} className={`${styles.withIcon} ${extra ?? ""}`} title={goodName(good)}>
      <Icon path={goodIcon(good)} />
      {goodName(good)}
    </span>
  );

  return (
    <div className={`${styles.buildMenu} ${dense ? styles.buildMenuDense : ""}`} data-testid="build-menu">
      <div className={styles.tabBar}>
        <div className={styles.tabs} role="group" aria-label={t("build.tiers")}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={tab.id === shown}
              className={`${styles.tab} ${tab.id === shown ? styles.tabActive : ""} ${tab.unlocked ? "" : styles.tabLocked}`}
              onClick={() => setChosen(tab.id)}
              title={tab.unlocked ? undefined : (lockReason(model, content, tab.id) ?? undefined)}
              data-testid={`build-tab-${tab.id}`}
            >
              <span className={styles.tabTitle}>
                <span className={styles.tabNumeral} aria-hidden="true">
                  {tierNumeral(tab.index)}
                </span>{" "}
                {tab.name}
              </span>
              {tab.subtitle && (
                <span className={styles.tabSub} data-testid={`build-tab-sub-${tab.id}`}>
                  {tab.subtitle}
                </span>
              )}
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
        {shown &&
          buildMenuGroups(content, shown).map((run) => (
            <div key={run.group} className={styles.buildGroup} data-testid={`build-group-${run.group}`}>
              <div className={styles.groupLabel}>{t(`build.group.${run.group}`)}</div>
              <div className={styles.groupItems}>
                {run.items.map((b) => {
                  const locked = !tabs.find((tab) => tab.id === b.tier)?.unlocked || loading;
                  const fertility = fertilityNeed(b, fertilities);
                  const cost = buildCost(b, model?.gold ?? 0, stock);
                  const needCategory = b.service ? serviceNeedCategory(content, b) : undefined;
                  const fieldDef = b.fields ? content.buildings.find((x) => x.id === b.fields?.type) : undefined;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`${styles.item} ${activeId === b.id ? styles.itemActive : ""}`}
                      disabled={locked}
                      aria-pressed={activeId === b.id}
                      onClick={() => onSelect(b)}
                      data-testid={`build-${b.id}`}
                      title={b.description}
                    >
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
                      <span className={`${styles.small} ${styles.cardLine}`} data-testid={`build-cost-${b.id}`}>
                        <span className={cost.gold.short ? styles.warn : undefined} data-short={cost.gold.short || undefined}>
                          {t("build.goldCost", { amount: units(cost.gold.amount) })}
                        </span>
                        {cost.materials.map((m) => (
                          <Fragment key={m.good}>
                            <span aria-hidden="true">·</span>
                            <span className={`${styles.withIcon} ${m.short ? styles.warn : ""}`} data-short={m.short || undefined} title={goodName(m.good)}>
                              <Icon path={goodIcon(m.good)} />
                              {tons(m.amount)}
                            </span>
                          </Fragment>
                        ))}
                      </span>
                      {fertility && !fertility.present ? (
                        <span className={`${styles.small} ${styles.warn} ${styles.cardLine}`} data-testid={`build-fertility-${b.id}`}>
                          {t("build.needsFertility", { fertility: fertilityName(fertility.fertility) })}
                        </span>
                      ) : (
                        <span className={`${styles.small} ${styles.cardLine}`} data-testid={`build-info-${b.id}`}>
                          <span>{t("infoPanel.upkeepRate", { rate: perMin(b.upkeep_per_min) })}</span>
                          {(b.recipe || b.service) && <span aria-hidden="true">·</span>}
                          {b.recipe && (
                            <span className={styles.flow}>
                              {b.requires_deposit && (
                                <span className={styles.withIcon} data-testid={`build-deposit-${b.id}`}>
                                  <Icon path={resourceIcon("deposit", b.requires_deposit)} />
                                  {t("almanac.chain.deposit", { name: cap(depositName(b.requires_deposit)) })}
                                </span>
                              )}
                              {b.fields && b.fields.required > 0 ? (
                                <span>{fieldDef?.name ?? b.fields.type}</span>
                              ) : (
                                b.recipe.inputs.map((i, n, all) => (
                                  <span key={`in-${i.good}`}>
                                    {goodChip(i.good, `in-${i.good}`)}
                                    {n < all.length - 1 && ","}
                                  </span>
                                ))
                              )}
                              <span aria-hidden="true">→</span>
                              {b.recipe.outputs.map((o) => goodChip(o.good, `out-${o.good}`))}
                            </span>
                          )}
                          {b.service && (
                            <span className={styles.flow}>
                              {needCategory && (
                                <span className={styles.withIcon}>
                                  <Icon path={needIcon({ category: needCategory.id }, needCategory.icon)} />
                                  {needCategory.name}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                      {/* The note row (always there, so every card is equally high): why the tier is locked. */}
                      {locked ? (
                        <span className={`${styles.lock} ${styles.cardNote}`} data-testid={`build-lock-${b.id}`}>
                          {lockText(b)}
                        </span>
                      ) : (
                        <span className={styles.cardNote} aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
