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
const content = { tiers: shipped("tiers"), quests: shipped("quests"), goods: shipped("goods"), buildings: shipped("buildings"), ships: [] } as unknown as Content;

/** The fork after intro_settlers_120: the intro's island 2 and the Citizens' shipyard are both open, the 120 settlers wait to be claimed. */
const model = {
  islands: [],
  quests: {
    claimable: ["intro_settlers_120"],
    active: [
      { id: "intro_island2", objectives: [{ kind: "island_settled", count: 2, met: false }] },
      { id: "citizens_shipyard", objectives: [] },
    ],
  },
} as unknown as DisplayState;

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("quest chains in the quest list", () => {
  it("takes the chain from the ID prefix, like the almanac", () => {
    expect(questChainOf("intro_first_road")).toBe("intro");
    expect(questChainOf("patricians_galleon")).toBe("patricians");
    expect(questChainOf("lonely")).toBe("lonely");
  });

  it("groups the open quests by chain with their steps, the claimed count and the next quest", () => {
    const chains = questChains(model, content);
    expect(chains.map((c) => c.id)).toEqual(["intro", "citizens"]);
    const [intro, citizens] = chains;
    expect(intro).toMatchObject({ name: "Intro", total: 12, done: 8, next: "intro_tools" });
    expect(intro?.open).toEqual([
      { id: "intro_settlers_120", claimable: true, step: 9 },
      { id: "intro_island2", claimable: false, step: 10 },
    ]);
    expect(citizens).toMatchObject({ name: "Citizens", total: 5, done: 0, next: "citizens_sloop" });
    expect(citizens?.open).toEqual([{ id: "citizens_shipyard", claimable: false, step: 1 }]);
  });

  it("lists a chain's last quest without a next one, and quests the content lacks on their own", () => {
    const last = { ...model, quests: { claimable: [], active: [{ id: "patricians_galleon", objectives: [] }, { id: "event_x", objectives: [] }] } } as unknown as DisplayState;
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
    expect(en).toMatch(/^Quests.*Intro8 of 12 doneStep 9 of 12/);
    expect(en).toContain("Step 10 of 12");
    expect(en).toContain("Citizens0 of 5 doneStep 1 of 5");
    expect(en).toMatch(/Next: [^N]+Citizens0 of 5/);
    expect(en).toMatch(/Next: [^N]+$/);
    setLanguage("de", false);
    const de = render();
    expect(de).toContain("Einstieg8 von 12 erledigtSchritt 9 von 12");
    expect(de).toContain("Danach: ");
  });
});
