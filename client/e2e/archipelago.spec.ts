import { expect, type Page, test } from "@playwright/test";
import {
  camera,
  clickIsland,
  clickLabel,
  expectFocused,
  expectLod,
  freeCanvasPoint,
  islandPoint,
  type Lod,
  lod,
  type Point,
  setCamera,
  shipPoint,
  showArchipelago,
  showIsland,
  worldReady,
} from "./archipelago";
import { dismissAwayDialog } from "./away";
import { E2E_TIME_SCALE, ISLAND, ISLAND_INLAND, ISLAND2, ISLAND2_INLAND, ROTATION_HOUSES } from "./constants";

// One continuous world (D-048) on the world the voyage spec left behind
// (island 2 settled, the sloop sailing "Fish home"): a mouse pan across
// the sea from the start island to island 2, wheel zoom through the three
// LODs without flicker, the four camera rotation steps with a road tile
// placed in each, clickable island labels and the island card, the route
// editor's island pickers (and the world-click shortcut), the server's
// loop time and estimated effects, the sloop assigned from the editor
// moving with its ETA badge at near and far LOD, minimap and tab jumps.
// Further tests render the synthetic fixtures without a server: the far
// LOD draw-call budget and culling, Esc cancelling a ship drag, the ship
// styles, the editor suspended by a ship selection, and jumps that start
// where the camera is.

test.describe.configure({ mode: "serial" });

/** A leg with handling (20 s + up to 2 min) in wall ms at the E2E time scale, plus margin. */
const LEG_WALL_MS = 140_000 / E2E_TIME_SCALE + 15_000;
const ORDER: Lod[] = ["near", "mid", "far"];

interface ServerShip {
  id: number;
  state: string;
  island_id: string;
  route_id: number;
}

async function tile(page: Page, island: string, t: Point): Promise<Point> {
  return page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [island, t.x, t.y] as const);
}

/** Whether a sequence of levels never goes back (in `order`). */
function monotonic(seq: Lod[], order: Lod[]): boolean {
  for (let i = 1; i < seq.length; i++) if (order.indexOf(seq[i]!) < order.indexOf(seq[i - 1]!)) return false;
  return true;
}

/** Number of level changes in a sequence. */
function flips(seq: Lod[]): number {
  let n = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) n++;
  return n;
}

/** Type and rotation of the server's building at a tile of an island (null: none). */
async function buildingAt(page: Page, island: string, t: Point): Promise<{ type: string; rotation: number } | null> {
  return page.evaluate(
    ([id, x, y]) => {
      const b = window.__newShores!.getServer()!.display.islands.find((i) => i.id === id)!.buildings.find((x2) => x2.x === x && x2.y === y);
      return b ? { type: b.type, rotation: b.rotation } : null;
    },
    [island, t.x, t.y] as const,
  );
}

