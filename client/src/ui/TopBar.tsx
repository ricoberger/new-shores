import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Content, DisplayState, Island, IslandDisplay } from "../api/client";
import { perMin, units } from "../display/format";
import { constructionGoods, islandResources, type TierRow, tierRows, worstNeedText } from "../display/hud";
import { needCategory, needLabel } from "../display/needs";
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
  /** The account menu. */
  account?: ReactNode;
  /** Touch layouts (phones, tablets); portrait phones put the island on a second row. */
  compact?: "portrait" | "landscape" | null;
}

/**
 * A top-bar stat (icon and number only) with a details popup: it opens on
 * mouse hover and toggles on click or tap (one pinned popup at a time: a
 * press elsewhere or Escape closes it).
 */
function HudChip({ testId, label, trigger, children }: { testId: string; label: string; trigger: ReactNode; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setPinned(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [pinned]);
  const open = pinned || hover;
  return (
    <div
      ref={root}
      className={styles.hudChipWrap}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <button type="button" className={styles.hudStat} aria-expanded={open} onClick={() => setPinned((p) => !p)} data-testid={testId}>
        {trigger}
        <span className={styles.srOnly}>{label}</span>
      </button>
      {open && (
        <div className={`${styles.panel} ${styles.hudPopover}`} data-testid={`${testId}-details`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Gold popup: a title, the current gold and the balance per minute (▲ / ▼ and the number, coloured), each on one line. */
export function GoldDetails({ model }: { model: DisplayState | null }) {
  const balance = model?.balance_rate_per_min ?? 0;
  const tone = balance < 0 ? styles.negative : balance > 0 ? styles.positive : "";
  return (
    <>
      <strong>Gold</strong>
      <div className={`${styles.stat} ${styles.noWrap}`}>
        <span className={styles.label}>Current</span>
        <span className={styles.value} data-testid="hud-gold-current">
          {model ? units(model.gold) : "…"}
        </span>
      </div>
      <div className={`${styles.stat} ${styles.noWrap}`}>
        <span className={styles.label}>Balance</span>
        <span className={`${styles.value} ${tone}`} data-testid="hud-balance">
          {balance < 0 ? "▼ " : balance > 0 ? "▲ " : ""}
          {perMin(balance, true)}/min
        </span>
      </div>
    </>
  );
}

/** Population popup: per tier employed / total, the satisfaction, unfilled jobs (when residents fall short) and the worst unmet need. */
export function PopulationDetails({ rows, content, islandName }: { rows: TierRow[]; content: Content | null; islandName: string }) {
  if (rows.length === 0) return <span className={styles.small}>No residents on {islandName}.</span>;
  return (
    <>
      <strong>Population of {islandName}</strong>
      {rows.map((r) => {
        const worst = worstNeedText(r.worst, (n) => needLabel(content, n));
        const w = r.worst;
        return (
          <div className={`${styles.stat} ${styles.tierStat}`} key={r.tier} data-testid={`hud-tier-${r.tier}`}>
            <span className={`${styles.label} ${styles.withIcon}`}>
              <Icon path={toolIcon("population")} />
              {r.name}
              <span className={styles.srOnly}> employed of residents</span>
            </span>
            <span className={styles.value} data-testid={`hud-population-${r.tier}`}>
              {units(r.employed)} / {units(r.total)}
            </span>
            {r.satisfactionPermille !== null && (
              <span className={styles.satisfaction} data-testid={`hud-satisfaction-${r.tier}`}>
                <span className={styles.srOnly}>, satisfaction </span>
                {Math.round(r.satisfactionPermille / 10)} %
              </span>
            )}
            {r.short > 0 && (
              <span className={styles.shortOfWorkers} data-testid={`hud-short-${r.tier}`}>
                <Icon path={toolIcon("warnings")} />
                Short of workers: {units(r.short)} jobs unfilled ({units(r.required)} needed)
              </span>
            )}
            {r.satisfactionPermille !== null && (
              <span className={styles.worstNeed} data-testid={`hud-worst-need-${r.tier}`}>
                {w && <Icon path={needIcon(w, w.category ? needCategory(content, w.category).icon : undefined)} />}
                {worst}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Materials popup: a title, then stock / capacity per construction material. */
export function MaterialsDetails({ goods, island, goodName }: { goods: string[]; island: IslandDisplay | undefined; goodName: (id: string) => string }) {
  return (
    <>
      <strong>Construction materials</strong>
      {goods.map((g) => (
        <div key={g} className={`${styles.stat} ${styles.popupStat}`} data-testid={`hud-material-${g}-detail`}>
          <span className={`${styles.label} ${styles.withIcon}`}>
            <Icon path={goodIcon(g)} />
            {goodName(g)}
          </span>
          <span className={styles.value}>
            {units(island?.inventory[g]?.stock ?? 0)} / {units(island?.inventory[g]?.capacity ?? 0)}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * Top bar (UI.md §2): on the left gold and the residents of the focused
 * island, then its construction-material stocks — icons and numbers only,
 * details in popups; in the middle the focused island (name and resource
 * icons, one button that opens the island card); on the right the account
 * menu. There are no island tabs: islands are reached through the minimap,
 * the island card and the lists. Every number is a server number or a sum
 * of them.
 */
export function TopBar({ model, content, islandId, statics, onOpenIsland, account, compact = null }: Props) {
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
  // Tiers without residents or open jobs on this island stay out of the details (the first tier always shows on a settled island).
  const rows = island && content && island.settled ? tierRows(island, content, defs).filter((r, i) => i === 0 || r.total > 0 || r.employed > 0 || r.short > 0) : [];
  const residents = rows.reduce((n, r) => n + r.total, 0);
  const shortOfWorkers = rows.some((r) => r.short > 0);
  const balance = model?.balance_rate_per_min ?? 0;
  const settled = island?.settled ?? false;
  const name = island ? island.name || island.id : "…";

  return (
    <div className={`${styles.topBar} ${compact === "portrait" ? styles.topBarPortrait : ""}`}>
      <div className={styles.hudLeft}>
        <div className={styles.hudGroup}>
          <HudChip
            testId="hud-gold-chip"
            label="Gold"
            trigger={
              <>
                <Icon path={toolIcon("gold")} />
                <span className={`${styles.value} ${balance < 0 ? styles.negative : ""}`} data-testid="hud-gold">
                  {model ? units(model.gold) : "…"}
                </span>
              </>
            }
          >
            <GoldDetails model={model} />
          </HudChip>
          <HudChip
            testId="hud-population-chip"
            label={`Residents on ${name}`}
            trigger={
              <>
                <Icon path={toolIcon("population")} />
                <span className={`${styles.value} ${shortOfWorkers ? styles.negative : ""}`} data-testid="hud-population">
                  {units(residents)}
                </span>
              </>
            }
          >
            <PopulationDetails rows={rows} content={content} islandName={name} />
          </HudChip>
        </div>
        {settled && goods.length > 0 && (
          <div className={styles.hudGroup}>
            <HudChip
              testId="hud-materials-chip"
              label={`Construction materials on ${name}`}
              trigger={goods.map((g) => (
                <span key={g} className={styles.hudMaterial} data-testid={`hud-material-${g}`}>
                  <Icon path={goodIcon(g)} />
                  <span className={styles.value}>{units(island?.inventory[g]?.stock ?? 0)}</span>
                </span>
              ))}
            >
              <MaterialsDetails goods={goods} island={island} goodName={goodName} />
            </HudChip>
          </div>
        )}
      </div>
      <div className={styles.hudMiddle} data-testid="hud-island" data-island={island?.id ?? ""}>
        <button type="button" className={styles.hudIslandButton} onClick={onOpenIsland} title="Open the island card" data-testid="hud-island-name">
          <span className={styles.hudIslandName}>{name}</span>
          {resources && <ResourceBadges resources={resources} prefix="hud" short />}
        </button>
      </div>
      <div className={styles.hudRight}>{account}</div>
    </div>
  );
}
