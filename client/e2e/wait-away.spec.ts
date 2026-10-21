import { expect, type Page, test } from "@playwright/test";
import { wheelZoom, worldReady } from "./archipelago";
import { dismissAwayDialog } from "./away";
import { E2E_TIME_SCALE, ISLAND, ISLAND_ZOOM_OUT_TICKS, LUMBERJACK } from "./constants";

// "While you were away" (R28) at the E2E time scale: after a command the
// world is left alone for away_summary_minutes of world time; a reload
// shows the summary from the command's time; dismissing acknowledges it
// and a reload shows no dialog. Runs last (file name) on the world the
// other specs built and relies on no version number, only on the smoke
// test's lumberjack.

/** away_summary_minutes (15) of world time in wall ms at the E2E scale, plus margin. */
const GAP_WALL_MS = (15 * 60_000) / E2E_TIME_SCALE + 5_000;

async function lumberjackPaused(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__newShores!.getServer()!.display.islands[0]!.buildings.find((b) => b.type === "lumberjack")!.paused);
}

async function pendingSummary(page: Page): Promise<number | null> {
  return page.evaluate(() => window.__newShores!.getServer()!.display.away_summary?.id ?? null);
}

test("the away dialog shows once per summary", async ({ page }) => {
  test.setTimeout(GAP_WALL_MS + 60_000);
  await page.goto("/");
  await dismissAwayDialog(page);
  await worldReady(page, ISLAND);
  await wheelZoom(page, ISLAND_ZOOM_OUT_TICKS);

  // A command: pause and resume the lumberjack in its info panel.
  const p = await page.evaluate(([id, x, y]) => window.__newShores!.tileToScreen(id as string, x as number, y as number), [
    ISLAND,
    LUMBERJACK.x,
    LUMBERJACK.y,
  ]);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("info-name")).toHaveText("Lumberjack");
  await page.getByTestId("info-pause").click();
  await expect.poll(() => lumberjackPaused(page)).toBe(true);
  await page.getByTestId("info-pause").click();
  await expect.poll(() => lumberjackPaused(page)).toBe(false);
  const lastSeen = await page.evaluate(() => window.__newShores!.getServer()!.display.last_seen_at);

  // away_summary_minutes of world time later a reload shows the summary.
  await page.waitForTimeout(GAP_WALL_MS);
  await page.reload();
  await expect(page.getByTestId("away-dialog")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("away-from")).toHaveText(lastSeen);

  // Dismiss acknowledges it; after a reload no dialog appears.
  await page.getByTestId("away-dismiss").click();
  await expect(page.getByTestId("away-dialog")).toBeHidden();
  await expect.poll(() => pendingSummary(page)).toBeNull();
  await page.reload();
  await expect(page.getByTestId("hud-gold")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__newShores!.getServer() !== null)).toBe(true);
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId("away-dialog")).toHaveCount(0);
  expect(await pendingSummary(page)).toBeNull();
});
