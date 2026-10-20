import { expect, type Page } from "@playwright/test";

/**
 * Closes the "while you were away" dialog when the first load shows one.
 * The dev world is created when the server starts, so the first GET of a
 * spec can already be more than away_summary_minutes of world time after
 * the last command and produce a summary (and a new world version).
 */
export async function dismissAwayDialog(page: Page): Promise<void> {
  await expect(page.getByTestId("hud-gold")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__newShores!.getServer() !== null)).toBe(true);
  const pending = await page.evaluate(() => window.__newShores!.getServer()!.display.away_summary !== null);
  if (pending) {
    await page.getByTestId("away-dismiss").click();
    await expect(page.getByTestId("away-dialog")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__newShores!.getServer()!.display.away_summary)).toBeNull();
  }
}
