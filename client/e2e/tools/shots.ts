// `make shots`: PNGs of the game with one command, identical camera and
// clock in every session (see the Makefile header and README). Not a test:
// it starts the e2e servers (the commands of constants.ts) itself,
// drives the page through the window.__newShores hook and writes
// .experiment/shots/<set>/<fixture>-<view>-<device>.png (presets:
// <fixture>-<preset>-<device>.png). Run through `npm run shots`.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, devices, type Page } from "@playwright/test";
import type { WorldResponse } from "../../src/api/client.ts";
import { FAR_EXIT_HALF, MID_TO_NEAR_HALF } from "../../src/display/lod.ts";
import { API_PORT, API_SERVER_COMMAND, E2E_TIME_SCALE, WEB_PORT, WEB_SERVER_COMMAND } from "../constants.ts";
import { type Device, type Fixture, type Preset, parseShotArgs, SERVER_FIXTURES, ShotArgError, type ShotArgs, type View } from "./shots-args.ts";

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(CLIENT_DIR, "..");

/** The visual spec's fixed time (the fixtures are built relative to it). */
const T = new Date("2026-10-21T16:00:00Z");
/** Camera half extents of the views (the visual spec's near default, mid and far LOD). */
const HALF = { near: 18, mid: 47 } as const;

