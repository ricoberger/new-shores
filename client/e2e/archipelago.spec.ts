import { expect, type Page, test } from "@playwright/test";
import { clickIsland, expectView, islandPoint, type Point, shipPoint, toArchipelago, view } from "./archipelago";
import { dismissAwayDialog } from "./away";
import { E2E_TIME_SCALE, ISLAND, ISLAND_INLAND, ISLAND2, ISLAND2_INLAND, WAREHOUSE_TILE } from "./constants";

// The archipelago view and the graphical route editor (R-39), on the world
// the voyage spec left behind (island 2 settled, the sloop sailing "Fish
// home"): zoom out past the island maximum, the island card, a route built
// by clicking islands (a same-island stop is rejected by the server), the
// server's loop time and estimated effects, the sloop assigned from the
// editor moving between the islands, entering island 2 from its card and
// returning with the back control (camera restored on re-entry). A second
// test renders the synthetic 8-island / 20-ship fixture without a server
// and checks the draw-call budget.

test.describe.configure({ mode: "serial" });

/** A leg with handling (20 s + up to 2 min) in wall ms at the E2E time scale, plus margin. */
const LEG_WALL_MS = 140_000 / E2E_TIME_SCALE + 15_000;

interface ServerShip {
  id: number;
  state: string;
  island_id: string;
  route_id: number;
}

