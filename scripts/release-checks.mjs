import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const pass = (condition) => condition ? "PASS" : "FAIL";

export function computeStaticReleaseChecks({ css, androidManifest, mainActivity, serviceWorker }) {
  return {
    accessibility: pass(/\.remove-button\s*\{[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/.test(css)),
    privacy_security: pass(!/uses-permission/i.test(androidManifest) && !/https?:\/\//i.test(mainActivity) && !/addJavascriptInterface/.test(mainActivity)),
    offline: pass(!/https?:\/\//i.test(serviceWorker) && /file:\/\/\/android_asset\/pwa\/index\.html/.test(mainActivity)),
  };
}

const commandStatus = (command, args, root) => pass(spawnSync(command, args, { cwd: root, encoding: "utf8", shell: true }).status === 0);

export function inspectAabSigning(aabPath) {
  const command = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, "bin/jarsigner") : "jarsigner";
  const result = spawnSync(command, ["-verify", aabPath], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  if (result.error) return "UNKNOWN";
  const output = `${result.stdout}\n${result.stderr}`;
  if (/jar is unsigned/i.test(output)) return "UNSIGNED";
  if (result.status === 0 && /jar verified/i.test(output)) return "SIGNED";
  return "UNKNOWN";
}

export async function computeReleaseChecks(root) {
  const [css, androidManifest, mainActivity, serviceWorker] = await Promise.all([
    readFile(resolve(root, "styles.css"), "utf8"),
    readFile(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8"),
    readFile(resolve(root, "android/app/src/main/java/com/learnershift/fridgemenu/MainActivity.java"), "utf8"),
    readFile(resolve(root, "service-worker.js"), "utf8"),
  ]);
  return {
    tests: commandStatus(process.execPath, ["--test", "tests/*.test.js"], root),
    build: commandStatus(process.execPath, ["scripts/build.mjs"], root),
    ...computeStaticReleaseChecks({ css, androidManifest, mainActivity, serviceWorker }),
  };
}

export function requirePassingChecks(checks) {
  const failed = Object.entries(checks).filter(([, status]) => status !== "PASS").map(([name]) => name);
  if (failed.length) throw new Error(`Release checks failed: ${failed.join(", ")}`);
}