const BASE_URL = `http://localhost:${WEB_PORT}`;
const DEVICE_OPTIONS = {
  desktop: { ...devices["Desktop Chrome"], baseURL: BASE_URL, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { ...devices["Pixel 5"], baseURL: BASE_URL, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625 },
};

/** The island each fixture opens on and per-view camera targets of the visual spec. */
const FIXTURE_INFO: Record<Fixture, { island: string | null; targets?: Partial<Record<View, { x: number; y: number; half?: number }>> }> = {
  showcase: { island: "showcase", targets: { near: { x: 22, y: 13, half: 10 } } },
  settled: { island: "isle-01" }, // the home island of every generated archipelago (D-053)
  town: { island: "isle-01" },
  seafaring: { island: "isle-01" }, // a new world: the start sloop at sea, nothing settled
  "dense-2x400": { island: "dense1" },
  "dense-archipelago-8": { island: "dense1", targets: { mid: { x: 87, y: 75 } } },
  "archipelago-8x20": { island: null },
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------- servers

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

/** Starts a shell command in its own process group and waits for the URL. */
async function start(command: string, cwd: string, url: string, env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  if (await reachable(url)) throw new Error(`${url} is already served (a running e2e run, \`make preview\` or another \`make shots\`); stop it first`);
  const child = spawn(command, { cwd, env, shell: true, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  // Kept for the failure message only (the dev server logs every request).
  let log = "";
  child.stderr?.on("data", (d: Buffer) => (log = (log + d.toString()).slice(-4000)));
  let exited: number | null | undefined;
  child.on("exit", (code) => (exited = code));
  const deadline = Date.now() + 180_000;
  while (!(await reachable(url))) {
    if (exited !== undefined) throw new Error(`\`${command}\` exited with ${exited} before ${url} was up\n${log}`);
    if (Date.now() > deadline) throw new Error(`${url} not up after 180 s`);
    await sleep(200);
  }
  return child;
}

function stop(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------- page helpers

/**
 * Waits until the frame is complete: the model manifest and every requested
 * model loaded, then the scene stable (no new meshes, the same triangle
 * count) over consecutive samples; decor and instances arrive in batches after
 * the models, and a shot taken in between differs from the next session's.
 */
async function settle(page: Page): Promise<void> {
  // The renderer requests the models of a new view on a 250 ms interval: an empty pending list before that proves nothing.
  await page.waitForTimeout(600);
  await page.waitForFunction(
    () => {
      const a = window.__newShores!.assets();
      return a.manifest && a.pending.length === 0 && a.failed.length === 0 && a.bridged === 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  const sample = () => page.evaluate(() => `${window.__newShores!.meshesCreated()}/${window.__newShores!.triangles()}/${window.__newShores!.drawCalls()}`);
  let last = "";
  let stable = 0;
  for (let i = 0; i < 40 && stable < 2; i++) {
    await page.waitForTimeout(100);
    const now = await sample();
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  await page.waitForTimeout(100);
}

/** Load timing of a page (ms since navigation on this script's clock; null: did not happen). */
interface Timing {
  firstFrameMs: number | null;
  focusTilesMs: number | null;
}
const timings = new WeakMap<Page, Timing>();

/**
 * Opens the game on a fixture. `patch` edits every `GET /api/v1/world`
 * response before the client sees it (a state the dev fixtures do not
 * reach, e.g. four ships at the pier; display only, the server is not
 * changed).
 */
async function open(
  browser: Browser,
  device: Device,
  fixture: Fixture,
  hud: boolean,
  patch?: (w: WorldResponse) => void,
): Promise<{ page: Page; close: () => Promise<void> }> {
  if (SERVER_FIXTURES.includes(fixture)) {
    const res = await fetch(`http://localhost:${API_PORT}/api/v1/dev/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture }),
    });
    if (!res.ok) throw new Error(`dev reset to '${fixture}' failed: ${res.status} ${await res.text()}`);
  }
  const context = await browser.newContext(DEVICE_OPTIONS[device]);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`page error (${fixture}, ${device}): ${e.message}`));
  await page.clock.setFixedTime(T);
  // HOLD_TILES=n lets the first n island tile requests through and holds the
  // rest (never answered): the lazy-loading look, islands drawn from masks.
  const hold = process.env.HOLD_TILES?.trim();
  if (hold) {
    let passed = 0;
    await page.route("**/api/v1/world/islands/*/tiles*", (route) => {
      if (passed++ < Number(hold)) void route.continue();
    });
  }
  if (patch) {
    await page.route("**/api/v1/world", async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as WorldResponse;
      patch(json);
      await route.fulfill({ response, json });
    });
  }
  const t0 = Date.now();
  // QUERY adds URL parameters (e.g. farmask=0, life=0) for A/B measurements.
  const params = new URLSearchParams(SERVER_FIXTURES.includes(fixture) ? "" : `fixture=${fixture}`);
  for (const [k, v] of new URLSearchParams(process.env.QUERY?.trim() ?? "")) params.set(k, v);
  const query = params.toString();
  await page.goto(query === "" ? "/" : `/?${query}`);
  await page.waitForFunction(() => Number.isFinite(window.__newShores?.camera().x ?? NaN) && window.__newShores!.getServer() !== null, undefined, { timeout: 30_000 });
  // Load timing on the wall clock of this script (the page's performance clock is faked with the fixed time).
  const timing: Timing = { firstFrameMs: null, focusTilesMs: null };
  if (process.env.STATS?.trim() === "1") {
    await page.waitForFunction(() => window.__newShores!.timing().firstFrame, undefined, { timeout: 30_000, polling: 10 });
    timing.firstFrameMs = Date.now() - t0;
    if (await page.waitForFunction(() => window.__newShores!.timing().focusTiles, undefined, { timeout: 60_000, polling: 10 }).then(() => true, () => false)) {
      timing.focusTilesMs = Date.now() - t0;
    }
  }
  timings.set(page, timing);
  await page.evaluate((t) => window.__newShores!.freezeTime(t), T.getTime());
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
  if (!hud) await page.addStyleTag({ content: "body * { visibility: hidden !important; } body canvas { visibility: visible !important; }" });
  return { page, close: () => context.close() };
}

async function islandCentre(page: Page, island: string | null, wanted?: string): Promise<{ id: string; x: number; y: number }> {
  const r = await page.evaluate(
    ([want, def]) => {
      const islands = window.__newShores!.getServer()!.display.islands;
      const is = islands.find((i) => i.id === (want ?? def)) ?? (want ? undefined : islands[0]);
      return { ids: islands.map((i) => i.id), is: is ? { id: is.id, x: is.position.x + is.width / 2, y: is.position.y + is.height / 2 } : null };
    },
    [wanted ?? null, island] as const,
  );
  if (!r.is) throw new ShotArgError(`ISLAND: unknown island '${wanted}'; this fixture has: ${r.ids.join(", ")}`);
  return r.is;
}

async function setCamera(page: Page, c: { x?: number; y?: number; half?: number; rotation?: number }): Promise<void> {
  await page.evaluate((v) => window.__newShores!.setCamera(v), c);
}

async function showArchipelago(page: Page, rotation: number): Promise<void> {
  const centre = await page.evaluate(() => {
    const is = window.__newShores!.getServer()!.display.islands;
    const minX = Math.min(...is.map((i) => i.position.x));
    const maxX = Math.max(...is.map((i) => i.position.x + i.width));
    const minY = Math.min(...is.map((i) => i.position.y));
    const maxY = Math.max(...is.map((i) => i.position.y + i.height));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  });
  await setCamera(page, { ...centre, half: 100_000, rotation });
}

async function waitLod(page: Page, lod: View): Promise<void> {
  await page.waitForFunction((l) => window.__newShores!.lod() === l, lod, { timeout: 10_000 }).catch(() => {
    throw new Error(`the camera did not reach the '${lod}' level of detail (ZOOM too far off the view?)`);
  });
}

async function shoot(page: Page, file: string, written: string[]): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, timeout: 90_000, animations: "disabled", caret: "hide" });
  written.push(file);
  const name = relative(process.cwd(), file) || file;
  if (process.env.STATS?.trim() === "1") {
    // Perf sanity (polish rounds): the renderer's counters of the shot's frame.
    // Load timing of the page (ms since navigation): first frame, focused island with its full tiles.
    const s = await page.evaluate(() => ({ draws: window.__newShores!.drawCalls(), tris: window.__newShores!.triangles(), meshes: window.__newShores!.meshesCreated() }));
    const t = timings.get(page);
    const ms = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${Math.round(v)} ms`);
    console.log(`${name}  draws ${s.draws}  tris ${s.tris}  meshes ${s.meshes}  first-frame ${ms(t?.firstFrameMs)}  focus-tiles ${ms(t?.focusTilesMs)}`);
  } else if (process.env.STATS?.trim() === "2") {
    // The active meshes by layer (where the draws and triangles go).
    const layers = await page.evaluate(() => window.__newShores!.activeLayers());
    const rows = Object.entries(layers).sort((a, b) => b[1].tris - a[1].tris);
    console.log(`${name}\n${rows.map(([k, v]) => `  ${k.padEnd(28)} meshes ${String(v.meshes).padStart(3)}  tris ${v.tris}`).join("\n")}`);
  } else {
    console.log(name);
  }
}

// ---------------------------------------------------------------- matrix

async function takeViews(page: Page, args: ShotArgs, fixture: Fixture, device: Device, dir: string, written: string[]): Promise<void> {
  const info = FIXTURE_INFO[fixture];
  const here = await islandCentre(page, info.island, args.island);
  for (const view of args.views) {
    if (view === "start") {
      // The opening camera as the game placed it (before any other view moves it).
      await settle(page);
      await shoot(page, resolve(dir, `${fixture}-${view}-${device}.png`), written);
      continue;
    }
    if (view === "far" && args.zoom === undefined && args.x === undefined) {
      await showArchipelago(page, args.rotation);
    } else {
      const t = args.island ? undefined : info.targets?.[view];
      const half = args.zoom ?? t?.half ?? (view === "far" ? 100_000 : HALF[view]);
      // The mid half extent lies in the LOD hysteresis band (FAR_EXIT_HALF):
      // coming from far (a new world opens there, D-053; or VIEW=far,mid)
      // the camera passes below it first.
      if (view === "mid" && args.zoom === undefined && (await page.evaluate(() => window.__newShores!.lod())) === "far") {
        await setCamera(page, { half: (MID_TO_NEAR_HALF + FAR_EXIT_HALF) / 2 });
        await waitLod(page, "mid");
      }
      await setCamera(page, { x: args.x ?? t?.x ?? here.x, y: args.y ?? t?.y ?? here.y, half, rotation: args.rotation });
    }
    if (args.zoom === undefined) await waitLod(page, view);
    await settle(page);
    await shoot(page, resolve(dir, `${fixture}-${view}-${device}.png`), written);
  }
}

// ---------------------------------------------------------------- presets

async function tileAt(page: Page, island: string, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([id, tx, ty]) => window.__newShores!.tileToScreen(id as string, tx as number, ty as number), [island, x, y] as const);
}

/** The first farm of a type (default: sheep farm) of the loaded world (island ID and tile). */
async function farmOf(page: Page, type = "sheep_farm"): Promise<{ island: string; x: number; y: number }> {
  return page.evaluate((t) => {
    for (const is of window.__newShores!.getServer()!.display.islands) {
      const b = is.buildings.find((x) => x.type === t);
      if (b) return { island: is.id, x: b.x, y: b.y };
    }
    throw new Error(`no ${t}`);
  }, type);
}

/** The home island's Trading Post at level 4 with four ships at its berths and one in its queue (copies of the start sloop). */
function fourAtThePier(w: WorldResponse): void {
  const d = w.display;
  const home = d.islands.find((i) => i.buildings.some((b) => b.type === "trading_post"));
  const tp = home?.buildings.find((b) => b.type === "trading_post");
  const sloop = d.ships[0];
  if (!home || !tp || !sloop) throw new Error("fourAtThePier: no Trading Post or ship");
  const ids = [901, 902, 903, 904, 905];
  for (const id of ids) {
    d.ships.push({ ...sloop, id, state: id === 905 ? "waiting_for_berth" : "idle", island_id: home.id, position: null, leg: null, route_id: 0, cargo: [], paused: false });
  }
  tp.level = 4;
  tp.berths = { total: 4, busy: 4, ships: ids.slice(0, 4), queue: [905] };
}

/** The home island's shipyard halfway through a sloop. */
function sloopOnTheSlip(w: WorldResponse): void {
  const yard = w.display.islands.flatMap((i) => i.buildings).find((b) => b.type === "shipyard");
  if (!yard) throw new Error("sloopOnTheSlip: no shipyard");
  // Around the payload's evaluation time (the client's clock follows the server's).
  const now = Date.parse(w.display.evaluated_at);
  yard.ship_order = { type: "sloop", ordered_at: new Date(now - 60_000).toISOString(), due_at: new Date(now + 60_000).toISOString() };
}

/** Centres the camera at near on a building's footprint (plus an offset in tiles) and opens its card. */
async function selectBuilding(page: Page, type: string, offset: { x: number; y: number }, half: number): Promise<void> {
  const t = await page.evaluate((ty) => {
    for (const is of window.__newShores!.getServer()!.display.islands) {
      const b = is.buildings.find((x) => x.type === ty);
      if (b) return { island: is.id, x: b.x, y: b.y, ox: is.position.x, oy: is.position.y };
    }
    throw new Error(`no ${ty}`);
  }, type);
  await setCamera(page, { x: t.ox + t.x + offset.x, y: t.oy + t.y + offset.y, half, rotation: 0 });
  await settle(page);
  // A land tile of the footprint whatever its rotation (ships over the water rows take the click there).
  for (const [dx, dy] of [
    [2, 2],
    [3, 5],
    [5, 3],
    [1, 7],
    [7, 1],
  ] as const) {
    const p = await tileAt(page, t.island, t.x + dx, t.y + dy);
    await page.mouse.click(p.x, p.y);
    if (await page.getByTestId("info-panel").waitFor({ state: "visible", timeout: 2000 }).then(() => true, () => false)) {
      if (await page.getByTestId("info-panel").getByText(type.replace("_", " "), { exact: false }).count()) break;
    }
    await page.keyboard.press("Escape");
  }
  await page.getByTestId("info-panel").waitFor({ state: "visible" });
  await page.mouse.move(5, 400);
}

const PRESET_RUN: Record<Preset, { fixture: Fixture; device: Device; patch?: (w: WorldResponse) => void; run: (page: Page) => Promise<void> }> = {
  // The HUD with the info panel of a building that is not running (desktop).
  "info-panel": {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === "dense1")!;
        const b = is.buildings.find((x) => x.status !== "ok" && x.type === "lumberjack") ?? is.buildings.find((x) => x.status !== "ok")!;
        return { x: b.x, y: b.y };
      });
      await setCamera(page, { x: t.x + 1, y: t.y + 1, half: HALF.near, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, "dense1", t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      // The producer card's collapsed Details, opened.
      await page.getByTestId("info-details").locator("summary").click();
      await page.mouse.move(5, 400);
    },
  },
  // A producer with inputs (a sawmill) selected, Details open (desktop).
  "producer-inputs": {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === "dense1")!;
        const b = is.buildings.find((x) => x.type === "sawmill")!;
        return { x: b.x, y: b.y };
      });
      await setCamera(page, { x: t.x + 1, y: t.y + 1, half: HALF.near, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, "dense1", t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.getByTestId("info-details").locator("summary").click();
      await page.mouse.move(5, 400);
    },
  },
  // A house selected (desktop).
  "house-card": {
    fixture: "settled",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        for (const is of window.__newShores!.getServer()!.display.islands) {
          const b = is.buildings.find((x) => (x.needs?.length ?? 0) > 0) ?? is.buildings.find((x) => x.residents !== undefined);
          if (b) return { island: is.id, x: b.x, y: b.y };
        }
        throw new Error("no house");
      });
      await setCamera(page, { x: t.x + 1, y: t.y + 1, half: HALF.near, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, t.island, t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  "warehouse-card": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        for (const is of window.__newShores!.getServer()!.display.islands) {
          const b = is.buildings.find((x) => x.type === "warehouse" && x.level === 1);
          if (b) return { island: is.id, x: b.x, y: b.y };
        }
        throw new Error("no chapel");
      });
      await setCamera(page, { x: t.x + 1, y: t.y + 1, half: HALF.near, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, t.island, t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  "service-card": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        for (const is of window.__newShores!.getServer()!.display.islands) {
          const b = is.buildings.find((x) => x.type === "chapel");
          if (b) return { island: is.id, x: b.x, y: b.y };
        }
        throw new Error("no chapel");
      });
      await setCamera(page, { x: t.x + 1, y: t.y + 1, half: HALF.near, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, t.island, t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.getByTestId("info-details").locator("summary").click();
      await page.mouse.move(5, 400);
    },
  },
  // The Trading Post at level 4 (D-054 size, settled) with four ships at its berths and one queued, its card open.
  "trading-post-card": {
    fixture: "settled",
    device: "desktop",
    patch: fourAtThePier,
    run: (page) => selectBuilding(page, "trading_post", { x: 1, y: -3 }, 12),
  },
  "shipyard-idle": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        for (const is of window.__newShores!.getServer()!.display.islands) {
          for (const x of is.buildings) if (x.type === "shipyard") delete (x as { ship_order?: unknown }).ship_order;
          const b = is.buildings.find((x) => x.type === "shipyard");
          if (b) return { island: is.id, x: b.x, y: b.y };
        }
        throw new Error("no chapel");
      });
      await setCamera(page, { x: t.x + 1, y: t.y + 1, half: HALF.near, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, t.island, t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  // The shipyard (D-054 size, settled) halfway through a sloop on its slipway, its card open.
  "shipyard-building": {
    fixture: "settled",
    device: "desktop",
    patch: sloopOnTheSlip,
    run: (page) => selectBuilding(page, "shipyard", { x: 4, y: 4 }, 12),
  },
  "served-houses": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        for (const is of window.__newShores!.getServer()!.display.islands) {
          const b = is.buildings.find((x) => x.type === "chapel");
          if (b) return { island: is.id, x: b.x, y: b.y };
        }
        throw new Error("no chapel");
      });
      await setCamera(page, { x: 15, y: 9, half: 13, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, t.island, t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  "serving-buildings": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const t = await page.evaluate(() => {
        for (const is of window.__newShores!.getServer()!.display.islands) {
          const b = is.buildings.find((x) => x.type === "house_citizens");
          if (b) return { island: is.id, x: b.x, y: b.y };
        }
        throw new Error("no chapel");
      });
      await setCamera(page, { x: 15, y: 9, half: 13, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, t.island, t.x, t.y);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  // Phone portrait with the ships sheet open.
  sheet: {
    fixture: "dense-2x400",
    device: "phone",
    run: async (page) => {
      await page.getByTestId("dock-ships").click();
      await page.getByTestId("sheet").waitFor({ state: "visible" });
      // The sheet takes focus on open; a neutral focus keeps the shot stable.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
  },
  // A sheep farm selected: its pastures are tinted like the farm (desktop).
  "farm-selected": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const f = await farmOf(page);
      await setCamera(page, { x: f.x + 1, y: f.y + 1, half: 6, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, f.island, f.x + 1, f.y + 1);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  // A hemp farm selected: its fields are tinted like the farm (desktop).
  "hemp-farm-selected": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const f = await farmOf(page, "hemp_farm");
      await setCamera(page, { x: f.x + 1, y: f.y + 1, half: 6, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, f.island, f.x + 1, f.y + 1);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  // A pasture selected: its card names its farm and says it counts (desktop).
  "field-selected": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const f = await farmOf(page, "pasture");
      await setCamera(page, { x: f.x + 1, y: f.y + 1, half: 6, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, f.island, f.x + 1, f.y + 1);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("info-panel").waitFor({ state: "visible" });
      await page.mouse.move(5, 400);
    },
  },
  // The field tool of a sheep farm: the pasture ghost next to the farm (desktop).
  "field-ghost": {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      const f = await farmOf(page);
      await setCamera(page, { x: f.x + 1, y: f.y + 1, half: 6, rotation: 0 });
      await settle(page);
      const p = await tileAt(page, f.island, f.x + 1, f.y + 1);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId("farm-add-field").click();
      // The first tile around the farm where the server would accept a pasture.
      for (let dy = -3; dy <= 6; dy++) {
        for (let dx = -3; dx <= 6; dx++) {
          const q = await tileAt(page, f.island, f.x + dx, f.y + dy);
          await page.mouse.move(q.x, q.y);
          await page.waitForTimeout(60);
          if ((await page.evaluate(() => window.__newShores!.ghostValidity())) === "ok") return;
        }
      }
      throw new Error("no valid pasture tile");
    },
  },
  // The red placement ghost: a quarry off its deposit (desktop).
  ghost: {
    fixture: "showcase",
    device: "desktop",
    run: async (page) => {
      await setCamera(page, { x: 22, y: 21, half: 6, rotation: 0 });
      await settle(page);
      await page.getByTestId("dock-build").click();
      await page.getByTestId("build-tab-production").click();
      await page.getByTestId("build-quarry").click();
      const p = await tileAt(page, "showcase", 23, 22);
      await page.mouse.move(p.x, p.y);
      await page.waitForFunction(() => window.__newShores!.ghostValidity() === "invalid", undefined, { timeout: 10_000 });
    },
  },
  // The build menu open (phone portrait).
  "build-menu": {
    fixture: "showcase",
    device: "phone",
    run: async (page) => {
      await page.getByTestId("dock-build").click();
      await page.getByTestId("build-menu").waitFor({ state: "visible" });
    },
  },
  // The warnings panel open (desktop).
  warnings: {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("dock-warnings").click();
      await page.getByTestId("warnings-panel").waitFor({ state: "visible" });
      // Scrolled: the title stays, the entries move beneath it.
      await page.evaluate(() => {
        const body = document.querySelector('[data-testid="warnings-panel"] > :last-child');
        if (body) body.scrollTop = 240;
      });
    },
  },
  // A ship selected from the Ships list: its panel and the selection ring (desktop).
  "ship-panel": {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("dock-ships").click();
      await page.getByTestId("ship-1").click();
      await page.getByTestId("ship-panel").waitFor({ state: "visible" });
    },
  },
  // A new route with two stops and a load line, in the route editor (desktop).
  "route-editor": {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("dock-routes").click();
      await page.getByTestId("route-new").click();
      await page.getByTestId("route-name").fill("Timber run");
      for (let i = 0; i < 2; i++) {
        const options = await page.getByTestId("route-stop-add").locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
        await page.getByTestId("route-stop-add").selectOption(options[i]!);
      }
      await page.getByTestId("route-good-add-0").click();
      await page.getByTestId("route-good-add-1").click();
      await page.getByTestId("route-mode-1-load-0").selectOption("unload");
      await page.getByTestId("route-name").focus();
    },
  },
  // The route editor paused by selecting a ship: the "Route editor paused" bar above the ship panel (desktop).
  "route-paused": {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("dock-routes").click();
      await page.getByTestId("route-new").click();
      await page.getByTestId("route-name").fill("Timber run");
      await page.getByTestId("dock-ships").click();
      await page.getByTestId("ship-1").click();
      await page.getByTestId("route-editor-resume").waitFor({ state: "visible" });
    },
  },
  // The island card, opened from an island label at far LOD (desktop).
  // A new world as it opens (D-053): the far zoom over the whole
  // archipelago, the sloop at its centre and the first quest's hint.
  "archipelago-far": {
    fixture: "seafaring",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("seafaring-panel").waitFor({ state: "visible" });
    },
  },
  // "Another archipelago" asks before it replaces the islands (desktop).
  reroll: {
    fixture: "seafaring",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("reroll-archipelago").click();
      await page.getByTestId("dialog").waitFor({ state: "visible" });
    },
  },
  // Renaming the settled home island in its card (desktop).
  rename: {
    fixture: "settled",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("hud-island-name").click();
      await page.getByTestId("island-card").waitFor({ state: "visible" });
      await page.getByTestId("island-rename").click();
      await page.getByTestId("island-rename-input").fill("Gull Haven");
    },
  },
  "island-card": {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      await setCamera(page, { half: 100_000, rotation: 0 });
      // The canvas takes the tap (labels are resolved by the renderer), so click at the label's position.
      const box = await page.locator('[data-testid^="island-label-"]').first().boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.getByTestId("island-card").waitFor({ state: "visible" });
    },
  },
  // The top bar's population popup, pinned open (desktop).
  "top-bar-popups": {
    fixture: "settled",
    device: "desktop",
    run: async (page) => {
      await page.getByTestId("hud-population-chip").click();
      await page.getByTestId("hud-tier-settlers").waitFor({ state: "visible" });

    },
  },
  // A sloop on a leg (desktop), camera centred on ship 2.
  sloop: {
    fixture: "dense-2x400",
    device: "desktop",
    run: async (page) => {
      await setCamera(page, { half: 7, rotation: 0 });
      // Centre on the ship through the archipelago → screen Jacobian of the hook's projections.
      for (let i = 0; i < 4; i++) {
        await page.evaluate((shipId) => {
          const h = window.__newShores!;
          const c = h.camera();
          const s = h.shipToScreen(shipId);
          const o = h.archToScreen(c.x, c.y);
          const ax = h.archToScreen(c.x + 1, c.y);
          const ay = h.archToScreen(c.x, c.y + 1);
          const det = (ax.x - o.x) * (ay.y - o.y) - (ay.x - o.x) * (ax.y - o.y);
          const dx = s.x - o.x;
          const dy = s.y - o.y;
          const u = ((ay.y - o.y) * dx - (ay.x - o.x) * dy) / det;
          const v = (-(ax.y - o.y) * dx + (ax.x - o.x) * dy) / det;
          if (Number.isFinite(u) && Number.isFinite(v)) h.setCamera({ x: c.x + u, y: c.y + v });
        }, 2);
        await page.waitForTimeout(250);
      }
    },
  },
};

