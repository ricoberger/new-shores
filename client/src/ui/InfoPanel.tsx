import { type ReactNode, useRef } from "react";
import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { percent, perMin, seconds, speedFactor, units } from "../display/format";
import { countdownWithUnit, orderTiming, shipName as shipNameOf } from "../display/ships";
import { fieldBuildingOf, footprintText } from "../display/fields";
import { needAlternatives, needCategory, needLabel, orderNeeds, upgradeReasonText } from "../display/needs";
import { lockReason, tierUnlocked } from "../display/tiers";
import { STATUS_STYLES, statusKey, statusText } from "../display/status";
import { goodIcon, needIcon, statusIcon, toolIcon } from "../theme/iconSet";
import { CloseButton } from "./CloseButton";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

interface Props {
  building: BuildingDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  onClose: () => void;
  onSetPaused: (paused: boolean) => void;
  onDemolish: () => void;
  /** Lifts the building into a move ghost (D-042). */
  onMove: () => void;
  onUpgrade: () => void;
  /** Raises a Trading Post, Warehouse or levelled public building to its next level (upgrade_building, D-056). */
  onUpgradeBuilding: () => void;
  onSelectBuilding: (id: number) => void;
  /**
   * Activates the field tool bound to this farm for a field building (its
   * "Paint" button, D-051 part 4, D-054); `remove`: in its "Remove fields"
   * mode (a right click or long press on the button).
   */
  onAddField: (fieldType: string, remove?: boolean) => void;
  /** A fields-list row is hovered or focused (its building ID; null: none): the scene outlines it. */
  /** Server time the model was extrapolated to (ms since the epoch). */
  nowMs: number;
  onOrderShip: (shipType: string) => void;
  onCancelShipOrder: () => void;
}

const NEED_REASONS: Record<string, string> = {
  ok: "",
  short_supply: "short supply",
  no_supply: "no supply on the island",
  out_of_range: "out of range",
  not_connected: "not connected",
  paused: "paused",
};

/** Small items on one centred row with a dot between them (the gap is the layout's, not a space glyph). */
function DotRow({ items, testId }: { items: ReactNode[]; testId?: string }) {
  return (
    <div className={`${styles.small} ${styles.costLine}`} data-testid={testId}>
      {items.flatMap((item, i) => (i === 0 ? [item] : [<span key={`dot${i}`}>·</span>, item]))}
    </div>
  );
}

/** Colour of a signed net rate as shown: green above 0, red below, plain for "0.0" (a rate that rounds to 0.0 too). */
function netClass(label: string): string | undefined {
  if (label.startsWith("+")) return styles.positive;
  if (label.startsWith("−") || label.startsWith("-")) return styles.negative;
  return undefined;
}

/** A good's icon and name (the icon is decorative; the name is the text). */
export function GoodName({ id, name }: { id: string; name: string }) {
  return (
    <span className={styles.withIcon}>
      <Icon path={goodIcon(id)} />
      {name}
    </span>
  );
}

/** The status as a wax-seal badge: the status colour with its icon (never colour alone, UI.md §7). */
export function StatusIcon({ building, seal = false }: { building: BuildingDisplay; seal?: boolean }) {
  const key = statusKey(building);
  const s = STATUS_STYLES[key];
  return (
    <span className={seal ? `${styles.icon} ${styles.seal}` : styles.icon} style={{ background: s.color }} title={s.label} role="img" aria-label={s.label}>
      <Icon path={statusIcon(key)} />
    </span>
  );
}

/** The building's size row of a Details table (D-054: footprint, water rows, a farm's fields). */
function SizeRow({ def, content }: { def: Content["buildings"][number]; content: Content }) {
  return (
    <tr>
      <td>Size</td>
      <td data-testid="info-size">{footprintText(def, content)}</td>
    </tr>
  );
}

/** How long a press on Paint lasts before it means "Remove fields" (the map's long press, render/gestures.ts). */
const PAINT_LONG_PRESS_MS = 450;

