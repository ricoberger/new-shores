import { expect, test } from "@playwright/test";
import { API_PORT } from "./constants";

// Installability of the preview build (the Lighthouse PWA category no
// longer exists): the manifest is linked and valid with 192/512 and
// maskable icons that are served, the service worker registers, becomes
// active and controls the page, and the API is never served from (or
// stored in) the worker's cache. Read-only: the fixture needs no server.

interface Manifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  icons?: { src: string; sizes: string; type?: string; purpose?: string }[];
}

test("the preview build is installable and caches the shell only", async ({ page, request }) => {
  await page.goto("/?fixture=dense-2x400");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as Manifest;
  expect(m.name).toBeTruthy();
  expect(m.short_name).toBeTruthy();
  expect(m.start_url).toBe("/");
  expect(m.display).toBe("standalone");
  const sizes = (m.icons ?? []).map((i) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect((m.icons ?? []).some((i) => i.purpose?.includes("maskable"))).toBe(true);
  for (const icon of m.icons ?? []) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toContain("image/png");
  }

  // The worker registers, activates and takes control (clients.claim).
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
    }
    return { script: reg.active?.scriptURL ?? "", state: reg.active?.state ?? "", controlled: navigator.serviceWorker.controller !== null };
  });
  expect(sw.script).toMatch(/\/sw\.js$/);
  expect(sw.state).toBe("activated");
  expect(sw.controlled).toBe(true);

  // Controlled now: the shell comes from the worker, the API never does.
  const apiResponses: { url: string; fromSW: boolean }[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/")) apiResponses.push({ url: r.url(), fromSW: r.fromServiceWorker() });
  });
  const nav = await page.goto("/");
  expect(nav?.fromServiceWorker()).toBe(true);
  await expect(page.getByTestId("hud-gold")).toBeVisible();
  await page.evaluate(async (port) => {
    await fetch(`http://localhost:${port}/api/v1/content`, { credentials: "include" });
    // Same-origin /api/ (as behind Caddy) is not intercepted either.
    await fetch("/api/v1/content").catch(() => undefined);
  }, API_PORT);
  await expect.poll(() => apiResponses.filter((r) => r.url.endsWith("/api/v1/content")).length).toBeGreaterThanOrEqual(2);
  expect(apiResponses.filter((r) => r.fromSW)).toEqual([]);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(cached.length).toBeGreaterThan(5);
  expect(cached).toContain("/manifest.webmanifest");
  expect(cached.filter((u) => u.startsWith("/api/"))).toEqual([]);
});
