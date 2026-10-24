import { expect, type Page, test } from "@playwright/test";
import { waterEdgeText } from "../src/display/tiers";
import { clickIsland, expectHudIsland, setCamera, worldReady } from "./archipelago";
import { dismissAwayDialog } from "./away";
import { E2E_TIME_SCALE, ISLAND, ISLAND_INLAND, LAND_SITE, START_SHIP, START_TRADING_POST } from "./constants";
import { resetWorld } from "./world";

// The start at sea (D-051) through the UI only, against the dev server at
// time scale 10, from the seafaring fixture (the start state): no island
// settled, the start sloop at sea with the starting stock. The camera
// opens on the ship; the island card's "Found settlement here" picks the
// Trading Post site with its water-edge ghost (red on land, its pier rows
// marked); the ship sails there (sail_ship) and founds it on arrival
// (found_island, chained by the client) while the pending founding shows.
// The berth queue is checked on the showcase fixture (display only).

test.describe.configure({ mode: "serial" });
test.beforeAll(({ request }) => resetWorld(request, "seafaring"));

type Tile = { x: number; y: number };

/** The voyage to the start island (≈ 57 s of world time) plus handling, in wall time. */
const VOYAGE_WALL_MS = 90_000 / E2E_TIME_SCALE + 15_000;

async function hover(page: Page, island: string, t: Tile): Promise<void> {
  let p = { x: NaN, y: NaN };
  await expect
    .poll(async () => {
      p = await page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [island, t.x, t.y] as const);
      return Number.isFinite(p.x);
    })
    .toBe(true);
  await page.mouse.move(p.x, p.y);
}

async function startIsland(page: Page): Promise<{ settled: boolean; types: string[] }> {
  return page.evaluate((id) => {
    const is = window.__newShores!.getServer()!.display.islands.find((x) => x.id === id)!;
    return { settled: is.settled, types: is.buildings.map((b) => b.type) };
  }, ISLAND);
}

test("start at sea: choose the home island and found it from the sloop", async ({ page }) => {
  await page.goto("/");
  await dismissAwayDialog(page);
  await expect(page.getByTestId("hud-gold")).toBeVisible();

  // Nothing settled: the camera opens on the start sloop at sea and the
  // bottom panel asks for the home island.
  await expect.poll(() => page.evaluate(() => window.__newShores!.startShip())).toBe(START_SHIP);
  await expect(page.getByTestId("seafaring-hint")).toContainText("Choose your home island");
  await expect(page.getByTestId("hud-ship-count")).toHaveText("1");
  await page.getByTestId("hud-ships").click();
  await expect(page.getByTestId(`ship-${START_SHIP}`)).toContainText("at sea");
  await page.getByTestId("ships-close").click();

  // The island card offers "Found settlement here": the ship sails there first.
  await worldReady(page, ISLAND);
  await clickIsland(page, ISLAND, ISLAND_INLAND);
  await expect(page.getByTestId("island-card")).toBeVisible();
  await expect(page.getByTestId("island-card-found-note")).toContainText(`Ship #${START_SHIP} sails here`);
  await page.getByTestId("island-card-found").click();
  await expectHudIsland(page, ISLAND);
  await expect(page.getByTestId("tool-hint")).toContainText("sails there and founds it on arrival");

  // The water-edge ghost: on land it is red with the reason; its two pier
  // rows are marked. At the bay site its pier stands on the water.
  await hover(page, ISLAND, LAND_SITE);
  await expect.poll(() => page.evaluate(() => window.__newShores!.ghostValidity())).toBe("invalid");
  await expect(page.getByTestId("tool-hint-reason")).toHaveText(waterEdgeText("front", 2));
  expect(await page.evaluate(() => window.__newShores!.ghostWaterRows())).toEqual({ x: LAND_SITE.x, y: LAND_SITE.y, w: 4, h: 2 });
  await hover(page, ISLAND, START_TRADING_POST);
  await expect.poll(() => page.evaluate(() => window.__newShores!.ghostValidity())).toBe("ok");
  expect(await page.evaluate(() => window.__newShores!.ghostWaterRows())).toEqual({ ...START_TRADING_POST, w: 4, h: 2 });

  // Placing it sails the ship (two steps): the pending founding shows.
  const at = await page.evaluate(
    ([x, y]) => window.__newShores!.tileToScreen("start", x as number, y as number),
    [START_TRADING_POST.x, START_TRADING_POST.y] as const,
  );
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("pending-founding")).toContainText("arrives in");
  await expect
    .poll(() => page.evaluate((id) => window.__newShores!.getServer()!.display.ships.find((s) => s.id === id)!.state, START_SHIP))
    .toBe("manual_leg");

  // Arrival: the client founds the island; the Trading Post appears.
  await expect.poll(() => startIsland(page), { timeout: VOYAGE_WALL_MS }).toEqual({ settled: true, types: ["trading_post"] });
  await expect(page.getByTestId("pending-founding")).toHaveCount(0);
  await expect(page.getByTestId("hud-materials")).toBeVisible();
  await expect(page.getByTestId("build-menu")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__newShores!.getServer()!.display.quests.claimable))
    .toContain("intro_home_island");
});

test("the Trading Post panel lists the berth queue and the ship waits for a berth", async ({ page }) => {
  await page.goto("/?fixture=showcase");
  await worldReady(page, "showcase");
  // Sloop 2 waits for the level-1 Trading Post's only berth; sloop 1 handles there.
  await page.getByTestId("hud-ships").click();
  await expect(page.getByTestId("ship-state-2")).toHaveText("Waiting for berth");
  await expect(page.getByTestId("ship-2")).toContainText("waiting for a berth at Showcase");
  await expect(page.getByTestId("ship-1")).toContainText("unloading at Showcase");
  await page.getByTestId("ship-2").click();
  await expect(page.getByTestId("ship-panel-berth")).toContainText("Waiting for a free berth");
  await page.getByTestId("ship-panel-close").click();

  // The Trading Post (level 1 at (2, 28), its land rows 28–29).
  await setCamera(page, { x: 4, y: 28, half: 8, rotation: 0 });
  const p = await page.evaluate(() => window.__newShores!.tileToScreen("showcase", 3, 28));
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("info-name")).toHaveText("Trading Post");
  await expect(page.getByTestId("trading-post-level")).toContainText("level 1 of 4");
  await expect(page.getByTestId("trading-post-berths")).toContainText("1 busy · 0 free of 1");
  await expect(page.getByTestId("trading-post-berth-ships")).toContainText("Sloop #1");
  await expect(page.getByTestId("trading-post-queue")).toContainText("Waiting for a berth: Sloop #2");
});
