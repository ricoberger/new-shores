import type { Content, DisplayState } from "../api/client";

/**
 * Translated names of what the server stores in English (D-061): the
 * archipelago generator's island names and the default name of a ship
 * ("Sloop 2"). A name the player chose is never touched.
 */
type NameContent = Pick<Content, "island_names" | "ships">;

/** An island name for display: a generated name in the content's language, else the name as it is. */
export function islandNameOf(content: NameContent | null | undefined, name: string): string {
  return content?.island_names?.find((n) => n.source === name)?.name ?? name;
}

/** A ship name for display: the default "<English type name> <number>" with the type name translated. */
export function shipNameOf(content: NameContent | null | undefined, name: string): string {
  for (const s of content?.ships ?? []) {
    if (s.source_name && name.startsWith(`${s.source_name} `) && /^\d+$/.test(name.slice(s.source_name.length + 1))) {
      return `${s.name} ${name.slice(s.source_name.length + 1)}`;
    }
  }
  return name;
}

/** The display state with island and ship names translated; the same object when there is nothing to translate. */
export function localizeNames(display: DisplayState, content: NameContent | null | undefined): DisplayState {
  if (!content || ((content.island_names ?? []).length === 0 && !(content.ships ?? []).some((s) => s.source_name))) return display;
  return {
    ...display,
    islands: display.islands.map((is) => {
      const name = islandNameOf(content, is.name);
      return name === is.name ? is : { ...is, name };
    }),
    ships: display.ships.map((s) => {
      const name = shipNameOf(content, s.name);
      return name === s.name ? s : { ...s, name };
    }),
  };
}
