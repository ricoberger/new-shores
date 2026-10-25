import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Browser, devices, expect, type Page, test, type TestInfo } from "@playwright/test";
import { modelsLoaded, setCamera, worldReady } from "./archipelago";

// Layout guard: screenshot baselines of the HUD only (desktop with the info
// panel, a Pixel 5 in portrait with and without a sheet) on the dense
// fixture, so the layout cannot drift unnoticed. The scene itself (near,
// mid and far LOD, the showcase, the red ghost, the sloop) has no baselines:
// every art change moves those pixels by design; look at it with
// `make shots` (README, Asset build) instead.
// Time is fixed (Date via the Playwright clock, the renderer's animation
// time via freezeTime), CSS animations are disabled. Baselines are per
// platform (Playwright's default naming); a missing baseline for the
// running platform is written and the test skipped with a notice, so CI
// (Linux, SwiftShader) stays green until its baselines are committed from
// the uploaded report.

/** Fixed time of every screenshot (the fixtures are built relative to it). */
const T = new Date("2026-10-21T16:00:00Z");
const SHOT = { maxDiffPixelRatio: 0.02, animations: "disabled" as const, caret: "hide" as const };

async function open(page: Page, fixture: string, query = "", island = "dense1"): Promise<void> {
  await page.clock.setFixedTime(T);
  await page.goto(`/?fixture=${fixture}${query}`);
  await worldReady(page, island);
  await page.evaluate((t) => window.__newShores!.freezeTime(t), T.getTime());
}

/** Lets the frame settle (camera moves, textures upload, models load and swap in). */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(1000);
  await modelsLoaded(page);
  await page.waitForTimeout(800);
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

test("HUD with the info panel (desktop)", async ({ page }, info) => {
  await open(page, "dense-2x400");
  const t = await page.evaluate(() => {
    const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === "dense1")!;
    const b = is.buildings.find((x) => x.status !== "ok" && x.type === "lumberjack") ?? is.buildings.find((x) => x.status !== "ok")!;
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
