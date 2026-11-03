// US English (UI §10): the English catalogue and the content's English
// text use American spelling. Keys and content IDs may keep a British
// word (`build.group.harbour`, `jewellery`); island names stay as they are.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";

/** British spellings and their US forms (word stems; matched at a word start, any case). */
const BRITISH: readonly (readonly [RegExp, string])[] = [
  [/\bharbour\w*/i, "harbor"],
  [/\bcentre\w*/i, "center"],
  [/\b(re)?colour\w*/i, "color"],
  [/\bfavour\w*/i, "favor"],
  [/\bneighbour\w*/i, "neighbor"],
  [/\bhonour\w*/i, "honor"],
  [/\blabour\w*/i, "labor"],
  [/\bbehaviour\w*/i, "behavior"],
  [/\barmour\w*/i, "armor"],
  [/\bgrey\w*/i, "gray"],
  [/\b(kilo|centi|milli)?metres?\b/i, "meter"],
  [/\btheatre\w*/i, "theater"],
  [/\bfibre\w*/i, "fiber"],
  [/\bjewellery\w*/i, "jewelry"],
  [/\bcatalogue\w*/i, "catalog"],
  [/\bplough\w*/i, "plow"],
  [/\bdefence\w*/i, "defense"],
  [/\blicence\w*/i, "license"],
  [/\bprogramme\w*/i, "program"],
  [/\bstorey\w*/i, "story"],
  [/\b(cancel|travel|label|model|fuel|signal|total|level)l(ed|ing|er)\b/i, "single l"],
  [/\b\w+(is|ys)(e|ed|es|ing|ation)\b/i, "-ize/-yze"],
];

/** British-spelled words in a text: [the match, the US hint]. */
function britishSpellings(text: string): string[] {
  const out: string[] = [];
  for (const [re, us] of BRITISH) {
    const m = re.exec(text);
    if (m && !ISE_OK.has(m[0].toLowerCase())) out.push(`${m[0]} (${us})`);
  }
  return out;
}

/** Words ending in -ise/-yse that are spelled so in US English too. */
const ISE_OK = new Set(
  [
    "advise", "advised", "advises", "advising", "arise", "arises", "arising", "comprise", "comprises", "compromise", "compromised", "concise", "despise",
    "devise", "devised", "disguise", "enterprise", "enterprises", "exercise", "exercises", "expertise", "franchise", "improvise", "merchandise", "noise",
    "otherwise", "paradise", "precise", "premise", "premises", "promise", "promised", "promises", "raise", "raised", "raises", "raising",
    "revise", "revised", "rise", "rises", "rising", "supervise", "surprise", "surprised", "surprises", "televise", "wise", "likewise", "clockwise",
    "anticlockwise", "counterclockwise", "praise", "praised", "cruise", "poise", "poised", "chemise", "excise", "incise", "reprise", "analysis",
    "paralysis", "praises", "noises", "promising", "exercising", "advisers", "cruising", "surprising", "rising",
  ].map((w) => w.toLowerCase()),
);

/** Content fields that carry English prose (CONTENT §11, "Locale files"). */
const PROSE = new Set(["name", "title", "text", "description"]);

function contentTexts(): { where: string; text: string }[] {
  const root = join(__dirname, "..", "..", "..", "content");
  const out: { where: string; text: string }[] = [];
  const walk = (v: unknown, where: string, field?: string) => {
    if (typeof v === "string") {
      if (field && PROSE.has(field)) out.push({ where, text: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`, field));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`, k);
  };
  for (const region of readdirSync(root, { withFileTypes: true })) {
    if (!region.isDirectory() || region.name === "schema") continue;
    for (const file of readdirSync(join(root, region.name))) {
      // Island names stay as they are (Greywater is a name).
      if (!file.endsWith(".json") || file === "island_names.json") continue;
      walk(JSON.parse(readFileSync(join(root, region.name, file), "utf8")), `${region.name}/${file}`);
    }
  }
  return out;
}

describe("US English", () => {
  it("flags British spellings and lets US ones and -ise words that are US too pass", () => {
    expect(britishSpellings("Harbour, centre, recoloured, Cancelling, organised, Jewellery")).toEqual([
      "Harbour (harbor)",
      "centre (center)",
      "recoloured (color)",
      "Jewellery (jewelry)",
      "Cancelling (single l)",
      "organised (-ize/-yze)",
    ]);
    expect(britishSpellings("The harbor center, recolored, canceling, organized jewelry; raise, otherwise, a promise")).toEqual([]);
  });

  it("is the spelling of every English catalogue text (keys may stay British)", () => {
    for (const [key, text] of Object.entries(en)) expect(britishSpellings(text), key).toEqual([]);
  });

  it("is the spelling of the content's English text (IDs and island names excepted)", () => {
    const texts = contentTexts();
    expect(texts.length).toBeGreaterThan(100);
    for (const { where, text } of texts) expect(britishSpellings(text), where).toEqual([]);
  });
});
