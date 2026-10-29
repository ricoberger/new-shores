import { useEffect, useMemo, useRef, useState } from "react";
import type { DisplayState, Island } from "../api/client";
import { archipelagoRect, type Rect } from "../display/camera";
import { decodeMask, MASK_BLOCK, MASK_WATER } from "../display/mask";
import { fromMinimap, islandsBounds, minimapCollapsedAtStart, minimapLandKey, minimapProjection, minimapSize, rememberMinimapCollapsed, toMinimap } from "../display/minimap";
import type { GameRenderer } from "../render/engine";
import { reliefOf } from "../render/terraces";
import { MAP_SEA, mapLandColor, mapTileRgb } from "../render/mapcolors";
import { toolIcon } from "../theme/iconSet";
import { UI } from "../theme/palette";
import { Compass } from "./Compass";
import { Icon } from "./Icon";
import styles from "./hud.module.css";

interface Props {
  renderer: GameRenderer | null;
  model: DisplayState;
  viewport: { width: number; height: number };
  /**
   * Phone layouts: a toggle collapses the minimap; `initiallyCollapsed`
   * is the layout's default. While no island is settled it opens expanded
   * instead (a collapse is remembered for the session); a founding
   * applies the default.
   */
  collapsible: boolean;
  initiallyCollapsed: boolean;
  /** The camera's rotation rounded to 45° (the compass's accessible name). */
  heading: number;
}

/** Dots and the viewport quadrilateral are redrawn at most this often (ms). */
const REFRESH_MS = 50;
/** Sea and land in the voxel world's colours (render/mapcolors.ts); settled or not alike (the islands are told apart by their labels, not by a grey tint). */
const SEA = MAP_SEA;
const SHIP = UI.map_ship;
const VIEW = UI.map_view;

/**
 * Minimap (D-048): a north-up 2D canvas of the islands' land (the voxel
 * ground colour of each cell's terrain, settled or not) from their 1:4 terrain masks (no tiles needed; once an island's tiles
 * are loaded, from its tiles with their terraces, rivers and rock, D-058), ship dots and the camera's ground footprint (which
 * turns with the camera), with the compass (D-051) in its top-right
 * corner (on phones a toggle button like the side dock's opens it to its
 * right; collapsed, only the toggle shows, so the compass shows with the
 * expanded map). The land is drawn once per change of the islands or their
 * static data; dots and the footprint follow the frames.
 * A click or tap pans the camera there (zoom kept). Pointer events stay on
 * the minimap (a HUD element, never the game canvas).
 */
