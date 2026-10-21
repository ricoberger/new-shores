// Gesture recogniser of the game canvas: a pure state machine over pointer
// samples (no DOM, no clock). The caller feeds it pointer downs, moves, ups
// and cancels with their time and position, calls tick() when deadline()
// is due, and receives the recognised gestures through `emit`. Mouse, pen
// and touch are told apart per pointer by PointerEvent.pointerType; pen
// behaves like the mouse (precise, has hover, no long-press).
//
// One pointer: tap, drag (start/move/end), long-press (touch only).
// Two touch pointers: pinch (centre, scale and translation per update) and
// rotate (accumulated angle, emitted per crossing of ROTATE_STEP_RAD). A
// second finger cancels the first finger's press or drag; after a
// two-finger gesture nothing else is recognised until every finger is up.

export interface Point {
  x: number;
  y: number;
}

export type PointerKind = "mouse" | "pen" | "touch";

/** Movement (CSS px) after which a mouse or pen press becomes a drag. */
export const DRAG_THRESHOLD_PX = 5;
/**
 * Movement (CSS px) after which a touch press becomes a drag; also the
 * tolerance of a long-press. Fingers jitter more than a mouse.
 */
export const TOUCH_SLOP_PX = 10;
/** A touch press held this long without moving is a long-press. */
export const LONG_PRESS_MS = 450;
/** Change of the finger distance or centre (CSS px) before a two-finger gesture pans and zooms. */
export const PINCH_START_PX = 8;
/** Twist (radians) per rotate step: every crossing of a multiple emits one step. */
export const ROTATE_STEP_RAD = Math.PI / 4;

export type GestureEvent =
  | { type: "tap"; p: Point; button: number; kind: PointerKind }
  | { type: "longPress"; p: Point; kind: PointerKind }
  | { type: "dragStart"; start: Point; button: number; kind: PointerKind }
  | { type: "dragMove"; prev: Point; cur: Point; button: number; kind: PointerKind }
  | { type: "dragEnd"; p: Point; button: number; kind: PointerKind }
  /**
   * Two fingers moved: `centre` is their midpoint, `translation` the
   * midpoint's movement and `scale` the distance ratio since the previous
   * pinch update (> 1: fingers apart, zoom in).
   */
  | { type: "pinch"; centre: Point; translation: Point; scale: number }
  /** Two fingers twisted: `angle` accumulated (radians, clockwise on screen), `steps` new threshold crossings (signed). */
  | { type: "rotate"; angle: number; steps: number }
  /** A press, drag or two-finger gesture ended without a release (pointercancel or cancel()). */
  | { type: "cancel" }
  /** The mouse or pen moved (null: it left the canvas). Touch never hovers. */
  | { type: "hover"; p: Point | null }
  | { type: "wheel"; p: Point; deltaY: number };

interface Tracked {
  kind: PointerKind;
  button: number;
  start: Point;
  last: Point;
}

interface Multi {
  a: number;
  b: number;
  startCentre: Point;
  startDist: number;
  prevCentre: Point;
  prevDist: number;
  prevAngle: number;
  angle: number;
  steps: number;
  pinching: boolean;
}

