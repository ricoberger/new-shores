import type { CDPSession, Page } from "@playwright/test";

// Touch input for the touch projects. Chromium: real touch events through
// CDP Input.dispatchTouchEvent (the browser derives pointer events with
// pointerType "touch", touch-action applies). WebKit: synthetic
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
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

class CdpTouch implements Touch {
  readonly multiTouch = true;
  constructor(private readonly cdp: CDPSession) {}

  private send(type: "touchStart" | "touchMove" | "touchEnd", points: (Point & { id: number })[]) {
    return this.cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })),
    });
  }

  async tap(p: Point) {
    await this.send("touchStart", [{ ...p, id: 1 }]);
    await pause(30);
    await this.send("touchEnd", []);
  }

  async drag(a: Point, b: Point, steps = 12) {
    await this.send("touchStart", [{ ...a, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
      await this.send("touchMove", [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 1 }]);
      await pause(16);
    }
    await this.send("touchEnd", []);
  }

  async longPress(p: Point, ms = 700) {
    await this.send("touchStart", [{ ...p, id: 1 }]);
    await pause(ms);
    await this.send("touchEnd", []);
  }

  async pinch(c: Point, fromDist: number, toDist: number, steps = 12) {
    const at = (d: number) => [
      { x: c.x - d / 2, y: c.y, id: 1 },
      { x: c.x + d / 2, y: c.y, id: 2 },
    ];
    await this.send("touchStart", at(fromDist));
    for (let i = 1; i <= steps; i++) {
      await this.send("touchMove", at(fromDist + ((toDist - fromDist) * i) / steps));
      await pause(16);
    }
    await this.send("touchEnd", []);
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
        for (const p of pts.slice(1)) {
          target.dispatchEvent(ev("pointermove", p, 1));
          await new Promise((r) => requestAnimationFrame(r));
        }
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
}

export async function touchFor(page: Page, browserName: string): Promise<Touch> {
  if (browserName === "chromium") return new CdpTouch(await page.context().newCDPSession(page));
  return new SyntheticTouch(page);
}
