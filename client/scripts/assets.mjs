// Runs the asset build (assets/build/build.py) in Blender 5.2.x headless:
// `npm run assets` rebuilds client/public/models (GLBs + manifest.json) and
// the contact sheets in assets/build/out; `npm run assets -- --check`
// builds into a temporary directory and compares with the committed models
// (without Blender it skips and exits 0, so CI runners pass). Blender is
// found as $BLENDER, /opt/homebrew/bin/blender or `blender` on PATH. No
// dependencies; the client build never needs Blender or the kits.
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO, "assets", "build", "build.py");
const WANT = [5, 2];

function executable(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The Blender binary to use, or null. */
export function findBlender(env = process.env) {
  if (env.BLENDER) return env.BLENDER;
  if (executable("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir && executable(join(dir, "blender"))) return join(dir, "blender");
  }
  return null;
}

/** [major, minor, patch] from `blender --version` output, or null. */
export function parseVersion(text) {
  const m = /Blender (\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const blender = findBlender();
  if (!blender) {
    if (check) {
      console.log("assets-check: skipped (Blender not found)");
      return 0;
    }
    console.error("assets: Blender not found — install Blender 5.2 or set BLENDER=/path/to/blender (see README, Asset build)");
    return 1;
  }
  const out = spawnSync(blender, ["--version"], { encoding: "utf8" });
  const version = parseVersion(`${out.stdout ?? ""}`);
  if (!version || version[0] !== WANT[0] || version[1] !== WANT[1]) {
    console.error(`assets: ${blender} is Blender ${version ? version.join(".") : "(unknown version)"}, the build needs ${WANT.join(".")}.x (byte-identical GLBs)`);
    return 1;
  }
  const child = spawn(blender, ["-b", "--factory-startup", "--python-exit-code", "1", "--python", SCRIPT, "--", ...args], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "inherit"],
  });
  // Blender's glTF importer logs every kit piece; keep the build's own lines.
  let rest = "";
  child.stdout.on("data", (chunk) => {
    const lines = (rest + chunk.toString()).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (/\| INFO: |^Blender quit$|^Read prefs|^\s*$/.test(line)) continue;
      console.log(line);
    }
  });
  return new Promise((resolve) => {
    child.on("close", (code) => {
      if (rest) console.log(rest);
      resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve(main()).then((code) => process.exit(code));
}
