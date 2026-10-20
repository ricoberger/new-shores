import { expect, type Page, test } from "@playwright/test";
import {
  E2E_TIME_SCALE,
  ISLAND,
  ISLAND2,
  ISLAND2_FISHER,
  ISLAND2_HOUSES,
  ISLAND2_ROAD_FROM,
  ISLAND2_ROAD_TO,
  ISLAND2_WAREHOUSE,
  SHIP_ROAD_FROM,
  SHIP_ROAD_SPUR_FROM,
  SHIP_ROAD_SPUR_TO,
  SHIP_ROAD_TO,
  SHIPMENT_PLANKS,
  SHIPYARD,
  WAREHOUSE_PLANKS,
} from "./constants";

// The shipping flow (R-69) through the UI only, against the dev server at
// time scale 10: build a connected shipyard, order a sloop, wait for
// ship_built, ship planks to island 2, found the settlement there and see
// its warehouse. Runs after the smoke test on the same in-memory world, so
// it never assumes version numbers. The second test continues on island 2:
// houses and a fisher, a route edited in the Routes panel, and fish carried
// home to the start island.

test.describe.configure({ mode: "serial" });

/** Sloop build time (2 min) and a leg with handling (20 s + 2 min), in wall ms at the E2E time scale, plus margin. */
const BUILD_WALL_MS = 120_000 / E2E_TIME_SCALE + 15_000;
const LEG_WALL_MS = 140_000 / E2E_TIME_SCALE + 15_000;

interface Tile {
  x: number;
  y: number;
}

async function screen(page: Page, island: string, t: Tile): Promise<Tile> {
  return page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [island, t.x, t.y]);
}

