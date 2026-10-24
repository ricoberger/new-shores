import { expect, type Page, test } from "@playwright/test";
import { modelsLoaded, setCamera, worldReady } from "./archipelago";
import { API_PORT } from "./constants";
import { resetWorld } from "./world";

// Life layer (LIFE_LAYER.md) at near LOD on the dev fixtures: carts and
// walkers on the roads of connected producers and none for a disconnected
// one, smoke only over running producers, the construction stages of a
// placement, and ?life=0 without any of it.

type Life = { stats: { instances: number; particles: number } | null; counts: Record<string, number> };
type Pos = { x: number; y: number };

const MOVERS = /^(cart|cart_loaded|villager_.*)$/;

async function life(page: Page): Promise<Life> {
  return page.evaluate(() => window.__newShores!.life());
}

function movers(l: Life): number {
  return Object.entries(l.counts)
    .filter(([k]) => MOVERS.test(k))
    .reduce((n, [, v]) => n + v, 0);
}

/** Archipelago positions of every instance of the classes matching `re` in the last frame. */
async function positions(page: Page, re: RegExp): Promise<Pos[]> {
  const counts = (await life(page)).counts;
  const out: Pos[] = [];
  for (const cls of Object.keys(counts).filter((k) => re.test(k))) out.push(...(await page.evaluate((c) => window.__newShores!.lifePositions(c), cls)));
  return out;
}

/** Footprints (tiles) of the producers the spec looks at (content/old_coast buildings.json). */
const FOOTPRINT: Record<string, [number, number]> = { lumberjack: [2, 2], sawmill: [2, 2], fisher: [2, 2], sheep_farm: [3, 3] };

/** The archipelago centre of a building's footprint. */
async function centre(page: Page, island: string, type: string, at?: Pos): Promise<Pos> {
  const [w, h] = FOOTPRINT[type]!;
  return page.evaluate(
    ({ island, type, at, w, h }) => {
      const is = window.__newShores!.getServer()!.display.islands.find((i) => i.id === island)!;
      const b = is.buildings.find((x) => x.type === type && (!at || (x.x === at.x && x.y === at.y)))!;
      const [rw, rh] = b.rotation % 180 === 0 ? [w, h] : [h, w];
      return { x: is.position.x + b.x + rw / 2, y: is.position.y + b.y + rh / 2 };
    },
    { island, type, at, w, h },
  );
}

const near = (ps: Pos[], c: Pos, r: number) => ps.filter((p) => Math.hypot(p.x - c.x, p.y - c.y) <= r);

async function show(page: Page, island: string, at: Pos, query = ""): Promise<void> {
  await page.goto(`/?stats=1${query}`);
  await worldReady(page, island);
  const pos = await page.evaluate((id) => window.__newShores!.getServer()!.display.islands.find((i) => i.id === id)!.position, island);
  await setCamera(page, { x: pos.x + at.x, y: pos.y + at.y, half: 10, rotation: 0 });
  await modelsLoaded(page);
}

/** Sends a world command with the page's session (as the client does). */
async function command(page: Page, cmd: Record<string, unknown>): Promise<number> {
  return page.evaluate(
    async ({ port, cmd }) => {
      const res = await fetch(`http://localhost:${port}/api/v1/world/commands`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      return res.status;
    },
    { port: API_PORT, cmd },
  );
}

test.describe("life layer on the town", () => {
  test.beforeEach(async ({ request }) => {
    await resetWorld(request, "town");
  });

  test("carts and walkers for connected producers, none for a disconnected one; construction stages on placement", async ({ page }) => {
    await show(page, "start", { x: 22, y: 6 });
    // The connected, delivering lumberjack sends carts and its walker along the road.
    await expect.poll(async () => movers(await life(page))).toBeGreaterThan(0);
    // A sawmill placed away from the roads (not connected): construction
    // stages while the clock is held, then no cart or walker of its own.
    const T = { x: 14, y: 10 };
    await page.evaluate(() => window.__newShores!.freezeTime(Date.now() + 1_000_000));
    expect(await command(page, { type: "place_building", island_id: "start", building_type: "sawmill", x: T.x, y: T.y, rotation: 0 })).toBe(200);
    await expect.poll(async () => (await life(page)).counts.stage_a ?? 0).toBe(1);
    const status = await page.evaluate(
      (t) => window.__newShores!.getServer()!.display.islands.find((i) => i.id === "start")!.buildings.find((b) => b.x === t.x && b.y === t.y)!.status,
      T,
    );
    expect(status).toBe("not_connected");
    await page.evaluate(() => window.__newShores!.freezeTime(null));
    await expect.poll(async () => Object.keys((await life(page)).counts).filter((k) => k.startsWith("stage_"))).toEqual([]);
    await page.waitForTimeout(1_000);
    const c = await centre(page, "start", "sawmill", T);
    expect(near(await positions(page, MOVERS), c, 2.5)).toEqual([]);
    // The connected producers keep theirs.
    expect(movers(await life(page))).toBeGreaterThan(0);
  });

  test("?life=0 renders without life", async ({ page }) => {
    await show(page, "start", { x: 22, y: 6 }, "&life=0");
    await page.waitForTimeout(1_000);
    expect(await life(page)).toEqual({ stats: null, counts: {} });
    expect(await page.evaluate(() => window.__newShores!.carts())).toBe(0);
  });
});

test("smoke rises only over running producers", async ({ page, request }) => {
  // The settled fixture is the town plus island 2. Running (ok): the
  // fisher on island 2 and the sheep farm on the start island; not
  // running: the lumberjack (low efficiency) and the sawmill (starved).
  await resetWorld(request, "settled");
  await show(page, "island2", { x: 13, y: 3 });
  const fisher = await centre(page, "island2", "fisher");
  await expect.poll(async () => near(await positions(page, /^smoke$/), fisher, 3).length).toBeGreaterThan(0);
  await show(page, "start", { x: 30, y: 6 });
  const farm = await centre(page, "start", "sheep_farm");
  await expect.poll(async () => near(await positions(page, /^smoke$/), farm, 3).length).toBeGreaterThan(0);
  const statuses = await page.evaluate(() =>
    Object.fromEntries(window.__newShores!.getServer()!.display.islands.find((i) => i.id === "start")!.buildings.map((b) => [b.type, b.status])),
  );
  expect(statuses).toMatchObject({ sheep_farm: "ok", lumberjack: "low_efficiency", sawmill: "input_starved" });
  const smoke = await positions(page, /^smoke$/);
  for (const type of ["lumberjack", "sawmill"]) expect(near(smoke, await centre(page, "start", type), 1.5)).toEqual([]);
});
