import type { CDPSession, Page } from "@playwright/test";

// Touch input for the touch projects. Chromium: real touch events through
// CDP Input.dispatchTouchEvent (the browser derives pointer events with
// pointerType "touch", touch-action applies), paced by wall-clock time
// without waiting for each acknowledgement. WebKit: synthetic
// PointerEvents (pointerType "touch") dispatched at the element under the
// point and, like pointer capture, to the same target for later moves;
// the app must tolerate failing setPointerCapture for those (R-1.4).
// WebKit skips multi-touch flows.

export interface Point {
  x: number;
  y: number;
}

export interface Touch {
  readonly multiTouch: boolean;
  tap(p: Point): Promise<void>;
  /** One finger from a to b in `steps` moves. */
  drag(a: Point, b: Point, steps?: number): Promise<void>;
  /** Holds one finger still for `ms`. */
  longPress(p: Point, ms?: number): Promise<void>;
  /** Two fingers around `centre` from `fromDist` to `toDist` apart (horizontal). */
  pinch(centre: Point, fromDist: number, toDist: number, steps?: number): Promise<void>;
  /** Two fingers `dist` apart twisted about `centre` by `angle` radians (positive: clockwise on screen). */
  twist(centre: Point, dist: number, angle: number, steps?: number): Promise<void>;
  /**
   * Raw touch events, dispatched back to back without waiting between them
   * (each lists every finger currently down; start: a finger is added;
   * end with [] lifts all), for hand-built gestures.
   */
  raw(...events: { type: "start" | "move" | "end"; fingers: (Point & { id: number })[] }[]): Promise<void>;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

class CdpTouch implements Touch {
  readonly multiTouch = true;
  private sent: Promise<unknown>[] = [];
  constructor(private readonly cdp: CDPSession) {}

  /**
   * Sends a touch event without waiting for the browser's acknowledgement:
   * on a slow runner every dispatch waits for the renderer (hundreds of ms),
   * which turned a quick drag into a hold of more than the long-press time.
   * Events stay in order; the gesture's pacing is the wall-clock pauses.
   */
  private fire(type: "touchStart" | "touchMove" | "touchEnd", points: (Point & { id: number })[]) {
    this.sent.push(
      this.cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })),
      }),
    );
  }

  /** Waits until the browser handled every event of the gesture. */
  private async done() {
    await Promise.all(this.sent.splice(0));
  }

  async tap(p: Point) {
    this.fire("touchStart", [{ ...p, id: 1 }]);
    await pause(30);
    this.fire("touchEnd", []);
    await this.done();
  }

  async drag(a: Point, b: Point, steps = 12) {
    this.fire("touchStart", [{ ...a, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
      await pause(16);
      this.fire("touchMove", [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }]);
    }
    this.fire("touchEnd", []);
    await this.done();
  }

  async longPress(p: Point, ms = 700) {
    this.fire("touchStart", [{ ...p, id: 1 }]);
    await pause(ms);
    this.fire("touchEnd", []);
    await this.done();
  }

  async pinch(c: Point, fromDist: number, toDist: number, steps = 12) {
    const at = (d: number) => [
      { x: c.x - d / 2, y: c.y, id: 1 },
      { x: c.x + d / 2, y: c.y, id: 2 },
    ];
    this.fire("touchStart", at(fromDist));
    for (let i = 1; i <= steps; i++) {
      await pause(16);
      this.fire("touchMove", at(fromDist + ((toDist - fromDist) * i) / steps));
    }
    this.fire("touchEnd", []);
    await this.done();
  }

  async raw(...events: { type: "start" | "move" | "end"; fingers: (Point & { id: number })[] }[]) {
    for (const e of events) this.fire(e.type === "start" ? "touchStart" : e.type === "move" ? "touchMove" : "touchEnd", e.fingers);
    await this.done();
  }

  async twist(c: Point, dist: number, angle: number, steps = 12) {
    const at = (a: number) => [
      { x: c.x - (Math.cos(a) * dist) / 2, y: c.y - (Math.sin(a) * dist) / 2, id: 1 },
      { x: c.x + (Math.cos(a) * dist) / 2, y: c.y + (Math.sin(a) * dist) / 2, id: 2 },
    ];
    this.fire("touchStart", at(0));
    for (let i = 1; i <= steps; i++) {
      await pause(16);
      this.fire("touchMove", at((angle * i) / steps));
    }
    this.fire("touchEnd", []);
    await this.done();
  }
}

class SyntheticTouch implements Touch {
  readonly multiTouch = false;
  private nextId = 100;
  constructor(private readonly page: Page) {}

  /** Dispatches pointer events of one finger along a path; the target is fixed at the first point. */
  private async path(points: Point[], holdMs = 0) {
    const id = this.nextId++;
    await this.page.evaluate(
      async ([pts, pid, hold]) => {
        const first = pts[0]!;
        const target = document.elementFromPoint(first.x, first.y) ?? document.body;
        const ev = (type: string, p: { x: number; y: number }, buttons: number) =>
          new PointerEvent(type, {
            pointerId: pid,
            pointerType: "touch",
            isPrimary: true,
            clientX: p.x,
            clientY: p.y,
            button: type === "pointermove" ? -1 : 0,
            buttons,
            bubbles: true,
            cancelable: true,
            composed: true,
          });
        target.dispatchEvent(ev("pointerdown", first, 1));
        if (hold > 0) await new Promise((r) => setTimeout(r, hold));
        // No frame waits between moves: on a slow runner a frame can take
        // longer than the long-press time.
        for (const p of pts.slice(1)) target.dispatchEvent(ev("pointermove", p, 1));
        const last = pts[pts.length - 1]!;
        target.dispatchEvent(ev("pointerup", last, 0));
        // A tap on a control also clicks it (as the browser does after a touch).
        if (pts.length === 1 && hold === 0 && !(target instanceof HTMLCanvasElement)) (target as HTMLElement).click();
      },
      [points, id, holdMs] as const,
    );
  }

  tap(p: Point) {
    return this.path([p]);
  }

  drag(a: Point, b: Point, steps = 12) {
    const pts = [a];
    for (let i = 1; i <= steps; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
    return this.path(pts);
  }

  longPress(p: Point, ms = 700) {
    return this.path([p, p], ms);
  }

  async pinch() {
    throw new Error("multi-touch is not emulated on this browser");
  }

  async twist() {
    throw new Error("multi-touch is not emulated on this browser");
  }

  async raw() {
    throw new Error("multi-touch is not emulated on this browser");
  }
}

/**
 * E2E_CPU_THROTTLE=<rate> (Chromium) slows the page's main thread like a
 * slow CI runner, to reproduce timing problems of the touch flows locally.
 */
const CPU_THROTTLE = Number(process.env.E2E_CPU_THROTTLE ?? "0");

export async function touchFor(page: Page, browserName: string): Promise<Touch> {
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    if (CPU_THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    return new CdpTouch(cdp);
  }
  return new SyntheticTouch(page);
}