/**
 * A farm's "Paint <field>" button (D-054): a click enters the field tool;
 * a right click or a long press enters its "Remove fields" mode.
 */
function PaintButton({ field, full, onPaint }: { field: Content["buildings"][number]; full: boolean; onPaint: (remove: boolean) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const name = field.name.toLowerCase();
  return (
    <>
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.button}
          title="Right click or long press: remove fields"
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            onPaint(false);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            clear();
            onPaint(true);
          }}
          onPointerDown={(e) => {
            longPressed.current = false;
            if (e.button !== 0) return;
            clear();
            timer.current = setTimeout(() => {
              longPressed.current = true;
              onPaint(true);
            }, PAINT_LONG_PRESS_MS);
          }}
          onPointerUp={clear}
          onPointerLeave={clear}
          onPointerCancel={clear}
          data-testid="farm-add-field"
        >
          Paint {name}
          {field.cost.gold > 0 && !full ? ` (${units(field.cost.gold)} gold each)` : ""}
        </button>
      </div>
      <div className={styles.small} data-testid="farm-remove-hint">
        Right click or long press Paint to remove fields
      </div>
    </>
  );
}

interface LevelDef {
  capacity?: number;
  berths?: number;
  throughput_per_min?: number;
  /** Service radius of a levelled public building (D-056). */
  radius?: number;
  /** Tier the upgrade into this level needs (D-056). */
  tier?: string;
  cost?: { gold: number; materials: Record<string, number> };
}

/** The next level of a Trading Post, Warehouse or levelled public building (content), undefined at the last level. */
function nextLevelOf(content: Content, b: BuildingDisplay): LevelDef | undefined {
  const def = content.buildings.find((d) => d.id === b.type);
  const levels: LevelDef[] = def?.trading_post?.levels ?? def?.warehouse?.levels ?? def?.service?.levels ?? [];
  return b.level !== undefined ? levels[b.level] : undefined;
}

/** What the next level brings and costs (the Upgrade button itself is in the footer). */
/** The short line under a disabled house Upgrade button, from the server's reason code; display only (the gate is the server's). */
const UPGRADE_HINTS: Record<string, string> = {
  not_full: "House not full",
  no_house: "No higher tier",
};

function upgradeHint(content: Content, model: DisplayState, island: IslandDisplay, b: BuildingDisplay, reason: string): string {
  const [code, category, percent] = reason.split(":") as [string, string | undefined, string | undefined];
  const tiers = content.tiers;
  const next = tiers[(tiers.find((t) => t.house === b.type)?.index ?? -2) + 1];
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  switch (code) {
    case "tier_locked":
      return next ? `${next.name} not unlocked` : "Next tier not unlocked";
    case "needs_below_threshold":
      return category ? `Needs ${needCategory(content, category).name.toLowerCase()}${percent ? ` ≥ ${percent} %` : ""}` : "Needs not supplied";
    case "cannot_afford": {
      // What the next house still costs beyond the gold and the island's stock, as the extrapolated display shows them.
      const cost = content.buildings.find((x) => x.id === next?.house)?.cost;
      const short: string[] = [];
      if (cost && cost.gold > model.gold) short.push(`${Math.ceil((cost.gold - model.gold) / 1000)} gold`);
      for (const [g, n] of Object.entries(cost?.materials ?? {})) {
        const have = island.inventory[g]?.stock ?? 0;
        if (n > have) short.push(`${Math.ceil((n - have) / 1000)} ${goodName(g).toLowerCase()}`);
      }
      return short.length > 0 ? `Costs ${short.join(", ")} more` : "Not enough gold or materials";
    }
    default:
      return UPGRADE_HINTS[code] ?? upgradeReasonText(content, reason);
  }
}