async function takePreset(browser: Browser, preset: Preset, dir: string, written: string[]): Promise<void> {
  const p = PRESET_RUN[preset];
  const { page, close } = await open(browser, p.device, p.fixture, true, p.patch);
  try {
    if (preset === "sheet") await page.waitForFunction(() => window.__newShores!.quality() === "low", undefined, { timeout: 10_000 });
    await settle(page);
    await p.run(page);
    await settle(page);
    await shoot(page, resolve(dir, `${p.fixture}-${preset}-${p.device}.png`), written);
  } finally {
    await close();
  }
}

// ---------------------------------------------------------------- main

async function main(): Promise<number> {
  let args: ShotArgs;
  try {
    args = parseShotArgs(process.env);
  } catch (e) {
    if (e instanceof ShotArgError) {
      console.error(`shots: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const dir = isAbsolute(args.out) ? args.out : resolve(REPO, args.out);
  const t0 = Date.now();
  const servers: ChildProcess[] = [];
  const cleanup = () => servers.forEach(stop);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  let browser: Browser | undefined;
  try {
    const env = {
      ...process.env,
      VITE_E2E: "1",
      VITE_API_BASE: `http://localhost:${API_PORT}`,
      VITE_TIME_SCALE: String(E2E_TIME_SCALE),
    };
    // CONTENT: another content directory (e.g. a local variant with larger islands for measurements).
    const base = args.content === undefined ? API_SERVER_COMMAND : API_SERVER_COMMAND.replace("--content ../content/old_coast", `--content '${resolve(REPO, args.content)}'`);
    const apiCommand = args.seed === undefined ? base : `${base} --seed ${args.seed}`;
    servers.push(await start(apiCommand, resolve(REPO, "server"), `http://localhost:${API_PORT}/healthz`, process.env));
    servers.push(await start(WEB_SERVER_COMMAND, CLIENT_DIR, `http://localhost:${WEB_PORT}`, env));
    const tReady = Date.now();
    browser = await chromium.launch();
    const written: string[] = [];
    if (args.presets.length > 0) {
      for (const preset of args.presets) await takePreset(browser, preset, dir, written);
    } else {
      const job = async (device: Device, fixture: Fixture) => {
        const { page, close } = await open(browser!, device, fixture, args.hud);
        try {
          await takeViews(page, args, fixture, device, dir, written);
        } finally {
          await close();
        }
      };
      // Software WebGL is CPU bound and more than two pages at once starve
      // each other (late loads, differing pixels): one worker per device.
      // Client fixtures go first; server fixtures share the dev server's
      // world and take turns (the lock covers the reset and the shots).
      let lock: Promise<void> = Promise.resolve();
      const exclusive = (fn: () => Promise<void>): Promise<void> => {
        const run = lock.then(fn);
        lock = run.catch(() => undefined);
        return run;
      };
      await Promise.all(
        args.devices.map(async (device) => {
          for (const fixture of args.fixtures.filter((f) => !SERVER_FIXTURES.includes(f))) await job(device, fixture);
          for (const fixture of args.fixtures.filter((f) => SERVER_FIXTURES.includes(f))) await exclusive(() => job(device, fixture));
        }),
      );
    }
    written.sort();
    console.log(`shots: ${written.length} written to ${dir} in ${((Date.now() - t0) / 1000).toFixed(1)} s (servers up after ${((tReady - t0) / 1000).toFixed(1)} s)`);
    return 0;
  } catch (e) {
    if (e instanceof ShotArgError) {
      console.error(`shots: ${e.message}`);
      return 2;
    }
    console.error(`shots: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await browser?.close();
    cleanup();
  }
}

process.exit(await main());
