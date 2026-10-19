// Pointer input on the canvas (pointer events only, so that touch can be
// added in M3): taps, drags and wheel zoom in render pixels. Overlay
// elements are siblings of the canvas, so their events never reach here.

export interface Point {
  x: number;
  y: number;
}

export interface PointerHandlers {
  /** Pointer released without dragging. */
  tap(p: Point, button: number): void;
  /** A drag started; return true to receive dragMove/dragEnd for it. */
  dragStart(start: Point, button: number): void;
  dragMove(prev: Point, cur: Point, button: number): void;
  dragEnd(cur: Point, button: number): void;
  /** Pointer moved (also while dragging). */
  hover(p: Point | null): void;
  wheel(p: Point, deltaY: number): void;
}

const DRAG_THRESHOLD_PX = 5;

export class PointerInput {
  private down: { start: Point; last: Point; button: number; dragging: boolean; id: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ratio: () => number,
    private readonly h: PointerHandlers,
  ) {
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

  private point(e: PointerEvent | WheelEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    const k = this.ratio();
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.down) return;
    const p = this.point(e);
    this.down = { start: p, last: p, button: e.button, dragging: false, id: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.point(e);
    this.h.hover(p);
    const d = this.down;
    if (!d || d.id !== e.pointerId) return;
    if (!d.dragging && Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_THRESHOLD_PX * this.ratio()) {
      d.dragging = true;
      this.h.dragStart(d.start, d.button);
    }
    if (d.dragging) this.h.dragMove(d.last, p, d.button);
    d.last = p;
  };

  private readonly onUp = (e: PointerEvent): void => {
    const d = this.down;
    if (!d || d.id !== e.pointerId) return;
    this.down = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const p = this.point(e);
    if (d.dragging) this.h.dragEnd(p, d.button);
    else this.h.tap(p, d.button);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (this.down?.id === e.pointerId) this.down = null;
  };

  private readonly onLeave = (): void => {
    if (!this.down) this.h.hover(null);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.h.wheel(this.point(e), e.deltaY);
  };

  private readonly onContextMenu = (e: Event): void => e.preventDefault();
}
