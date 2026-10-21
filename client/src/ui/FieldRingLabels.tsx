import { useEffect, useRef } from "react";
import type { GameRenderer } from "../render/engine";
import styles from "./hud.module.css";

/**
 * "n / required" labels of the farm rings the renderer draws (D-049: the
 * field tool shows every accepting farm's ring, a selected farm shows its
 * own). The counts are the server's fields display. Positioned every frame
 * at the top of the ring; passive (pointer-events: none), so they never
 * take a click or drag from the canvas. The elements are kept outside
 * React's render cycle (one per farm, updated in place).
 */
export function FieldRingLabels({ renderer }: { renderer: GameRenderer | null }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!renderer || !el) return;
    const labels = new Map<number, HTMLDivElement>();
    const off = renderer.onFrame(() => {
      const shown = new Set<number>();
      for (const r of renderer.fieldRingLabels()) {
        shown.add(r.farmId);
        let label = labels.get(r.farmId);
        if (!label) {
          label = document.createElement("div");
          label.className = styles.ringLabel ?? "";
          label.dataset.testid = `field-ring-label-${r.farmId}`;
          el.appendChild(label);
          labels.set(r.farmId, label);
        }
        const text = `${r.assigned} / ${r.required}`;
        if (label.textContent !== text) label.textContent = text;
        label.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px) translate(-50%, -110%)`;
      }
      for (const [id, label] of labels) {
        if (!shown.has(id)) {
          label.remove();
          labels.delete(id);
        }
      }
    });
    return () => {
      off();
      for (const label of labels.values()) label.remove();
    };
  }, [renderer]);
  return <div ref={root} className={styles.archOverlay} data-testid="field-ring-labels" />;
}
