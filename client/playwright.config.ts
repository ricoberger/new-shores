import { defineConfig, devices } from "@playwright/test";
import { API_PORT, API_SERVER_COMMAND, E2E_TIME_SCALE, WEB_PORT, WEB_SERVER_COMMAND } from "./e2e/constants";

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
  // GitHub runners render with SwiftShader several times slower than a
  // developer machine (perf: 5.5 vs 34 fps): assertions get more time there.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  // The world specs run against the dev server's in-memory world, each from
  // a fresh dev fixture (e2e/world.ts resetWorld in beforeAll: default,
  // town or settled): no spec depends on the order of the specs or on an
  // earlier one's leftovers, so the projects need no dependencies for it.
  projects: [
    { name: "chromium", testMatch: /(smoke|ttfi|voyage|seafaring|life)\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "archipelago", testMatch: /archipelago\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "away", testMatch: /wait-away\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    // Touch alone on phone profiles; the Pixel 5 profile at 412 × 915. The
    // PWA installability check runs in the Chromium touch project.
    {
      name: "touch-chromium",
      testMatch: /(touch|pwa)\.spec\.ts$/,
      use: { ...devices["Pixel 5"], viewport: { width: 412, height: 915 } },
    },
    { name: "touch-webkit", testMatch: /touch\.spec\.ts$/, use: { ...devices["iPhone 12"] } },
    // The fixture-only projects (no server state) run last (one worker,
    // in this order). Mobile performance budget and the opt-in Lighthouse
    // measurement on the dense fixture.
    {
      name: "perf",
      testMatch: /(perf|lighthouse)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], launchOptions: { args: gpuArgs } },
    },
    // Visual foundation (art task 2) on the fixtures: screenshot baselines
    // per platform (desktop and a Pixel 5 context; a missing baseline is
    // written and its test skipped) and the grid, palette, quality and
    // credits rules.
    { name: "visual", testMatch: /(visual|theme)\.spec\.ts$/, dependencies: ["perf"], use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: API_SERVER_COMMAND,
      cwd: "../server",
      url: `http://localhost:${API_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: WEB_SERVER_COMMAND,
      url: `http://localhost:${WEB_PORT}`,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
