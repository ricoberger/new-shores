import { expect, test } from "@playwright/test";

// Time to first interaction: navigation start -> HUD gold rendered and the
// canvas's first frame with terrain (performance marks set by the app).
// Only runs with MEASURE_TTFI=1 (numbers recorded in the M1b notes).
test.skip(process.env.MEASURE_TTFI !== "1", "measurement only");

test("time to first interaction (median of 3)", async ({ browser }) => {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("hud-gold")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName("ns-first-frame").length))
      .toBeGreaterThan(0);
    const t = await page.evaluate(() => {
      const at = (n: string) => performance.getEntriesByName(n)[0]?.startTime ?? NaN;
      return Math.max(at("ns-hud-gold"), at("ns-first-frame"));
    });
    runs.push(t);
    await context.close();
  }
  runs.sort((a, b) => a - b);
  console.log(`TTFI runs (ms): ${runs.map((r) => r.toFixed(0)).join(", ")}; median ${runs[1]?.toFixed(0)} ms`);
});
