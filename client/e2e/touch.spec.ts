import { expect, type Page, test } from "@playwright/test";
import { expectView, islandPoint, shipPoint, view } from "./archipelago";
import { dismissAwayDialog } from "./away";
import {
  ISLAND,
  SAWMILL_MOVED,
  TOUCH_EMPTY,
  TOUCH_FOCUS,
  TOUCH_HOUSE,
  TOUCH_HOUSE_MOVED,
  TOUCH_HOUSE_WEBKIT,
  TOUCH_ROAD_FROM,
  TOUCH_ROAD_TO,
} from "./constants";
import { type Point, type Touch, touchFor } from "./touch";

// Touch alone on phone profiles (Pixel 5 / Chromium at 412 × 915 and
// iPhone 12 / WebKit): gestures on the fixtures (read-only) and the
// touch flows that change the dev world (after the away project, on the
// tiles reserved in constants.ts). WebKit has no multi-touch emulation:
// it skips the pinch flow and runs the world flows on its own tile.

test.describe.configure({ mode: "serial" });

const DENSE = "dense1";

async function tile(page: Page, island: string, t: Point): Promise<Point> {
  let p: Point = { x: NaN, y: NaN };
  await expect
    .poll(async () => {
      p = await page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [island, t.x, t.y] as const);
      return Number.isFinite(p.x);
    })
    .toBe(true);
  return p;
}

async function version(page: Page): Promise<number> {
  return page.evaluate(() => window.__newShores!.getServer()?.version ?? -1);
}

/** A point inside the canvas that no HUD element covers. */
async function freeCanvasPoint(page: Page): Promise<Point> {
  const vp = page.viewportSize()!;
  return { x: vp.width / 2, y: vp.height / 2 };
}

async function serverBuildingAt(page: Page, island: string, t: Point): Promise<{ id: number; type: string; x: number; y: number; paused: boolean } | null> {
  return page.evaluate(
    ([id, x, y]) => {
      const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === id)!;
      const b = is.buildings.find((b) => b.x === x && b.y === y);
      return b ? { id: b.id, type: b.type, x: b.x, y: b.y, paused: b.paused } : null;
    },
    [island, t.x, t.y] as const,
  );
}

/** A dense-fixture building of a type whose footprint centre is in the free middle of the screen. */
async function denseBuilding(page: Page, type: string, yFrom = 0.3, yTo = 0.6): Promise<{ id: number; at: Point }> {
  const found = await page.evaluate(
    ([t, y0, y1]) => {
      const h = window.__newShores!;
      const w = window.innerWidth;
      const hgt = window.innerHeight;
      for (const b of h.getServer()!.display.islands[0]!.buildings) {
        if (b.type !== t) continue;
        const at = h.tileToScreen("dense1", b.x + 1, b.y + 1);
        if (at.x > w * 0.25 && at.x < w * 0.75 && at.y > hgt * (y0 as number) && at.y < hgt * (y1 as number)) return { id: b.id, at };
      }
      return null;
    },
    [type, yFrom, yTo] as const,
  );
  expect(found, `a ${type} in the middle of the screen`).not.toBeNull();
  return found!;
}

/** One-finger pans (no tool active) until a tile of the start island is near the screen centre. */
async function centreOn(page: Page, t: Point): Promise<void> {
  const c = await freeCanvasPoint(page);
  for (let i = 0; i < 8; i++) {
    const p = await tile(page, ISLAND, t);
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    if (Math.hypot(dx, dy) < 20) return;
    const k = Math.min(1, 150 / Math.hypot(dx, dy));
    await touch.drag(c, { x: c.x + dx * k, y: c.y + dy * k });
  }
}

/**
 * Unassigns every ship from its route by touch and waits until none sails:
 * arrivals are server events that change the world version, so the
 * "nothing was sent" checks below compare versions of a quiet world.
 */
async function quietWorld(page: Page): Promise<void> {
  await page.goto("/");
  await dismissAwayDialog(page);
  const routed = await page.evaluate(() => window.__newShores!.getServer()!.display.ships.filter((s) => s.route_id !== 0).map((s) => s.id));
  for (const id of routed) {
    await page.getByTestId("hud-ships").tap();
    await page.getByTestId(`ship-${id}`).tap();
    await page.getByTestId("ship-panel-unassign").tap();
    await expect(page.getByTestId("ship-panel-route")).toContainText("none");
    await page.getByTestId("sheet-close").tap();
  }
  await expect
    .poll(() => page.evaluate(() => window.__newShores!.getServer()!.display.ships.every((s) => s.leg === null)), { timeout: 60_000 })
    .toBe(true);
}

