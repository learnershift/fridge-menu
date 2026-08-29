import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectAabSigning } from "./release-checks.mjs";
import { verifyAndroidToolchain } from "./release-evidence-lib.mjs";

const root = resolve(import.meta.dirname, "..");
// Do not create or import signing keys; Play Console signing is owner-controlled.
const android = resolve(root, "android");
const assets = resolve(android, "app/src/main/assets/pwa");
const sdk = process.env.FRIDGE_MENU_ANDROID_SDK || process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
const gradle = resolve(android, process.platform === "win32" ? "gradlew.bat" : "gradlew");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
}

if (!sdk) throw new Error("FRIDGE_MENU_ANDROID_SDK (or ANDROID_SDK_ROOT) must name an installed Android SDK; do not install or download tools from this script.");
await access(sdk);
const toolchain = await verifyAndroidToolchain(root);
run(process.execPath, ["scripts/build.mjs"]);
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await cp(resolve(root, "dist"), assets, { recursive: true });

const env = { ...process.env, ANDROID_SDK_ROOT: sdk };
if (process.argv.includes("--clean")) await rm(resolve(android, "app/build"), { recursive: true, force: true });
const prewarm = process.argv.includes("--prewarm");
const gradleArgs = [
  ...(prewarm ? [] : ["--offline"]),
  "--dependency-verification", "strict",
  "--no-daemon", "--rerun-tasks", ":app:bundleRelease",
];
const result = spawnSync(gradle, gradleArgs, {
  cwd: android,
  stdio: "inherit",
  env: { ...env, LC_ALL: "C", LANG: "C", TZ: "UTC" },
  shell: process.platform === "win32",
});
if (result.error || result.status !== 0) {
  throw new Error("Pinned Gradle 8.11.1/JDK 17/SDK 36 toolchain failed. This script does not create or import signing keys, install SDKs, or download tools.");
}
const output = resolve(android, "app/build/outputs/bundle/release/app-release.aab");
await access(output);
const signing = inspectAabSigning(output);
if (signing === "UNKNOWN") throw new Error("Unable to determine AAB signing status with jarsigner.");
if (process.env.FRIDGE_MENU_REQUIRE_UNSIGNED === "1" && signing !== "UNSIGNED") {
  throw new Error("CI release verification requires an unsigned AAB and never accepts signing credentials.");
}
if (prewarm) console.log("ANDROID_PREWARM_ONLY this artifact is not release evidence");
console.log(`AAB_${signing}_OK path=${output} toolchain=${toolchain.gradle}/JDK${toolchain.jdk}/SDK${toolchain.android_platform}`);
