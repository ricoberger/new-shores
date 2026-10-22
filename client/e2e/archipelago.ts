import { expect, type Page } from "@playwright/test";

// Helpers of the continuous world (D-048): positions and camera state come
// from the test hook (window.__newShores); positions are NaN while a camera
// jump animates.

export interface Point {
  x: number;
  y: number;
}

export type Lod = "near" | "mid" | "far";

/** The level of detail of the last frame. */
export async function lod(page: Page): Promise<Lod> {
  return page.evaluate(() => window.__newShores!.lod());
}

/** Waits for a level of detail. */
export async function expectLod(page: Page, l: Lod): Promise<void> {
  await expect.poll(() => lod(page)).toBe(l);
}

/** The focused island (under the camera target, else the nearest). */
export async function expectFocused(page: Page, id: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__newShores!.focusedIsland())).toBe(id);
}

/** Camera target (world x, z; archipelago y), half extent and rotation step. */
export async function camera(page: Page): Promise<{ x: number; y: number; z: number; half: number; rotation: number }> {
  return page.evaluate(() => window.__newShores!.camera());
}

/** Sets parts of the camera (clamped like user input). */
export async function setCamera(page: Page, c: { x?: number; y?: number; half?: number; rotation?: number }): Promise<void> {
  await page.evaluate((v) => window.__newShores!.setCamera(v), c);
}

/** Waits until the renderer has drawn the world (the hook is installed and the first island projects). */
export async function worldReady(page: Page, island: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((id) => Number.isFinite(window.__newShores?.islandToScreen(id).x ?? NaN), island), { timeout: 30_000 })
    .toBe(true);
}

/** Waits until the model manifest and every model requested so far have loaded and swapped in (no building still drawn with the other detail). */
export async function modelsLoaded(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__newShores!.assets()), { timeout: 30_000 })
    .toMatchObject({ manifest: true, pending: [], failed: [], bridged: 0 });
}

/** Viewport position of an island tile (or its centre without a tile), once no camera jump runs. */
export async function islandPoint(page: Page, island: string, tile?: Point): Promise<Point> {
  let p: Point = { x: NaN, y: NaN };
  await expect
    .poll(async () => {
      p = await page.evaluate(([id, x, y]) => window.__newShores!.islandToScreen(id as string, x as number | undefined, y as number | undefined), [
        island,
        tile?.x,
        tile?.y,
      ] as const);
      return Number.isFinite(p.x);
    })
    .toBe(true);
  return p;
}

/** Viewport position of a ship drawn in the last frame. */
export async function shipPoint(page: Page, id: number): Promise<Point> {
  let p: Point = { x: NaN, y: NaN };
  await expect
    .poll(async () => {
      p = await page.evaluate((sid) => window.__newShores!.shipToScreen(sid), id);
      return Number.isFinite(p.x);
    })
    .toBe(true);
  return p;
}

export async function clickIsland(page: Page, island: string, tile: Point): Promise<void> {
  const p = await islandPoint(page, island, tile);
  await page.mouse.click(p.x, p.y);
}

/** Drags a ship from its position to a viewport point. */
export async function dragShip(page: Page, id: number, to: Point): Promise<void> {
  const a = await shipPoint(page, id);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Zooms the camera out to the whole archipelago (far LOD), keeping the rotation. */
export async function showArchipelago(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__newShores!.getServer() !== null)).toBe(true);
  const centre = await page.evaluate(() => {
    const is = window.__newShores!.getServer()!.display.islands;
    const minX = Math.min(...is.map((i) => i.position.x));
    const maxX = Math.max(...is.map((i) => i.position.x + i.width));
    const minY = Math.min(...is.map((i) => i.position.y));
    const maxY = Math.max(...is.map((i) => i.position.y + i.height));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  });
  await setCamera(page, { ...centre, half: 100_000 });
  await expectLod(page, "far");
}

/** Centres the camera on an island at a half extent (near default 18). */
export async function showIsland(page: Page, island: string, half = 18): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__newShores!.getServer() !== null)).toBe(true);
  const c = await page.evaluate((id) => {
    const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === id)!;
    return { x: is.position.x + is.width / 2, y: is.position.y + is.height / 2 };
  }, island);
  await setCamera(page, { ...c, half });
}

