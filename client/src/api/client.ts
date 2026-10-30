// Thin fetch client of the /api/v1 endpoints. Every payload type is an alias
// of the types generated from server/api/openapi.yaml (schema.d.ts, never
// edited by hand); nothing here duplicates a payload shape.
import type { components } from "./schema";

type Schemas = components["schemas"];

export type WorldResponse = Schemas["WorldResponse"];
export type DisplayState = Schemas["DisplayState"];
export type IslandDisplay = Schemas["IslandDisplay"];
export type BuildingDisplay = Schemas["BuildingDisplay"];
export type GoodDisplay = Schemas["GoodDisplay"];
export type NeedDisplay = Schemas["NeedDisplay"];
export type Content = Schemas["Content"];
export type ContentBuilding = Schemas["ContentBuilding"];
export type ContentTier = Schemas["ContentTier"];
export type ContentShip = Schemas["ContentShip"];
export type ContentSizeClass = Schemas["ContentSizeClass"];
export type ShipDisplay = Schemas["ShipDisplay"];
export type LegDisplay = Schemas["LegDisplay"];
export type CargoDisplay = Schemas["CargoDisplay"];
export type RouteDisplay = Schemas["RouteDisplay"];
export type ShipOrderDisplay = Schemas["ShipOrderDisplay"];
export type RouteStop = Schemas["RouteStop"];
export type LoadRule = Schemas["LoadRule"];
export type IslandTiles = Schemas["IslandTiles"];
export type DepositDisplay = Schemas["DepositDisplay"];
/**
 * Static data of an island the renderer and the placement hints read: the
 * full terrain rows (GET …/islands/{id}/tiles) with the fertilities and
 * deposits of the island's display payload.
 */
export interface Island {
  id: string;
  width: number;
  height: number;
  revision: string;
  terrain: IslandTiles["terrain"];
  /** Terrace level per tile, one digit, row-major (D-058; absent or empty: all 0). Visual only. */
  levels?: string;
  /** Rock height of mountain, cliff and islet tiles above their level in terrace levels, one digit per tile (D-058; absent: 0). Visual only. */
  heights?: string;
  fertilities: string[];
  deposits: DepositDisplay[];
}
export type Terrain = IslandTiles["terrain"][number];
export type Command = Schemas["Command"];
export type CommandRequest = Schemas["CommandRequest"];
export type ErrorCode = Schemas["ErrorCode"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type Player = Schemas["Player"];
export type AuthResponse = Schemas["AuthResponse"];
export type RegisterRequest = Schemas["RegisterRequest"];
export type LoginRequest = Schemas["LoginRequest"];
export type GuestRequest = Schemas["GuestRequest"];
export type WorldChangedMessage = Schemas["WorldChangedMessage"];

/**
 * Base URL of the game server. Empty means same origin (the Compose stack
 * serves client and API from one origin through Caddy).
 */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8080";

/**
 * WebSocket URL of /api/v1/ws: API_BASE with http(s) replaced by ws(s); an
 * empty base resolves against the page's origin.
 */
export function wsUrl(base: string = API_BASE, pageOrigin: string = globalThis.location?.origin ?? ""): string {
  const origin = base === "" ? pageOrigin : base;
  return origin.replace(/^http(s?):\/\//, "ws$1://").replace(/\/$/, "") + "/api/v1/ws";
}

/** A non-2xx response with the server's error envelope. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/** The server could not be reached (fetch failed). */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/** The session is missing or expired (HTTP 401 unauthorized). */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401 && err.code === "unauthorized";
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    // The session is an HttpOnly cookie: send it cross-origin too (dev).
    res = await fetch(API_BASE + path, { ...init, credentials: "include" });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    let code: ErrorCode = "internal";
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ErrorResponse;
      code = body.error.code;
      message = body.error.message;
    } catch {
      // Not an error envelope (e.g. a proxy error page).
    }
    throw new ApiError(code, message, res.status);
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  return (await res.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function getWorld(): Promise<WorldResponse> {
  return request<WorldResponse>("/api/v1/world");
}

/** The content in a language (D-061); the text fields are in that language, ids and numbers are not. */
export function getContent(lang?: string): Promise<Content> {
  return request<Content>(lang ? `/api/v1/content?lang=${encodeURIComponent(lang)}` : "/api/v1/content");
}

/**
 * Full terrain rows of an island. `key` is the archipelago's cache key
 * (`<seed>-<roll>`, `tilesKey`): the response is immutable per roll, so a
 * reroll must change the URL.
 */
export function getIslandTiles(id: string, key: string): Promise<IslandTiles> {
  return request<IslandTiles>(`/api/v1/world/islands/${encodeURIComponent(id)}/tiles?v=${encodeURIComponent(key)}`);
}

/** The tiles cache key of an archipelago: seed and roll. */
export function tilesKey(a: { seed: number; roll: number }): string {
  return `${a.seed}-${a.roll}`;
}

/** An island's static data from its rows and its display payload. */
export function islandStatics(tiles: IslandTiles, display: Pick<IslandDisplay, "fertilities" | "deposits">): Island {
  return {
    id: tiles.id,
    width: tiles.width,
    height: tiles.height,
    revision: tiles.revision,
    terrain: tiles.terrain,
    levels: tiles.levels,
    heights: tiles.heights,
    fertilities: [...display.fertilities],
    deposits: display.deposits.map((d) => ({ ...d })),
  };
}

export function sendCommand(command: Command, version?: number): Promise<WorldResponse> {
  const body: CommandRequest = version === undefined ? { command } : { version, command };
  return request<WorldResponse>("/api/v1/world/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The player of the current session (401 without one). */
export function getMe(): Promise<AuthResponse> {
  return request<AuthResponse>("/api/v1/auth/me");
}

export function postGuest(body: GuestRequest): Promise<AuthResponse> {
  return post<AuthResponse>("/api/v1/auth/guest", body);
}

export function postRegister(body: RegisterRequest): Promise<AuthResponse> {
  return post<AuthResponse>("/api/v1/auth/register", body);
}

export function postLogin(body: LoginRequest): Promise<AuthResponse> {
  return post<AuthResponse>("/api/v1/auth/login", body);
}

/** Dev server only (--dev): replaces the world by the named dev fixture (POST /api/v1/dev/reset; the server validates the name against its list). */
export async function postDevReset(fixture: string): Promise<void> {
  await send("/api/v1/dev/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fixture }) });
}

export async function postLogout(): Promise<void> {
  await send("/api/v1/auth/logout", { method: "POST" });
}

export async function postVerifyEmail(token: string): Promise<void> {
  await send("/api/v1/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
}

export async function postPasswordResetRequest(email: string): Promise<void> {
  await send("/api/v1/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function postPasswordResetConfirm(token: string, password: string): Promise<void> {
  await send("/api/v1/auth/password-reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
}
