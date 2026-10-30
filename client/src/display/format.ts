// The one formatting layer for server units (see server/api/openapi.yaml):
// quantities are milli-units / milli-gold / milli-residents, ratios
// permille, durations ms. The UI never shows raw milli values.

import { currentLocale } from "../i18n";

/** A number with a fixed count of decimals in the locale's separators (default: the current language's; no digit grouping). */
export function decimal(value: number, places: number, locale: string = currentLocale()): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: places, maximumFractionDigits: places, useGrouping: false }).format(value);
}

/** "A, B or C" / "A, B oder C": a list of alternatives in the locale's words. */
export function listOr(items: readonly string[], locale: string = currentLocale()): string {
  return new Intl.ListFormat(locale, { style: "long", type: "disjunction" }).format(items);
}

/** Whole units of a milli quantity (rounded down: never shows more than there is). */
export function units(milli: number): string {
  return String(Math.floor(milli / 1000 + 1e-9));
}

/** A per-minute rate in milli-units per minute with one decimal. */
export function perMin(milliPerMin: number, signed = false, locale: string = currentLocale()): string {
  const v = decimal(Math.abs(milliPerMin / 1000), 1, locale);
  if (v.replace(/[^0-9]/g, "").replace(/0/g, "") === "") return v;
  if (milliPerMin < 0) return signed ? `−${v}` : `-${v}`;
  return signed ? `+${v}` : v;
}

/**
 * A ship speed factor (permille of the reference speed) with one decimal,
 * two where the second is not zero: 1.2, 1.0, 0.85 (D-060).
 */
export function speedFactor(permille: number): string {
  const two = (permille / 1000).toFixed(2);
  return decimal(Number(two), two.endsWith("0") ? 1 : 2);
}

/** A permille ratio as whole percent. */
export function percent(permille: number): string {
  return `${Math.round(permille / 10)} %`;
}

/** Milliseconds as seconds with one decimal. */
export function seconds(ms: number): string {
  return `${decimal(ms / 1000, 1)} s`;
}
