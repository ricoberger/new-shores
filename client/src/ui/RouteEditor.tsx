import type { Content, DisplayState, ShipDisplay } from "../api/client";
import { units } from "../display/format";
import { draftChanged, effectRows } from "../display/routes";
import type { Draft, DraftStop } from "../display/view";
import { toolIcon } from "../theme/iconSet";
import { CloseButton } from "./CloseButton";
import styles from "./hud.module.css";
import { Icon } from "./Icon";

interface Props {
  model: DisplayState;
  content: Content;
  /** The saved route edited (null: new, unsaved). */
  routeId: number | null;
  draft: Draft;
  /** A ship to assign after saving ("Assign to route…" from the ship panel). */
  /** The last save error (server message). */
  error: string | null;
  onChange: (draft: Draft) => void;
  onAddStop: (island: string) => void;
  onRemoveStop: (index: number) => void;
  onMoveStop: (index: number, delta: -1 | 1) => void;
  onSave: () => void;
  /** Deletes the saved route (offered while no ship is assigned). */
  onDelete: () => void;
  onClose: () => void;
  onUnassign: (shipId: number) => void;
  /** Assigns an idle ship to the saved route. */
  onAssign: (shipId: number, routeId: number) => void;
}

interface GoodRow {
  mode: "load" | "unload";
  /** Index in the stop's load or unload list. */
  index: number;
  key: string;
  good: string;
  /** Top-up amount of a load row (0 for unload). */
  max: number;
}

/**
 * Route editor panel (UI.md §4, D-048): stops come from the island pickers
 * (a "+ stop…" chooser and one picker per stop to change its island); each
 * stop has one list of goods (good, load or unload, amount, the island's
 * stock) over its load ("top up to") and unload rules from the extrapolated display model. The
 * estimated effects are the server's numbers of the saved route (shown
 * once the route is saved). Save and Delete are pinned below the
 * scrolling body.
 */
