import { expect, type Page, test } from "@playwright/test";
import { HOUSE, ISLAND, LUMBERJACK, ROAD_FROM, ROAD_TO, SAWMILL, START_GOLD, WATER } from "./constants";

interface Tile {
  x: number;
  y: number;
}

async function screen(page: Page, t: Tile): Promise<Tile> {
  return page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [ISLAND, t.x, t.y]);
}

async function version(page: Page): Promise<number> {
  return page.evaluate(() => window.__newShores!.getServer()?.version ?? -1);
}

async function clickTile(page: Page, t: Tile): Promise<void> {
  const p = await screen(page, t);
  await page.mouse.click(p.x, p.y);
}

/** Selects a build-menu item and rotates the ghost to the wanted rotation. */
async function pick(page: Page, tab: string, id: string, rotation: number): Promise<void> {
  await page.getByTestId(`build-tab-${tab}`).click();
  await page.getByTestId(`build-${id}`).click();
  for (let r = 0; r < rotation; r += 90) await page.keyboard.press("r");
}

async function expectVersion(page: Page, v: number): Promise<void> {
  await expect.poll(() => version(page)).toBe(v);
}

test("place a plank chain and see planks produced", async ({ page }) => {
  await page.goto("/");

  // HUD: gold visible and equal to the start gold minus at most the
  // warehouse upkeep elapsed since the server started (4 gold/min).
  const gold = page.getByTestId("hud-gold");
  await expect(gold).toBeVisible();
  await expect.poll(async () => Number(await gold.textContent())).toBeGreaterThan(START_GOLD - 5);
  expect(Number(await gold.textContent())).toBeLessThanOrEqual(START_GOLD);
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
  await expect(page.getByTestId("hud-content-version")).toHaveText("old_coast-0.2.0");

  // Zoom out so that the whole island is on screen.
  const canvas = page.getByTestId("game-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(200);

  // Road from the warehouse entrance to the forest edge (one drag).
  await expectVersion(page, 0);
  await pick(page, "roads", "road_dirt", 0);
  const a = await screen(page, ROAD_FROM);
  const b = await screen(page, ROAD_TO);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await expectVersion(page, 1);
  const roads = await page.evaluate(() => window.__newShores!.getServer()!.display.islands[0]!.roads.length);
  expect(roads).toBe(ROAD_TO.x - ROAD_FROM.x + 1);

  // Clicking a HUD panel with a tool active never places anything.
  await pick(page, "houses", "house_settlers", 180);
  await page.getByTestId("build-menu").click({ position: { x: 600, y: 60 } });
  await page.waitForTimeout(300);
  expect(await version(page)).toBe(1);

  // A settler house provides the workers (D-035), then lumberjack and sawmill.
  await clickTile(page, HOUSE);
  await expectVersion(page, 2);
  await pick(page, "production", "lumberjack", LUMBERJACK.rotation);
  await clickTile(page, LUMBERJACK);
  await expectVersion(page, 3);
  await pick(page, "production", "sawmill", SAWMILL.rotation);
  await clickTile(page, SAWMILL);
  await expectVersion(page, 4);
  await page.keyboard.press("Escape");

  // Select the sawmill; its server-provided planks rate becomes > 0 within
  // 90 s of simulated time (the client re-fetches at next_change_at).
  await clickTile(page, { x: SAWMILL.x, y: SAWMILL.y });
  await expect(page.getByTestId("info-name")).toHaveText("Sawmill");
  const rate = page.getByTestId("rate-output-planks");
  await expect.poll(async () => Number(await rate.textContent()), { timeout: 30_000 }).toBeGreaterThan(0);
  const serverRate = await page.evaluate(() => {
    const is = window.__newShores!.getServer()!.display.islands[0]!;
    return is.buildings.find((x) => x.type === "sawmill")?.rates?.outputs.planks ?? 0;
  });
  expect(serverRate).toBeGreaterThan(0);

  // An invalid placement (on water) shows a toast and leaves the version.
  const before = await version(page);
  await pick(page, "houses", "house_settlers", 0);
  await clickTile(page, WATER);
  await expect(page.getByTestId("toast").first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(await version(page)).toBe(before);
});