export function Minimap({ renderer, model, viewport, collapsible, initiallyCollapsed, heading }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const unsettled = !model.islands.some((is) => is.settled);
  const [collapsedState, setCollapsed] = useState(() => minimapCollapsedAtStart(initiallyCollapsed, unsettled, session()));
  // The first founding: the layout's default from now on.
  const wasUnsettled = useRef(unsettled);
  useEffect(() => {
    if (wasUnsettled.current && !unsettled) setCollapsed(initiallyCollapsed);
    wasUnsettled.current = unsettled;
  }, [unsettled, initiallyCollapsed]);
  // Only phone layouts can collapse it: on a larger layout (e.g. after a
  // resize or rotation) the minimap shows, whatever the phone state was.
  const collapsed = collapsible && collapsedState;
  const islands = model.islands;
  // The land layer and the bounds are keyed by geometry, settlement and
  // the terrain masks, not by the model object that every extrapolated
  // update replaces.
  // Islands whose tiles are loaded draw their relief (terraces, rivers, rock) instead of the mask.
  const statics = renderer?.islandStatics();
  const tilesKey = statics ? [...statics.values()].map((s) => `${s.id}:${s.revision}`).join(",") : "";
  const landKey = `${minimapLandKey(islands)}|${tilesKey}`;
  // The payload's archipelago bounds (D-053); the islands' own for an older payload without extent.
  const ab = model.archipelago.bounds;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- landKey stands for the islands' geometry
  const bounds = useMemo<Rect | null>(() => archipelagoRect(model.archipelago) ?? islandsBounds(islands), [landKey, ab.x, ab.y, ab.width, ab.height]);
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
      const st = statics?.get(is.id);
      if (st && st.width === is.width && st.height === is.height && st.terrain.length === st.width * st.height) {
        drawTiles(ctx, m, is.position, st);
        continue;
      }
      const mask = decodeMask(is.terrain_mask, is.width, is.height);
      // One mask cell covers MASK_BLOCK × MASK_BLOCK tiles (clipped at the island's edge).
      for (let my = 0; my < mask.height; my++) {
        for (let mx = 0; mx < mask.width; mx++) {
          const cell = mask.cells[my * mask.width + mx] as number;
          if (cell === MASK_WATER) continue;
          ctx.fillStyle = mapLandColor(cell);
          const x = mx * MASK_BLOCK;
          const y = my * MASK_BLOCK;
          // Whole pixels, so neighbouring cells meet without anti-aliased seams.
          const p = toMinimap(m, { x: is.position.x + x, y: is.position.y + y });
          const q = toMinimap(m, { x: is.position.x + Math.min(is.width, x + MASK_BLOCK), y: is.position.y + Math.min(is.height, y + MASK_BLOCK) });
          const x0 = Math.floor(p.x);
          const y0 = Math.floor(p.y);
          ctx.fillRect(x0, y0, Math.max(1, Math.ceil(q.x) - x0), Math.max(1, Math.ceil(q.y) - y0));
        }
      }
    }
    return { canvas: c, dpr };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- landKey stands for the islands' geometry, settlement and masks
  }, [landKey, bounds, size.width, size.height, collapsed]);

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

  const view = (
    <div className={`${styles.panel} ${styles.minimap}`} data-testid="minimap-panel">
      <div className={styles.minimapView}>
        <canvas
          ref={canvas}
          className={styles.minimapCanvas}
          style={{ width: size.width, height: size.height }}
          role="img"
          aria-label="Minimap of the archipelago: click to move the camera there"
          onPointerDown={onPointerDown}
          data-testid="minimap"
        />
        <Compass renderer={renderer} heading={heading} />
      </div>
    </div>
  );
  if (!collapsible) return view;
  // Phones: a button like the side dock's; the minimap (with the compass) opens to its right.
  return (
    <div className={styles.minimapRow}>
      <button
        type="button"
        className={`${styles.dockButton} ${collapsed ? "" : styles.dockActive}`}
        onClick={() => {
          const next = !collapsed;
          rememberMinimapCollapsed(next, unsettled, session());
          setCollapsed(next);
        }}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show minimap" : "Hide minimap"}
        data-testid="minimap-toggle"
      >
        <Icon path={toolIcon("minimap")} />
      </button>
      {!collapsed && view}
    </div>
  );
}

/** Draws an island's loaded tiles: one sample per minimap pixel (the tile at its centre), shaded by terrace level and rock. */
function drawTiles(ctx: CanvasRenderingContext2D, m: ReturnType<typeof minimapProjection>, pos: { x: number; y: number }, st: Island): void {
  const p = toMinimap(m, pos);
  const q = toMinimap(m, { x: pos.x + st.width, y: pos.y + st.height });
  const x0 = Math.floor(p.x);
  const y0 = Math.floor(p.y);
  const w = Math.max(1, Math.ceil(q.x) - x0);
  const h = Math.max(1, Math.ceil(q.y) - y0);
  const img = ctx.getImageData(x0, y0, w, h);
  const r = reliefOf(st);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const pt = fromMinimap(m, { x: x0 + i + 0.5, y: y0 + j + 0.5 });
      const tx = Math.floor(pt.x - pos.x);
      const ty = Math.floor(pt.y - pos.y);
      if (tx < 0 || ty < 0 || tx >= st.width || ty >= st.height) continue;
      const t = ty * st.width + tx;
      const c = mapTileRgb(st.terrain[t] as string, r.level[t] as number, r.rock[t] as number);
      if (!c) continue;
      const o = (j * w + i) * 4;
      img.data[o] = Math.round(c[0] * 255);
      img.data[o + 1] = Math.round(c[1] * 255);
      img.data[o + 2] = Math.round(c[2] * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
}

/** The session storage (null where there is none). */
function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