type Mode = "idle" | "press" | "drag" | "longPressed" | "multi" | "consumed";

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Angle difference normalised to (-π, π]. */
function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export class GestureRecognizer {
  private readonly pointers = new Map<number, Tracked>();
  private mode: Mode = "idle";
  private primary = -1;
  private longPressAt: number | null = null;
  private multi: Multi | null = null;

  constructor(private readonly emit: (e: GestureEvent) => void) {}

  /** Time (ms) at which tick() must be called, or null. */
  deadline(): number | null {
    return this.longPressAt;
  }

  /** IDs of the pointers taking part in the current gesture. */
  trackedIds(): number[] {
    return [...this.pointers.keys()];
  }

  /** A pointer went down; returns whether it takes part in a gesture (capture it). */
  down(id: number, kind: PointerKind, button: number, p: Point, now: number): boolean {
    if (this.mode === "idle") {
      this.pointers.set(id, { kind, button, start: p, last: p });
      this.primary = id;
      this.mode = "press";
      this.longPressAt = kind === "touch" && button === 0 ? now + LONG_PRESS_MS : null;
      return true;
    }
    const first = this.pointers.get(this.primary);
    const twoFingers =
      kind === "touch" &&
      first?.kind === "touch" &&
      this.pointers.size === 1 &&
      (this.mode === "press" || this.mode === "drag" || this.mode === "longPressed");
    if (!twoFingers || !first) return false;
    // The first finger's press or drag ends without a tap or drop.
    if (this.mode === "drag" || this.mode === "longPressed") this.emit({ type: "cancel" });
    this.longPressAt = null;
    this.pointers.set(id, { kind, button, start: p, last: p });
    const c = mid(first.last, p);
    const d = Math.max(1, dist(first.last, p));
    this.multi = {
      a: this.primary,
      b: id,
      startCentre: c,
      startDist: d,
      prevCentre: c,
      prevDist: d,
      prevAngle: Math.atan2(p.y - first.last.y, p.x - first.last.x),
      angle: 0,
      steps: 0,
      pinching: false,
    };
    this.mode = "multi";
    return true;
  }

  move(id: number, kind: PointerKind, p: Point): void {
    if (kind !== "touch") this.emit({ type: "hover", p });
    const ptr = this.pointers.get(id);
    if (!ptr) return;
    switch (this.mode) {
      case "press": {
        const threshold = ptr.kind === "touch" ? TOUCH_SLOP_PX : DRAG_THRESHOLD_PX;
        if (dist(p, ptr.start) > threshold) {
          this.mode = "drag";
          this.longPressAt = null;
          this.emit({ type: "dragStart", start: ptr.start, button: ptr.button, kind: ptr.kind });
          this.emit({ type: "dragMove", prev: ptr.last, cur: p, button: ptr.button, kind: ptr.kind });
        }
        ptr.last = p;
        return;
      }
      case "drag":
        this.emit({ type: "dragMove", prev: ptr.last, cur: p, button: ptr.button, kind: ptr.kind });
        ptr.last = p;
        return;
      case "multi":
        ptr.last = p;
        this.updateMulti();
        return;
      default:
        ptr.last = p;
    }
  }

  private updateMulti(): void {
    const m = this.multi;
    const a = m && this.pointers.get(m.a);
    const b = m && this.pointers.get(m.b);
    if (!m || !a || !b) return;
    const c = mid(a.last, b.last);
    const d = Math.max(1, dist(a.last, b.last));
    if (!m.pinching && (Math.abs(d - m.startDist) > PINCH_START_PX || dist(c, m.startCentre) > PINCH_START_PX)) m.pinching = true;
    if (m.pinching) {
      this.emit({ type: "pinch", centre: c, translation: { x: c.x - m.prevCentre.x, y: c.y - m.prevCentre.y }, scale: d / m.prevDist });
      m.prevCentre = c;
      m.prevDist = d;
    }
    const ang = Math.atan2(b.last.y - a.last.y, b.last.x - a.last.x);
    m.angle += angleDelta(m.prevAngle, ang);
    m.prevAngle = ang;
    const steps = Math.trunc(m.angle / ROTATE_STEP_RAD);
    if (steps !== m.steps) {
      this.emit({ type: "rotate", angle: m.angle, steps: steps - m.steps });
      m.steps = steps;
    }
  }

  up(id: number, p: Point): void {
    const ptr = this.pointers.get(id);
    if (!ptr) return;
    this.pointers.delete(id);
    switch (this.mode) {
      case "press":
        this.reset();
        this.emit({ type: "tap", p, button: ptr.button, kind: ptr.kind });
        return;
      case "drag":
        this.reset();
        this.emit({ type: "dragEnd", p, button: ptr.button, kind: ptr.kind });
        return;
      default:
        // Long-press (already handled) or the end of a two-finger gesture:
        // the remaining finger does nothing until it is lifted too.
        if (this.pointers.size === 0) this.reset();
        else this.toConsumed();
    }
  }

  /** pointercancel: the gesture ends without a tap, drop or road. */
  cancelPointer(id: number): void {
    if (!this.pointers.has(id)) return;
    this.pointers.delete(id);
    const wasActive = this.mode !== "consumed";
    if (this.pointers.size === 0) this.reset();
    else this.toConsumed();
    if (wasActive) this.emit({ type: "cancel" });
  }

  /**
   * Ends the current gesture from outside (e.g. Esc during a ship drag):
   * held pointers neither tap nor drag any more; later moves are hovers
   * until the next press. Returns the IDs that were tracked.
   */
  cancel(): number[] {
    if (this.mode === "idle") return [];
    const ids = this.trackedIds();
    this.reset();
    this.emit({ type: "cancel" });
    return ids;
  }

  /** Deadline processing: a touch press held long enough becomes a long-press. */
  tick(now: number): void {
    if (this.mode !== "press" || this.longPressAt === null || now < this.longPressAt) return;
    const ptr = this.pointers.get(this.primary);
    this.longPressAt = null;
    if (!ptr) return;
    this.mode = "longPressed";
    this.emit({ type: "longPress", p: ptr.last, kind: ptr.kind });
  }

  /** The pointer left the canvas: no hover unless something is pressed. */
  leave(): void {
    if (this.mode === "idle") this.emit({ type: "hover", p: null });
  }

  wheel(p: Point, deltaY: number): void {
    this.emit({ type: "wheel", p, deltaY });
  }

  private toConsumed(): void {
    this.mode = "consumed";
    this.multi = null;
    this.longPressAt = null;
  }

  private reset(): void {
    this.pointers.clear();
    this.mode = "idle";
    this.primary = -1;
    this.multi = null;
    this.longPressAt = null;
  }
}