/** The start island on the phone, centred on the touch tiles. */
async function openWorld(page: Page): Promise<void> {
  await page.goto("/");
  await dismissAwayDialog(page);
  await expectView(page, ISLAND);
  await centreOn(page, TOUCH_FOCUS);
}

let touch: Touch;

test.beforeEach(async ({ page, browserName }) => {
  touch = await touchFor(page, browserName);
});

test("one-finger pan moves the island view by the drag", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  const ref = { x: 30, y: 25 };
  const before = await tile(page, DENSE, ref);
  const a = await freeCanvasPoint(page);
  await touch.drag(a, { x: a.x - 80, y: a.y - 40 });
  const after = await tile(page, DENSE, ref);
  expect(Math.abs(after.x - before.x - -80)).toBeLessThan(4);
  expect(Math.abs(after.y - before.y - -40)).toBeLessThan(4);
});

/** Blocks the main thread for `ms` in every animation frame (a slow runner or phone). */
async function jank(page: Page, ms: number): Promise<void> {
  await page.evaluate((busy) => {
    const loop = () => {
      const end = performance.now() + busy;
      while (performance.now() < end);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, ms);
}

test("gestures on a janky main thread: pan, tap and long-press keep their meaning", async ({ page, browserName }) => {
  // On the GitHub runner every frame took hundreds of ms: a drag became a
  // long-press, and a held finger could be read as a tap. Event times decide.
  test.skip(browserName !== "chromium", "real touch events through CDP");
  test.setTimeout(120_000);
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  await page.getByTestId("build-tab-production").tap();
  await page.getByTestId("build-woodcutter").tap();
  const ref = { x: 30, y: 25 };
  const house = await denseBuilding(page, "house", 0.32, 0.6);
  await jank(page, 500);
  // With a build tool: a tap positions the ghost, a long-press only inspects.
  await touch.tap(await tile(page, DENSE, { x: 30, y: 24 }));
  await expect(page.getByTestId("placement-hint")).toContainText("30, 24");
  await touch.longPress(house.at);
  await expect(page.getByTestId("info-name")).toHaveText("House");
  await expect(page.getByTestId("placement-hint")).toContainText("30, 24"); // the long-press placed nothing
  await page.getByTestId("placement-cancel").tap();
  await page.getByTestId("sheet-close").tap();
  await expect(page.getByTestId("sheet")).toHaveCount(0);
  // Without a tool: a one-finger drag pans by exactly the drag.
  const before = await tile(page, DENSE, ref);
  const a = await freeCanvasPoint(page);
  await touch.drag(a, { x: a.x - 80, y: a.y - 40 });
  const after = await tile(page, DENSE, ref);
  expect(Math.abs(after.x - before.x - -80)).toBeLessThan(4);
  expect(Math.abs(after.y - before.y - -40)).toBeLessThan(4);
});

test("pinch zooms; pinching out at the maximum switches to the archipelago; tap back in", async ({ page }) => {
  test.skip(!touch.multiTouch, "no multi-touch emulation in this browser");
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  const c = await freeCanvasPoint(page);
  const span = async () => {
    const a = await tile(page, DENSE, { x: 20, y: 20 });
    const b = await tile(page, DENSE, { x: 40, y: 20 });
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  // A small pinch zooms out a little and never switches.
  const s0 = await span();
  await touch.pinch(c, 200, 160);
  const s1 = await span();
  expect(s1).toBeLessThan(s0 * 0.9);
  await page.waitForTimeout(300);
  expect(await view(page)).toBe(DENSE);
  // Pinching on: the island maximum, then the archipelago.
  for (let i = 0; i < 6 && (await view(page)) === DENSE; i++) await touch.pinch(c, 320, 60);
  await expectView(page, "archipelago");
  // Pinching in inside the archipelago never switches back.
  await touch.pinch(c, 100, 300);
  await page.waitForTimeout(500);
  expect(await view(page)).toBe("archipelago");
  // Tap the island (card), tap again (enter).
  const p = await islandPoint(page, DENSE, { x: 30, y: 25 });
  await touch.tap(p);
  await expect(page.getByTestId("island-card")).toBeVisible();
  await expect(page.getByTestId("sheet")).toBeVisible();
  await touch.tap(await islandPoint(page, DENSE, { x: 30, y: 25 }));
  await expectView(page, DENSE);
});

test("tap and long-press select a building, a ship and an island", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  const house = await denseBuilding(page, "house");
  await touch.tap(house.at);
  await expect(page.getByTestId("sheet")).toBeVisible();
  await expect(page.getByTestId("info-name")).toHaveText("House");
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-snap", "half");
  await page.getByTestId("sheet-close").tap();
  await expect(page.getByTestId("sheet")).toHaveCount(0);
  // Long-press opens the context panel.
  const depot = await denseBuilding(page, "woodcutter").catch(() => denseBuilding(page, "sawmill"));
  await touch.longPress(depot.at);
  await expect(page.getByTestId("info-panel")).toBeVisible();
  await expect(page.getByTestId("sheet")).toBeVisible();
  await page.getByTestId("sheet-close").tap();

  await page.goto("/?fixture=archipelago-8x20");
  await expectView(page, "archipelago");
  await touch.tap(await shipPoint(page, 4));
  await expect(page.getByTestId("ship-panel-name")).toContainText("#4");
  await page.getByTestId("sheet-close").tap();
  await touch.tap(await islandPoint(page, "isle1", { x: 10, y: 10 }));
  await expect(page.getByTestId("island-card-name")).toHaveText("Isle 1");
  await page.getByTestId("sheet-close").tap();
  await touch.longPress(await islandPoint(page, "isle3", { x: 8, y: 10 }));
  await expect(page.getByTestId("island-card-name")).toHaveText("Isle 3");
});

test("long-press opens the info panel over an open list sheet and keeps the tool", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  await page.getByTestId("build-tab-production").tap();
  await page.getByTestId("build-woodcutter").tap();
  await expect(page.getByTestId("placement-bar")).toBeVisible();
  await page.getByTestId("hud-quests").tap();
  await expect(page.getByTestId("quests-panel")).toBeVisible();
  // A building above the half-open sheet.
  const house = await denseBuilding(page, "house", 0.32, 0.5);
  await touch.longPress(house.at);
  await expect(page.getByTestId("info-panel")).toBeVisible();
  await expect(page.getByTestId("info-name")).toHaveText("House");
  await expect(page.getByTestId("quests-panel")).toHaveCount(0);
  await expect(page.getByTestId("placement-bar")).toBeVisible();
  await expect(page.getByTestId("placement-confirm")).toBeDisabled();
});

test("a mouse or pen taking over drops the touch-pending tile; the ghost follows the pointer", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "mouse and touch in one context: Chromium project");
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  await page.getByTestId("build-tab-production").tap();
  await page.getByTestId("build-woodcutter").tap();
  const ghost = () => page.evaluate(() => window.__newShores!.ghostTile());
  const a = { x: 30, y: 24 };
  const b = { x: 26, y: 26 };
  await touch.tap(await tile(page, DENSE, a));
  await expect.poll(ghost).toEqual(a);
  await expect(page.getByTestId("placement-confirm")).toBeEnabled();
  // The mouse hovers another tile.
  const pb = await tile(page, DENSE, b);
  await page.mouse.move(pb.x, pb.y);
  await expect.poll(ghost).toEqual(b);
  await expect(page.getByTestId("placement-confirm")).toBeDisabled();
  // The mouse click places where the ghost is (the read-only fixture rejects the command).
  await page.mouse.click(pb.x, pb.y);
  expect(await ghost()).toEqual(b);
  await expect(page.getByTestId("toast").first()).toContainText("place_building");
  // Touch again: a tap positions the ghost on the tapped tile.
  await touch.tap(await tile(page, DENSE, a));
  await expect.poll(ghost).toEqual(a);
});

