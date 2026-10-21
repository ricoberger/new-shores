import { expect, type Page, test } from "@playwright/test";
import {
  CONTENT_VERSION,
  E2E_TIME_SCALE,
  HOUSE,
  HOUSE_MOVED,
  ISLAND_ZOOM_OUT_TICKS,
  ISLAND,
  LUMBERJACK,
  ROAD_FROM,
  ROAD_TO,
  SAWMILL,
  SAWMILL_MOVED,
  START_GOLD,
  WAREHOUSE_TILE,
  WATER,
  QUEST_HOUSES,
  PASTURE_RECT_FROM,
  PASTURE_RECT_OUTSIDE,
  PASTURE_RECT_TO,
  PASTURE_RECT_VALID,
  SHEEP_FARM,
} from "./constants";
import { wheelZoom, worldReady } from "./archipelago";
import { dismissAwayDialog } from "./away";

/** The planks must flow within this much simulated time after placing the sawmill. */
const PLANKS_WITHIN_SIM_MS = 90_000;
/** Wool must be produced (in transit or in stock) within this much simulated time after the fields. */
const WOOL_WITHIN_SIM_MS = 300_000;
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

// The tests share the dev server's in-memory world and run in order: the
// quest test continues on the plank chain of the first one.
test.describe.configure({ mode: "serial" });

test("place a plank chain and see planks produced", async ({ page }) => {
  await page.goto("/");
  await dismissAwayDialog(page);

  // HUD: gold visible and equal to the start gold (the warehouse, never
  // paused, has no upkeep, so nothing has been spent since the start).
  const gold = page.getByTestId("hud-gold");
  await expect(gold).toBeVisible();
  await expect.poll(async () => Number(await gold.textContent())).toBe(START_GOLD);
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
  await expect(page.getByTestId("hud-content-version")).toHaveText(CONTENT_VERSION);

  // Zoom out so that the whole island is on screen.
  await worldReady(page, ISLAND);
  await wheelZoom(page, ISLAND_ZOOM_OUT_TICKS);

  // Tier 2 (R-30): a Citizens building is listed locked with the server's
  // unmet unlock conditions; the Citizen house is upgrade-only and not
  // listed. The warehouse panel offers the level-2 upgrade with its cost.
  await page.getByTestId("build-tab-production").click();
  const quarryLock = page.getByTestId("build-lock-quarry");
  await expect(quarryLock).toContainText("Needs Citizens — Settlers 0/120");
  await expect(quarryLock).toContainText("Chapel");
  await expect(page.getByTestId("build-quarry")).toBeDisabled();
  await expect(page.getByTestId("build-deposit-quarry")).toContainText("stone deposit");
  await page.getByTestId("build-tab-houses").click();
  await expect(page.getByTestId("build-house_settlers")).toBeVisible();
  await expect(page.getByTestId("build-house_citizens")).toHaveCount(0);
  await clickTile(page, WAREHOUSE_TILE);
  await expect(page.getByTestId("info-name")).toHaveText("Warehouse");
  await expect(page.getByTestId("warehouse-level")).toContainText("level 1 of 2");
  await expect(page.getByTestId("warehouse-upgrade-button")).toContainText("level 2");
  await expect(page.getByTestId("warehouse-upgrade-cost")).toContainText("/300 gold");
  await expect(page.getByTestId("warehouse-upgrade-cost")).toContainText("Stone 0/10");
  await page.keyboard.press("Escape");
  await clickTile(page, WATER);
  await expect(page.getByTestId("info-panel")).toBeHidden();

  // D-042: the lumberjack is placed before any road exists; it is simply
  // not connected until the road reaches its footprint. Versions are
  // relative: a summary produced on the first load commits a version.
  const v0 = await version(page);
  await pick(page, "production", "lumberjack", LUMBERJACK.rotation);
  await clickTile(page, LUMBERJACK);
  await expectVersion(page, v0 + 1);
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
  await expectVersion(page, v0 + 2);
  const roads = await page.evaluate(() => window.__newShores!.getServer()!.display.islands[0]!.roads.length);
  expect(roads).toBe(ROAD_TO.x - ROAD_FROM.x + 1);
  expect((await serverBuilding(page, "lumberjack")).assigned_warehouse_id).not.toBe(0);

  // Clicking a HUD panel with a tool active never places anything.
  await pick(page, "houses", "house_settlers", 180);
  await page.getByTestId("build-menu").click({ position: { x: 600, y: 60 } });
  await page.waitForTimeout(300);
  expect(await version(page)).toBe(v0 + 2);

  // A settler house provides the workers (D-035), then the sawmill.
  await clickTile(page, HOUSE);
  await expectVersion(page, v0 + 3);
  await pick(page, "production", "sawmill", SAWMILL.rotation);
  await clickTile(page, SAWMILL);
  await expectVersion(page, v0 + 4);
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

interface QuestState {
  active: string[];
  claimable: string[];
  claimed: string[];
}

async function quests(page: Page): Promise<QuestState> {
  return page.evaluate(() => {
    const q = window.__newShores!.getServer()!.display.quests;
    return {
      active: q.active.map((a) => a.id),
      claimable: q.claimable,
      claimed: q.completed.filter((c) => c.claimed).map((c) => c.id),
    };
  });
}

test("complete and claim the first three quests", async ({ page }) => {
  await page.goto("/");
  await dismissAwayDialog(page);
  await worldReady(page, ISLAND);
  await wheelZoom(page, ISLAND_ZOOM_OUT_TICKS);

  // The road and the connected lumberjack and sawmill of the first test
  // completed the road and planks quests; the houses quest needs four
  // settler houses.
  await expect.poll(async () => (await quests(page)).claimable).toEqual(["intro_first_road", "intro_planks"]);
  expect((await quests(page)).active).toEqual(["intro_houses"]);
  await expect(page.getByTestId("hud-quests-badge")).toHaveText("2");
  await page.getByTestId("hud-quests").click();
  await expect(page.getByTestId("quest-active-intro_houses")).toContainText("1/4");
  await page.getByTestId("hud-quests").click();
  for (const h of QUEST_HOUSES) {
    await pick(page, "houses", "house_settlers", 180);
    await clickTile(page, h);
  }
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await quests(page)).claimable).toEqual(["intro_first_road", "intro_planks", "intro_houses"]);
  await expect(page.getByTestId("hud-quests-badge")).toHaveText("3");

  // Claim through the panel: gold directly, goods after choosing an island.
  await page.getByTestId("hud-quests").click();
  await expect(page.getByTestId("quests-panel")).toBeVisible();
  await page.getByTestId("quest-claim-intro_first_road").click();
  await expect.poll(async () => (await quests(page)).claimed).toEqual(["intro_first_road"]);

  await page.getByTestId("quest-claim-intro_planks").click();
  await expect(page.getByTestId("quest-claim-island")).toContainText("Goods beyond the warehouse capacity are lost.");
  await expect(page.getByTestId("quest-claim-stock-planks")).toContainText("in stock");
  await page.getByTestId("quest-claim-island-select").selectOption(ISLAND);
  const planks = await committed(page, "planks");
  await page.getByTestId("quest-claim-confirm").click();
  await expect.poll(async () => (await quests(page)).claimed).toEqual(["intro_first_road", "intro_planks"]);
  expect(await committed(page, "planks")).toBeGreaterThanOrEqual(planks + 45_000);

  await page.getByTestId("quest-claim-intro_houses").click();
  await expect.poll(async () => (await quests(page)).claimed).toEqual(["intro_first_road", "intro_planks", "intro_houses"]);
  await expect(page.getByTestId("hud-quests-badge")).toHaveCount(0);
  await expect(page.getByTestId("quest-completed-intro_houses")).toContainText("claimed");
  await expect(page.getByTestId("quest-active-intro_fish")).toBeVisible();
});

