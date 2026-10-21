import { chromium, test } from "@playwright/test";
import lighthouse, { desktopConfig } from "lighthouse";
import { WEB_PORT } from "./constants";

// Lighthouse accessibility score of the island view (dense fixture, no
// server state) for the desktop and the 412 × 915 mobile profile, with the
// project-local lighthouse devDependency against the preview build. Only
// runs with MEASURE_LIGHTHOUSE=1 (scores recorded in the M3 notes). The
// PWA category no longer exists in Lighthouse ≥ 12; installability is
// checked by pwa.spec.ts.
test.skip(process.env.MEASURE_LIGHTHOUSE !== "1", "measurement only");

const DEBUG_PORT = 9333;
const URL = `http://localhost:${WEB_PORT}/?fixture=dense-2x400`;

const PROFILES = [
  { name: "desktop", flags: { formFactor: "desktop" as const }, config: desktopConfig },
  {
    name: "mobile 412x915",
    flags: {
      formFactor: "mobile" as const,
      screenEmulation: { mobile: true, width: 412, height: 915, deviceScaleFactor: 2.625, disabled: false },
    },
    config: undefined,
  },
];

test("Lighthouse accessibility of the island view", async () => {
  test.setTimeout(240_000);
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${DEBUG_PORT}`] });
  try {
    for (const p of PROFILES) {
      const result = await lighthouse(
        URL,
        { port: DEBUG_PORT, output: "json", logLevel: "error", onlyCategories: ["accessibility"], ...p.flags },
        p.config,
      );
      const lhr = result?.lhr;
      const score = Math.round((lhr?.categories.accessibility?.score ?? 0) * 100);
      const failed = Object.values(lhr?.audits ?? {})
        .filter((a) => a.score === 0 && a.scoreDisplayMode === "binary")
        .map((a) => a.id);
      console.log(`LIGHTHOUSE ${lhr?.lighthouseVersion} ${p.name}: accessibility ${score}; failed audits: ${failed.join(", ") || "none"}`);
      test.expect(score).toBeGreaterThanOrEqual(90);
    }
  } finally {
    await browser.close();
  }
});