test("archipelago view, island card, graphical route and transitions", async ({ page }) => {
  await page.goto("/");
  await dismissAwayDialog(page);
  await expect(page.getByTestId("hud-ship-count")).toHaveText("1");
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
  await expectView(page, ISLAND);

  // One wheel tick at the island maximum does not switch; zooming further out does.
  const box = (await page.getByTestId("game-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(500);
  expect(await view(page)).toBe(ISLAND);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 300);
  await expectView(page, "archipelago");
  await expect(page.getByTestId(`island-label-${ISLAND}`)).toBeVisible();
  await expect(page.getByTestId(`island-label-${ISLAND2}`)).toBeVisible();
  await expect(page.getByTestId("build-menu")).toHaveCount(0);

  // Passive labels never take the pointer: a drag starting on a label pans the camera.
  const label = (await page.getByTestId(`island-label-${ISLAND2}`).boundingBox())!;
  const before = await islandPoint(page, ISLAND2);
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + label.width / 2 - 60, label.y + label.height / 2 - 20, { steps: 8 });
  await page.mouse.up();
  const after = await islandPoint(page, ISLAND2);
  expect(Math.abs(after.x - before.x - -60)).toBeLessThan(3);
  // A drag on a panel does not pan.
  const top = (await page.getByTestId("hud-gold").boundingBox())!;
  await page.mouse.move(top.x + 2, top.y + 2);
  await page.mouse.down();
  await page.mouse.move(top.x + 200, top.y + 200, { steps: 8 });
  await page.mouse.up();
  const still = await islandPoint(page, ISLAND2);
  expect(Math.abs(still.x - after.x)).toBeLessThan(1);

  // Single click selects island 2: the card with fertilities and deposits.
  await clickIsland(page, ISLAND2, ISLAND2_INLAND);
  await expect(page.getByTestId("island-card")).toBeVisible();
  await expect(page.getByTestId("island-card-name")).toHaveText("Island 2");
  await expect(page.getByTestId("island-card-fertilities")).toContainText("hemp");
  await expect(page.getByTestId("island-card-deposits")).toContainText("iron");
  // Hovering an island shows its tooltip.
  const hover = await islandPoint(page, ISLAND, ISLAND_INLAND);
  await page.mouse.move(hover.x, hover.y);
  await expect(page.getByTestId("island-tooltip")).toContainText("Start");
  await expect(page.getByTestId("island-tooltip")).toContainText("Warehouse");

  // The sloop sails "Fish home": unassign it in its ship panel and let it arrive.
  const [sloop] = await page.evaluate(() => window.__newShores!.getServer()!.display.ships as ServerShip[]);
  expect(sloop!.route_id).not.toBe(0);
  await page.getByTestId("hud-ships").click();
  await page.getByTestId(`ship-${sloop!.id}`).click();
  await expect(page.getByTestId("ship-panel")).toBeVisible();
  await page.getByTestId("ship-panel-unassign").click();
  await expect(page.getByTestId("ship-panel-route")).toContainText("none");
  await expect(page.getByTestId("ship-panel-state")).toHaveText("Idle", { timeout: LEG_WALL_MS });
  const at = (await page.evaluate(() => window.__newShores!.getServer()!.display.ships as ServerShip[]))[0]!.island_id;
  const other = at === ISLAND ? ISLAND2 : ISLAND;

  // Click–click shipment: "Send to…" then a tap on the target island opens the dialog preset to it.
  await page.getByTestId("ship-panel-send-to").click();
  await expect(page.getByTestId("arch-hint")).toContainText("destination");
  await clickIsland(page, other, other === ISLAND ? ISLAND_INLAND : ISLAND2_INLAND);
  await expect(page.getByTestId("shipment-dialog")).toBeVisible();
  await expect(page.getByTestId("shipment-dest")).toHaveValue(other);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shipment-dialog")).toHaveCount(0);

  // A new route by clicking islands. Two stops at island 2 are rejected by
  // the server (route_invalid), shown inline and as a toast.
  await page.getByTestId("hud-routes").click();
  await page.getByTestId("route-new").click();
  await expect(page.getByTestId("route-loop")).toHaveText("Save to compute");
  await expect(page.getByTestId("route-effects")).toContainText("Save to compute");
  await clickIsland(page, ISLAND2, ISLAND2_INLAND);
  await clickIsland(page, ISLAND2, ISLAND2_INLAND);
  await expect(page.getByTestId("route-stop-1")).toBeVisible();
  await page.getByTestId("route-save").click();
  await expect(page.getByTestId("route-error")).toContainText("both at");
  await expect(page.getByTestId("toast").first()).toContainText("both at");
  await expect(page.getByTestId("route-editor-title")).toHaveText("New route");
  await page.getByTestId("route-stop-remove-1").click();
  await clickIsland(page, ISLAND, ISLAND_INLAND);
  await expect(page.getByTestId("route-stop-name-1")).toContainText("Start");
  await page.getByTestId("route-name").fill("Fish shuttle");
  await page.getByTestId("route-load-add-0").click();
  await page.getByTestId("route-load-good-0-0").selectOption("fish");
  await page.getByTestId("route-load-max-0-0").fill("10");
  await page.getByTestId("route-unload-add-1").click();
  await page.getByTestId("route-unload-good-1-0").selectOption("fish");
  await page.getByTestId("route-save").click();
  await expect(page.getByTestId("route-editor-title")).toHaveText(/Route #\d+/);
  await expect(page.getByTestId("route-loop")).toContainText("loop time");
  await expect(page.getByTestId("route-effects")).toContainText("estimated");
  await expect(page.getByTestId(`route-effect-${ISLAND2}-fish`)).toContainText("−10");
  await expect(page.getByTestId(`route-effect-${ISLAND}-fish`)).toContainText("+10");

  // Assign the sloop from the editor; it sails along the highlighted route
  // with an ETA badge, and its screen position changes (time-scaled).
  await page.getByTestId(`route-assign-${sloop!.id}`).click();
  await expect(page.getByTestId(`route-unassign-${sloop!.id}`)).toBeVisible();
  await expect(page.getByTestId("ship-eta-badge")).toContainText(/departs in|arrives in/);
  const p0 = await shipPoint(page, sloop!.id);
  await expect
    .poll(
      async () => {
        const p = await shipPoint(page, sloop!.id);
        return Math.hypot(p.x - p0.x, p.y - p0.y);
      },
      { timeout: LEG_WALL_MS },
    )
    .toBeGreaterThan(20);

  // Enter island 2 from its card (≤ 400 ms transition), then back.
  await page.getByTestId("route-editor-close").click();
  await clickIsland(page, ISLAND2, ISLAND2_INLAND);
  await expect(page.getByTestId("island-card")).toBeVisible();
  const t0 = Date.now();
  await page.getByTestId("island-card-enter").click();
  await expectView(page, ISLAND2);
  const transitionMs = Date.now() - t0;
  console.log(`archipelago -> island 2 transition observed after ${transitionMs} ms (animation 350 ms, polled)`);
  expect(transitionMs).toBeLessThan(1_500);
  await expect(page.getByTestId(`island-tab-${ISLAND2}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("to-archipelago")).toBeVisible();
  await expect(page.getByTestId("build-menu")).toBeVisible();
  // Pan a little; the camera position is remembered per island.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const tile = await page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [
    ISLAND2,
    ISLAND2_INLAND.x,
    ISLAND2_INLAND.y,
  ] as const);
  await toArchipelago(page);
  // Backspace and Enter on a selected island work the same way.
  await clickIsland(page, ISLAND, ISLAND_INLAND);
  await page.keyboard.press("Enter");
  await expectView(page, ISLAND);
  await expect.poll(() => page.evaluate((t) => window.__newShores!.tileToScreen("start", t.x, t.y).x, WAREHOUSE_TILE)).not.toBeNaN();
  await page.keyboard.press("Backspace");
  await expectView(page, "archipelago");
  // The top-bar island switcher works from the archipelago view.
  await page.getByTestId(`island-tab-${ISLAND2}`).click();
  await expectView(page, ISLAND2);
  const again = await page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [
    ISLAND2,
    ISLAND2_INLAND.x,
    ISLAND2_INLAND.y,
  ] as const);
  expect(Math.abs(again.x - tile.x)).toBeLessThan(1.5);
  expect(Math.abs(again.y - tile.y)).toBeLessThan(1.5);
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
});

test("the 8-island / 20-ship fixture stays within the draw-call budget", async ({ page }) => {
  await page.goto("/?fixture=archipelago-8x20");
  await expectView(page, "archipelago");
  await expect(page.locator('[data-testid^="island-label-"]')).toHaveCount(8);
  const counts = await page.evaluate(() => {
    const d = window.__newShores!.getServer()!.display;
    return { islands: d.islands.length, ships: d.ships.length, routes: d.routes.length, unpaid: d.ships.filter((s) => s.state === "anchored_unpaid").length };
  });
  expect(counts).toMatchObject({ islands: 8, ships: 20, routes: 3 });
  expect(counts.unpaid).toBeGreaterThan(0);
  await page.waitForTimeout(5_500);
  const stats = await page.evaluate(() => ({ drawCalls: window.__newShores!.drawCalls(), frames: window.__newShores!.frameStats(5_000) }));
  console.log(`fixture archipelago-8x20: ${JSON.stringify(stats)}`);
  // 8 islands + 1 sea + 1 ship type + 1 arrows + 3 routes + 1 selection.
  expect(stats.drawCalls).toBeGreaterThan(0);
  expect(stats.drawCalls).toBeLessThanOrEqual(8 + 1 + 1 + 1 + 3 + 1);
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
});

/** Clicks a control and returns the projection of an archipelago point before and in the first transition frame. */
async function transitionStart(page: Page, testId: string, at: Point): Promise<{ before: Point; first: Point } | null> {
  return page.evaluate(
    async ([id, x, y]) => {
      const h = window.__newShores!;
      const before = h.archToScreen(x as number, y as number);
      (document.querySelector(`[data-testid="${id as string}"]`) as HTMLElement).click();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (h.view() === "transition") return { before, first: h.archToScreen(x as number, y as number) };
      }
      return null;
    },
    [testId, at.x, at.y] as const,
  );
}

test("fixture: continuous transitions, Esc cancels a ship drag, selecting a ship suspends the editor", async ({ page }) => {
  await page.goto("/?fixture=archipelago-8x20");
  await expectView(page, "archipelago");

  // Esc during a drag of an idle ship: the ship returns, the held pointer
  // neither drags nor pans, the release opens nothing.
  const idle = 4; // idle at isle2 in the fixture
  const p0 = await shipPoint(page, idle);
  const island0 = await islandPoint(page, "isle2");
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p0.x + 80, p0.y + 40, { steps: 8 });
  await expect(page.getByTestId("arch-hint")).toContainText("Drop ship");
  const dragged = await shipPoint(page, idle);
  expect(Math.hypot(dragged.x - p0.x, dragged.y - p0.y)).toBeGreaterThan(40);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("arch-hint")).not.toContainText("Drop ship");
  await page.mouse.move(p0.x + 160, p0.y + 120, { steps: 8 });
  const back = await shipPoint(page, idle);
  expect(Math.hypot(back.x - p0.x, back.y - p0.y)).toBeLessThan(2);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(page.getByTestId("shipment-dialog")).toHaveCount(0);
  const island1 = await islandPoint(page, "isle2");
  expect(Math.hypot(island1.x - island0.x, island1.y - island0.y)).toBeLessThan(1);

  // Ships are drawn in their state's style: anchored_unpaid greyed (the
  // renderer's instance style, exposed by the test hook).
  const unpaid = 5; // anchored_unpaid at isle5 in the fixture
  expect(await page.evaluate((id) => window.__newShores!.getServer()!.display.ships.find((s) => s.id === id)!.state, unpaid)).toBe("anchored_unpaid");
  await expect.poll(() => page.evaluate((id) => window.__newShores!.shipStyle(id), unpaid)).toBe("unpaid");
  expect(await page.evaluate((id) => window.__newShores!.shipStyle(id), idle)).toBe("active");

  // Selecting a ship while the route editor is open shows its panel (list
  // and scene); the editor is suspended and comes back.
  await page.getByTestId("hud-routes").click();
  await page.getByTestId("route-edit-1").click();
  await expect(page.getByTestId("route-editor")).toBeVisible();
  await page.getByTestId("route-name").fill("Draft kept");
  await page.getByTestId("hud-ships").click();
  await page.getByTestId(`ship-${idle}`).click();
  await expect(page.getByTestId("ship-panel-name")).toContainText(`#${idle}`);
  await expect(page.getByTestId("route-editor")).toHaveCount(0);
  await page.getByTestId("route-editor-resume").click();
  await expect(page.getByTestId("route-editor")).toBeVisible();
  const sp = await shipPoint(page, idle);
  await page.mouse.click(sp.x, sp.y);
  await expect(page.getByTestId("ship-panel-name")).toContainText(`#${idle}`);
  await page.getByTestId("ship-panel-close").click();
  await expect(page.getByTestId("route-editor")).toBeVisible();
  // Paused by a ship, with the Ships list open: "Back to route editor"
  // leaves the editor as the only side panel, its draft intact.
  await page.getByTestId("hud-ships").click();
  await page.getByTestId(`ship-${idle}`).click();
  await expect(page.getByTestId("ship-panel")).toBeVisible();
  await page.getByTestId("hud-ships").click();
  await expect(page.getByTestId("ships-panel")).toBeVisible();
  await page.getByTestId("route-editor-resume").click();
  await expect(page.getByTestId("route-editor")).toBeVisible();
  await expect(page.getByTestId("ships-panel")).toHaveCount(0);
  await expect(page.getByTestId("ship-panel")).toHaveCount(0);
  await expect(page.getByTestId("route-editor-resume")).toHaveCount(0);
  await expect(page.getByTestId("route-name")).toHaveValue("Draft kept");
  await expect(page.getByTestId("route-stop-name-0")).toContainText("Isle");
  await page.getByTestId("route-editor-close").click();

  // Entering an island starts the camera exactly where it was (no snap in
  // the first transition frame), from the archipelago and between islands.
  await clickIsland(page, "isle2", { x: 8, y: 8 });
  const fixed = { x: 100, y: 60 };
  const enter = await transitionStart(page, "island-card-enter", fixed);
  expect(enter).not.toBeNull();
  expect(Math.hypot(enter!.first.x - enter!.before.x, enter!.first.y - enter!.before.y)).toBeLessThan(12);
  await expectView(page, "isle2");
  const across = await transitionStart(page, "island-tab-isle6", fixed);
  expect(across).not.toBeNull();
  expect(Math.hypot(across!.first.x - across!.before.x, across!.first.y - across!.before.y)).toBeLessThan(12);
  await expectView(page, "isle6");
  const out = await transitionStart(page, "to-archipelago", fixed);
  expect(out).not.toBeNull();
  expect(Math.hypot(out!.first.x - out!.before.x, out!.first.y - out!.before.y)).toBeLessThan(12);
  await expectView(page, "archipelago");
});
