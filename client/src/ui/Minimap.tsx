import { useEffect, useMemo, useRef, useState } from "react";
import type { DisplayState, Island } from "../api/client";
import type { Rect } from "../display/camera";
import { fromMinimap, islandsBounds, minimapLandKey, minimapProjection, minimapSize, toMinimap } from "../display/minimap";
import type { GameRenderer } from "../render/engine";
import { toolIcon } from "../theme/iconSet";
import { TERRAIN, UI, WATER } from "../theme/palette";
import { Icon } from "./Icon";
import styles from "./hud.module.css";

interface Props {
  renderer: GameRenderer | null;
  model: DisplayState;
  /** Static island data (land tiles), by island ID. */
  statics: ReadonlyMap<string, Island>;
  viewport: { width: number; height: number };
  /** Phone layouts: a toggle collapses the minimap; `collapsed` is its initial state. */
  collapsible: boolean;
  initiallyCollapsed: boolean;
}

/** Dots and the viewport quadrilateral are redrawn at most this often (ms). */
const REFRESH_MS = 50;
const SEA = WATER.deep;
const SETTLED = TERRAIN.grass_a;
const UNSETTLED = TERRAIN.unsettled;
const SHIP = UI.map_ship;
const VIEW = UI.map_view;

/**
 * Minimap (D-048): a north-up 2D canvas of the islands' land (settled vs
 * unsettled tint), ship dots and the camera's ground footprint (which
 * turns with the camera). The land is drawn once per change of the
 * islands or their static data; dots and the footprint follow the frames.
 * A click or tap pans the camera there (zoom kept). Pointer events stay on
 * the minimap (a HUD element, never the game canvas).
 */
export function Minimap({ renderer, model, statics, viewport, collapsible, initiallyCollapsed }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [collapsedState, setCollapsed] = useState(initiallyCollapsed);
  // Only phone layouts can collapse it: on a larger layout (e.g. after a
  // resize or rotation) the minimap shows, whatever the phone state was.
  const collapsed = collapsible && collapsedState;
  const islands = model.islands;
  // The land layer and the bounds are keyed by geometry and settlement
  // (and static data), not by the model object that every extrapolated
  // update replaces.
  const landKey = minimapLandKey(islands);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- landKey stands for the islands' geometry
  const bounds = useMemo<Rect | null>(() => islandsBounds(islands), [landKey]);
  const size = bounds ? minimapSize(bounds, viewport.width, viewport.height) : { width: 0, height: 0 };

  // The cached land layer (an offscreen canvas at device resolution), drawn while the minimap shows.
  const land = useMemo(() => {
    if (collapsed || !bounds || size.width === 0 || typeof document === "undefined") return null;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const c = document.createElement("canvas");
    c.width = Math.round(size.width * dpr);
    c.height = Math.round(size.height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const m = minimapProjection(bounds, c.width, c.height);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, c.width, c.height);
    for (const is of islands) {
      ctx.fillStyle = is.settled ? SETTLED : UNSETTLED;
      const st = statics.get(is.id);
      if (!st) {
        const a = toMinimap(m, is.position);
        ctx.fillRect(a.x, a.y, is.width * m.scale, is.height * m.scale);
        continue;
      }
      const cell = Math.max(1, m.scale);
      for (let y = 0; y < st.height; y++) {
        for (let x = 0; x < st.width; x++) {
          if (st.terrain[y * st.width + x] === "water") continue;
          const p = toMinimap(m, { x: is.position.x + x, y: is.position.y + y });
          ctx.fillRect(p.x, p.y, cell, cell);
        }
      }
    }
    return { canvas: c, dpr };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- landKey stands for the islands' geometry and settlement
  }, [landKey, statics, bounds, size.width, size.height, collapsed]);

  useEffect(() => {
    const el = canvas.current;
    if (!renderer || !el || !bounds || !land || collapsed) return;
    let last = -Infinity;
    const draw = () => {
      const now = performance.now();
      if (now - last < REFRESH_MS) return;
      last = now;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      if (el.width !== land.canvas.width || el.height !== land.canvas.height) {
        el.width = land.canvas.width;
        el.height = land.canvas.height;
      }
      const m = minimapProjection(bounds, el.width, el.height);
      ctx.drawImage(land.canvas, 0, 0);
      ctx.fillStyle = SHIP;
      const r = Math.max(1.5, 1.5 * land.dpr);
      for (const [, pt] of renderer.shipPoints()) {
        const p = toMinimap(m, pt);
        ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
      }
      const fp = renderer.footprint();
      ctx.strokeStyle = VIEW;
      ctx.lineWidth = Math.max(1, land.dpr);
      ctx.beginPath();
      fp.forEach((q, i) => {
        const p = toMinimap(m, q);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    };
    draw();
    return renderer.onFrame(draw);
  }, [renderer, bounds, land, collapsed]);

  if (!bounds) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (!renderer || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const m = minimapProjection(bounds, r.width, r.height);
    renderer.jumpToPoint(fromMinimap(m, { x: e.clientX - r.left, y: e.clientY - r.top }));
  };

  return (
    <div className={`${styles.panel} ${styles.minimap}`} data-testid="minimap-panel">
      {collapsible && (
        <button
          type="button"
          className={styles.hudButton}
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show minimap" : "Hide minimap"}
          data-testid="minimap-toggle"
        >
          <Icon path={toolIcon("minimap")} />
        </button>
      )}
      {!collapsed && (
        <canvas
          ref={canvas}
          className={styles.minimapCanvas}
          style={{ width: size.width, height: size.height }}
          role="img"
          aria-label="Minimap of the archipelago: click to move the camera there"
          onPointerDown={onPointerDown}
          data-testid="minimap"
        />
      )}
    </div>
  );
}
