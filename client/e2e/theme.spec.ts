import { devices, expect, type Page, test } from "@playwright/test";
import { worldReady } from "./archipelago";

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
  await page.getByTestId("build-woodcutter").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);

  // Field tool: visible.
  await page.getByTestId("build-pasture").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);

  // Road tool: visible.
  await page.getByTestId("build-tab-roads").click();
  await page.getByTestId("build-road").click();
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
    const b = is.buildings.find((x) => x.type === "house")!;
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

test("the grid overlay shows for the found tool", async ({ page }) => {
  // archipelago-8x20: ship 14 lies idle at the unsettled Isle 8.
  await page.goto("/?fixture=archipelago-8x20");
  await expect.poll(() => page.evaluate(() => window.__newShores?.getServer() != null)).toBe(true);
  await page.getByTestId("island-tab-isle8").click();
  await expect(page.getByTestId("found-settlement-14")).toBeVisible();
  await page.getByTestId("found-settlement-14").click();
  await expect.poll(() => gridVisible(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => gridVisible(page)).toBe(false);
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

test("the Credits dialog names game-icons.net and opens by keyboard", async ({ page }) => {
  await page.goto("/?fixture=dense-2x400");
  await page.getByTestId("account-menu").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("account-credits").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("credits-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("game-icons.net");
  await expect(dialog).toContainText("CC BY 3.0");
  await expect(dialog).toContainText("SIL Open Font License");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
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
