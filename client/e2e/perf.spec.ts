import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { expectLod, modelsLoaded, setCamera, showArchipelago, worldReady } from "./archipelago";

// Mobile performance budget (FIRST_PLAYABLE §3) of the continuous world
// (D-048) under 4× CDP CPU throttling at phone viewports, per LOD:
// near — the dense-2x400 fixture (≈ 400 buildings on the island in view,
// ≥ 60 carts, 2 ships on legs) at the near default zoom; far — the
// dense-archipelago-8 fixture (8 islands, two of them dense) with the whole
// archipelago in view; mid — the same fixture centred between its dense
// islands at the upper end of the mid band (both in view). Every run logs
// fps, frame times, draw calls, JS heap, TTFI, the WebGL renderer
// (hardware or SwiftShader), the gzip size of the built chunks and the
// kit-bashed models loaded (GLB bytes, time to the first model; the
// measurement starts once every requested model has loaded). The
// regression check asserts a per-LOD fps floor for the 412 × 915 runs in
// the configuration this project runs in (headless Chromium; with
// PERF_GPU=1 the GPU flags of playwright.config.ts apply instead).

type PerfLod = "near" | "mid" | "far";

/**
 * Default fps floors per LOD (412 × 915 @ 2.625, 4× CPU throttling,
 * headless Chromium with SwiftShader on an Apple M4 Pro). A floor is a
 * regression tripwire relative to a device-validated build, not a
 * target: floor(0.8 × the software fps of that build), median of three
 * runs. Device-validated build: the KayKit restyle (art restyle
 * checkpoint 2), held at a stable 60 fps on an iPhone 15 Pro Max (Safari)
 * at near LOD and zoomed in on the dense fixture, 60 fps on a MacBook Pro
 * M4 Pro. Its software medians: near 19.9, mid 24.8, far 25.5 fps.
 * Re-derive the floors from the next device-validated build.
 */
export const DEFAULT_PERF_MIN_FPS: Readonly<Record<PerfLod, number>> = { near: 15, mid: 19, far: 20 };

/**
 * The floor in force for a LOD: the PERF_MIN_FPS environment variable
 * when set (one value for every LOD: software rendering scales with the
 * CPU, so a slower machine or CI runner sets its own, re-derived as its
 * lowest measured fps × 0.8), else the LOD's default.
 */
export function perfMinFps(lod: PerfLod, env: string | undefined = process.env.PERF_MIN_FPS): number {
  if (env === undefined || env.trim() === "") return DEFAULT_PERF_MIN_FPS[lod];
  const v = Number(env);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`PERF_MIN_FPS must be a positive number, got "${env}"`);
  return v;
}
/** JS heap ceiling (bytes): the < 400 MB mobile budget. */
const MAX_HEAP_BYTES = 400 * 1024 * 1024;
/** Draw-call ceiling of every run (instancing or culling regressions exceed it). */
const MAX_DRAW_CALLS = 160;
const CPU_THROTTLE = 4;
const SETTLE_MS = 3_000;
const SAMPLE_MS = 5_000;

/** The camera set-up of a run: the fixture, where the camera goes and what must hold before measuring. */
interface Run {
  lod: PerfLod;
  fixture: string;
  setup: (page: Page) => Promise<void>;
}

const RUNS: Run[] = [
  {
    lod: "near",
    fixture: "dense-2x400",
    setup: async (page) => {
      await worldReady(page, "dense1");
      await expectLod(page, "near");
    },
  },
  {
    lod: "far",
    fixture: "dense-archipelago-8",
    setup: async (page) => {
      await worldReady(page, "dense1");
      await showArchipelago(page);
      await expect.poll(() => page.evaluate(() => window.__newShores!.visibleIslands().length)).toBe(8);
    },
  },
  {
    lod: "mid",
    fixture: "dense-archipelago-8",
    setup: async (page) => {
      await worldReady(page, "dense1");
      // Between the dense islands' centres (42, 115) and (132, 35), just below FAR_ENTER_HALF (48).
      await setCamera(page, { x: 87, y: 75, half: 47 });
      await expectLod(page, "mid");
      await expect.poll(() => page.evaluate(() => window.__newShores!.visibleIslands())).toEqual(expect.arrayContaining(["dense1", "dense2"]));
    },
  },
];

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

