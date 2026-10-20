import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_TOKEN_KEY, type KeyValueStore, playAsGuest, register } from "./auth";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const PLAYER = { id: "p1", display_name: "Settler 1234", guest: true, email_verified: false };

describe("account flows", () => {
  let bodies: unknown[];
  let handler: (body: Record<string, unknown>) => Response;

  beforeEach(() => {
    bodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        expect(init?.credentials).toBe("include");
        const body = JSON.parse((init?.body as string | undefined) ?? "{}") as Record<string, unknown>;
        bodies.push(body);
        return handler(body);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stores the device token of a new guest and reuses it", async () => {
    const store = memoryStore();
    handler = () => json({ player: PLAYER, device_token: "dev-1" });
    await playAsGuest(store);
    expect(store.data.get(DEVICE_TOKEN_KEY)).toBe("dev-1");
    handler = () => json({ player: PLAYER });
    await playAsGuest(store);
    expect(bodies[1]).toEqual({ device_token: "dev-1" });
  });

  it("drops a rejected device token and creates a new guest", async () => {
    const store = memoryStore();
    store.setItem(DEVICE_TOKEN_KEY, "revoked");
    handler = (b) =>
      b.device_token
        ? json({ error: { code: "invalid_credentials", message: "invalid credentials" } }, 401)
        : json({ player: PLAYER, device_token: "dev-2" });
    const p = await playAsGuest(store);
    expect(p.id).toBe("p1");
    expect(bodies).toEqual([{ device_token: "revoked" }, {}]);
    expect(store.data.get(DEVICE_TOKEN_KEY)).toBe("dev-2");
  });

  it("forgets the device token after registering", async () => {
    const store = memoryStore();
    store.setItem(DEVICE_TOKEN_KEY, "dev-1");
    handler = () => json({ player: { ...PLAYER, guest: false, email: "a@b.org" } });
    await register("a@b.org", "password1", "  ", store);
    expect(bodies[0]).toEqual({ email: "a@b.org", password: "password1" });
    expect(store.data.has(DEVICE_TOKEN_KEY)).toBe(false);
  });
});
