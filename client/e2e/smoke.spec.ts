import { expect, type Page, test } from "@playwright/test";
import {
  E2E_TIME_SCALE,
  HOUSE,
  HOUSE_MOVED,
  ISLAND,
  LUMBERJACK,
  ROAD_FROM,
  ROAD_TO,
  SAWMILL,
  SAWMILL_MOVED,
  START_GOLD,
  WATER,
} from "./constants";

/** The planks must flow within this much simulated time after placing the sawmill. */
const PLANKS_WITHIN_SIM_MS = 90_000;
/** Wall-clock allowance on top of the scaled bound (requests, rendering). */
const WALL_MARGIN_MS = 5_000;

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

/** Server fields of a building in the last payload the client received. */
interface ServerBuilding {
  id: number;
  type: string;
  x: number;
  y: number;
  rotation: number;
  status: string;
  assigned_warehouse_id?: number;
  residents?: number;
  rates?: { outputs: Record<string, number> };
}

async function serverBuildings(page: Page): Promise<ServerBuilding[]> {
  return page.evaluate(() => window.__newShores!.getServer()!.display.islands[0]!.buildings as ServerBuilding[]);
}

async function serverBuilding(page: Page, type: string): Promise<ServerBuilding> {
  const b = (await serverBuildings(page)).find((x) => x.type === type);
  expect(b, `${type} in the server payload`).toBeDefined();
  return b!;
}

/** Stock + in transit of a good in the last payload (milli-units). */
async function committed(page: Page, good: string): Promise<number> {
  return page.evaluate((g) => {
    const inv = window.__newShores!.getServer()!.display.islands[0]!.inventory[g];
    return (inv?.stock ?? 0) + (inv?.in_transit ?? 0);
  }, good);
}

/** Polls the server planks rate of the sawmill until it is > 0 and returns the server time of that payload. */
async function firstPlanksRateAt(page: Page): Promise<number> {
  let firstPositiveAt = NaN;
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => {
          const server = window.__newShores!.getServer()!;
          const sm = server.display.islands[0]!.buildings.find((x) => x.type === "sawmill");
          return { at: Date.parse(server.display.evaluated_at), rate: sm?.rates?.outputs.planks ?? 0 };
        });
        if (s.rate > 0 && Number.isNaN(firstPositiveAt)) firstPositiveAt = s.at;
        return s.rate;
      },
      { timeout: PLANKS_WITHIN_SIM_MS / E2E_TIME_SCALE + WALL_MARGIN_MS, intervals: [100] },
    )
    .toBeGreaterThan(0);
  return firstPositiveAt;
}