async function measure(browser: Browser, c: Config, run: Run) {
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
  await page.goto(`/?fixture=${run.fixture}`);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("ns-first-frame").length), { timeout: 30_000 }).toBeGreaterThan(0);
  const ttfiMs = await page.evaluate(() => {
    const at = (n: string) => performance.getEntriesByName(n)[0]?.startTime ?? NaN;
    return Math.max(at("ns-hud-gold"), at("ns-first-frame"));
  });

  // The fixture payload: ≈ 400 buildings on the (first) dense island, ≥ 60
  // delivering producers (carts) and ships on legs.
  const payload = await page.evaluate(() => {
    const d = window.__newShores!.getServer()!.display;
    const dense = d.islands.find((is) => is.id === "dense1")!;
    const delivering = dense.buildings.filter(
      (b) => (b.assigned_warehouse_id ?? 0) > 0 && (b.transfer_delay_ms ?? 0) > 0 && Object.values(b.rates?.outputs ?? {}).some((r) => r > 0),
    ).length;
    return {
      islands: d.islands.length,
      denseBuildings: dense.buildings.length,
      totalBuildings: d.islands.reduce((n, is) => n + is.buildings.length, 0),
      delivering,
      shipsOnLegs: d.ships.filter((s) => s.leg !== null).length,
      routes: d.routes.length,
    };
  });
  expect(payload.denseBuildings).toBeGreaterThanOrEqual(380);
  expect(payload.denseBuildings).toBeLessThanOrEqual(420);
  expect(payload.delivering).toBeGreaterThanOrEqual(60);
  if (run.fixture === "dense-2x400") {
    expect(payload.islands).toBe(2);
    expect(payload.shipsOnLegs).toBe(2);
  } else {
    expect(payload.islands).toBe(8);
    expect(payload.shipsOnLegs).toBeGreaterThan(0);
    expect(payload.routes).toBeGreaterThanOrEqual(1);
  }
  await run.setup(page);
  if (run.lod === "near") expect(await page.evaluate(() => window.__newShores!.carts())).toBeGreaterThanOrEqual(60);
  // The models in view (buildings at near LOD, ships at every LOD) have loaded: measure with them, not the placeholders.
  await modelsLoaded(page);
  if (run.lod === "near") expect(await page.evaluate(() => window.__newShores!.assets().placeholders)).toEqual([]);

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
  const lod = await page.evaluate(() => window.__newShores!.lod());
  const visible = await page.evaluate(() => window.__newShores!.visibleIslands());
  const assets = await page.evaluate(() => window.__newShores!.assets());
  await context.close();
  return { ...payload, ttfiMs, drawCalls, frames, heapBytes, renderer, renderScale, lod, visible, glbBytes: assets.bytes, firstModelMs: assets.firstModelMs, models: assets.loaded.length };
}

test.describe.configure({ mode: "serial" });

for (const run of RUNS) {
  for (const c of CONFIGS) {
    test(`${run.lod} LOD (${run.fixture}) holds the budget at ${c.name} (4× CPU throttling)`, async ({ browser }) => {
      test.setTimeout(150_000);
      const r = await measure(browser, c, run);
      const bundle = bundleSizes();
      console.log(
        `PERF ${run.lod} ${run.fixture} ${c.name} ${JSON.stringify({
          minFps: c.check ? perfMinFps(run.lod) : null,
          fps: Number(r.frames.fps.toFixed(1)),
          avgMs: Number(r.frames.avgMs.toFixed(1)),
          p95Ms: Number(r.frames.p95Ms.toFixed(1)),
          frames: r.frames.frames,
          drawCalls: r.drawCalls,
          heapMB: Number((r.heapBytes / 1024 / 1024).toFixed(1)),
          ttfiMs: Math.round(r.ttfiMs),
          glbBytes: r.glbBytes,
          firstModelMs: r.firstModelMs === null ? null : Math.round(r.firstModelMs),
          models: r.models,
          renderScale: Number(r.renderScale.toFixed(3)),
          lod: r.lod,
          visible: r.visible,
          buildings: r.totalBuildings,
          carts: r.delivering,
          renderer: r.renderer,
          bundleGzipKB: Number((bundle.totalGzip / 1024).toFixed(1)),
          largestGzipKB: bundle.largest.map((b) => `${b.file}=${(b.gzip / 1024).toFixed(1)}`),
        })}`,
      );
      expect(r.lod).toBe(run.lod);
      expect(r.heapBytes).toBeLessThan(MAX_HEAP_BYTES);
      expect(r.drawCalls).toBeGreaterThan(0);
      expect(r.drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
      if (c.check && process.env.PERF_GPU !== "1") expect(r.frames.fps).toBeGreaterThanOrEqual(perfMinFps(run.lod));
    });
  }
}
