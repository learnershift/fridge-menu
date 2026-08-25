import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectAabSigning } from "./release-checks.mjs";

const root = resolve(import.meta.dirname, "..");
// Do not create or import signing keys; Play Console signing is owner-controlled.
const android = resolve(root, "android");
const assets = resolve(android, "app/src/main/assets/pwa");
const sdk = process.env.FRIDGE_MENU_ANDROID_SDK || process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
const gradle = process.platform === "win32" ? "gradle.bat" : "gradle";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
}

if (!sdk) throw new Error("FRIDGE_MENU_ANDROID_SDK (or ANDROID_SDK_ROOT) must name an installed Android SDK; do not install or download tools from this script.");
await access(sdk);
run(process.execPath, ["scripts/build.mjs"]);
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(resolve(root, "dist"), assets, { recursive: true });

const env = { ...process.env, ANDROID_SDK_ROOT: sdk };
const result = spawnSync(gradle, [":app:bundleRelease"], { cwd: android, stdio: "inherit", env });
if (result.error || result.status !== 0) {
  throw new Error("Android Gradle 8.7+ must already be installed and available as gradle. This script does not create or import signing keys, install SDKs, or download a wrapper.");
}
const output = resolve(android, "app/build/outputs/bundle/release/app-release.aab");
await access(output);
const signing = inspectAabSigning(output);
if (signing === "UNKNOWN") throw new Error("Unable to determine AAB signing status with jarsigner.");
console.log(`AAB_${signing}_OK path=${output}`);
