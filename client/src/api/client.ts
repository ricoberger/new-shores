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
export type Island = Schemas["Island"];
export type Terrain = Island["terrain"][number];
export type Command = Schemas["Command"];
export type CommandRequest = Schemas["CommandRequest"];
export type ErrorCode = Schemas["ErrorCode"];
export type ErrorResponse = Schemas["ErrorResponse"];

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8080";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, init);
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
  return (await res.json()) as T;
}

export function getWorld(): Promise<WorldResponse> {
  return request<WorldResponse>("/api/v1/world");
}

export function getContent(): Promise<Content> {
  return request<Content>("/api/v1/content");
}

/**
 * Static data of an island. Only the fields the client knows are read, so
 * sibling arrays added later (fertilities, slots) are ignored until the
 * regenerated types and the renderer use them.
 */
export async function getIsland(id: string): Promise<Island> {
  const raw = await request<Island>(`/api/v1/world/islands/${encodeURIComponent(id)}`);
  return { id: raw.id, width: raw.width, height: raw.height, revision: raw.revision, terrain: raw.terrain };
}

export function sendCommand(command: Command, version?: number): Promise<WorldResponse> {
  const body: CommandRequest = version === undefined ? { command } : { version, command };
  return request<WorldResponse>("/api/v1/world/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
