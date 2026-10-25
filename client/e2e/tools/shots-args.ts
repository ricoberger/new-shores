// Argument parsing of `make shots` (e2e/tools/shots.ts), kept free of
// Playwright and the browser so a Vitest covers it.

export const FIXTURES = ["showcase", "settled", "dense-2x400", "dense-archipelago-8", "archipelago-8x20", "town"] as const;
export const VIEWS = ["near", "mid", "far"] as const;
export const DEVICES = ["desktop", "phone"] as const;
export const PRESETS = ["info-panel", "sheet", "ghost", "sloop", "build-menu", "warnings", "ship-panel", "route-editor", "route-paused", "island-card", "top-bar-popups"] as const;

export type Fixture = (typeof FIXTURES)[number];
export type View = (typeof VIEWS)[number];
export type Device = (typeof DEVICES)[number];
export type Preset = (typeof PRESETS)[number];

export const DEFAULT_FIXTURES: Fixture[] = ["showcase", "settled", "dense-2x400"];

/** Fixtures served by the dev server's reset endpoint (the page loads `/`) rather than by `?fixture=`. */
export const SERVER_FIXTURES: readonly Fixture[] = ["settled", "town"];

export interface ShotArgs {
  fixtures: Fixture[];
  views: View[];
  devices: Device[];
  /** Camera rotation step 0..3. */
  rotation: number;
  /** Island to centre on; undefined: the fixture's own. */
  island?: string;
  /** Camera half extent override. */
  zoom?: number;
  /** Camera target override (archipelago coordinates). */
  x?: number;
  y?: number;
  /** Output directory, relative to the working directory unless absolute. */
  out: string;
  hud: boolean;
  /** Named HUD-state shots; when set, only these are taken. */
  presets: Preset[];
}

export class ShotArgError extends Error {}

type Env = Record<string, string | undefined>;

/** A comma list or `all` of allowed values; unset or empty gives the fallback. */
export function parseList<T extends string>(name: string, raw: string | undefined, allowed: readonly T[], fallback: readonly T[]): T[] {
  const text = raw?.trim();
  if (!text) return [...fallback];
  if (text === "all") return [...allowed];
  const out: T[] = [];
  for (const part of text.split(",").map((p) => p.trim())) {
    if (!(allowed as readonly string[]).includes(part)) {
      throw new ShotArgError(`${name}: unknown value '${part}'; allowed: ${allowed.join(", ")}, all`);
    }
    if (!out.includes(part as T)) out.push(part as T);
  }
  return out;
}

function parseNumber(name: string, raw: string | undefined, min?: number): number | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || (min !== undefined && n <= min)) {
    throw new ShotArgError(`${name}: '${text}' is not ${min === undefined ? "a number" : "a number > " + min}`);
  }
  return n;
}

/** Parses FIXTURE, VIEW, DEVICE, ROTATION, ISLAND, ZOOM, X, Y, OUT, HUD, PRESET and SET from an environment. */
export function parseShotArgs(env: Env): ShotArgs {
  const presets = parseList("PRESET", env.PRESET, PRESETS, []);
  const rotationText = env.ROTATION?.trim();
  let rotation = 0;
  if (rotationText) {
    if (!/^[0-3]$/.test(rotationText)) throw new ShotArgError(`ROTATION: '${rotationText}' is not one of 0, 1, 2, 3`);
    rotation = Number(rotationText);
  }
  const hudText = env.HUD?.trim();
  if (hudText && hudText !== "0" && hudText !== "1") throw new ShotArgError(`HUD: '${hudText}' is not 0 or 1`);
  const x = parseNumber("X", env.X);
  const y = parseNumber("Y", env.Y);
  if ((x === undefined) !== (y === undefined)) throw new ShotArgError("X and Y set the camera target together; give both");
  const args: ShotArgs = {
    fixtures: parseList("FIXTURE", env.FIXTURE, FIXTURES, DEFAULT_FIXTURES),
    views: parseList("VIEW", env.VIEW, VIEWS, VIEWS),
    devices: parseList("DEVICE", env.DEVICE, DEVICES, DEVICES),
    rotation,
    out: env.OUT?.trim() || `.experiment/shots/${env.SET?.trim() || (presets.length > 0 ? "presets" : "default")}`,
    hud: hudText !== "0",
    presets,
  };
  const island = env.ISLAND?.trim();
  if (island) args.island = island;
  const zoom = parseNumber("ZOOM", env.ZOOM, 0);
  if (zoom !== undefined) args.zoom = zoom;
  if (x !== undefined && y !== undefined) {
    args.x = x;
    args.y = y;
  }
  if (presets.length > 0) {
    const clash = ["FIXTURE", "VIEW", "DEVICE", "ROTATION", "ISLAND", "ZOOM", "X", "Y", "HUD"].filter((k) => env[k]?.trim());
    if (clash.length > 0) throw new ShotArgError(`PRESET fixes fixture, view, device and camera; remove ${clash.join(", ")}`);
  }
  return args;
}
