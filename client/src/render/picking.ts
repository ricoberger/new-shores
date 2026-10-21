// Pointer input on the canvas: pointer events only (mouse, pen and touch
// through one code path), fed to the pure gesture recogniser. Positions
// reach the handlers in render pixels. Overlay elements are siblings of
// the canvas, so their events never reach here.
import { GestureRecognizer, type GestureEvent, type Point, type PointerKind } from "./gestures";

export type { Point, PointerKind } from "./gestures";

export interface PointerHandlers {
  /**
   * A pointer went down on the canvas (any kind; before the gesture is
   * known). `first`: no other pointer of the current press is down.
   */
  pointerDown(kind: PointerKind, first: boolean): void;
  /** The last pointer of the press went up or was cancelled by the browser. */
  released(): void;
  /** Pointer released without dragging. */
  tap(p: Point, button: number, kind: PointerKind): void;
  /** A touch held still for the long-press time (no tap follows). */
  longPress(p: Point): void;
  dragStart(start: Point, button: number, kind: PointerKind): void;
  dragMove(prev: Point, cur: Point, button: number): void;
  dragEnd(cur: Point, button: number): void;
  /** Two fingers moved: pan from `prev` to `centre` and zoom by `scale` (> 1: in) about `centre`. */
  pinch(centre: Point, prev: Point, scale: number): void;
  /** Two fingers twisted past one or more rotate steps (signed). */
  rotate(steps: number): void;
  /** A press or drag ended without a release (pointercancel or cancel()). */
  cancel(): void;
  /** Mouse or pen moved (also while dragging); null when it left the canvas. */
  hover(p: Point | null): void;
  wheel(p: Point, deltaY: number): void;
}

/** The event's own time on the performance.now() clock (processing time if the browser reports another clock). */
function eventTime(e: Event): number {
  const now = performance.now();
  return e.timeStamp > 0 && e.timeStamp <= now ? e.timeStamp : now;
}

function kindOf(pointerType: string): PointerKind {
  return pointerType === "touch" ? "touch" : pointerType === "pen" ? "pen" : "mouse";
}

export class PointerInput {
  private readonly gestures: GestureRecognizer;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  /** Pointers of the current press that are down on the canvas. */
  private readonly down = new Set<number>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ratio: () => number,
    private readonly h: PointerHandlers,
  ) {
    this.gestures = new GestureRecognizer((e) => this.dispatch(e));
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  dispose(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

  /** Canvas-relative CSS pixels (the recogniser's thresholds are CSS pixels). */
  private css(e: PointerEvent | WheelEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private px(p: Point): Point {
    const k = this.ratio();
    return { x: p.x * k, y: p.y * k };
  }

  private dispatch(e: GestureEvent): void {
    switch (e.type) {
      case "tap":
        this.h.tap(this.px(e.p), e.button, e.kind);
        return;
      case "longPress":
        this.h.longPress(this.px(e.p));
        return;
      case "dragStart":
        this.h.dragStart(this.px(e.start), e.button, e.kind);
        return;
      case "dragMove":
        this.h.dragMove(this.px(e.prev), this.px(e.cur), e.button);
        return;
      case "dragEnd":
        this.h.dragEnd(this.px(e.p), e.button);
        return;
      case "pinch":
        this.h.pinch(this.px(e.centre), this.px({ x: e.centre.x - e.translation.x, y: e.centre.y - e.translation.y }), e.scale);
        return;
      case "rotate":
        this.h.rotate(e.steps);
        return;
      case "cancel":
        this.h.cancel();
        return;
      case "hover":
        this.h.hover(e.p ? this.px(e.p) : null);
        return;
      case "wheel":
        this.h.wheel(this.px(e.p), e.deltaY);
    }
  }

  /**
   * Runs the recogniser's long-press deadline. The decision waits for the
   * next animation frame after the timer: on a busy main thread, pointer
   * events sampled before the deadline (a release, a move past the slop)
   * are delivered before that frame and win over the timer.
   */
  private schedule(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    const at = this.gestures.deadline();
    if (at === null) return;
    this.timer = setTimeout(() => {
      this.frame = requestAnimationFrame(() => {
        this.gestures.tick(performance.now());
        this.schedule();
      });
    }, Math.max(0, at - performance.now()));
  }

  // Capture can fail for synthetic or already released pointers; input
  // must keep working without it.
  private capture(id: number): void {
    try {
      this.canvas.setPointerCapture(id);
    } catch {
      // not capturable
    }
  }

  private release(id: number): void {
    try {
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    } catch {
      // already released
    }
  }

  private readonly onDown = (e: PointerEvent): void => {
    const kind = kindOf(e.pointerType);
    // A primary pointer starts a new press (also if an earlier pointer's
    // release never reached the canvas).
    if (e.isPrimary) this.down.clear();
    const first = this.down.size === 0;
    this.down.add(e.pointerId);
    this.h.pointerDown(kind, first);
    // Event times (PointerEvent.timeStamp, the performance.now() clock)
    // decide tap vs long-press, not the time the event was processed.
    if (this.gestures.down(e.pointerId, kind, e.button, this.css(e), eventTime(e))) this.capture(e.pointerId);
    this.schedule();
  };

  private readonly onMove = (e: PointerEvent): void => {
    this.gestures.move(e.pointerId, kindOf(e.pointerType), this.css(e), eventTime(e));
    this.schedule();
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.release(e.pointerId);
    this.gestures.up(e.pointerId, this.css(e), eventTime(e));
    this.ended(e.pointerId);
    this.schedule();
  };

  /** A pointer of the press is gone; the press ends with its last one. */
  private ended(id: number): void {
    if (this.down.delete(id) && this.down.size === 0) this.h.released();
  }

  private readonly onCancel = (e: PointerEvent): void => {
    this.release(e.pointerId);
    this.gestures.cancelPointer(e.pointerId);
    this.ended(e.pointerId);
    this.schedule();
  };

  /**
   * Ends the current press or drag without a tap or dragEnd (e.g. Esc
   * cancels a ship drag): later moves of the still-held pointer are plain
   * hovers until the next press.
   */
  cancel(): void {
    for (const id of this.gestures.cancel()) this.release(id);
    this.schedule();
  }

  private readonly onLeave = (): void => {
    this.gestures.leave();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.gestures.wheel(this.css(e), e.deltaY);
  };

  private readonly onContextMenu = (e: Event): void => e.preventDefault();
}