/** A point inside the canvas that no HUD element (panel, minimap) or island label covers, near the given point (default: the viewport centre). */
export async function freeCanvasPoint(page: Page, near?: Point): Promise<Point> {
  const p = await page.evaluate((n) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const c = n ?? { x: w / 2, y: h / 2 };
    for (let r = 0; r < 400; r += 20) {
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ]) {
        const x = c.x + (dx as number) * r;
        const y = c.y + (dy as number) * r;
        if (x < 10 || y < 10 || x > w - 10 || y > h - 10) continue;
        // The point and a margin around it must be bare canvas: no HUD
        // element and no island label (labels are passive to the pointer,
        // but the canvas resolves taps on them).
        const labels = [...document.querySelectorAll<HTMLElement>('[data-testid^="island-label-"]')]
          .filter((el) => el.style.visibility === "visible")
          .map((el) => el.getBoundingClientRect());
        const free = [
          [0, 0],
          [12, 0],
          [-12, 0],
          [0, 12],
          [0, -12],
        ].every(([ox, oy]) => {
          const px = x + (ox as number);
          const py = y + (oy as number);
          if (labels.some((r) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom)) return false;
          return document.elementFromPoint(px, py) instanceof HTMLCanvasElement;
        });
        if (free) return { x, y };
      }
    }
    return null;
  }, near ?? null);
  expect(p, "a free canvas point").not.toBeNull();
  return p!;
}

/**
 * Wheel ticks (deltaY 300 each) at a free canvas point: `ticks` of them
 * from the near default zoom (the constants' ISLAND_ZOOM_OUT_TICKS keeps
 * near LOD with the whole start island on a desktop screen).
 */
export async function wheelZoom(page: Page, ticks: number, deltaY = 300): Promise<void> {
  const p = await freeCanvasPoint(page);
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < ticks; i++) await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(200);
}

/**
 * Clicks an island's name label. Labels are passive to the pointer (the
 * canvas resolves taps on them after ships), so the click goes to the
 * label's position, not to the element.
 */
export async function clickLabel(page: Page, island: string): Promise<void> {
  const label = page.getByTestId(`island-label-${island}`);
  await expect(label).toBeVisible();
  const b = (await label.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/**
 * A viewport point on an island's inner tiles that taps the island: on the
 * canvas (or the island's own label), at least `clearPx` from every drawn
 * ship (ships are picked first within 18 CSS px). Ships at harbour berths
 * lie close to small islands on a zoomed-out phone screen.
 */
export async function islandTapPoint(page: Page, island: string, clearPx = 26): Promise<Point> {
  await islandPoint(page, island);
  const p = await page.evaluate(
    ([id, clear]) => {
      const h = window.__newShores!;
      const d = h.getServer()!.display;
      const is = d.islands.find((i) => i.id === id)!;
      const ships = d.ships.map((s) => h.shipToScreen(s.id)).filter((s) => Number.isFinite(s.x));
      const own = document.querySelector<HTMLElement>(`[data-testid="island-label-${id as string}"]`);
      for (let r = 0; r < Math.max(is.width, is.height) / 2; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = Math.floor(is.width / 2) + dx;
            const y = Math.floor(is.height / 2) + dy;
            if (x < 2 || y < 2 || x >= is.width - 2 || y >= is.height - 2) continue;
            const q = h.tileToScreen(id as string, x, y);
            if (ships.some((s) => Math.hypot(s.x - q.x, s.y - q.y) < (clear as number))) continue;
            const el = document.elementFromPoint(q.x, q.y);
            if (el instanceof HTMLCanvasElement || (own && el === own)) {
              const other = [...document.querySelectorAll<HTMLElement>('[data-testid^="island-label-"]')].some((l) => {
                if (l === own || l.style.visibility !== "visible") return false;
                const b = l.getBoundingClientRect();
                return q.x >= b.left && q.x <= b.right && q.y >= b.top && q.y <= b.bottom;
              });
              if (!other) return q;
            }
          }
        }
      }
      return null;
    },
    [island, clearPx] as const,
  );
  expect(p, `a tap point on ${island}`).not.toBeNull();
  return p!;
}
