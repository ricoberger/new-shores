import { useEffect, useState } from "react";
import { readHeapBytes, type StatsSample, statsLines } from "../dev/stats";
import type { GameRenderer } from "../render/engine";

const REFRESH_MS = 500;

/** Dev/E2E-only overlay (?stats=1): fps, frame time, the longest frame of the last second and the island build queue, draw calls, triangles, JS heap, LOD, model detail and the life layer's instances and particles. */
export function StatsBadge({ renderer }: { renderer: GameRenderer | null }) {
  const [sample, setSample] = useState<StatsSample | null>(null);
  useEffect(() => {
    if (!renderer) return;
    const read = () => {
      const f = renderer.frameStats(1000);
      const r = renderer.renderStats();
      setSample({
        fps: f.fps,
        frameMs: f.avgMs,
        p95Ms: f.p95Ms,
        drawCalls: r.drawCalls,
        triangles: r.triangles,
        heapBytes: readHeapBytes(),
        lod: r.lod,
        detail: r.detail,
        queue: r.queue,
        maxMs: f.maxMs,
        life: renderer.lifeStats(),
      });
    };
    read();
    const id = window.setInterval(read, REFRESH_MS);
    // The first frames (camera placed, level known) show at once, not after the first interval.
    let early = 3;
    const off = renderer.onFrame(() => {
      if (early-- > 0) read();
      else off();
    });
    return () => {
      window.clearInterval(id);
      off();
    };
  }, [renderer]);
  if (!sample) return null;
  return (
    <pre
      data-testid="stats-badge"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 4,
        bottom: 4,
        margin: 0,
        padding: "3px 6px",
        zIndex: 1000,
        pointerEvents: "none",
        font: "11px/1.3 ui-monospace, Menlo, monospace",
        color: "white",
        background: "black",
        opacity: 0.75,
        borderRadius: 4,
      }}
    >
      {statsLines(sample).join("\n")}
    </pre>
  );
}
