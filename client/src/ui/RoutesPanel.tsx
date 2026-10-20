import { useState } from "react";
import type { Content, DisplayState, RouteDisplay, RouteStop } from "../api/client";
import { units } from "../display/format";
import { countdown } from "../display/ships";
import styles from "./hud.module.css";

interface Props {
  model: DisplayState;
  content: Content;
  /** Creates (id null) or updates a route; resolves to success. */
  onSave: (id: number | null, name: string, stops: RouteStop[]) => Promise<boolean>;
  onDelete: (id: number) => void;
  onClose: () => void;
}

/** Editable form state of a stop (amounts in whole units). */
interface StopForm {
  island: string;
  load: { good: string; max: number }[];
  unload: string[];
}

function toForm(r: RouteDisplay): StopForm[] {
  return r.stops.map((s) => ({
    island: s.island_id,
    load: s.load.map((l) => ({ good: l.good, max: Math.floor(l.max_amount / 1000) })),
    unload: [...s.unload],
  }));
}

/** Routes: list with loop time and assigned ships, and a form editor. */
export function RoutesPanel({ model, content, onSave, onDelete, onClose }: Props) {
  const [editing, setEditing] = useState<{ id: number | null; name: string; stops: StopForm[] } | null>(null);
  const islandName = (id: string) => {
    const is = model.islands.find((i) => i.id === id);
    return is?.name || id;
  };
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const settled = model.islands.filter((i) => i.settled);
  const blank = (): StopForm => ({ island: settled[0]?.id ?? model.islands[0]?.id ?? "", load: [], unload: [] });

  if (editing) {
    const set = (stops: StopForm[]) => setEditing({ ...editing, stops });
    const setStop = (i: number, patch: Partial<StopForm>) => set(editing.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const save = async () => {
      const stops: RouteStop[] = editing.stops.map((s) => ({
        island_id: s.island,
        load: s.load.filter((l) => l.good !== "").map((l) => ({ good: l.good, max_amount: l.max * 1000 })),
        unload: s.unload,
      }));
      if (await onSave(editing.id, editing.name, stops)) setEditing(null);
    };
    return (
      <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="route-editor">
        <h2 className={styles.title}>{editing.id === null ? "New route" : `Edit route #${editing.id}`}</h2>
        <div className={styles.row}>
          <label htmlFor="route-name">Name</label>
          <input
            id="route-name"
            className={styles.input}
            maxLength={40}
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            data-testid="route-name"
          />
        </div>
        {editing.stops.map((s, i) => (
          <div key={i} className={styles.stop} data-testid={`route-stop-${i}`}>
            <div className={styles.row}>
              <strong>Stop {i + 1}</strong>
              <select
                className={styles.input}
                value={s.island}
                onChange={(e) => setStop(i, { island: e.target.value })}
                data-testid={`route-stop-island-${i}`}
              >
                {model.islands.map((is) => (
                  <option key={is.id} value={is.id}>
                    {is.name || is.id}
                    {is.settled ? "" : " (unsettled)"}
                  </option>
                ))}
              </select>
              <button type="button" className={styles.link} onClick={() => set(editing.stops.filter((_, j) => j !== i))} data-testid={`route-stop-remove-${i}`}>
                remove
              </button>
            </div>
            <div className={styles.small}>Load (up to this many aboard)</div>
            {s.load.map((l, j) => (
              <div key={j} className={styles.row}>
                <select
                  className={styles.input}
                  value={l.good}
                  onChange={(e) => setStop(i, { load: s.load.map((x, k) => (k === j ? { ...x, good: e.target.value } : x)) })}
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
                    setStop(i, { load: s.load.map((x, k) => (k === j ? { ...x, max: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)) })
                  }
                  data-testid={`route-load-max-${i}-${j}`}
                />
                <button type="button" className={styles.link} onClick={() => setStop(i, { load: s.load.filter((_, k) => k !== j) })}>
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.link}
              onClick={() => setStop(i, { load: [...s.load, { good: content.goods[0]?.id ?? "", max: 50 }] })}
              data-testid={`route-load-add-${i}`}
            >
              + load
            </button>
            <div className={styles.small}>Unload</div>
            <div className={styles.row}>
              {content.goods.map((g) => (
                <label key={g.id} className={styles.small}>
                  <input
                    type="checkbox"
                    checked={s.unload.includes(g.id)}
                    onChange={(e) =>
                      setStop(i, { unload: e.target.checked ? [...s.unload, g.id] : s.unload.filter((x) => x !== g.id) })
                    }
                    data-testid={`route-unload-${i}-${g.id}`}
                  />
                  {g.name}
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={() => set([...editing.stops, blank()])} data-testid="route-stop-add">
            + Stop
          </button>
          <button type="button" className={styles.button} onClick={() => void save()} data-testid="route-save">
            Save
          </button>
          <button type="button" className={styles.button} onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.panel} ${styles.shipsPanel}`} data-testid="routes-panel">
      <div className={styles.row}>
        <h2 className={styles.title}>Routes</h2>
        <div className={styles.spacer} />
        <button type="button" className={styles.link} onClick={onClose} data-testid="routes-close">
          close
        </button>
      </div>
      {model.routes.map((r) => (
        <div key={r.id} className={styles.shipEntry} data-testid={`route-${r.id}`}>
          <div className={styles.row}>
            <strong>{r.name}</strong>
            <span className={styles.small}>loop time {countdown(r.loop_ms)}</span>
          </div>
          {r.stops.map((s, i) => (
            <div key={i} className={styles.small}>
              {i + 1}. {islandName(s.island_id)}
              {s.unload.length > 0 && ` · unload ${s.unload.map(goodName).join(", ")}`}
              {s.load.length > 0 && ` · load ${s.load.map((l) => `${goodName(l.good)} up to ${units(l.max_amount)}`).join(", ")}`}
            </div>
          ))}
          <div className={styles.small}>Ships: {r.ship_ids.length === 0 ? "none" : r.ship_ids.map((id) => `#${id}`).join(", ")}</div>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.button}
              onClick={() => setEditing({ id: r.id, name: r.name, stops: toForm(r) })}
              data-testid={`route-edit-${r.id}`}
            >
              Edit
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              disabled={r.ship_ids.length > 0}
              title={r.ship_ids.length > 0 ? "Unassign its ships first (route in use)" : undefined}
              onClick={() => onDelete(r.id)}
              data-testid={`route-delete-${r.id}`}
            >
              Delete
            </button>
            {r.ship_ids.length > 0 && <span className={styles.small}>in use: unassign its ships to delete</span>}
          </div>
        </div>
      ))}
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.button}
          onClick={() => setEditing({ id: null, name: "", stops: [blank(), { ...blank(), island: settled[1]?.id ?? blank().island }] })}
          data-testid="route-new"
        >
          + New route
        </button>
      </div>
    </div>
  );
}
