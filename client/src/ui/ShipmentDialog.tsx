import { useState } from "react";
import type { CargoDisplay, Content, DisplayState, ShipDisplay } from "../api/client";
import { units } from "../display/format";
import { cargoTotals, slotsFor } from "../display/ships";
import styles from "./hud.module.css";

interface Props {
  ship: ShipDisplay;
  model: DisplayState;
  content: Content;
  onSend: (toIslandId: string, cargo: CargoDisplay[]) => void;
  onClose: () => void;
}

/**
 * Manual shipment: destination and amounts (whole units) chosen from the
 * ship's island inventory. The slot count is a display bound only; the
 * server validates stock and slots.
 */
export function ShipmentDialog({ ship, model, content, onSend, onClose }: Props) {
  const here = model.islands.find((i) => i.id === ship.island_id);
  const destinations = model.islands.filter((i) => i.id !== ship.island_id);
  const [to, setTo] = useState(destinations[0]?.id ?? "");
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const goods = content.goods.filter((g) => (here?.inventory[g.id]?.stock ?? 0) >= 1000);
  const aboard = cargoTotals(ship.cargo);
  const total: Record<string, number> = { ...aboard };
  for (const [g, n] of Object.entries(amounts)) total[g] = (total[g] ?? 0) + n * 1000;
  const slots = slotsFor(total, ship.slot_size);
  const cargo = Object.entries(amounts)
    .filter(([, n]) => n > 0)
    .map(([good, n]) => ({ good, amount: n * 1000 }));
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={`${styles.panel} ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        data-testid="shipment-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title}>Send ship #{ship.id}</h2>
        <div className={styles.row}>
          <label htmlFor="shipment-dest">To</label>
          <select id="shipment-dest" className={styles.input} value={to} onChange={(e) => setTo(e.target.value)} data-testid="shipment-dest">
            {destinations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name || i.id}
                {i.settled ? "" : " (unsettled)"}
              </option>
            ))}
          </select>
        </div>
        <table className={`${styles.table} ${styles.section}`}>
          <thead>
            <tr>
              <th>Good</th>
              <th>Stock</th>
              <th>Load</th>
            </tr>
          </thead>
          <tbody>
            {goods.map((g) => {
              const max = Math.floor((here?.inventory[g.id]?.stock ?? 0) / 1000);
              return (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>{units(here?.inventory[g.id]?.stock ?? 0)}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={max}
                      step={1}
                      className={`${styles.input} ${styles.number}`}
                      value={amounts[g.id] ?? 0}
                      onChange={(e) => setAmounts({ ...amounts, [g.id]: Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))) })}
                      data-testid={`shipment-amount-${g.id}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className={`${styles.small} ${slots > ship.slots ? styles.warn : ""}`} data-testid="shipment-slots">
          Slots {slots}/{ship.slots} (slot size {units(ship.slot_size)})
        </div>
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.button}
            disabled={to === "" || (cargo.length === 0 && ship.cargo.length === 0)}
            onClick={() => {
              onClose();
              onSend(to, cargo);
            }}
            data-testid="shipment-send"
          >
            Send
          </button>
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
