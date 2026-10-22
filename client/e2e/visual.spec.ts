import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Browser, devices, expect, type Page, test, type TestInfo } from "@playwright/test";
import { expectLod, setCamera, showArchipelago, worldReady } from "./archipelago";

// Screenshot baselines of the visual foundation (art task 2) on the
// fixtures only (no server state): the dense island at near, mid and far
// LOD and the HUD on desktop and on a Pixel 5 (portrait, a sheet open).
// Time is fixed (Date via the Playwright clock, the renderer's animation
// time via freezeTime), CSS animations are disabled. Baselines are per
// platform (Playwright's default naming); a missing baseline for the
// running platform is written and the test skipped with a notice, so CI
// (Linux, SwiftShader) stays green until its baselines are committed from
// the uploaded report.

/** Fixed time of every screenshot (the fixtures are built relative to it). */
const T = new Date("2026-10-21T16:00:00Z");
const SHOT = { maxDiffPixelRatio: 0.02, animations: "disabled" as const, caret: "hide" as const };

async function open(page: Page, fixture: string, query = ""): Promise<void> {
  await page.clock.setFixedTime(T);
  await page.goto(`/?fixture=${fixture}${query}`);
  await worldReady(page, "dense1");
  await page.evaluate((t) => window.__newShores!.freezeTime(t), T.getTime());
}

/** Lets the frame settle (camera moves, textures upload). */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(1500);
}

/**
 * Compares with the platform baseline; without one, writes it and returns
 * false (the test then skips with a notice, see skipIfWritten).
 */
async function compare(page: Page, info: TestInfo, name: string): Promise<boolean> {
  const path = info.snapshotPath(name);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }));
    const notice = `No ${process.platform} baseline for ${name}: written to ${path}; commit it to compare from the next run.`;
    console.log(`VISUAL ${notice}`);
    info.annotations.push({ type: "baseline-written", description: notice });
    return false;
  }
  await expect(page).toHaveScreenshot(name, SHOT);
  return true;
}

/** Skips (instead of passing) a test that wrote a missing baseline. */
function skipIfWritten(info: TestInfo): void {
  const written = info.annotations.filter((a) => a.type === "baseline-written");
  test.skip(written.length > 0, `baseline written for ${process.platform}: ${written.length} screenshot(s), nothing compared`);
}

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 412, height: 915 } });
  return context.newPage();
}

test.describe.configure({ mode: "serial" });

test("near LOD of the dense island (desktop)", async ({ page }, info) => {
  await open(page, "dense-2x400");
  await expectLod(page, "near");
  await settle(page);
  await compare(page, info, "near-desktop.png");
  skipIfWritten(info);
});

// The complete high-quality path, FXAA included: headless Chromium renders
// with SwiftShader, where "high" skips FXAA unless the ?fxaa=1 toggle asks
// for it, so this baseline exercises the real FXAA pass (shadow map,
// grading overlay, vignette and FXAA together).
test("near LOD at high quality with FXAA forced on (desktop)", async ({ page }, info) => {
  await open(page, "dense-2x400", "&quality=high&fxaa=1");
  await expectLod(page, "near");
  expect(await page.evaluate(() => window.__newShores!.effects())).toMatchObject({ quality: "high", shadowMap: true, grading: true, fxaa: true, vignette: true });
  await setCamera(page, { half: 9 });
  await settle(page);
  await compare(page, info, "near-high-fxaa-desktop.png");
  skipIfWritten(info);
});

test("mid LOD between the dense islands (desktop)", async ({ page }, info) => {
  await open(page, "dense-archipelago-8");
  await setCamera(page, { x: 87, y: 75, half: 47 });
  await expectLod(page, "mid");
  await settle(page);
  await compare(page, info, "mid-desktop.png");
  skipIfWritten(info);
});

test("far LOD of the archipelago (desktop)", async ({ page }, info) => {
  await open(page, "dense-archipelago-8");
  await showArchipelago(page);
  await settle(page);
  await compare(page, info, "far-desktop.png");
  skipIfWritten(info);
});

test("HUD with the info panel (desktop)", async ({ page }, info) => {
  await open(page, "dense-2x400");
  const t = await page.evaluate(() => {
    const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === "dense1")!;
    const b = is.buildings.find((x) => x.status !== "ok" && x.type === "woodcutter") ?? is.buildings.find((x) => x.status !== "ok")!;
    return { x: b.x, y: b.y };
  });
  await setCamera(page, { x: t.x + 1, y: t.y + 1 });
  await settle(page);
  const p = await page.evaluate(([x, y]) => window.__newShores!.tileToScreen("dense1", x as number, y as number), [t.x, t.y]);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("info-panel")).toBeVisible();
  await page.mouse.move(5, 400);
  await settle(page);
  await compare(page, info, "hud-desktop.png");
  skipIfWritten(info);
});

test("phone portrait with a sheet open (Pixel 5)", async ({ browser }, info) => {
  const page = await phone(browser);
  await open(page, "dense-2x400");
  await expect.poll(() => page.evaluate(() => window.__newShores!.quality())).toBe("low");
  await settle(page);
  await compare(page, info, "phone-portrait.png");
  await page.getByTestId("hud-ships").click();
  await expect(page.getByTestId("sheet")).toBeVisible();
  // The sheet takes focus on open; a neutral focus keeps the shot stable.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
  await compare(page, info, "phone-sheet.png");
  await page.context().close();
  skipIfWritten(info);
});
