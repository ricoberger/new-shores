import { useEffect, useState } from "react";
import { readHeapBytes, type StatsSample, statsLines } from "../dev/stats";
import type { GameRenderer } from "../render/engine";

const REFRESH_MS = 500;

/** Dev/E2E-only overlay (?stats=1): fps, frame time, draw calls, triangles, JS heap, LOD and model detail. */
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
      });
    };
    read();
    const id = window.setInterval(read, REFRESH_MS);
    return () => window.clearInterval(id);
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
