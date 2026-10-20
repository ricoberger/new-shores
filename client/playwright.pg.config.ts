import { defineConfig, devices } from "@playwright/test";

// Persistence e2e: the Go server in default mode (PostgreSQL + Redis, not
// --dev) and a production build of the client. Needs E2E_DATABASE_URL and
// E2E_REDIS_URL (CI: service containers); migrations run on start.
const API_PORT = 18081;
const METRICS_PORT = 19091;
const WEB_PORT = 4175;

const databaseURL = process.env.E2E_DATABASE_URL ?? "";
const redisURL = process.env.E2E_REDIS_URL ?? "";
if (!databaseURL || !redisURL) {
  throw new Error("set E2E_DATABASE_URL and E2E_REDIS_URL to run the persistence e2e tests");
}

export default defineConfig({
  testDir: "./e2e-pg",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-pg" }]] : "list",
  outputDir: "test-results-pg",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium-postgres", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "go run ./cmd/server",
      cwd: "../server",
      env: {
        ...process.env,
        DATABASE_URL: databaseURL,
        REDIS_URL: redisURL,
        MIGRATE_ON_START: "true",
        LISTEN_ADDR: `:${API_PORT}`,
        METRICS_ADDR: `:${METRICS_PORT}`,
        ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`,
        CONTENT_DIR: "../content/old_coast",
      },
      url: `http://localhost:${API_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite build --outDir dist-pg && npx vite preview --outDir dist-pg --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { ...process.env, VITE_E2E: "1", VITE_API_BASE: `http://localhost:${API_PORT}`, VITE_TIME_SCALE: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