test("one continuous world: pan, LOD zoom, rotation, labels, route pickers, minimap and tabs", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await dismissAwayDialog(page);
  await expect(page.getByTestId("hud-ship-count")).toHaveText("1");
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
  await worldReady(page, ISLAND);
  await expectLod(page, "near");
  await expectFocused(page, ISLAND);

  // The four camera rotation steps 0 → 1 → 2 → 3 (right button, E, E),
  // then back 3 → 2 → 1 → 0 (Q, left button, Q), always about the same
  // target and zoom. In each distinct step a settler house is placed by a
  // click with building rotation step × 90° (world-relative, D-042): the
  // server has it on the intended tile with that rotation. (First: the
  // commands also keep the world from producing an away summary mid-test.)
  await showIsland(page, ISLAND);
  await expectLod(page, "near");
  await expect
    .poll(() => page.evaluate((id) => window.__newShores!.getServer()!.display.islands.find((i) => i.id === id)!.inventory.planks?.stock ?? 0, ISLAND), {
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(10_000 * ROTATION_HOUSES.length);
  const placeHouse = async (step: number) => {
    const t = ROTATION_HOUSES[step]!;
    const rotation = step * 90;
    await page.getByTestId("build-tab-houses").click();
    await page.getByTestId("build-house_settlers").click();
    for (let r = 0; r < rotation; r += 90) await page.keyboard.press("r");
    await expect(page.getByTestId("tool-hint")).toContainText(`(${rotation}°)`);
    const p = await tile(page, ISLAND, t);
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => page.evaluate(() => window.__newShores!.ghostTile())).toEqual(t);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => buildingAt(page, ISLAND, t)).toEqual({ type: "house_settlers", rotation });
    await page.keyboard.press("Escape");
  };
  const press = async (k: "button-right" | "button-left" | "E" | "Q", to: number) => {
    const before = await camera(page);
    if (k === "button-right") await page.getByTestId("camera-rotate-right").click();
    else if (k === "button-left") await page.getByTestId("camera-rotate-left").click();
    else await page.keyboard.press(k);
    await expect.poll(async () => (await camera(page)).rotation).toBe(to);
    const after = await camera(page);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
    expect(after.half).toBeCloseTo(before.half, 6);
  };
  expect((await camera(page)).rotation).toBe(0);
  await placeHouse(0);
  await press("button-right", 1);
  await placeHouse(1);
  await press("E", 2);
  await placeHouse(2);
  await press("E", 3);
  await placeHouse(3);
  await press("Q", 2);
  await press("button-left", 1);
  await press("Q", 0);

  // Back at the start island for the pan.
  await showIsland(page, ISLAND);
  // Pan by mouse drags from the start island across the sea to island 2:
  // tile positions of both islands are finite before and after, the LOD
  // stays near and nothing switches.
  expect(Number.isFinite((await tile(page, ISLAND, ISLAND_INLAND)).x)).toBe(true);
  expect(Number.isFinite((await tile(page, ISLAND2, ISLAND2_INLAND)).x)).toBe(true);
  const lods: Lod[] = [];
  for (let i = 0; i < 20 && (await page.evaluate(() => window.__newShores!.focusedIsland())) !== ISLAND2; i++) {
    const target = await tile(page, ISLAND2, ISLAND2_INLAND);
    const from = await freeCanvasPoint(page);
    const d = { x: from.x - target.x, y: from.y - target.y };
    const k = Math.min(1, 220 / Math.hypot(d.x, d.y));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + d.x * k, from.y + d.y * k, { steps: 8 });
    await page.mouse.up();
    lods.push(await lod(page));
  }
  await expectFocused(page, ISLAND2);
  expect(lods.every((l) => l === "near")).toBe(true);
  await expect(page.getByTestId(`island-tab-${ISLAND2}`)).toHaveAttribute("aria-selected", "true");
  expect(Number.isFinite((await tile(page, ISLAND, ISLAND_INLAND)).x)).toBe(true);
  expect(Number.isFinite((await tile(page, ISLAND2, ISLAND2_INLAND)).x)).toBe(true);

  // Wheel zoom from a single house to the whole archipelago and back: the
  // sampled levels are monotonic (no flicker) and pass all three.
  await setCamera(page, { half: 7 });
  const at = await freeCanvasPoint(page);
  await page.mouse.move(at.x, at.y);
  const out: Lod[] = [await lod(page)];
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
    out.push(await lod(page));
  }
  await expect.poll(async () => (await camera(page)).half).toBeGreaterThan(48);
  out.push(await lod(page));
  console.log(`zoom out: ${out.join(" ")}`);
  expect(monotonic(out, ORDER)).toBe(true);
  expect(new Set(out)).toEqual(new Set(ORDER));
  const back: Lod[] = [await lod(page)];
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(60);
    back.push(await lod(page));
  }
  console.log(`zoom in: ${back.join(" ")}`);
  expect(monotonic(back, [...ORDER].reverse())).toBe(true);
  expect(back.at(-1)).toBe("near");
  // A small back-and-forth at the near/mid boundary changes the level at most once.
  await setCamera(page, { half: 29 });
  await expectLod(page, "near");
  const wobble: Lod[] = [];
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, i % 2 === 0 ? 60 : -60);
    await page.waitForTimeout(60);
    wobble.push(await lod(page));
  }
  console.log(`wobble: ${wobble.join(" ")}`);
  expect(flips(["near", ...wobble])).toBeLessThanOrEqual(1);

  // Hovering an island at mid LOD shows its tooltip.
  await showIsland(page, ISLAND, 40);
  await expectLod(page, "mid");
  const hover = await islandPoint(page, ISLAND, ISLAND_INLAND);
  await page.mouse.move(hover.x, hover.y);
  await expect(page.getByTestId("island-tooltip")).toContainText("Start");
  await expect(page.getByTestId("island-tooltip")).toContainText("Warehouse");

  // Far LOD: the islands with their lite models (warehouses and shipyards counted as landmarks);
  // labels at every LOD: island 2's label opens its card.
  await showArchipelago(page);
  await expect.poll(() => page.evaluate(() => window.__newShores!.landmarks())).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId(`island-label-${ISLAND}`)).toBeVisible();
  await clickLabel(page, ISLAND2);
  await expect(page.getByTestId("island-card")).toBeVisible();
  await expect(page.getByTestId("island-card-name")).toHaveText("Island 2");
  await expect(page.getByTestId("island-card-fertilities")).toContainText("hemp");
  await expect(page.getByTestId("island-card-deposits")).toContainText("iron");
  await expect(page.getByTestId("island-card-enter")).toHaveText("Go to island");
  // A drag on a panel does not pan.
  const cam0 = await camera(page);
  const top = (await page.getByTestId("hud-gold").boundingBox())!;
  await page.mouse.move(top.x + 2, top.y + 2);
  await page.mouse.down();
  await page.mouse.move(top.x + 200, top.y + 200, { steps: 8 });
  await page.mouse.up();
  expect(await camera(page)).toEqual(cam0);

  // The sloop sails "Fish home": unassign it in its ship panel and let it arrive.
  const [sloop] = await page.evaluate(() => window.__newShores!.getServer()!.display.ships as ServerShip[]);
  expect(sloop!.route_id).not.toBe(0);
  await page.getByTestId("hud-ships").click();
  await page.getByTestId(`ship-${sloop!.id}`).click();
  await expect(page.getByTestId("ship-panel")).toBeVisible();
  await page.getByTestId("ship-panel-unassign").click();
  await expect(page.getByTestId("ship-panel-route")).toContainText("none");
  await expect(page.getByTestId("ship-panel-state")).toHaveText("Idle", { timeout: LEG_WALL_MS });
  const at2 = (await page.evaluate(() => window.__newShores!.getServer()!.display.ships as ServerShip[]))[0]!.island_id;
  const other = at2 === ISLAND ? ISLAND2 : ISLAND;

  // Click–click shipment: "Send to…" then a tap on the target island opens the dialog preset to it.
  await page.getByTestId("ship-panel-send-to").click();
  await expect(page.getByTestId("arch-hint")).toContainText("destination");
  await clickIsland(page, other, other === ISLAND ? ISLAND_INLAND : ISLAND2_INLAND);
  await expect(page.getByTestId("shipment-dialog")).toBeVisible();
  await expect(page.getByTestId("shipment-dest")).toHaveValue(other);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shipment-dialog")).toHaveCount(0);

  // A new route built from the pickers only. Two stops at island 2 are
  // rejected by the server (route_invalid), shown inline and as a toast;
  // the second stop's island picker changes it to the start island.
  const camBefore = await camera(page);
  await page.getByTestId("hud-routes").click();
  await page.getByTestId("route-new").click();
  expect(await camera(page)).toEqual(camBefore); // opening the editor does not move the camera
  await expect(page.getByTestId("route-loop")).toHaveText("Save to compute");
  await expect(page.getByTestId("route-effects")).toContainText("Save to compute");
  await page.getByTestId("route-stop-add").selectOption(ISLAND2);
  await page.getByTestId("route-stop-add").selectOption(ISLAND2);
  await expect(page.getByTestId("route-stop-1")).toBeVisible();
  await page.getByTestId("route-save").click();
  await expect(page.getByTestId("route-error")).toContainText("both at");
  await expect(page.getByTestId("toast").first()).toContainText("both at");
  await expect(page.getByTestId("route-editor-title")).toHaveText("New route");
  // Each option names the island with the stock of the stop's goods (none listed yet: the first good).
  await expect(page.getByTestId("route-stop-island-1").locator("option", { hasText: "Start" })).toHaveText(/^Start · Wood \d+\/\d+$/);
  await page.getByTestId("route-stop-island-1").selectOption(ISLAND);
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
  // The shortcut: a click on an island in the world (here at mid LOD, the
  // island clear of the editor panel) appends a stop (removed again, unsaved).
  await showIsland(page, ISLAND2, 40);
  await expectLod(page, "mid");
  await clickIsland(page, ISLAND2, ISLAND2_INLAND);
  await expect(page.getByTestId("route-stop-name-2")).toContainText("Island 2");
  await page.getByTestId("route-stop-remove-2").click();
  await expect(page.getByTestId("route-stop-2")).toHaveCount(0);

  // Assign the sloop from the editor; it sails along the highlighted route
  // with an ETA badge, and its screen position changes (time-scaled).
  await page.getByTestId(`route-assign-${sloop!.id}`).click();
  await expect(page.getByTestId(`route-unassign-${sloop!.id}`)).toBeVisible();
  await page.getByTestId("hud-ships").click();
  await page.getByTestId(`ship-${sloop!.id}`).click();
  await expect(page.getByTestId("ship-eta-badge")).toContainText(/departs in|arrives in/);
  await expect(page.getByTestId("ship-eta-badge")).toBeVisible();
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
  // Dragging a ship that is not idle pans: bring the sloop to the screen
  // centre, then zoom in to near LOD around it — still drawn and badged.
  const vp = page.viewportSize()!;
  const ps = await shipPoint(page, sloop!.id);
  await page.mouse.move(ps.x, ps.y);
  await page.mouse.down();
  await page.mouse.move(vp.width / 2, vp.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId("shipment-dialog")).toHaveCount(0);
  await setCamera(page, { half: 18 });
  await expectLod(page, "near");
  // shipPoint waits for a finite projection of the drawn ship.
  await shipPoint(page, sloop!.id);
  await expect(page.getByTestId("ship-eta-badge")).toBeVisible();
  await expect(page.getByTestId("ship-eta-badge")).toContainText(/departs in|arrives in/);

  // Minimap jump: a click pans the camera target there, the zoom is kept.
  await page.getByTestId("ship-panel-close").click();
  const mm = (await page.getByTestId("minimap").boundingBox())!;
  const halfBefore = (await camera(page)).half;
  const want = await page.evaluate(
    ([w, h]) => {
      // The minimap's projection: the islands' box plus 12 tiles, fitted and centred.
      const is = window.__newShores!.getServer()!.display.islands;
      const minX = Math.min(...is.map((i) => i.position.x)) - 12;
      const maxX = Math.max(...is.map((i) => i.position.x + i.width)) + 12;
      const minY = Math.min(...is.map((i) => i.position.y)) - 12;
      const maxY = Math.max(...is.map((i) => i.position.y + i.height)) + 12;
      const scale = Math.min((w as number) / (maxX - minX), (h as number) / (maxY - minY));
      const ox = ((w as number) - (maxX - minX) * scale) / 2;
      const oy = ((h as number) - (maxY - minY) * scale) / 2;
      // Island 2's centre on the minimap.
      const i2 = is.find((i) => i.id === "island2")!;
      const cx = i2.position.x + i2.width / 2;
      const cy = i2.position.y + i2.height / 2;
      return { px: ox + (cx - minX) * scale, py: oy + (cy - minY) * scale, x: cx, y: cy };
    },
    [mm.width, mm.height] as const,
  );
  await setCamera(page, { x: 10, y: 10 });
  await page.mouse.click(mm.x + want.px, mm.y + want.py);
  await expect.poll(async () => Math.hypot((await camera(page)).x - want.x, (await camera(page)).y - want.y)).toBeLessThan(2);
  expect((await camera(page)).half).toBeCloseTo(halfBefore, 6);
  await expectFocused(page, ISLAND2);

  // Tabs jump with a ≤ 350 ms animation (observed within 1.5 s); the focused island follows.
  await showArchipelago(page);
  const t0 = Date.now();
  await page.getByTestId(`island-tab-${ISLAND}`).click();
  await expectFocused(page, ISLAND);
  await expect.poll(() => page.evaluate(() => Number.isFinite(window.__newShores!.tileToScreen("start", 1, 1).x))).toBe(true);
  const jumpMs = Date.now() - t0;
  console.log(`tab jump observed after ${jumpMs} ms (animation 350 ms, polled)`);
  expect(jumpMs).toBeLessThan(1_500);
  // Zoomed in from far to the near default; the build menu shows the focused island.
  await expectLod(page, "near");
  expect((await camera(page)).half).toBeCloseTo(18, 3);
  await expect(page.getByTestId(`island-tab-${ISLAND}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("build-menu")).toBeVisible();
  // With the editor closed, a label opens the island card; Enter on the
  // selected island jumps there (a closer zoom is kept).
  await page.getByTestId("route-editor-close").click();
  await setCamera(page, { half: 12 });
  await clickLabel(page, ISLAND);
  await expect(page.getByTestId("island-card-name")).toHaveText("Start");
  await page.getByTestId("island-card-close").click();
  await showArchipelago(page);
  await clickLabel(page, ISLAND2);
  await expect(page.getByTestId("island-card-name")).toHaveText("Island 2");
  // Enter on a focused button activates the button; on the world it jumps.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Enter");
  await expectFocused(page, ISLAND2);
  await expectLod(page, "near");
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
});

test("the 8-island / 20-ship fixture: far LOD within the draw-call budget; off-screen islands are culled", async ({ page }) => {
  await page.goto("/?fixture=archipelago-8x20");
  await worldReady(page, "isle1");
  await expectLod(page, "far");
  await expect(page.locator('[data-testid^="island-label-"]')).toHaveCount(8);
  const counts = await page.evaluate(() => {
    const d = window.__newShores!.getServer()!.display;
    return { islands: d.islands.length, ships: d.ships.length, routes: d.routes.length, unpaid: d.ships.filter((s) => s.state === "anchored_unpaid").length };
  });
  expect(counts).toMatchObject({ islands: 8, ships: 20, routes: 3 });
  expect(counts.unpaid).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__newShores!.visibleIslands())).toHaveLength(8);
  expect(await page.evaluate(() => window.__newShores!.landmarks())).toBe(0); // no buildings in this fixture
  // The minimap's land layer is cached: the fixture's 250 ms model updates
  // (new display objects, same geometry) create no new canvases.
  await expect(page.getByTestId("minimap")).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __canvases: number };
    w.__canvases = 0;
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      if (tag.toLowerCase() === "canvas") w.__canvases++;
      return create(tag, options);
    }) as typeof document.createElement;
  });
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => (window as unknown as { __canvases: number }).__canvases)).toBe(0);
  await page.waitForTimeout(5_500);
  const stats = await page.evaluate(() => ({ drawCalls: window.__newShores!.drawCalls(), frames: window.__newShores!.frameStats(5_000) }));
  console.log(`fixture archipelago-8x20 far LOD: ${JSON.stringify(stats)}`);
  // 8 islands drawn as at near LOD (ground, plateaus and crags, trees,
  // scatter: ≈ 6 each, measured 59) + sea + haze + 1 ship type + arrows + 3
  // route ribbons (+ a selection ring).
  expect(stats.drawCalls).toBeGreaterThan(0);
  expect(stats.drawCalls).toBeLessThanOrEqual(72);

  // Pan so that isle1 leaves the camera's footprint: it is not rendered.
  await setCamera(page, { x: 200, y: 160, half: 60 });
  await expect.poll(() => page.evaluate(() => window.__newShores!.visibleIslands())).not.toContain("isle1");
  await page.waitForTimeout(300);
  const fewer = await page.evaluate(() => ({ visible: window.__newShores!.visibleIslands().length, drawCalls: window.__newShores!.drawCalls() }));
  console.log(`culled: ${JSON.stringify(fewer)}`);
  expect(fewer.visible).toBeLessThan(8);
  expect(fewer.drawCalls).toBeLessThan(stats.drawCalls);
  expect(await page.evaluate(() => window.__newShores!.engineCount())).toBe(1);
});

/** Clicks a control and returns the projection of an archipelago point before and in the first frame of the camera animation. */
async function jumpStart(page: Page, testId: string, at: Point): Promise<{ before: Point; first: Point } | null> {
  return page.evaluate(
    async ([id, x, y]) => {
      const h = window.__newShores!;
      const before = h.archToScreen(x as number, y as number);
      (document.querySelector(`[data-testid="${id as string}"]`) as HTMLElement).click();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        // tileToScreen is NaN while the camera animates.
        if (!Number.isFinite(h.tileToScreen("isle1", 0, 0).x)) return { before, first: h.archToScreen(x as number, y as number) };
      }
      return null;
    },
    [testId, at.x, at.y] as const,
  );
}

test("fixture: Esc cancels a ship drag, ship styles, selecting a ship suspends the editor, jumps start where the camera is", async ({ page }) => {
  await page.goto("/?fixture=archipelago-8x20");
  await worldReady(page, "isle1");

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
  await expect(page.getByTestId("arch-hint")).toHaveCount(0);
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

  // Jumps (island card, tabs) start exactly where the camera is (no snap
  // in the first animation frame) and zoom in to the near default.
  await clickIsland(page, "isle2", { x: 8, y: 8 });
  await expect(page.getByTestId("island-card")).toBeVisible();
  const fixed = { x: 100, y: 60 };
  const go = await jumpStart(page, "island-card-enter", fixed);
  expect(go).not.toBeNull();
  expect(Math.hypot(go!.first.x - go!.before.x, go!.first.y - go!.before.y)).toBeLessThan(12);
  await expectFocused(page, "isle2");
  await expectLod(page, "near");
  const across = await jumpStart(page, "island-tab-isle6", fixed);
  expect(across).not.toBeNull();
  expect(Math.hypot(across!.first.x - across!.before.x, across!.first.y - across!.before.y)).toBeLessThan(12);
  await expectFocused(page, "isle6");
  // A pan in progress when a tab is clicked is cancelled, not continued after the jump.
  await worldReady(page, "isle6");
  const free = await freeCanvasPoint(page);
  await page.mouse.move(free.x, free.y);
  await page.mouse.down();
  await page.mouse.move(free.x + 40, free.y + 10, { steps: 4 });
  await page.evaluate(() => (document.querySelector('[data-testid="island-tab-isle3"]') as HTMLElement).click());
  await expectFocused(page, "isle3");
  await worldReady(page, "isle3");
  const settled = await camera(page);
  await page.mouse.move(free.x + 200, free.y + 120, { steps: 6 });
  await page.mouse.up();
  expect(await camera(page)).toEqual(settled);

  // A click during a jump is ignored, but only that press: right after the
  // jump the wheel zooms without another click first.
  const into = await freeCanvasPoint(page);
  await page.evaluate(() => (document.querySelector('[data-testid="island-tab-isle1"]') as HTMLElement).click());
  await page.mouse.click(into.x, into.y);
  await expectFocused(page, "isle1");
  await worldReady(page, "isle1");
  const halfBefore = (await camera(page)).half;
  const wheelAt = await freeCanvasPoint(page);
  await page.mouse.move(wheelAt.x, wheelAt.y);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await camera(page)).half).toBeGreaterThan(halfBefore * 1.3);
});
