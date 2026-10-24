import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { percent, perMin, seconds, units } from "../display/format";
import { countdown, orderTiming } from "../display/ships";
import { fieldBuildingOf } from "../display/fields";
import { workforceText } from "../display/hud";
import { needCategory, needLabel } from "../display/needs";
import { fieldsPlural, STATUS_STYLES, statusKey, statusText } from "../display/status";
import { goodIcon, needIcon, statusIcon, toolIcon } from "../theme/iconSet";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

interface Props {
  building: BuildingDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  onSetPaused: (paused: boolean) => void;
  onDemolish: () => void;
  /** Lifts the building into a move ghost (D-042). */
  onMove: () => void;
  onUpgrade: () => void;
  /** Raises a warehouse to its next level (upgrade_warehouse). */
  onUpgradeWarehouse: () => void;
  onSelectBuilding: (id: number) => void;
  /** Activates the field tool for a field building (a farm's "Place …" button, D-049). */
  onPlaceFields: (fieldType: string) => void;
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

function Bar({ permille, testId }: { permille: number; testId?: string }) {
  const pct = Math.max(0, Math.min(100, permille / 10));
  return (
    <div className={styles.bar} data-testid={testId}>
      <div className={styles.barFill} style={{ width: `${pct}%` }} />
    </div>
  );
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

/**
 * Next warehouse level from content (capacity, throughput, cost with the
 * island's have/need per material); hidden at the last level. The server
 * decides whether the upgrade is affordable.
 */
function WarehouseUpgrade({
  building: b,
  island,
  model,
  content,
  onUpgrade,
}: {
  building: BuildingDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  onUpgrade: () => void;
}) {
  const def = content.buildings.find((d) => d.id === b.type);
  const levels: { capacity?: number; throughput_per_min: number; cost?: { gold: number; materials: Record<string, number> } }[] =
    def?.trading_post?.levels ?? def?.warehouse?.levels ?? [];
  const next = b.level !== undefined ? levels[b.level] : undefined;
  if (!next) return null;
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const cost = next.cost ?? { gold: 0, materials: {} };
  return (
    <div className={styles.section} data-testid="warehouse-upgrade">
      <button type="button" className={styles.button} onClick={onUpgrade} data-testid="warehouse-upgrade-button">
        <Icon path={toolIcon("upgrade")} /> Upgrade to level {(b.level ?? 0) + 1}
      </button>
      <div className={styles.small}>
        {next.capacity !== undefined && <>Capacity {units(next.capacity)} per good · </>}throughput {perMin(next.throughput_per_min)}/min
      </div>
      <div className={styles.small} data-testid="warehouse-upgrade-cost">
        <span className={cost.gold > model.gold ? styles.warn : undefined}>
          {units(model.gold)}/{units(cost.gold)} gold
        </span>
        {Object.entries(cost.materials).map(([g, n]) => {
          const have = island.inventory[g]?.stock ?? 0;
          return (
            <span key={g} className={have < n ? styles.warn : undefined}>
              {" "}
              · <GoodName id={g} name={goodName(g)} /> {units(have)}/{units(n)}
            </span>
          );
        })}
      </div>
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
  onUpgradeWarehouse,
  onSelectBuilding,
  onPlaceFields,
  nowMs,
  onOrderShip,
  onCancelShipOrder,
}: Props) {
  const def = content.buildings.find((d) => d.id === b.type);
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const tierName = (id: string) => content.tiers.find((t) => t.id === id)?.name ?? id;
  const status = statusText(b, island, model, content);
  const canPause = def?.pause_category !== "never";
  const warehouse = b.assigned_warehouse_id ? island.buildings.find((w) => w.id === b.assigned_warehouse_id) : undefined;
  const warehouseName = warehouse ? (content.buildings.find((d) => d.id === warehouse.type)?.name ?? warehouse.type) : "";

  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="info-panel">
      <h2 className={styles.title} data-testid="info-name">
        {def?.name ?? b.type}
      </h2>
      <div className={styles.small}>{def ? tierName(def.tier) : ""}</div>
      <div className={styles.statusRow}>
        <StatusIcon building={b} seal />
        <div>
          <div data-testid="info-status">{status.sentence}</div>
          {status.fix && <div className={styles.fix}>{status.fix}</div>}
        </div>
      </div>

      {b.fields && def?.fields && (
        <div className={styles.section} data-testid="farm-fields">
          <div className={styles.sectionTitle} data-testid="farm-fields-count">
            Fields {b.fields.assigned} / {b.fields.required}
          </div>
          <Bar permille={Math.min(1000, (b.fields.assigned * 1000) / Math.max(1, b.fields.required))} />
          {(() => {
            const field = fieldBuildingOf(content, b.type);
            if (!field) return null;
            return (
              <div className={styles.buttons}>
                <button type="button" className={styles.button} onClick={() => onPlaceFields(field.id)} data-testid="farm-place-fields">
                  Place {fieldsPlural(content, b.type)} {b.fields.assigned} / {b.fields.required}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {def?.field && (
        <div className={styles.section} data-testid="field-farm">
          <div className={styles.sectionTitle}>Farm</div>
          {(() => {
            const farm = b.farm_id !== undefined ? island.buildings.find((f) => f.id === b.farm_id) : undefined;
            if (!farm) return <div className={styles.small}>No farm in range</div>;
            const name = content.buildings.find((d) => d.id === farm.type)?.name ?? farm.type;
            return (
              <button type="button" className={styles.link} onClick={() => onSelectBuilding(farm.id)} data-testid="field-farm-link">
                {name} #{farm.id}
              </button>
            );
          })()}
        </div>
      )}

      {b.rates && (
        <>
          {Object.keys(b.rates.inputs).length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Inputs</div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Good</th>
                    <th>Stock</th>
                    <th>Use/min</th>
                    <th>Net/min</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(b.rates.inputs).map(([good, rate]) => (
                    <tr key={good}>
                      <td>
                        <GoodName id={good} name={goodName(good)} />
                      </td>
                      <td>{units(island.inventory[good]?.stock ?? 0)}</td>
                      <td>{perMin(rate)}</td>
                      <td>{perMin(island.inventory[good]?.rate_per_min ?? 0, true)}</td>
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
                    <td data-testid={`rate-output-${good}`}>{perMin(rate)}</td>
                    <td>/min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Cycle {b.cycle_seconds !== undefined ? `(${b.cycle_seconds} s)` : ""}</div>
            <Bar permille={b.cycle_progress_permille ?? 0} testId="cycle-bar" />
          </div>
          <table className={`${styles.table} ${styles.section}`}>
            <tbody>
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
                    <span data-testid="info-workforce">{workforceText(b, island, tierName)}</span>
                  </td>
                </tr>
              )}
              <tr>
                <td>Warehouse</td>
                <td>
                  {warehouse ? (
                    <button type="button" className={styles.link} onClick={() => onSelectBuilding(warehouse.id)}>
                      {warehouseName} #{warehouse.id}
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
        </>
      )}

      {b.residents !== undefined && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Residents</div>
            <div data-testid="house-residents">
              {units(b.residents_floor ?? 0)} – <strong>{units(b.residents)}</strong> – {units(b.residents_max ?? 0)}{" "}
              {(b.growth_rate_per_min ?? 0) > 0 ? "↑" : (b.growth_rate_per_min ?? 0) < 0 ? "↓" : "→"}
            </div>
            <Bar permille={Math.abs(b.growth_progress_permille ?? 0)} />
            <div className={styles.small}>Satisfaction {percent(b.satisfaction_permille ?? 0)}</div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Needs</div>
            {(b.needs ?? []).map((n) => (
              <div key={n.id} style={{ marginBottom: 4 }} data-testid={`house-need-${n.id}`}>
                <div className={`${styles.small} ${styles.withIcon}`}>
                  <Icon path={needIcon(n, n.category ? needCategory(content, n.category).icon : undefined)} />
                  {needLabel(content, n)}{" "}
                  {percent(n.fulfilment_permille)} {NEED_REASONS[n.reason] ? `— ${NEED_REASONS[n.reason]}` : ""}
                </div>
                <Bar permille={n.fulfilment_permille} />
              </div>
            ))}
          </div>
        </>
      )}

      {def?.shipyard && (
        <div className={styles.section} data-testid="shipyard">
          <div className={styles.sectionTitle}>Shipyard</div>
          {b.ship_order ? (
            <>
              <div className={styles.small} data-testid="shipyard-order">
                Building a {content.ships.find((t) => t.id === b.ship_order?.type)?.name ?? b.ship_order.type} · ready in{" "}
                {countdown(orderTiming(b.ship_order, nowMs).remainingMs)}
              </div>
              <Bar permille={orderTiming(b.ship_order, nowMs).progressPermille} testId="shipyard-progress" />
              <div className={styles.buttons}>
                <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onCancelShipOrder} data-testid="shipyard-cancel">
                  Cancel order (50 % materials back)
                </button>
              </div>
            </>
          ) : (
            def.shipyard.ships.map((id) => {
              const t = content.ships.find((x) => x.id === id);
              if (!t) return null;
              const missingGoods = Object.entries(t.cost.materials).filter(([g, n]) => (island.inventory[g]?.stock ?? 0) < n);
              const missingGold = t.cost.gold > model.gold;
              return (
                <div key={id} className={styles.shipEntry}>
                  <div className={styles.row}>
                    <button type="button" className={styles.button} onClick={() => onOrderShip(id)} data-testid={`shipyard-order-${id}`}>
                      Order {t.name}
                    </button>
                    <span className={styles.small}>
                      {t.slots}×{units(t.slot_size)} · {countdown(t.build_ms)} · upkeep {perMin(t.upkeep_per_min)}/min
                    </span>
                  </div>
                  <div className={styles.small}>
                    {units(t.cost.gold)} gold
                    {Object.entries(t.cost.materials).map(([g, n]) => (
                      <span key={g}>
                        {" "}
                        · <GoodName id={g} name={goodName(g)} /> {units(island.inventory[g]?.stock ?? 0)}/{units(n)}
                      </span>
                    ))}
                  </div>
                  {(missingGold || missingGoods.length > 0) && (
                    <div className={`${styles.small} ${styles.warn}`} data-testid={`shipyard-missing-${id}`}>
                      Missing:{" "}
                      {missingGold && `${units(t.cost.gold - model.gold)} gold${missingGoods.length > 0 ? ", " : ""}`}
                      {missingGoods.map(([g, n], i) => (
                        <span key={g}>
                          {i > 0 && ", "}
                          {units(n - (island.inventory[g]?.stock ?? 0))} <GoodName id={g} name={goodName(g)} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {b.level !== undefined && (
        <div className={styles.section}>
          <div className={styles.sectionTitle} data-testid="warehouse-level">
            Warehouse level {b.level} of {(def?.trading_post ?? def?.warehouse)?.levels.length ?? b.level}
          </div>
          <div className={styles.small}>
            Capacity {units(b.capacity ?? 0)} per good · throughput {perMin(b.throughput_per_min ?? 0)}/min ·{" "}
            {island.buildings.filter((p) => p.assigned_warehouse_id === b.id).length} producers
          </div>
          <div className={styles.small}>Load {percent(b.load_permille ?? 0)}</div>
          <Bar permille={b.load_permille ?? 0} />
          <WarehouseUpgrade building={b} island={island} model={model} content={content} onUpgrade={onUpgradeWarehouse} />
          <table className={`${styles.table} ${styles.section}`}>
            <thead>
              <tr>
                <th>Good</th>
                <th>Stock</th>
                <th>Net/min</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(island.inventory).map(([good, g]) => (
                <tr key={good}>
                  <td>
                    <GoodName id={good} name={goodName(good)} />
                  </td>
                  <td>
                    {units(g.stock)}/{units(g.capacity)}
                  </td>
                  <td>{perMin(g.rate_per_min, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.buttons}>
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
        {b.residents !== undefined && (
          <button type="button" className={styles.button} onClick={onUpgrade} data-testid="info-upgrade">
            <Icon path={toolIcon("upgrade")} /> Upgrade
          </button>
        )}
        <button type="button" className={styles.button} onClick={onMove} data-testid="info-move">
          <Icon path={toolIcon("move")} /> Move
        </button>
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onDemolish} data-testid="info-demolish">
          <Icon path={toolIcon("demolish")} /> Demolish
        </button>
      </div>
    </div>
  );
}