test("keyboard: a dialog opened from a sheet takes focus, keeps Tab and returns focus", async ({ page }) => {
  await page.goto("/?fixture=archipelago-8x20");
  await expectView(page, "archipelago");
  await touch.tap(await shipPoint(page, 4));
  await expect(page.getByTestId("sheet")).toBeVisible();
  await page.getByTestId("ship-panel-scrap").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("dialog");
  await expect(dialog).toBeVisible();
  const focusedInDialog = () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return { inside: !!a?.closest('[data-testid="dialog"]'), id: a?.dataset.testid ?? "" };
    });
  expect((await focusedInDialog()).inside).toBe(true);
  const reached = new Set<string>();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const f = await focusedInDialog();
    expect(f.inside).toBe(true);
    reached.add(f.id);
  }
  expect(reached).toContain("dialog-confirm");
  expect(reached).toContain("dialog-cancel");
  await page.keyboard.press("Shift+Tab");
  expect((await focusedInDialog()).inside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("ship-panel-scrap")).toBeFocused();
  // The sheet's own trap works again.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="sheet"]'))).toBe(true);
  }
});

test("sheet snaps by its handle; sheet, HUD and build-bar drags never move the camera", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  const house = await denseBuilding(page, "house");
  await touch.tap(house.at);
  const sheet = page.getByTestId("sheet");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  const ref = { x: 10, y: 6 };
  const before = await tile(page, DENSE, ref);
  const vp = page.viewportSize()!;
  const handle = async () => {
    const b = (await page.getByTestId("sheet-handle").boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // Up to full, down to peek, by the handle (heights are fractions of the
  // area below the top bar).
  const dragTo = async (fraction: number) => {
    const h = await handle();
    const top = await page.evaluate((f) => {
      const host = document.querySelector('[data-testid="sheet"]')!.parentElement!.getBoundingClientRect();
      return host.bottom - host.height * f;
    }, fraction);
    const sheetTop = (await sheet.boundingBox())!.y;
    await touch.drag(h, { x: h.x, y: h.y + (top - sheetTop) });
  };
  await dragTo(0.85);
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await dragTo(0.22);
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  // Drags on the top bar, the sheet header and the build bar.
  const gold = (await page.getByTestId("hud-gold").boundingBox())!;
  await touch.drag({ x: gold.x + 4, y: gold.y + 4 }, { x: gold.x + 150, y: gold.y + 250 });
  await page.getByTestId("sheet-close").tap();
  await expect(sheet).toHaveCount(0);
  const menu = (await page.getByTestId("build-menu").boundingBox())!;
  await touch.drag({ x: menu.x + menu.width - 40, y: menu.y + menu.height - 30 }, { x: menu.x + 40, y: menu.y + menu.height - 30 });
  // Reopen and drag the sheet below peek: it closes.
  await touch.tap(house.at);
  await expect(sheet).toHaveAttribute("data-snap", "half");
  const body = (await sheet.boundingBox())!;
  await touch.drag({ x: body.x + body.width / 2, y: body.y + body.height - 40 }, { x: body.x + body.width / 2 - 100, y: body.y + 60 });
  const h = await handle();
  await touch.drag(h, { x: h.x, y: vp.height - 2 });
  await expect(sheet).toHaveCount(0);
  const after = await tile(page, DENSE, ref);
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
});

test("drag an idle ship onto another island, or Send to… and tap, opens the shipment dialog", async ({ page }) => {
  await page.goto("/?fixture=archipelago-8x20");
  await expectView(page, "archipelago");
  const idle = 4; // idle at isle2
  await touch.drag(await shipPoint(page, idle), await islandPoint(page, "isle1", { x: 10, y: 10 }), 16);
  await expect(page.getByTestId("shipment-dialog")).toBeVisible();
  await expect(page.getByTestId("shipment-dest")).toHaveValue("isle1");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shipment-dialog")).toHaveCount(0);
  await touch.tap(await shipPoint(page, idle));
  await page.getByTestId("ship-panel-send-to").tap();
  await expect(page.getByTestId("arch-hint")).toContainText("Tap the destination");
  await touch.tap(await islandPoint(page, "isle3", { x: 8, y: 10 }));
  await expect(page.getByTestId("shipment-dialog")).toBeVisible();
  await expect(page.getByTestId("shipment-dest")).toHaveValue("isle3");
});

test("every HUD control is at least 44 × 44 px; no horizontal overflow at 360 × 640", async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 412, "audit at 412 × 915 (Pixel 5 project)");
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, DENSE);
  // Open a sheet and the population chip so their controls are audited too.
  await touch.tap((await denseBuilding(page, "woodcutter").catch(() => denseBuilding(page, "sawmill"))).at);
  await expect(page.getByTestId("sheet")).toBeVisible();
  await page.getByTestId("hud-population-chip").tap();
  await expect(page.getByTestId("hud-population-list")).toBeVisible();
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("#root button, #root a, #root input, #root select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.dataset.testid ?? el.textContent?.trim().slice(0, 20)} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
  const count = await page.locator("#root button, #root input, #root select").count();
  expect(count).toBeGreaterThan(15);

  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
});

