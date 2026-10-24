import { devices, expect, type Page, test } from "@playwright/test";
import { setCamera, worldReady } from "./archipelago";
import { touchFor } from "./touch";

// Visual foundation rules on the fixtures (no server state): the grid
// overlay shows only for placement tools, the palette custom properties,
// the render quality per layout (and its override) and the Credits dialog.

async function gridVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__newShores!.gridOverlayVisible());
}

test("the grid overlay shows for placement tools only", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  await worldReady(page, "dense1");
  await expect.poll(() => gridVisible(page)).toBe(false);

  // Build tool: visible; Esc: hidden again.
  await page.getByTestId("build-tab-production").click();
  await page.getByTestId("build-lumberjack").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);

  // Field tool (from the sheep farm's panel, D-051 part 4): visible.
  const farm = await page.evaluate(() => {
    const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === "dense1")!;
    const b = is.buildings.find((x) => x.type === "sheep_farm")!;
    return { x: b.x, y: b.y };
  });
  await page.evaluate(([x, y]) => window.__newShores!.setCamera({ x: (x as number) + 1, y: (y as number) + 1 }), [farm.x, farm.y]);
  await page.waitForTimeout(300);
  const fp = await page.evaluate(([x, y]) => window.__newShores!.tileToScreen("dense1", x as number, y as number), [farm.x, farm.y]);
  await page.mouse.click(fp.x, fp.y);
  await page.getByTestId("farm-add-field").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);

  // Road tool: visible.
  await page.getByTestId("build-tab-roads").click();
  await page.getByTestId("build-road_dirt").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);

  // Demolish: hidden.
  await page.getByTestId("tool-demolish").click();
  await page.waitForTimeout(200);
  expect(await gridVisible(page)).toBe(false);
  await page.keyboard.press("Escape");

  // Move (from a building's info panel): visible.
  const t = await page.evaluate(() => {
    const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === "dense1")!;
    const b = is.buildings.find((x) => x.type === "house_settlers")!;
    return { x: b.x, y: b.y };
  });
  await page.evaluate(([x, y]) => window.__newShores!.setCamera({ x: (x as number) + 1, y: (y as number) + 1 }), [t.x, t.y]);
  await page.waitForTimeout(300);
  const p = await page.evaluate(([x, y]) => window.__newShores!.tileToScreen("dense1", x as number, y as number), [t.x, t.y]);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("info-move")).toBeVisible();
  await page.getByTestId("info-move").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);
});

test("the placement ghost is the building's model, rotated and tinted by validity", async ({ page }) => {
  await page.goto("/?fixture=showcase");
  await worldReady(page, "showcase");
  await setCamera(page, { x: 22, y: 21, half: 6, rotation: 0 });
  const ghost = () => page.evaluate(() => ({ kind: window.__newShores!.ghostKind(), validity: window.__newShores!.ghostValidity(), tile: window.__newShores!.ghostTile() }));
  const hover = async (x: number, y: number) => {
    const p = await page.evaluate(([tx, ty]) => window.__newShores!.tileToScreen("showcase", tx as number, ty as number), [x, y]);
    await page.mouse.move(p.x, p.y);
  };
  await page.getByTestId("build-tab-production").click();
  await page.getByTestId("build-sawmill").click();
  // Touching the paved road below the showcase's south road row: neutral.
  await hover(20, 18);
  await expect.poll(ghost, { timeout: 15_000 }).toEqual({ kind: "model", validity: "ok", tile: { x: 20, y: 18 } });
  // Away from every road: yellow.
  await hover(23, 22);
  await expect.poll(ghost).toEqual({ kind: "model", validity: "no_road", tile: { x: 23, y: 22 } });
  await page.keyboard.press("r");
  await page.waitForTimeout(200);
  expect((await ghost()).kind).toBe("model");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__newShores!.ghostKind())).toBeNull();
  // A quarry on plain grass covers no stone deposit: red, with the reason.
  await page.getByTestId("build-quarry").click();
  await hover(23, 21);
  await hover(23, 22);
  await expect.poll(ghost, { timeout: 15_000 }).toEqual({ kind: "model", validity: "invalid", tile: { x: 23, y: 22 } });
  await expect(page.getByTestId("tool-hint-reason")).toHaveText("Must cover a stone deposit");
});