async function evaluatedAt(page: Page): Promise<number> {
  return page.evaluate(() => Date.parse(window.__newShores!.getServer()!.display.evaluated_at));
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

  // D-042: the lumberjack is placed before any road exists; it is simply
  // not connected until the road reaches its footprint.
  await expectVersion(page, 0);
  await pick(page, "production", "lumberjack", LUMBERJACK.rotation);
  await clickTile(page, LUMBERJACK);
  await expectVersion(page, 1);
  const unconnected = await serverBuilding(page, "lumberjack");
  expect(unconnected.status).toBe("not_connected");
  expect(unconnected.assigned_warehouse_id).toBe(0);

  // Road from below the warehouse to the forest edge (one drag); its last
  // tiles touch the lumberjack's top edge.
  await pick(page, "roads", "road_dirt", 0);
  const a = await screen(page, ROAD_FROM);
  const b = await screen(page, ROAD_TO);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await expectVersion(page, 2);
  const roads = await page.evaluate(() => window.__newShores!.getServer()!.display.islands[0]!.roads.length);
  expect(roads).toBe(ROAD_TO.x - ROAD_FROM.x + 1);
  expect((await serverBuilding(page, "lumberjack")).assigned_warehouse_id).not.toBe(0);

  // Clicking a HUD panel with a tool active never places anything.
  await pick(page, "houses", "house_settlers", 180);
  await page.getByTestId("build-menu").click({ position: { x: 600, y: 60 } });
  await page.waitForTimeout(300);
  expect(await version(page)).toBe(2);

  // A settler house provides the workers (D-035), then the sawmill.
  await clickTile(page, HOUSE);
  await expectVersion(page, 3);
  await pick(page, "production", "sawmill", SAWMILL.rotation);
  await clickTile(page, SAWMILL);
  await expectVersion(page, 4);
  // World time of the sawmill placement (the command response's state).
  const placedAt = await evaluatedAt(page);
  await page.keyboard.press("Escape");

  // Select the sawmill; its server-provided planks rate must become > 0
  // within 90 s of simulated time after the placement. The client re-fetches
  // at next_change_at; the first payload with a positive rate is recorded
  // with its server timestamp.
  await clickTile(page, { x: SAWMILL.x, y: SAWMILL.y });
  await expect(page.getByTestId("info-name")).toHaveText("Sawmill");
  const firstPositiveAt = await firstPlanksRateAt(page);
  console.log(`first positive planks rate ${firstPositiveAt - placedAt} simulated ms after the sawmill placement`);
  expect(firstPositiveAt - placedAt).toBeLessThanOrEqual(PLANKS_WITHIN_SIM_MS);
  await expect.poll(async () => Number(await page.getByTestId("rate-output-planks").textContent())).toBeGreaterThan(0);

  // An invalid placement (on water) shows a toast and leaves the version.
  const before = await version(page);
  await pick(page, "houses", "house_settlers", 0);
  await clickTile(page, WATER);
  await expect(page.getByTestId("toast").first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(await version(page)).toBe(before);
  await page.keyboard.press("Escape");

  // Move the house (D-042): Move then Esc sends nothing; Move then a click
  // on a valid tile keeps its ID and residents.
  await clickTile(page, HOUSE);
  await expect(page.getByTestId("info-name")).toHaveText("Settler house");
  const house = await serverBuilding(page, "house_settlers");
  const count = (await serverBuildings(page)).length;
  const v = await version(page);
  await page.getByTestId("info-move").click();
  await expect(page.getByTestId("tool-hint")).toContainText("Click to move");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tool-hint")).toBeHidden();
  await page.waitForTimeout(300);
  expect(await version(page)).toBe(v);
  expect((await serverBuilding(page, "house_settlers")).x).toBe(HOUSE.x);

  await page.getByTestId("info-move").click();
  await clickTile(page, HOUSE_MOVED);
  await expectVersion(page, v + 1);
  const movedHouse = (await serverBuildings(page)).find((x) => x.id === house.id);
  expect(movedHouse).toMatchObject({ type: "house_settlers", x: HOUSE_MOVED.x, y: HOUSE_MOVED.y, residents: house.residents });
  expect((await serverBuildings(page)).length).toBe(count);
  await expect(page.getByTestId("tool-hint")).toBeHidden();
  await expect(page.getByTestId("info-name")).toHaveText("Settler house");

  // Move the sawmill: same ID, nothing of its output lost, planks again.
  await page.keyboard.press("Escape");
  await clickTile(page, SAWMILL);
  await expect(page.getByTestId("info-name")).toHaveText("Sawmill");
  const sawmill = await serverBuilding(page, "sawmill");
  const planksBefore = await committed(page, "planks");
  await page.getByTestId("info-move").click();
  await clickTile(page, SAWMILL_MOVED);
  await expectVersion(page, v + 2);
  const movedSawmill = (await serverBuildings(page)).find((x) => x.id === sawmill.id);
  expect(movedSawmill).toMatchObject({ type: "sawmill", x: SAWMILL_MOVED.x, y: SAWMILL_MOVED.y });
  expect(await committed(page, "planks")).toBeGreaterThanOrEqual(planksBefore);
  const movedAt = await evaluatedAt(page);
  const againAt = await firstPlanksRateAt(page);
  expect(againAt - movedAt).toBeLessThanOrEqual(PLANKS_WITHIN_SIM_MS);
});
