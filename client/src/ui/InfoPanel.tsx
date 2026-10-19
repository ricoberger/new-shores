import type { BuildingDisplay, Content, DisplayState, IslandDisplay } from "../api/client";
import { percent, perMin, seconds, units } from "../display/format";
import { STATUS_STYLES, statusKey, statusText } from "../display/status";
import styles from "./hud.module.css";

interface Props {
  building: BuildingDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  onSetPaused: (paused: boolean) => void;
  onDemolish: () => void;
  onUpgrade: () => void;
  onSelectBuilding: (id: number) => void;
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

export function StatusIcon({ building }: { building: BuildingDisplay }) {
  const s = STATUS_STYLES[statusKey(building)];
  return (
    <span className={styles.icon} style={{ background: s.color }} title={s.label} aria-label={s.label}>
      {s.glyph}
    </span>
  );
}

export function InfoPanel({ building: b, island, model, content, onSetPaused, onDemolish, onUpgrade, onSelectBuilding }: Props) {
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
        <StatusIcon building={b} />
        <div>
          <div data-testid="info-status">{status.sentence}</div>
          {status.fix && <div className={styles.fix}>{status.fix}</div>}
        </div>
      </div>

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
                      <td>{goodName(good)}</td>
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
                    <td>{goodName(good)}</td>
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
                    {units(b.workforce.required)} {tierName(b.workforce.tier)} ({percent(b.workforce_factor_permille ?? 1000)})
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
                    <td>Buffer {goodName(good)}</td>
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
              <div key={n.id} style={{ marginBottom: 4 }}>
                <div className={styles.small}>
                  {n.category ? n.category : n.building ? (content.buildings.find((d) => d.id === n.building)?.name ?? n.building) : n.id}{" "}
                  {percent(n.fulfilment_permille)} {NEED_REASONS[n.reason] ? `— ${NEED_REASONS[n.reason]}` : ""}
                </div>
                <Bar permille={n.fulfilment_permille} />
              </div>
            ))}
          </div>
        </>
      )}

      {b.level !== undefined && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Warehouse level {b.level}</div>
          <div className={styles.small}>
            Capacity {units(b.capacity ?? 0)} per good · throughput {perMin(b.throughput_per_min ?? 0)}/min ·{" "}
            {island.buildings.filter((p) => p.assigned_warehouse_id === b.id).length} producers
          </div>
          <div className={styles.small}>Load {percent(b.load_permille ?? 0)}</div>
          <Bar permille={b.load_permille ?? 0} />
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
                  <td>{goodName(good)}</td>
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
            {b.paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        )}
        {b.residents !== undefined && (
          <button type="button" className={styles.button} onClick={onUpgrade} data-testid="info-upgrade">
            ⇧ Upgrade
          </button>
        )}
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onDemolish} data-testid="info-demolish">
          ⚒ Demolish
        </button>
      </div>
    </div>
  );
}
