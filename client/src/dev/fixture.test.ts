import { describe, expect, it } from "vitest";
import { fixtureFromSearch } from "./fixture";

describe("fixture names in the URL", () => {
  it("takes any name; the dev server validates it", () => {
    expect(fixtureFromSearch("?fixture=played")).toBe("played");
    expect(fixtureFromSearch("?stats=1&fixture=settled")).toBe("settled");
    expect(fixtureFromSearch("?fixture=showcase")).toBe("showcase");
    expect(fixtureFromSearch("?fixture=")).toBeNull();
    expect(fixtureFromSearch("")).toBeNull();
  });
});