function UpgradePreview({
  building: b,
  island,
  model,
  content,
  testId = "warehouse-upgrade",
}: {
  building: BuildingDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  /** Test ID prefix of the section and its cost. */
  testId?: string;
}) {
  const next = nextLevelOf(content, b);
  if (!next) return null;
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const cost = next.cost ?? { gold: 0, materials: {} };
  return (
    <div className={styles.section} data-testid={testId}>
      <div className={styles.sectionTitle}>Upgrade to level {(b.level ?? 0) + 1}</div>
      <DotRow
        testId={`${testId}-stats`}
        items={[
          ...(next.capacity !== undefined ? [<span key="capacity">{units(next.capacity)} capacity per good</span>] : []),
          ...(next.berths !== undefined ? [<span key="berths">{next.berths} berths</span>] : []),
          ...(next.throughput_per_min !== undefined ? [<span key="throughput">{perMin(next.throughput_per_min)}/min throughput</span>] : []),
          ...(next.radius !== undefined ? [<span key="radius">{next.radius} tiles radius</span>] : []),
        ]}
      />
      {next.tier && !tierUnlocked(model, next.tier) && (
        <div className={`${styles.small} ${styles.warn}`} data-testid={`${testId}-locked`}>
          {lockReason(model, content, next.tier)}
        </div>
      )}
      {/* The content's upgrade cost; a part the balance or the island's stock does not cover is red (the server decides). */}
      <DotRow
        testId={`${testId}-cost`}
        items={[
          <span
            key="gold"
            className={cost.gold > model.gold ? styles.warn : undefined}
            data-short={cost.gold > model.gold || undefined}
            title={`${units(model.gold)} gold on hand`}
          >
            {units(cost.gold)} gold
          </span>,
          ...Object.entries(cost.materials).map(([g, n]) => {
            const have = island.inventory[g]?.stock ?? 0;
            return (
              <span
                key={g}
                className={`${styles.withIcon} ${have < n ? styles.warn : ""}`}
                data-short={have < n || undefined}
                data-testid={`${testId}-cost-${g}`}
                title={`${units(have)} in stock`}
              >
                {units(n)}
                <Icon path={goodIcon(g)} />
                {goodName(g)}
              </span>
            );
          }),
        ]}
      />
    </div>
  );
}

function AssignedProducers({
  building: b,
  island,
  content,
  onSelectBuilding,
}: {
  building: BuildingDisplay;
  island: IslandDisplay;
  content: Content;
  onSelectBuilding: (id: number) => void;
}) {
  const producers = island.buildings.filter((p) => p.assigned_warehouse_id === b.id && p.rates !== undefined);
  const name = (type: string) => content.buildings.find((d) => d.id === type)?.name ?? type;
  return (
    <details className={styles.section} data-testid="collector-producers">
      <summary className={styles.detailsSummary}>Producers ({producers.length})</summary>
      {producers.length === 0 && <div className={styles.small}>None yet</div>}
      {producers.slice(0, 8).map((p) => (
        <div key={p.id}>
          <button type="button" className={styles.link} onClick={() => onSelectBuilding(p.id)} data-testid={`collector-producer-${p.id}`}>
            {name(p.type)}
          </button>
        </div>
      ))}
      {producers.length > 8 && <div className={styles.small}>and {producers.length - 8} more</div>}
    </details>
  );
}

/**
 * The Trading Post (D-051): level, the island's capacity, its collector
 * throughput and load, the pier's berths busy and free with the ships at
 * them and the queue (MECHANICS §9.3), the upgrade and the island's
 * inventory. Display numbers only.
 */
