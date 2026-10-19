/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the game server (default http://localhost:8080). */
  readonly VITE_API_BASE?: string;
  /** "1" exposes the window.__newShores test hook in production builds (E2E). */
  readonly VITE_E2E?: string;
  /** World seconds per wall-clock second; must match the dev server's --time-scale. */
  readonly VITE_TIME_SCALE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
