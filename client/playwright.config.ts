import { defineConfig, devices } from "@playwright/test";
import { API_PORT, E2E_TIME_SCALE, WEB_PORT } from "./e2e/constants";

// The smoke test runs against the Go dev server (in-memory world) and a
// production build of the client with the test hook enabled. Separate ports
// keep it independent of a running `make dev`.

const env = {
  ...process.env,
  VITE_E2E: "1",
  VITE_API_BASE: `http://localhost:${API_PORT}`,
  VITE_TIME_SCALE: String(E2E_TIME_SCALE),
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `go run ./cmd/server --dev --content ../content/old_coast --addr :${API_PORT} --cors-origin http://localhost:${WEB_PORT} --time-scale ${E2E_TIME_SCALE}`,
      cwd: "../server",
      url: `http://localhost:${API_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
