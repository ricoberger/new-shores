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
  /** An island's name label was clicked or tapped. */
  onIsland: (id: string) => void;
}

/** Labels closer than this (CSS px) to the canvas edge are hidden (never half off-screen). */
const LABEL_EDGE_PX = 24;

/**
 * HTML overlay of the continuous world (D-048), positioned every frame
 * from the camera projection at every LOD: island name labels (hidden when
 * their island centre is off screen), the hover tooltip (mid/far LOD) and
 * the selected ship's ETA badge. The overlay is passive to the pointer, so
 * it never takes a pan, zoom or ship from the canvas; the labels are
 * buttons for the keyboard, and the renderer resolves pointer taps on them
 * through a hit test (ships first, then labels, then island land) — a tap
 * on a label opens the island card.
 */
export function WorldOverlay({ renderer, model, selectedShip, nowMs, onIsland }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
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
      const w = root.current?.clientWidth ?? 0;
      const h = root.current?.clientHeight ?? 0;
      for (const is of modelRef.current.islands) {
        const el = labels.current.get(is.id);
        if (!el) continue;
        const p = renderer.archToCanvas({ x: is.position.x + is.width / 2, y: is.position.y + is.height / 2 });
        const half = el.offsetWidth / 2;
        const inside =
          Number.isFinite(p.x) && p.x - half >= LABEL_EDGE_PX && p.x + half <= w - LABEL_EDGE_PX && p.y >= LABEL_EDGE_PX && p.y <= h - LABEL_EDGE_PX;
        // Measured while laid out (visibility, not display, hides it).
        el.style.visibility = inside ? "visible" : "hidden";
        if (inside) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
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
    renderer.setLabelHitTest((x, y) => {
      for (const [id, el] of labels.current) {
        if (el.style.visibility !== "visible") continue;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
      }
      return null;
    });
    const offHover = renderer.onHoverIsland((id, at) => {
      setHover(id);
      if (tip.current && at) tip.current.style.transform = `translate(${at.x + 14}px, ${at.y + 14}px)`;
    });
    return () => {
      offFrame();
      offHover();
      renderer.setLabelHitTest(null);
    };
  }, [renderer]);

  const islandName = (id: string) => model.islands.find((i) => i.id === id)?.name || id;
  const hovered = hover ? model.islands.find((i) => i.id === hover) : undefined;
  const sum = hovered ? islandSummary(hovered) : null;
  const ship = selectedShip === null ? undefined : model.ships.find((s) => s.id === selectedShip);

  return (
    <div ref={root} className={styles.archOverlay} data-testid="world-overlay">
      {model.islands.map((is) => (
        <button
          key={is.id}
          type="button"
          className={styles.islandLabel}
          style={{ visibility: "hidden" }}
          ref={(el) => {
            if (el) labels.current.set(is.id, el);
            else labels.current.delete(is.id);
          }}
          onClick={() => onIsland(is.id)}
          data-testid={`island-label-${is.id}`}
        >
          {is.name || is.id}
          {!is.settled && (
            <span className={styles.badge} data-testid={`island-unsettled-${is.id}`}>
              unsettled
            </span>
          )}
        </button>
      ))}
      <div ref={badge} className={styles.etaBadge} style={{ visibility: "hidden" }} data-testid="ship-eta-badge">
        {ship ? shipWhere(ship, nowMs, islandName) : ""}
      </div>
      <div ref={tip} className={`${styles.panel} ${styles.tooltip}`} style={{ display: hovered ? "block" : "none" }} data-testid="island-tooltip">
        {hovered && sum && (
          <>
            <strong>{hovered.name || hovered.id}</strong> {hovered.settled ? "" : "(unsettled)"}
            <div className={styles.small}>Population {units(sum.population)}</div>
            <div className={styles.small}>Trading Post {sum.fillPercent === null ? "—" : `${sum.fillPercent} %`}</div>
            <div className={styles.small}>Warnings {sum.warnings}</div>
          </>
        )}
      </div>
    </div>
  );
}
