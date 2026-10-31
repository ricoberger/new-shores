// Argument parsing of `make shots` (e2e/tools/shots.ts), kept free of
// Playwright and the browser so a Vitest covers it.

/**
 * The dev server's fixtures (devworld.Fixtures, server/internal/devworld/
 * fixtures.go, in its order): the dev server has no endpoint that lists
 * them, so shots-args.test.ts compares this list with the Go source.
 */
export const FIXTURES = ["default", "seafaring", "town", "settled", "citizens", "merchants", "patricians", "played"] as const;
/**
 * Camera views; "start" is the opening camera as the game places it (no
 * camera move); "pan" is a measurement: a far → mid pan through the
 * island centres on the real clock (longest frame, build queue), shot at
 * its end.
 */
export const VIEWS = ["near", "mid", "far", "start", "pan"] as const;
/** Viewports: desktop 1280 × 800, phone (Pixel 5), desktop-xl 2992 × 1700 at dpr 1 (the owner's large Safari window: the far view's widest footprint). */
export const DEVICES = ["desktop", "phone", "desktop-xl"] as const;
export const PRESETS = ["info-panel", "producer-inputs", "house-card", "service-card", "warehouse-card", "trading-post-card", "shipyard-idle", "shipyard-building", "served-houses", "serving-buildings", "sheet", "ghost", "ghost-water-valid", "ghost-water-in", "ghost-water-out", "ghost-depot-valid", "ghost-depot-out", "ghost-terrace-3", "ghost-terrace-3-invalid", "ghost-terrace-6", "ghost-terrace-6-invalid", "sloop", "build-menu", "warnings", "away", "ship-panel", "ship-rename", "route-editor", "route-rename", "route-paused", "island-card", "top-bar-popups", "farm-selected", "hemp-farm-selected", "field-selected", "field-ghost", "field-paint", "field-paint-result", "field-paint-pasture", "archipelago-far", "far-labels", "reroll", "rename", "merchant-house-card", "merchant-build-menu", "patrician-house-card", "patrician-build-menu", "harbour", "founding-ghost", "founding-docked", "playhouse-menu"] as const;

export type Fixture = (typeof FIXTURES)[number];
export type View = (typeof VIEWS)[number];
export type Device = (typeof DEVICES)[number];
export type Preset = (typeof PRESETS)[number];

export const DEFAULT_FIXTURES: Fixture[] = ["settled", "played"];
export const DEFAULT_VIEWS: View[] = ["near", "mid", "far"];
/** The default devices (desktop-xl only on request: DEVICE=desktop-xl or all). */
export const DEFAULT_DEVICES: Device[] = ["desktop", "phone"];

/** The largest world seed (53 bits, D-053), as the server's --seed accepts. */
export const MAX_SEED = 2 ** 53 - 1;

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
  /** Archipelago seed of the dev server (--seed); undefined: the dev seed. */
  seed?: number;
  /** Content directory of the dev server (--content), relative to the repository root unless absolute; undefined: the committed content. */
  content?: string;
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

/** Parses FIXTURE, VIEW, DEVICE, ROTATION, ISLAND, ZOOM, X, Y, OUT, HUD, PRESET, SEED, CONTENT and SET from an environment. */
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
    views: parseList("VIEW", env.VIEW, VIEWS, DEFAULT_VIEWS),
    devices: parseList("DEVICE", env.DEVICE, DEVICES, DEFAULT_DEVICES),
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
  const content = env.CONTENT?.trim();
  if (content) args.content = content;
  const seedText = env.SEED?.trim();
  if (seedText) {
    const seed = Number(seedText);
    if (!/^[0-9]+$/.test(seedText) || !Number.isSafeInteger(seed) || seed < 1 || seed > MAX_SEED) {
      throw new ShotArgError(`SEED: '${seedText}' is not an integer in 1..${MAX_SEED}`);
    }
    args.seed = seed;
  }
  if (presets.length > 0) {
    const clash = ["FIXTURE", "VIEW", "DEVICE", "ROTATION", "ISLAND", "ZOOM", "X", "Y", "HUD"].filter((k) => env[k]?.trim());
    if (clash.length > 0) throw new ShotArgError(`PRESET fixes fixture, view, device and camera; remove ${clash.join(", ")}`);
  }
  return args;
}