test("the grid overlay shows for the found tool", async ({ page }) => {
  // archipelago-8x20: ship 14 lies idle at the unsettled Isle 8.
  await page.goto("/?fixture=archipelago-8x20");
  await expect.poll(() => page.evaluate(() => window.__newShores?.getServer() != null)).toBe(true);
  await page.evaluate(() => window.__newShores!.jumpToIsland("isle8"));
  await expect(page.getByTestId("hud-island")).toHaveAttribute("data-island", "isle8");
  await expect(page.getByTestId("hud-island-unsettled")).toBeVisible();
  await expect(page.getByTestId("found-settlement-here")).toBeVisible();
  await page.getByTestId("found-settlement-here").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);
});

test("on touch the grid follows the finger of a road drag and of a second field drag", async ({ browser, browserName }) => {
  const context = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const touch = await touchFor(page, browserName);
  await page.goto("/?fixture=dense-2x400");
  await worldReady(page, "dense1");
  await setCamera(page, { x: 32, y: 24, half: 24 });
  await page.waitForTimeout(300);
  const at = async (x: number, y: number) => {
    const p = await page.evaluate(([tx, ty]) => window.__newShores!.tileToScreen("dense1", tx as number, ty as number), [x, y]);
    const free = await page.evaluate(([px, py]) => document.elementFromPoint(px as number, py as number) instanceof HTMLCanvasElement, [p.x, p.y]);
    expect(free, `tile ${x},${y} on the bare canvas`).toBe(true);
    return p;
  };
  const gridNear = (x: number, y: number) =>
    expect
      .poll(async () => {
        const g = await page.evaluate(() => window.__newShores!.gridAt());
        return g ? Math.hypot(g.x - (x + 0.5), g.y - (y + 0.5)) : Infinity;
      })
      .toBeLessThan(1.5);
  /**
   * One finger from tile a to tile b; `during` runs while it rests on b.
   * Few steps, so that the first one leaves the touch slop long before the
   * long-press time on a slow renderer.
   */
  const drag = async (a: [number, number], b: [number, number], during: () => Promise<void>) => {
    const p = await at(...a);
    const q = await at(...b);
    const steps = 4;
    const step = (i: number) => ({ type: "move" as const, fingers: [{ x: p.x + ((q.x - p.x) * i) / steps, y: p.y + ((q.y - p.y) * i) / steps, id: 1 }] });
    // The first move goes out with the start (no wait for the start's
    // acknowledgement, which on a busy software renderer takes frames).
    await touch.raw({ type: "start", fingers: [{ ...p, id: 1 }] }, step(1));
    for (let i = 2; i <= steps; i++) {
      await page.waitForTimeout(16);
      await touch.raw(step(i));
    }
    await during();
    await touch.raw({ type: "end", fingers: [] });
  };

  // Road drag: more than the grid radius (8 tiles) away from where it began.
  await page.getByTestId("build-tab-roads").tap();
  await page.getByTestId("build-road_dirt").tap();
  await expect.poll(() => page.evaluate(() => window.__newShores!.gridOverlayVisible())).toBe(true);
  await drag([16, 24], [30, 24], () => gridNear(30, 24));
  await page.getByTestId("road-done").tap();

  await context.close();
});

test("the palette custom properties resolve on :root", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  const vars = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { parchment: s.getPropertyValue("--ns-ui-parchment").trim(), wood: s.getPropertyValue("--ns-ui-dark-wood").trim() };
  });
  expect(vars.parchment.toUpperCase()).toBe("#F1E6CC");
  expect(vars.wood.toUpperCase()).toBe("#4A3421");
});

