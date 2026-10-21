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

// PERF_GPU=1 runs the perf project with hardware WebGL where available
// (headless Chromium otherwise uses SwiftShader, a software renderer).
const gpuArgs =
  process.env.PERF_GPU === "1"
    ? ["--enable-gpu", "--ignore-gpu-blocklist", ...(process.platform === "darwin" ? ["--use-angle=metal"] : [])]
    : [];

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
  // The specs share the dev server's in-memory world and build on each
  // other: the archipelago spec needs the sloop and the settled island 2 of
  // the voyage spec, and the away spec runs last. Project dependencies make
  // that order explicit.
  projects: [
    { name: "chromium", testMatch: /(smoke|ttfi|voyage)\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "archipelago", testMatch: /archipelago\.spec\.ts$/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"] } },
    { name: "away", testMatch: /wait-away\.spec\.ts$/, dependencies: ["archipelago"], use: { ...devices["Desktop Chrome"] } },
    // Mobile performance budget on the dense fixture (no server state).
    { name: "perf", testMatch: /perf\.spec\.ts$/, use: { ...devices["Desktop Chrome"], launchOptions: { args: gpuArgs } } },
  ],
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
