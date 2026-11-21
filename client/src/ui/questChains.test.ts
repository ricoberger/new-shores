import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { Content, DisplayState } from "../api/client";
import { setLanguage } from "../i18n";
import { QuestsPanel } from "./QuestsPanel";
import { questChainOf, questChains } from "./questChains";

afterEach(() => setLanguage("en", false));

const contentDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content", "old_coast");
const shipped = (n: string) => JSON.parse(readFileSync(join(contentDir, `${n}.json`), "utf8")) as unknown;
// Quests in the served shape (rewards.goods always present, as the server sends them).
const quests = (shipped("quests") as { rewards: object }[]).map((q) => ({ ...q, rewards: { gold: 0, goods: {}, ...q.rewards } }));
const content = { tiers: shipped("tiers"), quests, goods: shipped("goods"), buildings: shipped("buildings"), ships: [] } as unknown as Content;

/** The fork after intro_settlers_120: the Citizens' stone (D-083) and shipyard are both open, the 120 settlers wait to be claimed. */
const model = {
  islands: [],
  quests: {
    claimable: ["intro_settlers_120"],
    active: [
      { id: "citizens_stone", objectives: [{ kind: "stock", good: "stone", min: 20_000, met: false }] },
      { id: "citizens_shipyard", objectives: [] },
    ],
  },
} as unknown as DisplayState;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("quest chains in the quest list", () => {
  it("takes the chain from the ID prefix, like the almanac", () => {
    expect(questChainOf("intro_first_road")).toBe("intro");
    expect(questChainOf("patricians_carrack")).toBe("patricians");
    expect(questChainOf("lonely")).toBe("lonely");
  });

  it("groups the open quests by chain with their steps, the claimed count and the next quest", () => {
    const chains = questChains(model, content);
    expect(chains.map((c) => c.id)).toEqual(["intro", "citizens"]);
    const [intro, citizens] = chains;
    expect(intro).toMatchObject({ name: "Intro", total: 10, done: 8, next: "intro_citizen_house" });
    expect(intro?.open).toEqual([{ id: "intro_settlers_120", claimable: true, step: 9 }]);
    expect(citizens).toMatchObject({ name: "Citizens", total: 6, done: 0, next: "citizens_cog" });
    expect(citizens?.open).toEqual([
      { id: "citizens_stone", claimable: false, step: 1 },
      { id: "citizens_shipyard", claimable: false, step: 2 },
    ]);
  });

  it("lists a chain's last quest without a next one, and quests the content lacks on their own", () => {
    const last = { ...model, quests: { claimable: [], active: [{ id: "patricians_carrack", objectives: [] }, { id: "event_x", objectives: [] }] } } as unknown as DisplayState;
    const chains = questChains(last, content);
    expect(chains.map((c) => [c.id, c.done, c.total, c.next])).toEqual([
      ["patricians", 5, 6, null],
      ["event", 0, 1, null],
    ]);
    expect(questChains({ ...model, quests: { claimable: [], active: [] } } as unknown as DisplayState, content)).toEqual([]);
  });

  it("renders the chains, steps and next quests in the panel (English and German)", () => {
    const render = () => text(renderToStaticMarkup(createElement(QuestsPanel, { model, content, onClaim: () => {}, onClose: () => {} })));
    const en = render();
    expect(en).toMatch(/^Quests.*Intro8 of 10 doneStep 9 of 10/);
    expect(en).toContain("Citizens0 of 6 doneStep 1 of 6");
    expect(en).toContain("Step 2 of 6");
    expect(en).toMatch(/Next: [^N]+Citizens0 of 6/);
    expect(en).toMatch(/Next: [^N]+$/);
    setLanguage("de", false);
    const de = render();
    expect(de).toContain("Einstieg8 von 10 erledigtSchritt 9 von 10");
    expect(de).toContain("Danach: ");
  });
});
