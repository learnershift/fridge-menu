import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const pass = (condition) => condition ? "PASS" : "FAIL";

export function computeStaticReleaseChecks({ css, androidManifest, mainActivity, serviceWorker, adBoundary }) {
  return {
    accessibility: pass(/\.remove-button\s*\{[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/.test(css)),
    privacy_security: pass(!/uses-permission/i.test(androidManifest) && !/https?:\/\//i.test(mainActivity) && /networkRequests:\s*false/.test(adBoundary) && /sdkLoaded:\s*false/.test(adBoundary) && /productionIdentifier:\s*null/.test(adBoundary)),
    offline: pass(!/https?:\/\//i.test(serviceWorker) && /file:\/\/\/android_asset\/pwa\/index\.html/.test(mainActivity)),
  };
}

const commandStatus = (command, args, root) => pass(spawnSync(command, args, { cwd: root, encoding: "utf8", shell: true }).status === 0);

export async function computeReleaseChecks(root) {
  const [css, androidManifest, mainActivity, serviceWorker, adBoundary] = await Promise.all([
    readFile(resolve(root, "styles.css"), "utf8"),
    readFile(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8"),
    readFile(resolve(root, "android/app/src/main/java/com/learnershift/fridgemenu/MainActivity.java"), "utf8"),
    readFile(resolve(root, "service-worker.js"), "utf8"),
    readFile(resolve(root, "ad-boundary.js"), "utf8"),
  ]);
  return {
    tests: commandStatus(process.execPath, ["--test", "tests/*.test.js"], root),
    build: commandStatus(process.execPath, ["scripts/build.mjs"], root),
    ...computeStaticReleaseChecks({ css, androidManifest, mainActivity, serviceWorker, adBoundary }),
  };
}

export function requirePassingChecks(checks) {
  const failed = Object.entries(checks).filter(([, status]) => status !== "PASS").map(([name]) => name);
  if (failed.length) throw new Error(`Release checks failed: ${failed.join(", ")}`);
}