export function RouteEditor(p: Props) {
  const { model, content, routeId, draft, error } = p;
  const route =
    routeId === null ? undefined : model.routes.find((r) => r.id === routeId);
  const setStop = (i: number, patch: Partial<DraftStop>) =>
    p.onChange({
      ...draft,
      stops: draft.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  const stock = (island: string, good: string) => {
    const g = model.islands.find((i) => i.id === island)?.inventory[good];
    return g ? `${units(g.stock)}/${units(g.capacity)}` : "—";
  };
  const firstGood = content.goods[0]?.id ?? "";
  /** A stop's load and unload rules as one list (loads first), each with its index in its own list. */
  const goodRows = (st: DraftStop): GoodRow[] => [
    ...st.load.map(
      (l, index): GoodRow => ({
        mode: "load",
        index,
        key: `load-${index}`,
        good: l.good,
        max: l.max,
      }),
    ),
    ...st.unload.map(
      (good, index): GoodRow => ({
        mode: "unload",
        index,
        key: `unload-${index}`,
        good,
        max: 0,
      }),
    ),
  ];
  /** Changes a row's good or amount, or moves it between the load and unload lists. */
  const setGood = (
    i: number,
    r: GoodRow,
    patch: { good?: string; max?: number; mode?: GoodRow["mode"] },
  ) => {
    const st = draft.stops[i];
    if (!st) return;
    const good = patch.good ?? r.good;
    if (patch.mode && patch.mode !== r.mode) {
      if (patch.mode === "unload")
        setStop(i, {
          load: st.load.filter((_, k) => k !== r.index),
          unload: [...st.unload, good],
        });
      else
        setStop(i, {
          unload: st.unload.filter((_, k) => k !== r.index),
          load: [...st.load, { good, max: 50 }],
        });
    } else if (r.mode === "load") {
      setStop(i, {
        load: st.load.map((x, k) =>
          k === r.index ? { good, max: patch.max ?? x.max } : x,
        ),
      });
    } else {
      setStop(i, {
        unload: st.unload.map((x, k) => (k === r.index ? good : x)),
      });
    }
  };
  const removeGood = (i: number, r: GoodRow) => {
    const st = draft.stops[i];
    if (!st) return;
    if (r.mode === "load")
      setStop(i, { load: st.load.filter((_, k) => k !== r.index) });
    else setStop(i, { unload: st.unload.filter((_, k) => k !== r.index) });
  };
  const dirty = route ? draftChanged(draft, route) : true;
  const idleShips = model.ships.filter((s) => s.state === "idle");
  const shipName = (s: ShipDisplay) =>
    `${content.ships.find((t) => t.id === s.type)?.name ?? s.type} #${s.id}`;

  return (
    <div
      className={`${styles.panel} ${styles.shipsPanel}`}
      data-testid="route-editor"
    >
      <div className={styles.row}>
        <h2 className={styles.title} data-testid="route-editor-title">
          {draft.name.trim() ||
            (routeId === null ? "New route" : `Route #${routeId}`)}
        </h2>
        <div className={styles.spacer} />
        <CloseButton onClick={p.onClose} testId="route-editor-close" />
      </div>
      <div className={styles.panelBody}>
        <input
          className={`${styles.input} ${styles.grow}`}
          maxLength={40}
          placeholder="Route name"
          value={draft.name}
          onChange={(e) => p.onChange({ ...draft, name: e.target.value })}
          aria-label="Route name"
          data-testid="route-name"
        />
        {draft.stops.map((s, i) => (
          <div key={i} className={styles.stop} data-testid={`route-stop-${i}`}>
            <div className={styles.row}>
              <strong>{i + 1}.</strong>
              <select
                className={`${styles.input} ${styles.grow}`}
                value={s.island}
                onChange={(e) =>
                  e.target.value && setStop(i, { island: e.target.value })
                }
                aria-label={`Stop ${i + 1}: island`}
                data-testid={`route-stop-island-${i}`}
              >
                {model.islands.map((is) => (
                  <option key={is.id} value={is.id}>
                    {is.name || is.id}
                    {is.settled ? "" : " (unsettled)"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.link}
                disabled={i === 0}
                onClick={() => p.onMoveStop(i, -1)}
                aria-label={`Move stop ${i + 1} up`}
                data-testid={`route-stop-up-${i}`}
              >
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
              <button
                type="button"
                className={styles.link}
                onClick={() => p.onRemoveStop(i)}
                aria-label={`Remove stop ${i + 1}`}
                data-testid={`route-stop-remove-${i}`}
              >
                <Icon path={toolIcon("close")} />
              </button>
            </div>
            {goodRows(s).map((r) => (
              <div key={`${r.mode}-${r.index}`} className={styles.goodRow}>
                <select
                  className={styles.input}
                  value={r.good}
                  onChange={(e) => setGood(i, r, { good: e.target.value })}
                  aria-label={`Stop ${i + 1}: good`}
                  data-testid={`route-good-${i}-${r.key}`}
                >
                  {content.goods.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.input}
                  value={r.mode}
                  onChange={(e) =>
                    setGood(i, r, { mode: e.target.value as GoodRow["mode"] })
                  }
                  aria-label={`Stop ${i + 1}: load or unload`}
                  data-testid={`route-mode-${i}-${r.key}`}
                >
                  <option value="load">Load</option>
                  <option value="unload">Unload</option>
                </select>
                {r.mode === "load" ? (
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={`${styles.input} ${styles.amount}`}
                    value={r.max}
                    onChange={(e) =>
                      setGood(i, r, {
                        max: Math.max(
                          1,
                          Math.floor(Number(e.target.value) || 0),
                        ),
                      })
                    }
                    aria-label={`Stop ${i + 1}: top up to (units)`}
                    data-testid={`route-load-max-${i}-${r.index}`}
                  />
                ) : (
                  <span className={`${styles.small} ${styles.amount}`}>
                    all
                  </span>
                )}
                <span
                  className={styles.small}
                  data-testid={`route-${r.mode}-stock-${i}-${r.index}`}
                >
                  {stock(s.island, r.good)}
                </span>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => removeGood(i, r)}
                  aria-label="Remove good"
                  data-testid={`route-good-remove-${i}-${r.key}`}
                >
                  <Icon path={toolIcon("close")} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.link}
              onClick={() =>
                setStop(i, { load: [...s.load, { good: firstGood, max: 50 }] })
              }
              data-testid={`route-good-add-${i}`}
            >
              + good
            </button>
          </div>
        ))}
        <div className={`${styles.row} ${styles.addStop}`}>
          <select
            className={styles.input}
            value=""
            onChange={(e) => e.target.value && p.onAddStop(e.target.value)}
            aria-label="Add a stop"
            data-testid="route-stop-add"
          >
            <option value="">
              {draft.stops.length === 0 ? "+ first stop…" : "+ stop…"}
            </option>
            {model.islands.map((is) => (
              <option key={is.id} value={is.id}>
                {is.name || is.id}
                {is.settled ? "" : " (unsettled)"}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div
            className={`${styles.small} ${styles.warn}`}
            data-testid="route-error"
          >
            {error}
          </div>
        )}
        {route && (
          <>
            <div
              className={`${styles.section} ${styles.divided}`}
              data-testid="route-effects"
            >
              <div className={styles.sectionTitle}>Net effect (estimated)</div>
              {route.effects.length === 0 ? (
                <div className={styles.small}>
                  estimated: the route moves no goods
                </div>
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
                      <tr
                        key={`${e.island}-${e.good}`}
                        data-testid={`route-effect-${e.island}-${e.good}`}
                      >
                        <td>{e.islandName}</td>
                        <td>{e.goodName}</td>
                        <td>{e.perLoop}</td>
                        <td>{e.perMin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className={styles.small}>
                estimated at the reference speed with full stocks
                {route.ship_ids.length === 0
                  ? "; per minute needs an assigned ship"
                  : ""}
                {dirty ? " (saved version)" : ""}
              </div>
            </div>
          </>
        )}
        {route && (
          <div
            className={`${styles.section} ${styles.divided}`}
            data-testid="route-ships"
          >
            <div className={styles.sectionTitle}>Ships</div>
            {route.ship_ids.length === 0 && (
              <div className={styles.small}>none assigned</div>
            )}
            {route.ship_ids.map((id) => {
              const s = model.ships.find((x) => x.id === id);
              return (
                <div key={id} className={styles.row}>
                  <span className={styles.small}>
                    {s ? shipName(s) : `#${id}`}
                  </span>
                  <div className={styles.spacer} />
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => p.onUnassign(id)}
                    aria-label={`Unassign ${s ? shipName(s) : `#${id}`}`}
                    data-testid={`route-unassign-${id}`}
                  >
                    <Icon path={toolIcon("close")} />
                  </button>
                </div>
              );
            })}
            {idleShips.length > 0 && (
              <div className={`${styles.row} ${styles.addStop}`}>
                <select
                  className={styles.input}
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    p.onAssign(Number(e.target.value), route.id)
                  }
                  aria-label="Assign a ship"
                  data-testid="route-assign-add"
                >
                  <option value="">+ assign…</option>
                  {idleShips.map((s) => (
                    <option key={s.id} value={s.id}>
                      {shipName(s)} at{" "}
                      {model.islands.find((i) => i.id === s.island_id)?.name ||
                        s.island_id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
      <div className={`${styles.buttons} ${styles.panelFooter}`}>
        <button
          type="button"
          className={styles.button}
          onClick={p.onSave}
          data-testid="route-save"
        >
          Save
        </button>
        {route && route.ship_ids.length === 0 && (
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            onClick={p.onDelete}
            data-testid="route-delete"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
