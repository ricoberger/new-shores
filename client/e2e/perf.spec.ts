import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { type Browser, expect, test } from "@playwright/test";
import { expectView } from "./archipelago";

// Mobile performance budget (FIRST_PLAYABLE §3): the dense fixture
// (two islands, ≈ 400 buildings on the shown one, ≥ 60 carts, 2 ships on
// legs) in the island view under 4× CDP CPU throttling at phone viewports.
// Every run logs fps, frame times, draw calls, JS heap, TTFI, the WebGL
// renderer (hardware or SwiftShader) and the gzip size of the built
// chunks. The regression check asserts PERF_MIN_FPS for the 412 × 915
// run in the configuration this project runs in (headless Chromium; with
// PERF_GPU=1 the GPU flags of playwright.config.ts apply instead).

/**
 * Default regression threshold (fps, 412 × 915 @ 2.625, 4× CPU
 * throttling, headless Chromium with SwiftShader): the measured average
 * × 0.8, rounded down (median of three runs 34.1 fps on an Apple M4 Pro →
 * 27). Measurements and the derivation are in the M3 notes.
 */
export const DEFAULT_PERF_MIN_FPS = 27;

/**
 * The threshold in force: the PERF_MIN_FPS environment variable when set
 * (software rendering scales with the CPU, so a slower machine or CI
 * runner sets its own value, re-derived as measured × 0.8), else the
 * default.
 */
export function perfMinFps(env: string | undefined = process.env.PERF_MIN_FPS): number {
  if (env === undefined || env.trim() === "") return DEFAULT_PERF_MIN_FPS;
  const v = Number(env);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`PERF_MIN_FPS must be a positive number, got "${env}"`);
  return v;
}

export const PERF_MIN_FPS = perfMinFps();
/** JS heap ceiling (bytes): the < 400 MB mobile budget. */
const MAX_HEAP_BYTES = 400 * 1024 * 1024;
/** Draw-call ceiling of the dense island view (27 measured; instancing regressions exceed it). */
const MAX_DRAW_CALLS = 40;
const CPU_THROTTLE = 4;
const SETTLE_MS = 3_000;
const SAMPLE_MS = 5_000;

interface Config {
  name: string;
  width: number;
  height: number;
  dpr: number;
  /** The configuration of the fps regression check. */
  check: boolean;
}

const CONFIGS: Config[] = [
  { name: "412x915@2.625", width: 412, height: 915, dpr: 2.625, check: true },
  { name: "360x640@3", width: 360, height: 640, dpr: 3, check: false },
];

/** Gzip size of the built JS and CSS chunks (bytes). */
function bundleSizes(): { totalGzip: number; largest: { file: string; gzip: number }[] } {
  const dir = join(process.cwd(), "dist", "assets");
  const files = readdirSync(dir).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
  const sizes = files.map((f) => ({ file: f, gzip: gzipSync(readFileSync(join(dir, f))).length }));
  sizes.sort((a, b) => b.gzip - a.gzip);
  return { totalGzip: sizes.reduce((n, s) => n + s.gzip, 0), largest: sizes.slice(0, 3) };
}

async function measure(browser: Browser, c: Config) {
  const context = await browser.newContext({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: c.dpr,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  await cdp.send("Performance.enable");
  await page.goto("/?fixture=dense-2x400");
  await expectView(page, "dense1");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("ns-first-frame").length), { timeout: 30_000 }).toBeGreaterThan(0);
  const ttfiMs = await page.evaluate(() => {
    const at = (n: string) => performance.getEntriesByName(n)[0]?.startTime ?? NaN;
    return Math.max(at("ns-hud-gold"), at("ns-first-frame"));
  });

  // The fixture payload: ≈ 400 buildings on the shown island, ≥ 60
  // delivering producers (carts) and 2 ships on legs.
  const payload = await page.evaluate(() => {
    const d = window.__newShores!.getServer()!.display;
    const shown = d.islands.find((is) => is.id === "dense1")!;
    const delivering = shown.buildings.filter(
      (b) => (b.assigned_warehouse_id ?? 0) > 0 && (b.transfer_delay_ms ?? 0) > 0 && Object.values(b.rates?.outputs ?? {}).some((r) => r > 0),
    ).length;
    return {
      islands: d.islands.length,
      shownBuildings: shown.buildings.length,
      totalBuildings: d.islands.reduce((n, is) => n + is.buildings.length, 0),
      delivering,
      shipsOnLegs: d.ships.filter((s) => s.leg !== null).length,
    };
  });
  expect(payload.islands).toBe(2);
  expect(payload.shownBuildings).toBeGreaterThanOrEqual(380);
  expect(payload.shownBuildings).toBeLessThanOrEqual(420);
  expect(payload.delivering).toBeGreaterThanOrEqual(60);
  expect(payload.shipsOnLegs).toBe(2);
  expect(await page.evaluate(() => window.__newShores!.carts())).toBeGreaterThanOrEqual(60);

  await page.waitForTimeout(SETTLE_MS);
  let drawCalls = 0;
  for (let i = 0; i < 5; i++) {
    drawCalls = Math.max(drawCalls, await page.evaluate(() => window.__newShores!.drawCalls()));
    await page.waitForTimeout(SAMPLE_MS / 5);
  }
  const frames = await page.evaluate((ms) => window.__newShores!.frameStats(ms), SAMPLE_MS);
  const metrics = (await cdp.send("Performance.getMetrics")).metrics;
  const heapBytes = metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? NaN;
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  const renderScale = await page.evaluate(() => {
    const c = document.querySelector("canvas")!;
    return c.width / c.clientWidth;
  });
  await context.close();
  return { ...payload, ttfiMs, drawCalls, frames, heapBytes, renderer, renderScale };
}

test.describe.configure({ mode: "serial" });

for (const c of CONFIGS) {
  test(`dense fixture holds the budget at ${c.name} (4× CPU throttling)`, async ({ browser }) => {
    test.setTimeout(120_000);
    const r = await measure(browser, c);
    const bundle = bundleSizes();
    console.log(
      `PERF ${c.name} ${JSON.stringify({
        minFps: c.check ? PERF_MIN_FPS : null,
        fps: Number(r.frames.fps.toFixed(1)),
        avgMs: Number(r.frames.avgMs.toFixed(1)),
        p95Ms: Number(r.frames.p95Ms.toFixed(1)),
        frames: r.frames.frames,
        drawCalls: r.drawCalls,
        heapMB: Number((r.heapBytes / 1024 / 1024).toFixed(1)),
        ttfiMs: Math.round(r.ttfiMs),
        renderScale: Number(r.renderScale.toFixed(3)),
        buildings: r.shownBuildings,
        carts: r.delivering,
        renderer: r.renderer,
        bundleGzipKB: Number((bundle.totalGzip / 1024).toFixed(1)),
        largestGzipKB: bundle.largest.map((b) => `${b.file}=${(b.gzip / 1024).toFixed(1)}`),
      })}`,
    );
    expect(r.heapBytes).toBeLessThan(MAX_HEAP_BYTES);
    expect(r.drawCalls).toBeGreaterThan(0);
    expect(r.drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
    if (c.check && process.env.PERF_GPU !== "1") expect(r.frames.fps).toBeGreaterThanOrEqual(PERF_MIN_FPS);
  });
}