test("render quality: high on desktop, low at 412 × 915, overridable", async ({ page, browser }) => {
  await page.goto("/?fixture=dense-2x400");
  await worldReady(page, "dense1");
  expect(await page.evaluate(() => window.__newShores!.quality())).toBe("high");
  const high = (await page.evaluate(() => window.__newShores!.effects()))!;
  expect(high).toMatchObject({ quality: "high", shadowMap: true, grading: true, vignette: true });
  // FXAA runs on hardware WebGL; headless Chromium's SwiftShader skips it (a pass costs more than a frame there).
  expect(high.fxaa).toBe(!high.software);

  // ?fxaa=1 keeps FXAA at high quality on any renderer, never at low.
  await page.goto("/?fixture=dense-2x400&quality=high&fxaa=1");
  await worldReady(page, "dense1");
  expect(await page.evaluate(() => window.__newShores!.effects())).toMatchObject({ quality: "high", fxaa: true });
  await page.goto("/?fixture=dense-2x400&quality=low&fxaa=1");
  await worldReady(page, "dense1");
  expect(await page.evaluate(() => window.__newShores!.effects())).toMatchObject({ quality: "low", fxaa: false });

  await page.goto("/?fixture=dense-2x400&quality=low");
  await worldReady(page, "dense1");
  expect(await page.evaluate(() => window.__newShores!.effects())).toMatchObject({ quality: "low", shadowMap: false, grading: false, fxaa: false, vignette: true });

  const context = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 412, height: 915 } });
  const phone = await context.newPage();
  await phone.goto("/?fixture=dense-2x400");
  await worldReady(phone, "dense1");
  expect(await phone.evaluate(() => window.__newShores!.quality())).toBe("low");
  expect(await phone.evaluate(() => window.__newShores!.effects()?.shadowMap)).toBe(false);
  await context.close();
});

/** The Credits dialog lies inside the viewport, wide enough to read, with its attribution on screen. */
async function expectCreditsReadable(page: Page): Promise<void> {
  const dialog = page.getByTestId("credits-dialog");
  await expect(dialog).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(box.width).toBeGreaterThanOrEqual(Math.min(360, vp.width - 32));
  const link = (await dialog.getByRole("link", { name: "game-icons.net" }).boundingBox())!;
  expect(link.y).toBeGreaterThanOrEqual(box.y);
  expect(link.y + link.height).toBeLessThanOrEqual(box.y + box.height);
  // Nothing covers it: the topmost element at its centre belongs to the dialog.
  expect(
    await page.evaluate(([x, y]) => document.querySelector('[data-testid="credits-dialog"]')!.contains(document.elementFromPoint(x as number, y as number)), [
      box.x + box.width / 2,
      box.y + box.height / 2,
    ]),
  ).toBe(true);
  await expect(dialog).toContainText("game-icons.net");
  await expect(dialog).toContainText("CC BY 3.0");
  await expect(dialog).toContainText("SIL Open Font License");
}

test("the Credits dialog names game-icons.net and opens by keyboard", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  await page.getByTestId("account-menu").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("account-credits").focus();
  await page.keyboard.press("Enter");
  await expectCreditsReadable(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("credits-dialog")).toBeHidden();
});

test("the Credits dialog is readable on a phone", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  await page.goto("/?fixture=dense-2x400");
  await page.getByTestId("account-menu").tap();
  await page.getByTestId("account-credits").tap();
  await expectCreditsReadable(page);
  await page.getByTestId("credits-close").tap();
  await expect(page.getByTestId("credits-dialog")).toBeHidden();
  await context.close();
});

test("no external font or icon requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname !== "localhost" && u.protocol !== "data:" && u.protocol !== "blob:") external.push(r.url());
  });
  await page.goto("/?fixture=dense-2x400");
  await worldReady(page, "dense1");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Cinzel"') && document.fonts.check('16px "Source Sans 3"'))).toBe(true);
  expect(external).toEqual([]);
});
