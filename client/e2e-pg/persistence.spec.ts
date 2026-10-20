import { expect, type Page, test } from "@playwright/test";

// Against the PostgreSQL-backed server: a guest's building survives a
// reload; after registering, logging out and in again shows the same world.

const ISLAND = "start";
/** Sawmill on grass below the warehouse row (see e2e/constants.ts). */
const SAWMILL = { x: 20, y: 5 };

async function serverVersion(page: Page): Promise<number> {
  return page.evaluate(() => window.__newShores?.getServer()?.version ?? -1);
}

async function sawmills(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__newShores?.getServer()?.display.islands[0]?.buildings.filter((b) => b.type === "sawmill").length ?? -1,
  );
}

async function clickTile(page: Page, x: number, y: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(([id, tx, ty]) => window.__newShores?.tileToScreen(id as string, tx as number, ty as number).x ?? NaN, [ISLAND, x, y]))
    .not.toBeNaN();
  const p = await page.evaluate(([id, tx, ty]) => window.__newShores!.tileToScreen(id as string, tx as number, ty as number), [ISLAND, x, y]);
  await page.mouse.click(p.x, p.y);
}

test("guest world persists across reload, registration, logout and login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await page.getByTestId("play-guest").click();
  await expect(page.getByTestId("hud-gold")).toBeVisible();
  await expect(page.getByTestId("account-menu")).toContainText("(guest)");
  await expect.poll(() => serverVersion(page)).toBe(0);

  // Place a sawmill.
  await page.getByTestId("build-tab-production").click();
  await page.getByTestId("build-sawmill").click();
  for (let r = 0; r < 180; r += 90) await page.keyboard.press("r");
  await clickTile(page, SAWMILL.x, SAWMILL.y);
  await expect.poll(() => serverVersion(page)).toBe(1);
  expect(await sawmills(page)).toBe(1);

  // Reload: the session cookie keeps the guest; the building is still there.
  await page.reload();
  await expect(page.getByTestId("hud-gold")).toBeVisible();
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await expect.poll(() => serverVersion(page)).toBeGreaterThanOrEqual(1);
  expect(await sawmills(page)).toBe(1);

  // Register the guest (keeps the world).
  const email = `e2e-${Date.now()}@example.org`;
  const password = "e2e password 123";
  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-register").click();
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-display-name").fill("E2E Captain");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("account-menu")).toHaveText(/E2E Captain/);
  await expect(page.getByTestId("account-menu")).not.toContainText("(guest)");
  const version = await serverVersion(page);

  // Log out: back to the start screen.
  await page.getByTestId("account-menu").click();
  await page.getByTestId("account-logout").click();
  await expect(page.getByTestId("start-screen")).toBeVisible();

  // Log in: the same world.
  await page.getByTestId("show-login").click();
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill(password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("hud-gold")).toBeVisible();
  await expect.poll(() => serverVersion(page)).toBeGreaterThanOrEqual(version);
  expect(await sawmills(page)).toBe(1);
  await expect(page.getByTestId("account-menu")).toHaveText(/E2E Captain/);
});

test("wrong password shows the API error", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("show-login").click();
  await page.getByTestId("auth-email").fill("nobody@example.org");
  await page.getByTestId("auth-password").fill("wrong password");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-error")).toHaveText("Wrong email or password.");
});

test("a verification result that arrives after the start screen is shown", async ({ page }) => {
  // Delay the verification request so that /auth/me (401) renders the
  // start screen first; the late result must still appear.
  await page.route("**/api/v1/auth/verify-email", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto("/?verify_email=1&token=not-a-real-token");
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await expect(page.getByTestId("start-notice")).toHaveText("This link is invalid or has expired.");
  expect(new URL(page.url()).search).toBe("");
});
