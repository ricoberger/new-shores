// Error and reason codes → text (D-061): the server sends codes only; the
// words live in the catalogue as `error.<code>`.
import { tOr } from "../i18n";

/** The player-facing text of an API error code; `fallback` (the server's English message) for a code the catalogue lacks. */
export function errorText(code: string, fallback = code): string {
  return tOr(`error.${code}`, fallback);
}