test("tablet layouts: every HUD control is reachable and at least 44 × 44 px", async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 412, "Chromium touch project (coarse pointer)");
  for (const vp of [
    { width: 481, height: 800 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto("/?fixture=dense-2x400");
    await expectView(page, DENSE);
    await expect(page.locator('[data-layout="tablet"]')).toHaveCount(1);
    // A side panel open too (tablets keep panels at the side).
    await touch.tap((await denseBuilding(page, "woodcutter").catch(() => denseBuilding(page, "sawmill"))).at);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("#root button, #root a, #root input, #root select")) {
        if (el.getClientRects().length === 0) continue; // not rendered
        // Controls in a scrolling row are reachable by scrolling that row.
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const name = el.dataset.testid ?? el.textContent?.trim().slice(0, 20) ?? "?";
        if (r.left < -0.5 || r.right > window.innerWidth + 0.5 || r.top < -0.5 || r.bottom > window.innerHeight + 0.5) out.push(`${name} off-screen`);
        if (r.width < 43.5 || r.height < 43.5) out.push(`${name} ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
      // Only the designated scrollers may scroll, never the page itself.
      const root = document.getElementById("root")!;
      if (document.documentElement.scrollLeft || document.body.scrollLeft || root.scrollLeft || root.scrollTop) out.push("page scrolled");
      if (root.scrollWidth > window.innerWidth || document.documentElement.scrollWidth > window.innerWidth) out.push("page overflow");
      return out;
    });
    expect(bad, `${vp.width} × ${vp.height}`).toEqual([]);
  }
});

// World flows (dev server, shared world; after the away project).

test("place a building by tap + Confirm; a tap alone or a long-press never places", async ({ page, browserName }) => {
  test.setTimeout(150_000);
  const target = browserName === "chromium" ? TOUCH_HOUSE : TOUCH_HOUSE_WEBKIT;
  await quietWorld(page);
  await openWorld(page);
  const v0 = await version(page);
  await page.getByTestId("build-tab-houses").tap();
  await page.getByTestId("build-house_settlers").tap();
  await expect(page.getByTestId("placement-bar")).toBeVisible();
  await expect(page.getByTestId("placement-confirm")).toBeDisabled();
  await touch.tap(await tile(page, ISLAND, TOUCH_EMPTY));
  await expect(page.getByTestId("placement-hint")).toContainText(`${TOUCH_EMPTY.x}, ${TOUCH_EMPTY.y}`);
  // A further tap moves the ghost; nothing is sent.
  await touch.tap(await tile(page, ISLAND, target));
  await expect(page.getByTestId("placement-hint")).toContainText(`${target.x}, ${target.y}`);
  await page.waitForTimeout(400);
  expect(await version(page)).toBe(v0);
  // Long-press with the tool active inspects only.
  await touch.longPress(await tile(page, ISLAND, { x: SAWMILL_MOVED.x + 1, y: SAWMILL_MOVED.y + 1 }));
  await expect(page.getByTestId("info-name")).toHaveText("Sawmill");
  await expect(page.getByTestId("placement-bar")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await version(page)).toBe(v0);
  await page.getByTestId("sheet-close").tap();
  // Rotate twice and back to 0° with the on-screen button, then confirm.
  for (let i = 0; i < 4; i++) await page.getByTestId("placement-rotate").tap();
  await expect(page.getByTestId("placement-rotate")).toContainText("0°");
  await page.getByTestId("placement-confirm").tap();
  await expect.poll(() => version(page)).toBe(v0 + 1);
  expect(await serverBuildingAt(page, ISLAND, target)).toMatchObject({ type: "house_settlers" });
  // The tool stays (desktop parity) without a pending tile.
  await expect(page.getByTestId("placement-confirm")).toBeDisabled();
  await page.getByTestId("placement-cancel").tap();
  await expect(page.getByTestId("placement-bar")).toHaveCount(0);
});

test("draw a road with one finger", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "world flow of the Pixel 5 project");
  await openWorld(page);
  const v0 = await version(page);
  await page.getByTestId("build-tab-roads").tap();
  await page.getByTestId("build-road_dirt").tap();
  await expect(page.getByTestId("road-bar")).toBeVisible();
  await touch.drag(await tile(page, ISLAND, TOUCH_ROAD_FROM), await tile(page, ISLAND, TOUCH_ROAD_TO), 16);
  await expect.poll(() => version(page)).toBe(v0 + 1);
  const roads = await page.evaluate(
    ([id, y]) =>
      window.__newShores!.getServer()!.display.islands.find((i) => i.id === id)!.roads.filter((r) => r.y === y).map((r) => r.x),
    [ISLAND, TOUCH_ROAD_FROM.y] as const,
  );
  for (let x = TOUCH_ROAD_FROM.x; x <= TOUCH_ROAD_TO.x; x++) expect(roads).toContain(x);
  await page.getByTestId("road-done").tap();
  await expect(page.getByTestId("road-bar")).toHaveCount(0);
});

test("demolish mode shows the demolish bar until Done", async ({ page, browserName }) => {
  const house = browserName === "chromium" ? TOUCH_HOUSE : TOUCH_HOUSE_WEBKIT;
  await openWorld(page);
  await page.getByTestId("tool-demolish").tap();
  const bar = page.getByTestId("demolish-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveText(/Demolish mode — tap a building/);
  await expect(page.getByTestId("demolish-done")).toBeVisible();
  if (browserName === "chromium") {
    // A demolish tap (a road tile, no confirmation) keeps the tool and the bar.
    const v = await version(page);
    await touch.tap(await tile(page, ISLAND, TOUCH_ROAD_TO));
    await expect.poll(() => version(page)).toBe(v + 1);
    await expect(bar).toBeVisible();
  }
  await page.getByTestId("demolish-done").tap();
  await expect(bar).toHaveCount(0);
  // Out of demolish mode a tap selects and never demolishes.
  const v1 = await version(page);
  await touch.tap(await tile(page, ISLAND, { x: house.x + 1, y: house.y + 1 }));
  await expect(page.getByTestId("info-name")).toHaveText("Settler house");
  await page.waitForTimeout(400);
  expect(await version(page)).toBe(v1);
  expect(await serverBuildingAt(page, ISLAND, house)).not.toBeNull();
});

test("move, pause and resume, quests and the route editor by touch", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "world flow of the Pixel 5 project");
  await openWorld(page);
  // Move the touch house: Move in its sheet, tap the target, Confirm.
  const house = (await serverBuildingAt(page, ISLAND, TOUCH_HOUSE))!;
  let v = await version(page);
  await touch.tap(await tile(page, ISLAND, { x: TOUCH_HOUSE.x + 1, y: TOUCH_HOUSE.y + 1 }));
  await expect(page.getByTestId("info-name")).toHaveText("Settler house");
  await page.getByTestId("info-move").tap();
  await expect(page.getByTestId("placement-bar")).toBeVisible();
  await touch.tap(await tile(page, ISLAND, TOUCH_HOUSE_MOVED));
  await page.getByTestId("placement-confirm").tap();
  await expect.poll(() => version(page)).toBe(v + 1);
  expect((await serverBuildingAt(page, ISLAND, TOUCH_HOUSE_MOVED))?.id).toBe(house.id);
  await expect(page.getByTestId("placement-bar")).toHaveCount(0);
  await page.getByTestId("sheet-close").tap();

  // Pause and resume the sawmill from its sheet.
  v = await version(page);
  await touch.tap(await tile(page, ISLAND, { x: SAWMILL_MOVED.x + 1, y: SAWMILL_MOVED.y + 1 }));
  await expect(page.getByTestId("info-name")).toHaveText("Sawmill");
  await page.getByTestId("info-pause").tap();
  await expect.poll(async () => (await serverBuildingAt(page, ISLAND, SAWMILL_MOVED))?.paused).toBe(true);
  await page.getByTestId("info-pause").tap();
  await expect.poll(async () => (await serverBuildingAt(page, ISLAND, SAWMILL_MOVED))?.paused).toBe(false);
  expect(await version(page)).toBeGreaterThanOrEqual(v + 2);
  await page.getByTestId("sheet-close").tap();

  // The quests sheet.
  await page.getByTestId("hud-quests").tap();
  await expect(page.getByTestId("quests-panel")).toBeVisible();
  await expect(page.getByTestId("sheet")).toBeVisible();
  await page.getByTestId("sheet-close").tap();

  // Open a saved route in the editor and save it.
  await page.getByTestId("to-archipelago").tap();
  await expectView(page, "archipelago");
  await page.getByTestId("hud-routes").tap();
  const edit = page.locator('[data-testid^="route-edit-"]').first();
  await edit.tap();
  await expect(page.getByTestId("route-editor")).toBeVisible();
  v = await version(page);
  await page.getByTestId("route-save").tap();
  await expect.poll(() => version(page)).toBe(v + 1);
  await expect(page.getByTestId("route-error")).toHaveCount(0);
});
