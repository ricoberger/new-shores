import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { units } from "../display/format";
import { draftChanged, effectRows } from "../display/routes";
import { countdown } from "../display/ships";
import type { Draft, DraftStop } from "../display/view";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  /** The saved route edited (null: new, unsaved). */
  routeId: number | null;
  draft: Draft;
  /** A ship to assign after saving ("Assign to route…" from the ship panel). */
  pickingShip: number | null;
  /** The last save error (server message). */
  error: string | null;
  onChange: (draft: Draft) => void;
  onAddStop: (island: string) => void;
  onRemoveStop: (index: number) => void;
  onMoveStop: (index: number, delta: -1 | 1) => void;
  onSave: () => void;
  onClose: () => void;
  onAssign: (shipId: number, routeId: number) => void;
  onUnassign: (shipId: number) => void;
  /** Leaves the ship pick (the pending ship is not assigned). */
  onCancelPick: () => void;
}

/**
 * Route editor panel (UI.md §4, D-048): stops come from the island pickers
 * (a "+ stop…" chooser and one picker per stop to change its island) or,
 * as a shortcut, from clicks on islands in the world; each stop has its
 * load ("top up to") and unload lists and the island's stock of the listed
 * goods from the extrapolated display model. Loop time and the estimated
 * effects are the server's numbers of the saved route ("Save to compute"
 * before).
 */
