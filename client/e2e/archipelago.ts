import { expect, type Page } from "@playwright/test";

// Archipelago-view helpers: positions come from the test hook
// (window.__newShores), NaN while a view transition runs.

export interface Point {
  x: number;
  y: number;
}

/** The view the renderer shows: "archipelago" or an island ID. */
export async function view(page: Page): Promise<string> {
  return page.evaluate(() => window.__newShores!.view());
}

/** Waits for the renderer to show a view (after its transition). */
export async function expectView(page: Page, v: string): Promise<void> {
  await expect.poll(() => view(page)).toBe(v);
}

/** Back control of the top bar, then waits for the archipelago view. */
export async function toArchipelago(page: Page): Promise<void> {
  await page.getByTestId("to-archipelago").click();
  await expectView(page, "archipelago");
}

/** Viewport position of an island tile (or the anchor without a tile) in the archipelago view. */
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

/** Viewport position of a ship (archipelago view or at the harbour). */
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
