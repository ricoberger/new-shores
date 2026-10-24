import { type ReactNode, useEffect, useState } from "react";
import type { Content, DisplayState, Island } from "../api/client";
import { perMin, units } from "../display/format";
import { constructionGoods, islandResources, type TierRow, tierRows, worstNeedText } from "../display/hud";
import { needCategory, needLabel } from "../display/needs";
import { claimableCount } from "../display/quests";
import { goodIcon, needIcon, toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
import { ResourceBadges } from "./ResourceBadges";

interface Props {
  model: DisplayState | null;
  content: Content | null;
  /** The focused island (under the camera): the top bar shows it. */
  islandId: string;
  /** Its static data (fertilities, deposits, coast); undefined while loading. */
  statics: Island | undefined;
  /** Opens the focused island's card. */
  onOpenIsland: () => void;
  /** Opens or closes the Ships / Routes panels. */
  onShips: () => void;
  onRoutes: () => void;
  /** Opens or closes the quests panel. */
  onQuests: () => void;
  /** The account menu. */
  account?: ReactNode;
  /**
   * Touch layouts (phones, tablets): the island, its materials and the
   * population collapse into tap-to-expand chips; Ships and Routes scroll
   * between the pinned stats and quests/account (a second row on portrait
   * phones).
   */
  compact?: "portrait" | "landscape" | null;
}

type Chip = "island" | "materials" | "population";

/**
 * Top bar (UI.md §2, D-051 part 7): the focused island — its name with
 * resource badges (fertilities, deposits, free coast), its construction-
 * material stocks and per tier "employed / total" with the resident-
 * weighted satisfaction (tooltip: the worst unmet need) — then gold and
 * balance, Ships, Routes, quests and the account. There are no island
 * tabs: islands are reached through the minimap, the island card and the
 * Ships / Routes lists. Every number is a server number or a sum of them.
 */
export function TopBar({ model, content, islandId, statics, onOpenIsland, onShips, onRoutes, onQuests, account, compact = null }: Props) {
  const [open, setOpen] = useState<Chip | null>(null);
  const ready = model !== null;
  useEffect(() => {
    if (ready && performance.getEntriesByName("ns-hud-gold").length === 0) {
      performance.mark("ns-hud-gold");
    }
  }, [ready]);

  const island = model?.islands.find((is) => is.id === islandId) ?? model?.islands[0];
  const defs = new Map((content?.buildings ?? []).map((b) => [b.id, b]));
  const resources = island && statics && statics.id === island.id ? islandResources(statics, island, defs) : null;
  const goods = content ? constructionGoods(content) : [];
  const goodName = (id: string) => content?.goods.find((g) => g.id === id)?.name ?? id;
  // Tiers without residents on this island stay out of the bar (the first tier always shows on a settled island).
  const rows = island && content && island.settled ? tierRows(island, content, defs).filter((r, i) => i === 0 || r.total > 0 || r.employed > 0) : [];
  const balance = model?.balance_rate_per_min ?? 0;
  const claimable = claimableCount(model);
  const settled = island?.settled ?? false;
  const name = island ? island.name || island.id : "…";
  const toggle = (c: Chip) => setOpen((o) => (o === c ? null : c));

  const gold = (
    <div className={styles.stat}>
      <span className={styles.label}>Gold</span>
      <span className={styles.value} data-testid="hud-gold">
        {model ? units(model.gold) : "…"}
      </span>
    </div>
  );
  const balanceStat = (
    <div className={styles.stat}>
      <span className={styles.srOnly}>Balance per minute (taxes − upkeep)</span>
      <span className={balance < 0 ? styles.negative : styles.positive} aria-hidden="true">
        {balance < 0 ? "▼" : "▲"}
      </span>
      <span className={`${styles.value} ${balance < 0 ? styles.negative : styles.positive}`} data-testid="hud-balance">
        {perMin(balance, true)}/min
      </span>
    </div>
  );
  const material = (g: string) => {
    const inv = island?.inventory[g];
    const text = `${goodName(g)}: ${units(inv?.stock ?? 0)} of ${units(inv?.capacity ?? 0)}`;
    return (
      <span key={g} className={`${styles.stat} ${styles.material}`} title={text} data-testid={`hud-material-${g}`}>
        <Icon path={goodIcon(g)} />
        <span className={styles.srOnly}>{goodName(g)}</span>
        <span className={styles.value}>{units(inv?.stock ?? 0)}</span>
      </span>
    );
  };
  const satisfaction = (r: TierRow) =>
    r.satisfactionPermille === null ? null : (
      <span className={styles.satisfaction} data-testid={`hud-satisfaction-${r.tier}`}>
        <span className={styles.srOnly}>, satisfaction </span>
        {Math.round(r.satisfactionPermille / 10)} %
      </span>
    );
  /** A tier: "employed / total" and the satisfaction aggregate (the worst unmet need as tooltip, or inline in the popover). */
  const tierStat = (r: TierRow, inline = false) => {
    const worst = worstNeedText(r.worst, (n) => needLabel(content, n));
    const w = r.worst;
    return (
      <div className={`${styles.stat} ${styles.tierStat}`} key={r.tier} title={inline ? undefined : worst} data-testid={`hud-tier-${r.tier}`}>
        <span className={`${styles.label} ${styles.withIcon}`}>
          <Icon path={toolIcon("population")} />
          {r.name}
          <span className={styles.srOnly}> employed of residents</span>
        </span>
        <span className={styles.value} data-testid={`hud-population-${r.tier}`}>
          {units(r.employed)} / {units(r.total)}
        </span>
        {satisfaction(r)}
        {r.satisfactionPermille !== null && (
          <span className={inline ? styles.worstNeed : styles.srOnly} data-testid={`hud-worst-need-${r.tier}`}>
            {inline && w && <Icon path={needIcon(w, w.category ? needCategory(content, w.category).icon : undefined)} />}
            {worst}
          </span>
        )}
      </div>
    );
  };
  // Desktop: icon and count (the word for screen readers and as tooltip), the bar is full; touch: the word too.
  const word = (w: string) => (compact ? ` ${w} ` : <span className={styles.srOnly}>{w} </span>);
  const navButtons = (
    <>
      <button type="button" className={styles.hudButton} onClick={onShips} title="Ships" data-testid="hud-ships">
        <Icon path={toolIcon("ships")} />
        {word("Ships")}
        <span data-testid="hud-ship-count">{model?.ships.length ?? 0}</span>
      </button>
      <button type="button" className={styles.hudButton} onClick={onRoutes} title="Routes" data-testid="hud-routes">
        <Icon path={toolIcon("routes")} />
        {word("Routes")}
        {model?.routes.length ?? 0}
      </button>
    </>
  );
  const quests = (
    <button
      type="button"
      className={styles.hudButton}
      onClick={onQuests}
      aria-label={claimable > 0 ? `Quests, ${claimable} rewards to claim` : "Quests"}
      data-testid="hud-quests"
    >
      <Icon path={toolIcon("quests")} />
      {compact ? "" : " Quests"}
      {claimable > 0 && (
        <span className={styles.badge} data-testid="hud-quests-badge">
          {claimable}
        </span>
      )}
    </button>
  );
  const unsettledBadge = !settled && island && (
    <span className={styles.hudBadge} data-testid="hud-island-unsettled">
      unsettled
    </span>
  );

  if (compact) {
    const residents = rows.reduce((n, r) => n + r.total, 0);
    return (
      <div className={`${styles.topBar} ${styles.compactTop} ${compact === "portrait" ? styles.compactPortrait : ""}`}>
        <div className={styles.compactStats}>
          <div className={styles.populationChipWrap} data-testid="hud-island" data-island={island?.id ?? ""}>
            <button
              type="button"
              className={`${styles.hudButton} ${styles.islandChip} ${settled ? "" : styles.islandChipUnsettled}`}
              aria-expanded={open === "island"}
              onClick={() => toggle("island")}
              data-testid="hud-island-chip"
            >
              <span className={styles.islandChipName} data-testid="hud-island-name">
                {name}
              </span>
              <span className={styles.srOnly}>{settled ? "" : ", unsettled"}: resources</span>
            </button>
            {open === "island" && (
              <div className={`${styles.panel} ${styles.populationPopover}`} data-testid="hud-island-details">
                <div className={styles.row}>
                  <strong>{name}</strong>
                  {unsettledBadge}
                </div>
                {resources ? <ResourceBadges resources={resources} prefix="hud" /> : <span className={styles.small}>…</span>}
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    setOpen(null);
                    onOpenIsland();
                  }}
                  data-testid="hud-island-card"
                >
                  Island card
                </button>
              </div>
            )}
          </div>
          {gold}
          {balanceStat}
          <div className={styles.populationChipWrap}>
            <button
              type="button"
              className={styles.hudButton}
              aria-expanded={open === "population"}
              onClick={() => toggle("population")}
              data-testid="hud-population-chip"
            >
              <Icon path={toolIcon("population")} /> <span className={styles.srOnly}>Population </span>
              {units(residents)}
              <span className={styles.srOnly}> residents on {name}, per tier</span>
            </button>
            {open === "population" && (
              <div className={`${styles.panel} ${styles.populationPopover}`} data-testid="hud-population-list">
                {rows.map((r) => tierStat(r, true))}
              </div>
            )}
          </div>
        </div>
        <div className={styles.compactNav}>
          {settled && goods.length > 0 && (
            <div className={styles.populationChipWrap}>
              <button
                type="button"
                className={styles.hudButton}
                aria-expanded={open === "materials"}
                onClick={() => toggle("materials")}
                data-testid="hud-materials-chip"
              >
                <Icon path={goodIcon(goods[0] as string)} /> {units(island?.inventory[goods[0] as string]?.stock ?? 0)}
                {goods.length > 1 && <span aria-hidden="true"> +{goods.length - 1}</span>}
                <span className={styles.srOnly}> {goodName(goods[0] as string)}, construction materials on {name}</span>
              </button>
            </div>
          )}
          {navButtons}
        </div>
        <div className={styles.compactEnd}>
          {quests}
          {account}
        </div>
        {/* The materials list hangs from the bar (the nav row scrolls and would clip it). */}
        {open === "materials" && (
          <div className={`${styles.panel} ${styles.materialsPopover}`} data-testid="hud-materials-list">
            {goods.map((g) => (
              <div key={g} className={styles.stat}>
                <span className={styles.withIcon}>
                  <Icon path={goodIcon(g)} />
                  {goodName(g)}
                </span>
                <span className={styles.value}>
                  {units(island?.inventory[g]?.stock ?? 0)} / {units(island?.inventory[g]?.capacity ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.topBar}>
      <div className={styles.hudIsland} data-testid="hud-island" data-island={island?.id ?? ""}>
        <button type="button" className={styles.hudIslandName} onClick={onOpenIsland} title="Open the island card" data-testid="hud-island-name">
          {name}
        </button>
        {unsettledBadge}
        {resources && <ResourceBadges resources={resources} prefix="hud" short />}
      </div>
      {settled && (
        <div className={styles.materials} data-testid="hud-materials">
          {goods.map(material)}
        </div>
      )}
      {gold}
      {balanceStat}
      {rows.map((r) => tierStat(r))}
      {navButtons}
      <div className={styles.spacer} />
      {quests}
      <span className={styles.version} data-testid="hud-content-version">
        {content?.region.version ?? ""}
      </span>
      {account}
    </div>
  );
}