export function RouteEditor(p: Props) {
  const { model, content, routeId, draft, pickingShip, error } = p;
  const route = routeId === null ? undefined : model.routes.find((r) => r.id === routeId);
  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  const setStop = (i: number, patch: Partial<DraftStop>) =>
    p.onChange({ ...draft, stops: draft.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const stock = (island: string, good: string) => {
    const g = model.islands.find((i) => i.id === island)?.inventory[good];
    return g ? `${units(g.stock)}/${units(g.capacity)}` : "—";
  };
  const firstGood = content.goods[0]?.id ?? "";
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  /** Inline stock of a stop's goods (its load and unload lists, else the first good) at an island, for the island picker. */
  const pickerStock = (island: string, s: DraftStop) => {
    const goods = [...new Set([...s.load.map((l) => l.good), ...s.unload])];
    if (goods.length === 0 && firstGood) goods.push(firstGood);
    return goods.map((g) => `${goodName(g)} ${stock(island, g)}`).join(", ");
  };
  const dirty = route ? draftChanged(draft, route) : true;
  const idleShips = model.ships.filter((s) => s.state === "idle");
  const picking = pickingShip === null ? undefined : model.ships.find((s) => s.id === pickingShip);
  const shipName = (s: ShipDisplay) => `${content.ships.find((t) => t.id === s.type)?.name ?? s.type} #${s.id}`;

  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="route-editor">
      <div className={styles.row}>
        <h2 className={styles.title} data-testid="route-editor-title">
          {routeId === null ? "New route" : `Route #${routeId}`}
        </h2>
        <div className={styles.spacer} />
        <button type="button" className={styles.link} onClick={p.onClose} data-testid="route-editor-close">
          close
        </button>
      </div>
      {picking && (
        <div className={`${styles.small} ${styles.stop}`} data-testid="route-pick-ship">
          Assigning {shipName(picking)}:{" "}
          {routeId === null ? "build the route and save it, or pick a saved route below." : "save, then assign it below."}
          {model.routes.length > 0 && routeId === null && (
            <div className={styles.row}>
              {model.routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={styles.button}
                  onClick={() => p.onAssign(picking.id, r.id)}
                  data-testid={`route-pick-assign-${r.id}`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
          <button type="button" className={styles.link} onClick={p.onCancelPick}>
            cancel
          </button>
        </div>
      )}
      <div className={styles.row}>
        <label htmlFor="route-name">Name</label>
        <input
          id="route-name"
          className={styles.input}
          maxLength={40}
          value={draft.name}
          onChange={(e) => p.onChange({ ...draft, name: e.target.value })}
          data-testid="route-name"
        />
      </div>
      <div className={styles.small}>Pick islands below or click them in the world to add stops.</div>
      {draft.stops.map((s, i) => (
        <div key={i} className={styles.stop} data-testid={`route-stop-${i}`}>
          <div className={styles.row}>
            <strong data-testid={`route-stop-name-${i}`}>
              {i + 1}. {islandName(s.island)}
            </strong>
            <div className={styles.spacer} />
            <button type="button" className={styles.link} disabled={i === 0} onClick={() => p.onMoveStop(i, -1)} aria-label={`Move stop ${i + 1} up`} data-testid={`route-stop-up-${i}`}>
              ↑
            </button>
            <button
              type="button"
              className={styles.link}
              disabled={i === draft.stops.length - 1}
              onClick={() => p.onMoveStop(i, 1)}
              aria-label={`Move stop ${i + 1} down`}
              data-testid={`route-stop-down-${i}`}
            >
              ↓
            </button>
            <button type="button" className={styles.link} onClick={() => p.onRemoveStop(i)} aria-label={`Remove stop ${i + 1}`} data-testid={`route-stop-remove-${i}`}>
              remove
            </button>
          </div>
          <select
            className={styles.input}
            value={s.island}
            onChange={(e) => e.target.value && setStop(i, { island: e.target.value })}
            aria-label={`Stop ${i + 1}: island`}
            data-testid={`route-stop-island-${i}`}
          >
            {model.islands.map((is) => (
              <option key={is.id} value={is.id}>
                {is.name || is.id}
                {is.settled ? "" : " (unsettled)"} · {pickerStock(is.id, s)}
              </option>
            ))}
          </select>
          <div className={styles.small}>Load (top up to this many aboard)</div>
          {s.load.map((l, j) => (
            <div key={j} className={styles.row}>
              <select
                className={styles.input}
                value={l.good}
                onChange={(e) => setStop(i, { load: s.load.map((x, k) => (k === j ? { ...x, good: e.target.value } : x)) })}
                aria-label={`Stop ${i + 1}: good to load`}
                data-testid={`route-load-good-${i}-${j}`}
              >
                {content.goods.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                step={1}
                className={`${styles.input} ${styles.number}`}
                value={l.max}
                onChange={(e) =>
                  setStop(i, { load: s.load.map((x, k) => (k === j ? { ...x, max: Math.max(1, Math.floor(Number(e.target.value) || 0)) } : x)) })
                }
                aria-label={`Stop ${i + 1}: top up to (units)`}
                data-testid={`route-load-max-${i}-${j}`}
              />
              <span className={styles.small} data-testid={`route-load-stock-${i}-${j}`}>
                stock {stock(s.island, l.good)}
              </span>
              <button type="button" className={styles.link} onClick={() => setStop(i, { load: s.load.filter((_, k) => k !== j) })} aria-label="Remove load">
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.link}
            onClick={() => setStop(i, { load: [...s.load, { good: firstGood, max: 50 }] })}
            data-testid={`route-load-add-${i}`}
          >
            + load
          </button>
          <div className={styles.small}>Unload</div>
          {s.unload.map((g, j) => (
            <div key={j} className={styles.row}>
              <select
                className={styles.input}
                value={g}
                onChange={(e) => setStop(i, { unload: s.unload.map((x, k) => (k === j ? e.target.value : x)) })}
                aria-label={`Stop ${i + 1}: good to unload`}
                data-testid={`route-unload-good-${i}-${j}`}
              >
                {content.goods.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <span className={styles.small} data-testid={`route-unload-stock-${i}-${j}`}>
                stock {stock(s.island, g)}
              </span>
              <button type="button" className={styles.link} onClick={() => setStop(i, { unload: s.unload.filter((_, k) => k !== j) })} aria-label="Remove unload">
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.link}
            onClick={() => setStop(i, { unload: [...s.unload, firstGood] })}
            data-testid={`route-unload-add-${i}`}
          >
            + unload
          </button>
        </div>
      ))}
      <div className={styles.row}>
        <select
          className={styles.input}
          value=""
          onChange={(e) => e.target.value && p.onAddStop(e.target.value)}
          aria-label="Add a stop"
          data-testid="route-stop-add"
        >
          <option value="">+ stop…</option>
          {model.islands.map((is) => (
            <option key={is.id} value={is.id}>
              {is.name || is.id}
              {is.settled ? "" : " (unsettled)"}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div className={`${styles.small} ${styles.warn}`} data-testid="route-error">
          {error}
        </div>
      )}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Loop time</div>
        <div className={styles.small} data-testid="route-loop">
          {route ? `loop time ${countdown(route.loop_ms)}${dirty ? " (saved version)" : ""}` : "Save to compute"}
        </div>
      </div>
      <div className={styles.section} data-testid="route-effects">
        <div className={styles.sectionTitle}>Net effect (estimated)</div>
        {!route ? (
          <div className={styles.small}>Save to compute</div>
        ) : route.effects.length === 0 ? (
          <div className={styles.small}>estimated: the route moves no goods</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Island</th>
                <th>Good</th>
                <th>per loop</th>
                <th>per min</th>
              </tr>
            </thead>
            <tbody>
              {effectRows(route, model, content).map((e) => (
                <tr key={`${e.island}-${e.good}`} data-testid={`route-effect-${e.island}-${e.good}`}>
                  <td>{e.islandName}</td>
                  <td>{e.goodName}</td>
                  <td>{e.perLoop}</td>
                  <td>{e.perMin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {route && (
          <div className={styles.small}>
            estimated at the reference speed with full stocks{route.ship_ids.length === 0 ? "; per minute needs an assigned ship" : ""}
            {dirty ? " (saved version)" : ""}
          </div>
        )}
      </div>
      {route && (
        <div className={styles.section} data-testid="route-ships">
          <div className={styles.sectionTitle}>Ships</div>
          {route.ship_ids.length === 0 && <div className={styles.small}>none assigned</div>}
          {route.ship_ids.map((id) => {
            const s = model.ships.find((x) => x.id === id);
            return (
              <div key={id} className={styles.row}>
                <span>{s ? shipName(s) : `#${id}`}</span>
                <button type="button" className={styles.button} onClick={() => p.onUnassign(id)} data-testid={`route-unassign-${id}`}>
                  Unassign
                </button>
              </div>
            );
          })}
          {idleShips.map((s) => (
            <div key={s.id} className={styles.row}>
              <span>
                {shipName(s)} at {islandName(s.island_id)}
              </span>
              <button type="button" className={styles.button} onClick={() => p.onAssign(s.id, route.id)} data-testid={`route-assign-${s.id}`}>
                Assign
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={p.onSave} data-testid="route-save">
          Save
        </button>
      </div>
    </div>
  );
}
