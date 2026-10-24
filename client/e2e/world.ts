import { type APIRequestContext, expect } from "@playwright/test";
import { API_PORT } from "./constants";

/**
 * Dev fixtures of the server's reset endpoint (server/internal/devworld
 * fixtures.go): seafaring — the start state (no island settled, the start
 * sloop at sea, D-051); default — the start island founded from the start
 * sloop at the standard site; town — the smoke spec's result
 * (plank chain, four houses, the first quests claimed, a sheep farm with
 * pastures); settled — town plus the voyage spec's result (shipyard, the
 * sloop sailing "Fish home", island 2 founded with houses and a fisher).
 */
export type DevFixture = "default" | "seafaring" | "town" | "settled";

/**
 * Replaces the dev server's in-memory world with a fresh fixture (POST
 * /api/v1/dev/reset, mounted only with --dev). Every spec that changes the
 * shared world calls it in beforeAll, so no spec depends on the order of
 * the specs or on what an earlier one left behind.
 */
export async function resetWorld(request: APIRequestContext, fixture: DevFixture = "default"): Promise<void> {
  const res = await request.post(`http://localhost:${API_PORT}/api/v1/dev/reset`, { data: { fixture } });
  expect(res.status(), await res.text()).toBe(200);
}