interface FieldsServerBuilding extends ServerBuilding {
  efficiency_permille: number;
  fields?: { assigned: number; required: number };
  farm_id?: number;
}

test("a sheep farm with a dragged pasture rectangle produces wool", async ({ page }) => {
  await page.goto("/");
  await dismissAwayDialog(page);
  await worldReady(page, ISLAND);
  await wheelZoom(page, ISLAND_ZOOM_OUT_TICKS);

  // The pasture is listed under Production right after the sheep farm.
  await page.getByTestId("build-tab-production").click();
  const items = await page
    .getByTestId("build-menu")
    .locator('[data-testid^="build-"]:not([data-testid^="build-tab-"]):not([data-testid^="build-lock-"]):not([data-testid^="build-fertility-"]):not([data-testid^="build-deposit-"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(items.indexOf("build-pasture")).toBe(items.indexOf("build-sheep_farm") + 1);

  // A farm with fields is placed at 0 fields (D-049).
  const v0 = await version(page);
  await pick(page, "production", "sheep_farm", SHEEP_FARM.rotation);
  await clickTile(page, SHEEP_FARM);
  await expectVersion(page, v0 + 1);
  await page.keyboard.press("Escape");
  const farm = (await serverBuilding(page, "sheep_farm")) as FieldsServerBuilding;
  expect(farm.fields).toEqual({ assigned: 0, required: 16 });
  expect(farm.efficiency_permille).toBe(0);

  // Its panel counts the fields and opens the field tool with the ring.
  await clickTile(page, { x: SHEEP_FARM.x + 1, y: SHEEP_FARM.y + 1 });
  await expect(page.getByTestId("info-name")).toHaveText("Sheep farm");
  await expect(page.getByTestId("farm-fields-count")).toHaveText("Fields 0 / 16");
  await expect(page.getByTestId("farm-place-fields")).toHaveText("Place pastures 0 / 16");
  await page.getByTestId("farm-place-fields").click();
  await expect(page.getByTestId("tool-hint")).toContainText("drag a rectangle to place pastures");
  const label = page.getByTestId(`field-ring-label-${farm.id}`);
  await expect(label).toHaveText("0 / 16");

  // Right click and Esc cancel the tool; nothing is sent.
  const a = await screen(page, PASTURE_RECT_FROM);
  const b = await screen(page, PASTURE_RECT_TO);
  await page.mouse.click(a.x, a.y, { button: "right" });
  await expect(page.getByTestId("tool-hint")).toBeHidden();
  await pick(page, "production", "pasture", 0);
  await expect(page.getByTestId("tool-hint")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tool-hint")).toBeHidden();
  expect(await version(page)).toBe(v0 + 1);

  // Drag a rectangle: the preview counts the green and yellow tiles; the
  // release sends one place_fields command with the green ones.
  await pick(page, "production", "pasture", 0);
  const commands: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/world/commands")) commands.push(r.postData() ?? "");
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await expect(page.getByTestId("tool-hint-reason")).toHaveText(
    `${PASTURE_RECT_VALID} pastures · ${PASTURE_RECT_OUTSIDE} outside every farm's ring`,
  );
  expect(commands).toHaveLength(0);
  await page.mouse.up();
  await expectVersion(page, v0 + 2);
  expect(commands).toHaveLength(1);
  const sent = JSON.parse(commands[0]!) as { command: { type: string; field_type: string; tiles: Tile[] } };
  expect(sent.command.type).toBe("place_fields");
  expect(sent.command.field_type).toBe("pasture");
  expect(sent.command.tiles).toHaveLength(PASTURE_RECT_VALID);
  await expect(label).toHaveText("16 / 16");
  const full = (await serverBuilding(page, "sheep_farm")) as FieldsServerBuilding;
  expect(full.fields).toEqual({ assigned: 16, required: 16 });
  expect(full.efficiency_permille).toBe(1000);
  const pastures = (await serverBuildings(page)).filter((x) => x.type === "pasture") as FieldsServerBuilding[];
  expect(pastures).toHaveLength(16);
  for (const p of pastures) expect(p.farm_id).toBe(farm.id);
  await page.keyboard.press("Escape");

  // The farm runs at 100 % on 16 fields; wool flows.
  await clickTile(page, { x: SHEEP_FARM.x + 1, y: SHEEP_FARM.y + 1 });
  await expect(page.getByTestId("farm-fields-count")).toHaveText("Fields 16 / 16");
  await expect(page.getByTestId("info-panel")).toContainText("Efficiency100 %");
  await expect
    .poll(async () => Number(await page.getByTestId("rate-output-wool").textContent()), {
      timeout: WOOL_WITHIN_SIM_MS / E2E_TIME_SCALE + WALL_MARGIN_MS,
    })
    .toBeGreaterThan(0);
  await expect.poll(() => committed(page, "wool"), { timeout: WOOL_WITHIN_SIM_MS / E2E_TIME_SCALE + WALL_MARGIN_MS }).toBeGreaterThan(0);

  // Demolish mode removes a field with one click (no confirmation); a
  // click with the pasture tool places one again.
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-demolish").click();
  await expect(page.getByTestId("tool-hint")).toContainText("building, field or road");
  const v2 = await version(page);
  await clickTile(page, PASTURE_RECT_FROM);
  await expectVersion(page, v2 + 1);
  expect(((await serverBuilding(page, "sheep_farm")) as FieldsServerBuilding).fields?.assigned).toBe(15);
  await page.keyboard.press("Escape");
  await pick(page, "production", "pasture", 0);
  await clickTile(page, PASTURE_RECT_FROM);
  await expectVersion(page, v2 + 2);
  expect(((await serverBuilding(page, "sheep_farm")) as FieldsServerBuilding).fields?.assigned).toBe(16);
  await page.keyboard.press("Escape");

  // The later specs keep the economy they were written for: the farm is
  // paused (no upkeep, no workers); a paused farm still accepts fields.
  await clickTile(page, { x: SHEEP_FARM.x + 1, y: SHEEP_FARM.y + 1 });
  await expect(page.getByTestId("info-name")).toHaveText("Sheep farm");
  await page.getByTestId("info-pause").click();
  await expect.poll(async () => (await serverBuilding(page, "sheep_farm")).status).toBe("paused");
  await page.keyboard.press("Escape");
});
