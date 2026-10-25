import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Files under a directory, relative to it with "/" separators. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out;
}

/**
 * Writes dist/sw.js from src/pwa/sw.template.js with the app shell (the
 * built chunks, index.html and the public manifest and icons) and a
 * version hash of the shell, so every build with changed files is a new
 * worker. Build only; the dev server has no service worker.
 */
function serviceWorker(): Plugin {
  return {
    name: "new-shores-service-worker",
    apply: "build",
    // writeBundle: index.html is part of the bundle only by then.
    writeBundle(options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const pub = listFiles(join(__dirname, "public")).filter((f) => f === "manifest.webmanifest" || f.startsWith("icons/"));
      const shell = ["/", ...[...built, ...pub].map((f) => `/${f}`)].sort();
      const hash = createHash("sha256");
      for (const f of Object.keys(bundle).sort()) {
        const item = bundle[f];
        if (!item) continue;
        hash.update(f);
        hash.update(item.type === "chunk" ? item.code : typeof item.source === "string" ? item.source : Buffer.from(item.source));
      }
      for (const f of pub) hash.update(readFileSync(join(__dirname, "public", f)));
      const source = readFileSync(join(__dirname, "src", "pwa", "sw.template.js"), "utf8")
        .replace('"__SW_VERSION__"', JSON.stringify(hash.digest("hex").slice(0, 16)))
        .replace("__SW_SHELL__", JSON.stringify(shell));
      writeFileSync(join(options.dir ?? join(__dirname, "dist"), "sw.js"), source);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
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
    include: ["src/**/*.test.ts", "e2e/tools/**/*.test.ts"],
    environment: "node",
  },
});
