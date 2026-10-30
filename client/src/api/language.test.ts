import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentLanguage, setLanguage } from "../i18n";
import { currentPlayer, login, syncAccountLanguage } from "./auth";
import type { Player } from "./client";

const PLAYER: Player = { id: "p1", display_name: "Ada", guest: false, email_verified: true };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("account language (D-061)", () => {
  let patches: unknown[];
  let me: Player;

  beforeEach(() => {
    patches = [];
    me = PLAYER;
    setLanguage("en", false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const body = JSON.parse(init.body as string) as { language: string };
          patches.push(body.language);
          return json({ player: { ...me, language: body.language } });
        }
        if (init?.method === "POST") return json({ player: me });
        return json({ player: me });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setLanguage("en", false);
  });

  it("applies the account's language when a session is restored", async () => {
    me = { ...PLAYER, language: "de" };
    expect((await currentPlayer())?.language).toBe("de");
    expect(currentLanguage()).toBe("de");
    expect(patches).toEqual([]);
  });

  it("applies the account's language after a login that picked none here", async () => {
    me = { ...PLAYER, language: "de" };
    await login("a@b.org", "password1");
    expect(currentLanguage()).toBe("de");
    expect(patches).toEqual([]);
  });

  it("saves a language picked before the login to the account", async () => {
    setLanguage("de"); // the start screen's switch
    me = { ...PLAYER, language: "en" };
    const p = await login("a@b.org", "password1");
    expect(patches).toEqual(["de"]);
    expect(currentLanguage()).toBe("de");
    expect(p.language).toBe("de");
  });

  it("leaves everything alone when the language already matches", async () => {
    setLanguage("de", false);
    await syncAccountLanguage({ ...PLAYER, language: "de" }, true);
    expect(patches).toEqual([]);
  });

  it("ignores an unknown account language", async () => {
    await syncAccountLanguage({ ...PLAYER, language: "xx" }, false);
    expect(currentLanguage()).toBe("en");
  });
});
