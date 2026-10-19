import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The display fixtures are read from ../server/testdata by the tests.
    fs: { allow: [".."] },
  },
  preview: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    // Babylon core dominates the bundle; sizes are tracked in the M1b notes.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
