// Dev/E2E-only: the `?fixture=<name>` URL parameter. Every name is a server
// fixture (settled, citizens, played, …, the one list devworld.Fixtures in
// server/internal/devworld): the page asks the dev server to reset its
// world to it (POST /api/v1/dev/reset; an unknown name is answered with an
// error, shown by the gate) and then opens the game as usual (Root.tsx).
// Imported only behind the dev/E2E guard, so production builds tree-shake
// it away.

/** The fixture named in a location.search string, or null. */
export function fixtureFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("fixture");
  return id ? id : null;
}
