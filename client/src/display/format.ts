// The one formatting layer for server units (see server/api/openapi.yaml):
// quantities are milli-units / milli-gold / milli-residents, ratios
// permille, durations ms. The UI never shows raw milli values.

/** Whole units of a milli quantity (rounded down: never shows more than there is). */
export function units(milli: number): string {
  return String(Math.floor(milli / 1000 + 1e-9));
}

/** A per-minute rate in milli-units per minute with one decimal. */
export function perMin(milliPerMin: number, signed = false): string {
  const v = Math.abs(milliPerMin / 1000).toFixed(1);
  if (v === "0.0") return v;
  if (milliPerMin < 0) return signed ? `−${v}` : `-${v}`;
  return signed ? `+${v}` : v;
}

/** A permille ratio as whole percent. */
export function percent(permille: number): string {
  return `${Math.round(permille / 10)} %`;
}

/** Milliseconds as seconds with one decimal. */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