function TradingPostSection({
  building: b,
  island,
  model,
  content,
  levels,
  onSelectBuilding,
}: {
  building: BuildingDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  levels: number;
  onSelectBuilding: (id: number) => void;
}) {
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const shipName = (id: number) => shipNameOf(model.ships, id);
  const def = content.buildings.find((d) => d.id === b.type);
  // The berths of the level (content) until the server reports them.
  const levelBerths = def?.trading_post?.levels[(b.level ?? 1) - 1]?.berths ?? 0;
  const berths = b.berths ?? { total: levelBerths, busy: 0, ships: [], queue: [] };
  const free = Math.max(0, berths.total - berths.busy);
  return (
    <div data-testid="trading-post-panel">
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Details</div>
        <table className={styles.table}>
          <tbody>
            <tr>
              <td>Level</td>
              <td data-testid="trading-post-level">
                {b.level} / {levels}
              </td>
            </tr>
            <tr>
              <td>Capacity</td>
              <td data-testid="trading-post-capacity">{units(b.capacity ?? 0)} per good</td>
            </tr>
            <tr>
              <td>Throughput</td>
              <td>{perMin(b.throughput_per_min ?? 0)}/min</td>
            </tr>
            <tr>
              <td>Load</td>
              <td>{percent(b.load_permille ?? 0)}</td>
            </tr>
            <tr>
              <td>Berths</td>
              <td data-testid="trading-post-berths">
                {free} / {berths.total} free
              </td>
            </tr>
            {def && <SizeRow def={def} content={content} />}
          </tbody>
        </table>
      </div>
      {(berths.ships.length > 0 || berths.queue.length > 0) && (
        <div className={styles.section} data-testid="trading-post-pier">
          <div className={styles.sectionTitle}>Pier</div>
          <table className={styles.table}>
            <tbody>
              {berths.ships.map((id) => (
                <tr key={id}>
                  <td>{shipName(id)}</td>
                  <td>at the pier</td>
                </tr>
              ))}
              {berths.queue.map((id) => (
                <tr key={id}>
                  <td>{shipName(id)}</td>
                  <td>waiting</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.section} data-testid="trading-post-inventory">
        <div className={styles.sectionTitle}>Inventory</div>
        <table className={styles.table}>
          <tbody>
            {Object.entries(island.inventory).map(([good, g]) => (
              <tr key={good}>
                <td>
                  <GoodName id={good} name={goodName(good)} />
                </td>
                <td>
                  {units(g.stock)} / {units(g.capacity)}
                </td>
                <td className={netClass(perMin(g.rate_per_min, true))} data-testid={`trading-post-net-${good}`}>
                  {perMin(g.rate_per_min, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AssignedProducers building={b} island={island} content={content} onSelectBuilding={onSelectBuilding} />
      <UpgradePreview building={b} island={island} model={model} content={content} testId="trading-post-upgrade" />
    </div>
  );
}

export function InfoPanel({
  building: b,
  island,
  model,
  content,
  onSetPaused,
  onDemolish,
  onMove,
  onUpgrade,
  onUpgradeBuilding,
  onSelectBuilding,
  onAddField,
  nowMs,
  onOrderShip,
  onCancelShipOrder,
  onClose,
}: Props) {
  const def = content.buildings.find((d) => d.id === b.type);
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const base = statusText(b, island, model, content);
  // A field does nothing but count for its farm: say that instead of "Running" (an inactive one keeps its own sentence and fix).
  const order = def?.shipyard ? b.ship_order : undefined;
  const shipyardSentence = order
    ? `Building a ${content.ships.find((t) => t.id === order.type)?.name ?? order.type} · ready in ${countdownWithUnit(orderTiming(order, nowMs).remainingMs)}`
    : "Idle";
  const status =
    def?.field && base.key === "ok"
      ? { ...base, sentence: "Counts for its farm" }
      : def?.shipyard && base.key === "ok"
        ? { ...base, sentence: shipyardSentence, fix: order ? "Cancelling the order returns 50 % of the materials." : undefined }
        : base;
  const canPause = def?.pause_category !== "never";
  const warehouse = b.assigned_warehouse_id ? island.buildings.find((w) => w.id === b.assigned_warehouse_id) : undefined;
  const warehouseName = warehouse ? (content.buildings.find((d) => d.id === warehouse.type)?.name ?? warehouse.type) : "";

  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="info-panel">
      <div className={styles.row}>
        <h2 className={styles.title} data-testid="info-name">
          {def?.name ?? b.type}
        </h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="info-close" />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.statusRow}>
          <StatusIcon building={b} seal />
          <div>
            <div data-testid="info-status">{status.sentence}</div>
            {status.fix && <div className={styles.fix}>{status.fix}</div>}
          </div>
        </div>

        {b.fields && def?.fields && (() => {
          // Placed of the maximum (= required), fields cut off from the farm, and the Paint button (right click / long press: Remove fields).
          const field = fieldBuildingOf(content, b.type);
          const placed = b.fields.ids.length;
          const inactive = placed - b.fields.active;
          return (
            <div className={styles.section} data-testid="farm-fields">
              <div className={styles.small} data-testid="farm-fields-count">
                {placed} / {b.fields.max} placed
              </div>
              {inactive > 0 && (
                <div className={`${styles.small} ${styles.warn}`} data-testid="farm-fields-inactive">
                  {inactive} not connected to the farm
                </div>
              )}
              {field && <PaintButton field={field} full={placed >= b.fields.max} onPaint={(remove) => onAddField(field.id, remove)} />}
            </div>
          );
        })()}

        {b.rates && (
          <>
            {Object.keys(b.rates.inputs).length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Inputs</div>
                <table className={styles.table}>
                  <tbody>
                    {Object.entries(b.rates.inputs).map(([good, rate]) => (
                      <tr key={good}>
                        <td>
                          <GoodName id={good} name={goodName(good)} />
                        </td>
                        <td data-testid={`rate-input-${good}`}>{perMin(rate)}/min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Output</div>
              <table className={styles.table}>
                <tbody>
                  {Object.entries(b.rates.outputs).map(([good, rate]) => (
                    <tr key={good}>
                      <td>
                        <GoodName id={good} name={goodName(good)} />
                      </td>
                      <td data-testid={`rate-output-${good}`}>{perMin(rate)}/min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className={styles.section} data-testid="info-details">
              <summary className={styles.detailsSummary}>Details</summary>
              <table className={`${styles.table} ${styles.detailsTable}`}>
                <tbody>
                  {def && <SizeRow def={def} content={content} />}
                  {b.cycle_seconds !== undefined && (
                    <tr>
                      <td>Cycle</td>
                      <td data-testid="info-cycle">{b.cycle_seconds} s</td>
                    </tr>
                  )}
                  <tr>
                    <td>Efficiency</td>
                    <td>{percent(b.efficiency_permille)}</td>
                  </tr>
                  <tr>
                    <td>Throughput factor</td>
                    <td>{percent(b.throughput_factor_permille)}</td>
                  </tr>
                  {b.workforce && (
                    <tr>
                      <td>Workers</td>
                      <td>
                        <span data-testid="info-workforce">{percent(b.workforce_factor_permille ?? 1000)}</span>
                      </td>
                    </tr>
                  )}
                  {def && (
                    <tr>
                      <td>Upkeep</td>
                      <td data-testid="info-upkeep">{perMin(b.paused ? 0 : def.upkeep_per_min)} $/min</td>
                    </tr>
                  )}
                  <tr>
                    <td>Delivers to</td>
                    <td>
                      {warehouse ? (
                        <button type="button" className={styles.link} onClick={() => onSelectBuilding(warehouse.id)}>
                          {warehouseName}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  {warehouse && (
                    <tr>
                      <td>Transfer delay</td>
                      <td>{seconds(b.transfer_delay_ms ?? 0)}</td>
                    </tr>
                  )}
                  {b.buffer &&
                    Object.entries(b.buffer.stock).map(([good, stock]) => (
                      <tr key={good}>
                        <td>
                          Buffer <GoodName id={good} name={goodName(good)} />
                        </td>
                        <td>
                          {units(stock)}/{units(b.buffer?.capacity ?? 0)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </>
        )}

        {def?.service && (
          <details className={styles.section} data-testid="info-details">
            <summary className={styles.detailsSummary}>Details</summary>
            <table className={`${styles.table} ${styles.detailsTable}`}>
              <tbody>
                {def.service.levels.length > 1 && (
                  <tr>
                    <td>Level</td>
                    <td data-testid="service-level">
                      {b.level ?? 1} / {def.service.levels.length}
                    </td>
                  </tr>
                )}
                <tr>
                  <td>Radius</td>
                  <td data-testid="info-radius">{def.service.levels[(b.level ?? 1) - 1]?.radius ?? def.service.radius} tiles</td>
                </tr>
                <SizeRow def={def} content={content} />
                <tr>
                  <td>Upkeep</td>
                  <td data-testid="info-upkeep">{perMin(b.paused ? 0 : def.upkeep_per_min)} $/min</td>
                </tr>
              </tbody>
            </table>
          </details>
        )}
        {def?.service && b.level !== undefined && <UpgradePreview building={b} island={island} model={model} content={content} testId="service-upgrade" />}

        {b.residents !== undefined && (
          <>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Residents</div>
              <table className={styles.table}>
                <tbody>
                  <tr>
                    <td>Residents</td>
                    <td data-testid="house-residents">
                      {(b.growth_rate_per_min ?? 0) > 0 ? "↑" : (b.growth_rate_per_min ?? 0) < 0 ? "↓" : "→"} {units(b.residents)} / {units(b.residents_max ?? 0)}
                    </td>
                  </tr>
                  <tr>
                    <td>Satisfaction</td>
                    <td data-testid="house-satisfaction">{percent(b.satisfaction_permille ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Needs</div>
              <table className={styles.table}>
                <tbody>
                  {orderNeeds(content, b.needs ?? []).map((n) => (
                    <tr
                      key={n.id}
                      data-testid={`house-need-${n.id}`}
                      title={[needAlternatives(content, n.id), NEED_REASONS[n.reason]].filter(Boolean).join(" — ") || undefined}
                    >
                      <td>
                        <span className={styles.withIcon}>
                          <Icon path={needIcon(n, n.category ? needCategory(content, n.category).icon : undefined)} />
                          {needLabel(content, n)}
                        </span>
                      </td>
                      <td>{percent(n.fulfilment_permille)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {def?.shipyard && (
          <div className={styles.section} data-testid="shipyard">
            {def.shipyard.ships.map((id) => {
              const t = content.ships.find((x) => x.id === id);
              if (!t) return null;
              const stock = (g: string) => island.inventory[g]?.stock ?? 0;
              return (
                <div key={id} className={styles.shipEntry} data-testid={`shipyard-ship-${id}`}>
                  <div className={styles.row}>
                    <strong>{t.name}</strong>
                    <div className={styles.spacer} />
                    <button type="button" className={styles.button} onClick={() => onOrderShip(id)} disabled={!!order} data-testid={`shipyard-order-${id}`}>
                      Order
                    </button>
                  </div>
                  <DotRow
                    items={[
                      <span key="cargo">
                        {t.slots}×{units(t.slot_size)} cargo
                      </span>,
                      <span key="speed">{speedFactor(t.speed_permille ?? 1000)}× speed</span>,
                      <span key="upkeep">{perMin(t.upkeep_per_min)} $/min upkeep</span>,
                    ]}
                  />
                  <DotRow
                    testId={`shipyard-cost-${id}`}
                    items={[
                      <span key="gold" className={t.cost.gold > model.gold ? styles.warn : undefined} title={`${units(model.gold)} gold available`}>
                        {units(t.cost.gold)} gold
                      </span>,
                      ...Object.entries(t.cost.materials).map(([g, n]) => (
                        <span key={g} className={`${styles.withIcon} ${stock(g) < n ? styles.warn : ""}`} title={`${units(stock(g))} in stock`}>
                          {units(n)}
                          <Icon path={goodIcon(g)} />
                          {goodName(g)}
                        </span>
                      )),
                      <span key="build">{countdownWithUnit(t.build_ms)} build</span>,
                    ]}
                  />
                </div>
              );
            })}
          </div>
        )}

        {b.level !== undefined && def?.trading_post && (
          <TradingPostSection building={b} island={island} model={model} content={content} levels={def.trading_post.levels.length}
            onSelectBuilding={onSelectBuilding}
          />
        )}
        {b.level !== undefined && def?.warehouse && (
          <div data-testid="warehouse-panel">
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Details</div>
              <table className={styles.table}>
                <tbody>
                  <tr>
                    <td>Level</td>
                    <td data-testid="warehouse-level">
                      {b.level} / {def.warehouse.levels.length}
                    </td>
                  </tr>
                  <tr>
                    <td>Throughput</td>
                    <td data-testid="warehouse-throughput">{perMin(b.throughput_per_min ?? 0)}/min</td>
                  </tr>
                  <tr>
                    <td>Load</td>
                    <td data-testid="warehouse-load">{percent(b.load_permille ?? 0)}</td>
                  </tr>
                  <SizeRow def={def} content={content} />
                </tbody>
              </table>
            </div>
            <AssignedProducers building={b} island={island} content={content} onSelectBuilding={onSelectBuilding} />
            <UpgradePreview building={b} island={island} model={model} content={content} />
          </div>
        )}
      </div>
      <div className={`${styles.buttons} ${styles.panelFooter}`}>
        {(canPause || b.paused) && (
          <button type="button" className={styles.button} onClick={() => onSetPaused(!b.paused)} data-testid="info-pause">
            {b.paused ? (
              <>
                <Icon path={toolIcon("resume")} /> Resume
              </>
            ) : (
              <>
                <Icon path={statusIcon("paused_player")} /> Pause
              </>
            )}
          </button>
        )}
        {b.level !== undefined && nextLevelOf(content, b) && (
          <button
            type="button"
            className={styles.button}
            onClick={onUpgradeBuilding}
            data-testid={def?.trading_post ? "trading-post-upgrade-button" : def?.warehouse ? "warehouse-upgrade-button" : "service-upgrade-button"}
          >
            <Icon path={toolIcon("upgrade")} /> Upgrade
          </button>
        )}
        {b.residents !== undefined && (
          // The server says whether the upgrade would succeed (D-027): enabled only then, the reason as the tooltip and as a short line below.
          <span className={styles.upgradeGroup}>
            <button
              type="button"
              className={styles.button}
              onClick={onUpgrade}
              disabled={!b.upgrade?.available}
              title={b.upgrade && !b.upgrade.available && b.upgrade.reason ? upgradeReasonText(content, b.upgrade.reason) : undefined}
              data-testid="info-upgrade"
            >
              <Icon path={toolIcon("upgrade")} /> Upgrade
            </button>
            {b.upgrade && !b.upgrade.available && b.upgrade.reason && (
              <span className={`${styles.small} ${styles.warn}`} data-testid="info-upgrade-hint">
                {upgradeHint(content, model, island, b, b.upgrade.reason)}
              </span>
            )}
          </span>
        )}
        {order && (
          <button type="button" className={styles.button} onClick={onCancelShipOrder} data-testid="shipyard-cancel">
            Cancel order
          </button>
        )}
        {/* A field cannot be moved (the server rejects it): demolish and add one again. */}
        {!def?.field && (
          <button type="button" className={styles.button} onClick={onMove} data-testid="info-move">
            <Icon path={toolIcon("move")} /> Move
          </button>
        )}
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onDemolish} data-testid="info-demolish">
          <Icon path={toolIcon("demolish")} /> Demolish
        </button>
      </div>
    </div>
  );
}
