import { useEffect, useRef } from "react";
import { angleDelta, COMPASS_DRAG_PX, compassTurn, headingDegrees, headingName, pointerAngle } from "../display/compass";
import type { GameRenderer } from "../render/engine";
import styles from "./hud.module.css";

interface Props {
  renderer: GameRenderer | null;
  /** The camera's rotation rounded to 45° (quarter turns): the accessible name follows it, the needle follows every frame. */
  heading: number;
}

/**
 * Compass on the minimap (D-051 part 6): a ring with a needle that points
 * where the camera looks on the north-up minimap and turns with it every
 * frame. Dragging around the ring turns the camera (eased to the nearest
 * 45° on release); a tap, click, Enter or Space returns to the default
 * heading (north-east, the compass's "north"); Q / E turn by 45° anywhere.
 * Its pointer events never reach the minimap or the game canvas.
 */
export function Compass({ renderer, heading }: Props) {
  const needle = useRef<SVGGElement>(null);
  const drag = useRef<{ id: number; centre: { x: number; y: number }; start: { x: number; y: number }; angle: number; turning: boolean } | null>(null);
  /** The last press was a drag: its click must not reset the heading. */
  const dragged = useRef(false);

  useEffect(() => {
    if (!renderer) return;
    let shown = NaN;
    const draw = () => {
      const deg = headingDegrees(renderer.cameraView().rotation);
      if (deg === shown || !needle.current) return;
      shown = deg;
      needle.current.setAttribute("transform", `rotate(${deg.toFixed(2)} 20 20)`);
    };
    draw();
    return renderer.onFrame(draw);
  }, [renderer]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const p = { x: e.clientX, y: e.clientY };
    drag.current = { id: e.pointerId, centre, start: p, angle: pointerAngle(centre, p), turning: false };
    dragged.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not capturable (synthetic pointer)
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    const p = { x: e.clientX, y: e.clientY };
    if (!d.turning && Math.hypot(p.x - d.start.x, p.y - d.start.y) <= COMPASS_DRAG_PX) return;
    d.turning = true;
    dragged.current = true;
    const a = pointerAngle(d.centre, p);
    renderer?.turnCamera(compassTurn(angleDelta(d.angle, a)));
    d.angle = a;
  };

  const end = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    drag.current = null;
    if (d.turning) renderer?.settleCamera();
  };

  const onClick = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    renderer?.faceDefaultHeading();
  };

  const name = headingName(heading);
  const label = `Camera heading ${Math.round(headingDegrees(heading))}° (${name}): activate to return to north-east, drag to turn, Q / E turn by 45°`;
  return (
    <button
      type="button"
      className={styles.compass}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid="camera-compass"
      data-heading={heading}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle className={styles.compassRing} cx="20" cy="20" r="17" />
        {/* North of the minimap (fixed): the minimap is north-up. */}
        <path className={styles.compassNorth} d="M20 1.5 L23 7 L17 7 Z" />
        <g ref={needle} transform="rotate(45 20 20)">
          <path className={styles.compassNeedle} d="M20 6 L24 20 L20 18 L16 20 Z" />
          <path className={styles.compassTail} d="M20 34 L23.5 20 L20 22 L16.5 20 Z" />
        </g>
        <circle className={styles.compassHub} cx="20" cy="20" r="2.2" />
      </svg>
    </button>
  );
}
