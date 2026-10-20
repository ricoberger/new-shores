import { useEffect, useRef, useState } from "react";
import type { DisplayState } from "../api/client";
import { islandSummary } from "../display/archipelago";
import { units } from "../display/format";
import type { GameRenderer } from "../render/engine";
import { shipWhere } from "./ShipsPanel";
import styles from "./hud.module.css";

interface Props {
  renderer: GameRenderer | null;
  model: DisplayState;
  /** The selected ship (its ETA badge follows it), or null. */
  selectedShip: number | null;
  nowMs: number;
}

/**
 * HTML overlay of the archipelago view: island name labels, the hover
 * tooltip and the selected ship's ETA badge, positioned every frame from
 * the camera projection. Passive (pointer-events: none), so it never takes
 * a pan or zoom from the canvas.
 */
export function ArchipelagoOverlay({ renderer, model, selectedShip, nowMs }: Props) {
  const labels = useRef(new Map<string, HTMLDivElement>());
  const badge = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);
  const shipRef = useRef(selectedShip);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    modelRef.current = model;
    shipRef.current = selectedShip;
  });

  useEffect(() => {
    if (!renderer) return;
    const offFrame = renderer.onFrame(() => {
      for (const is of modelRef.current.islands) {
        const el = labels.current.get(is.id);
        if (!el) continue;
        const p = renderer.archToCanvas({ x: is.position.x + is.width / 2, y: is.position.y + is.height / 2 });
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
      }
      const b = badge.current;
      const id = shipRef.current;
      if (b) {
        const pt = id === null ? undefined : renderer.shipPoint(id);
        if (pt) {
          const p = renderer.archToCanvas(pt, 1.5);
          b.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -150%)`;
          b.style.visibility = "visible";
        } else {
          b.style.visibility = "hidden";
        }
      }
    });
    const offHover = renderer.onHoverIsland((id, at) => {
      setHover(id);
      if (tip.current && at) tip.current.style.transform = `translate(${at.x + 14}px, ${at.y + 14}px)`;
    });
    return () => {
      offFrame();
      offHover();
    };
  }, [renderer]);

  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  const hovered = hover ? model.islands.find((i) => i.id === hover) : undefined;
  const sum = hovered ? islandSummary(hovered) : null;
  const ship = selectedShip === null ? undefined : model.ships.find((s) => s.id === selectedShip);

  return (
    <div className={styles.archOverlay} data-testid="archipelago-overlay">
      {model.islands.map((is) => (
        <div
          key={is.id}
          className={styles.islandLabel}
          ref={(el) => {
            if (el) labels.current.set(is.id, el);
            else labels.current.delete(is.id);
          }}
          data-testid={`island-label-${is.id}`}
        >
          {is.name || is.id}
          {!is.settled && (
            <span className={styles.badge} data-testid={`island-unsettled-${is.id}`}>
              unsettled
            </span>
          )}
        </div>
      ))}
      <div ref={badge} className={styles.etaBadge} style={{ visibility: "hidden" }} data-testid="ship-eta-badge">
        {ship ? shipWhere(ship, nowMs, islandName) : ""}
      </div>
      <div ref={tip} className={`${styles.panel} ${styles.tooltip}`} style={{ display: hovered ? "block" : "none" }} data-testid="island-tooltip">
        {hovered && sum && (
          <>
            <strong>{hovered.name || hovered.id}</strong> {hovered.settled ? "" : "(unsettled)"}
            <div className={styles.small}>Population {units(sum.population)}</div>
            <div className={styles.small}>Warehouse {sum.fillPercent === null ? "—" : `${sum.fillPercent} %`}</div>
            <div className={styles.small}>Warnings {sum.warnings}</div>
          </>
        )}
      </div>
    </div>
  );
}