async function clickTile(page: Page, island: string, t: Tile): Promise<void> {
  const p = await screen(page, island, t);
  expect(Number.isFinite(p.x), `tile (${t.x},${t.y}) of ${island} on screen`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

async function drag(page: Page, island: string, from: Tile, to: Tile): Promise<void> {
  const a = await screen(page, island, from);
  const b = await screen(page, island, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function zoomOut(page: Page): Promise<void> {
  const box = (await page.getByTestId("game-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(200);
}

interface ServerShip {
  id: number;
  state: string;
  island_id: string;
}

async function ships(page: Page): Promise<ServerShip[]> {
  return page.evaluate(() => window.__newShores!.getServer()!.display.ships as ServerShip[]);
}

/** Stock of a good on an island in the last payload (milli-units). */
async function stockOf(page: Page, island: string, good: string): Promise<number> {
  return page.evaluate(
    ([id, g]) => window.__newShores!.getServer()!.display.islands.find((x) => x.id === id)!.inventory[g!]?.stock ?? 0,
    [island, good],
  );
}

async function island2(page: Page): Promise<{ settled: boolean; types: string[] }> {
  return page.evaluate((id) => {
    const is = window.__newShores!.getServer()!.display.islands.find((x) => x.id === id)!;
    return { settled: is.settled, types: is.buildings.map((b) => b.type) };
  }, ISLAND2);
}

test("build a sloop, ship planks to island 2 and found a settlement", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hud-gold")).toBeVisible();
  await expect(page.getByTestId(`island-tab-${ISLAND2}`)).toContainText("unsettled");
  await zoomOut(page);

  // Road to the south coast and a connected shipyard.
  await page.getByTestId("build-tab-roads").click();
  await page.getByTestId("build-road_dirt").click();
  await drag(page, ISLAND, SHIP_ROAD_FROM, SHIP_ROAD_TO);
  await drag(page, ISLAND, SHIP_ROAD_SPUR_FROM, SHIP_ROAD_SPUR_TO);
  await page.getByTestId("build-tab-harbour").click();
  await page.getByTestId("build-shipyard").click();
  await clickTile(page, ISLAND, SHIPYARD);
  // Connected: status ok (not_connected without the road).
  await expect
    .poll(() =>
      page.evaluate(() => window.__newShores!.getServer()!.display.islands[0]!.buildings.find((x) => x.type === "shipyard")?.status ?? "none"),
    )
    .toBe("ok");
  await page.keyboard.press("Escape");

  // Order a sloop in the shipyard's panel; the progress bar counts up.
  await clickTile(page, ISLAND, { x: SHIPYARD.x + 1, y: SHIPYARD.y + 1 });
  await expect(page.getByTestId("info-name")).toHaveText("Shipyard");
  await page.getByTestId("shipyard-order-sloop").click();
  await expect(page.getByTestId("shipyard-progress")).toBeVisible();
  await expect(page.getByTestId("shipyard-order")).toContainText("ready in");

  // ship_built arrives by push/next_change_at without a reload.
  await expect(page.getByTestId("hud-ship-count")).toHaveText("1", { timeout: BUILD_WALL_MS });
  const [ship] = await ships(page);
  expect(ship).toMatchObject({ state: "idle", island_id: ISLAND });

  // Manual shipment of planks to island 2.
  await page.getByTestId("hud-ships").click();
  await expect(page.getByTestId(`ship-state-${ship!.id}`)).toHaveText("Idle");
  await page.getByTestId(`ship-send-${ship!.id}`).click();
  await page.getByTestId("shipment-dest").selectOption(ISLAND2);
  await page.getByTestId("shipment-amount-planks").fill(String(SHIPMENT_PLANKS));
  await expect(page.getByTestId("shipment-slots")).toContainText("2/2");
  await page.getByTestId("shipment-send").click();
  const eta = page.getByTestId(`ship-eta-${ship!.id}`);
  await expect(page.getByTestId(`ship-state-${ship!.id}`)).toHaveText("Shipment");
  await expect(eta).toContainText(/departs in|arrives in/);
  // The countdown moves without a reload.
  const first = await eta.textContent();
  await expect.poll(() => eta.textContent(), { timeout: 5_000 }).not.toBe(first);

  // Arrival: the ship is idle at the unsettled island 2 with its cargo.
  await expect(page.getByTestId(`ship-state-${ship!.id}`)).toHaveText("Idle", { timeout: LEG_WALL_MS });
  await expect(page.getByTestId(`ship-cargo-${ship!.id}`)).toContainText(`${SHIPMENT_PLANKS} Planks`);

  // Found the settlement: the view switches to island 2 with a warehouse ghost.
  await page.getByTestId(`ship-found-${ship!.id}`).click();
  await expect(page.getByTestId(`island-tab-${ISLAND2}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tool-hint")).toContainText("warehouse");
  await expect.poll(async () => (await screen(page, ISLAND2, ISLAND2_WAREHOUSE)).x).not.toBeNaN();
  await clickTile(page, ISLAND2, ISLAND2_WAREHOUSE);
  await expect.poll(() => island2(page)).toEqual({ settled: true, types: ["warehouse"] });
  await expect(page.getByTestId(`island-tab-${ISLAND2}`)).not.toContainText("unsettled");
  await expect(page.getByTestId("unsettled-panel")).toBeHidden();
  await expect(page.getByTestId("build-menu")).toBeVisible();

  // The warehouse on island 2 can be selected in the view.
  await page.keyboard.press("Escape");
  await clickTile(page, ISLAND2, { x: ISLAND2_WAREHOUSE.x + 1, y: ISLAND2_WAREHOUSE.y + 1 });
  await expect(page.getByTestId("info-name")).toHaveText("Warehouse");
  // The remaining 40 planks were unloaded into island 2.
  const planks = await page.evaluate(
    (id) => window.__newShores!.getServer()!.display.islands.find((x) => x.id === id)!.inventory.planks?.stock ?? 0,
    ISLAND2,
  );
  expect(planks).toBe((SHIPMENT_PLANKS - WAREHOUSE_PLANKS) * 1000);
});

test("build on island 2 and bring fish home on a route", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hud-ship-count")).toHaveText("1");
  await page.getByTestId(`island-tab-${ISLAND2}`).click();
  await expect(page.getByTestId(`island-tab-${ISLAND2}`)).toHaveAttribute("aria-selected", "true");
  await zoomOut(page);
  await expect.poll(async () => (await screen(page, ISLAND2, ISLAND2_ROAD_FROM)).x).not.toBeNaN();

  // Road, two settler houses (the fisher's workers) and a fisher.
  await page.getByTestId("build-tab-roads").click();
  await page.getByTestId("build-road_dirt").click();
  await drag(page, ISLAND2, ISLAND2_ROAD_FROM, ISLAND2_ROAD_TO);
  await page.getByTestId("build-tab-houses").click();
  await page.getByTestId("build-house_settlers").click();
  for (const h of ISLAND2_HOUSES) await clickTile(page, ISLAND2, h);
  await page.getByTestId("build-tab-production").click();
  await page.getByTestId("build-fisher").click();
  await clickTile(page, ISLAND2, ISLAND2_FISHER);
  await expect.poll(() => island2(page)).toEqual({ settled: true, types: ["warehouse", "house_settlers", "house_settlers", "fisher"] });
  await page.keyboard.press("Escape");

  // Wait for the first fish on island 2 (40 s cycle plus delivery).
  await expect.poll(() => stockOf(page, ISLAND2, "fish"), { timeout: 120_000 / E2E_TIME_SCALE + 10_000 }).toBeGreaterThanOrEqual(1000);

  // Route in the Routes panel: island 2 loads fish (up to 50), start unloads it.
  await page.getByTestId("hud-routes").click();
  await page.getByTestId("route-new").click();
  await page.getByTestId("route-name").fill("Fish home");
  await page.getByTestId("route-stop-island-0").selectOption(ISLAND2);
  await page.getByTestId("route-stop-island-1").selectOption(ISLAND);
  await page.getByTestId("route-load-add-0").click();
  await page.getByTestId("route-load-good-0-0").selectOption("fish");
  await page.getByTestId("route-load-max-0-0").fill("50");
  await page.getByTestId("route-unload-1-fish").check();
  await page.getByTestId("route-save").click();
  const route = page.getByTestId("route-1");
  await expect(route).toContainText("Fish home");
  await expect(route).toContainText("loop time");
  await expect(page.getByTestId("route-delete-1")).toBeEnabled();

  // Assign the idle ship at island 2: it loads the fish and sails home.
  await page.getByTestId("hud-ships").click();
  const [ship] = await ships(page);
  await page.getByTestId(`ship-route-${ship!.id}`).selectOption("1");
  await page.getByTestId(`ship-assign-${ship!.id}`).click();
  await expect(page.getByTestId(`ship-state-${ship!.id}`)).toHaveText("On route");
  await expect(page.getByTestId(`ship-cargo-${ship!.id}`)).toContainText("Fish");
  await expect(page.getByTestId(`ship-eta-${ship!.id}`)).toContainText(/departs in|arrives in/);
  await page.getByTestId("hud-routes").click();
  await expect(page.getByTestId("route-delete-1")).toBeDisabled();

  // Fish arrives at the start island without a reload.
  await expect.poll(() => stockOf(page, ISLAND, "fish"), { timeout: LEG_WALL_MS }).toBeGreaterThan(0);
});
