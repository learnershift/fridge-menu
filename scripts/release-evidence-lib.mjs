import { createHash } from "node:crypto";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const digest = (value) => createHash("sha256").update(value).digest("hex");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: null, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed${result.stderr?.length ? `: ${result.stderr.toString("utf8").trim()}` : ""}`);
  }
  return result.stdout;
}

export async function assertDeepRegularFile(root, relativePath) {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new Error(`Unsafe release path: ${relativePath}`);
  }
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const part of relativePath.split("/")) {
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Release path contains a symlink: ${relativePath}`);
  }
  const info = await lstat(current);
  if (!info.isFile()) throw new Error(`Release path is not a regular file: ${relativePath}`);
  const canonicalFile = await realpath(current);
  const fromRoot = relative(canonicalRoot, canonicalFile);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) throw new Error(`Unsafe release path: ${relativePath}`);
  return canonicalFile;
}

export async function fileEvidence(root, relativePath) {
  const path = await assertDeepRegularFile(root, relativePath);
  const bytes = await readFile(path);
  return { path: relativePath, bytes: bytes.length, sha256: digest(bytes) };
}

export async function assertCleanGitTree(root) {
  const status = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  if (status.error || status.status !== 0) throw new Error("Cannot inspect Git source tree.");
  if (status.stdout.trim()) throw new Error(`Dirty source tree cannot produce release evidence:\n${status.stdout.trim()}`);
}

export function gitIdentity(root) {
  const read = (value) => {
    const result = spawnSync("git", ["rev-parse", value], { cwd: root, encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error(`Cannot bind release evidence to ${value}.`);
    return result.stdout.trim();
  };
  return { gitRevision: read("HEAD"), sourceTree: read("HEAD^{tree}") };
}

export function assertGitIdentityUnchanged(expected, actual) {
  if (!isDeepStrictEqual(expected, actual)) throw new Error("Git source identity changed while release evidence was generated.");
}

export function verifyReproducibleBytes(first, second) {
  const firstSha256 = digest(first);
  const secondSha256 = digest(second);
  if (first.length !== second.length || firstSha256 !== secondSha256) throw new Error("AAB is not reproducible across two clean builds.");
  return { bytes: second.length, first_sha256: firstSha256, second_sha256: secondSha256, sha256: secondSha256 };
}

function manifestAttributeValue(bytes, name) {
  const marker = Buffer.from(name, "utf8");
  const index = bytes.indexOf(marker);
  if (index === -1) return null;
  let offset = index + marker.length;
  while (offset < bytes.length && bytes[offset] !== 0x1a) offset += 1;
  if (offset >= bytes.length) return null;
  offset += 1;
  let length = 0;
  let shift = 0;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    length |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  if (length < 1 || length > 256 || offset + length > bytes.length) return null;
  return bytes.subarray(offset, offset + length).toString("utf8");
}

export async function inspectAabArtifact(root, relativePath, expectedIdentity) {
  const aab = await fileEvidence(root, relativePath);
  const absolutePath = resolve(root, relativePath);
  const entries = run("unzip", ["-Z1", absolutePath]).toString("utf8").trim().split("\n").filter(Boolean);
  if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error("AAB contains an unsafe ZIP entry.");
  const manifestBytes = run("unzip", ["-p", absolutePath, "base/manifest/AndroidManifest.xml"]);
  const identity = {
    application_id: manifestAttributeValue(manifestBytes, "package"),
    version_code: Number(manifestAttributeValue(manifestBytes, "versionCode")),
    version_name: manifestAttributeValue(manifestBytes, "versionName"),
    min_sdk: Number(manifestAttributeValue(manifestBytes, "minSdkVersion")),
    target_sdk: Number(manifestAttributeValue(manifestBytes, "targetSdkVersion")),
  };
  if (!isDeepStrictEqual(identity, expectedIdentity)) throw new Error(`AAB identity mismatch: ${JSON.stringify(identity)}`);
  if (manifestBytes.includes(Buffer.from("uses-permission"))) throw new Error("AAB manifest contains an unexpected permission.");

  const pwaNames = ["app.js", "i18n.js", "icon-192.png", "icon-512.png", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "privacy.html", "service-worker.js", "styles.css"];
  const expectedPwaEntries = pwaNames.map((name) => `base/assets/pwa/${name}`);
  const actualPwaEntries = entries.filter((entry) => entry.startsWith("base/assets/pwa/")).sort();
  if (!isDeepStrictEqual(actualPwaEntries, expectedPwaEntries.sort())) throw new Error("AAB PWA inventory mismatch.");
  const packagedPwa = [];
  for (const name of pwaNames) {
    const packaged = run("unzip", ["-p", absolutePath, `base/assets/pwa/${name}`]);
    const source = await readFile(await assertDeepRegularFile(root, `dist/${name}`));
    if (!packaged.equals(source)) throw new Error(`AAB PWA bytes differ from dist/${name}.`);
    packagedPwa.push({ path: `base/assets/pwa/${name}`, bytes: packaged.length, sha256: digest(packaged) });
  }
  return { ...aab, identity, permissions: [], packaged_pwa: packagedPwa };
}

export function assertEvidenceAgreement(manifest, evidence, actualAab) {
  const pairs = [
    [manifest.gitRevision, evidence.source_revision],
    [manifest.sourceTree, evidence.source_tree],
    [manifest.identity, evidence.identity],
    [manifest.checks, evidence.checks],
    [manifest.aab, evidence.aab],
    [manifest.aab, actualAab],
  ];
  if (pairs.some(([left, right]) => !isDeepStrictEqual(left, right))) throw new Error("Release manifest and Android evidence mismatch.");
}

export async function verifyAndroidToolchain(root) {
  const sdk = process.env.FRIDGE_MENU_ANDROID_SDK || process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  const javaHome = process.env.JAVA_HOME;
  const gradle = resolve(root, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!sdk || !javaHome) throw new Error("FRIDGE_MENU_ANDROID_SDK and JAVA_HOME are required for the pinned Android toolchain.");
  await Promise.all([
    access(resolve(sdk, "platforms/android-36/android.jar")),
    access(resolve(sdk, "build-tools/36.0.0")),
    access(resolve(javaHome, "bin/java")),
    access(gradle),
  ]);
  const wrapperProperties = await readFile(resolve(root, "android/gradle/wrapper/gradle-wrapper.properties"), "utf8");
  const wrapperJar = await readFile(resolve(root, "android/gradle/wrapper/gradle-wrapper.jar"));
  if (!/gradle-8\.11\.1-bin\.zip/.test(wrapperProperties) ||
      !/distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6/.test(wrapperProperties) ||
      digest(wrapperJar) !== "2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046") {
    throw new Error("Pinned Gradle wrapper provenance is invalid.");
  }
  const java = spawnSync(resolve(javaHome, "bin/java"), ["-version"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", LANG: "C" } });
  const gradleVersion = spawnSync(gradle, ["--version"], { cwd: resolve(root, "android"), encoding: "utf8", env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" }, shell: process.platform === "win32" });
  if (java.error || java.status !== 0 || !/version "17\./.test(`${java.stdout}\n${java.stderr}`)) throw new Error("Pinned Android build requires JDK 17.");
  if (gradleVersion.error || gradleVersion.status !== 0 || !/Gradle 8\.11\.1/.test(gradleVersion.stdout)) throw new Error("Pinned Android build requires Gradle 8.11.1.");
  const androidBuild = await readFile(resolve(root, "android/build.gradle.kts"), "utf8");
  if (!/com\.android\.application"\) version "8\.9\.1"/.test(androidBuild)) throw new Error("Pinned Android build requires AGP 8.9.1.");
  return {
    jdk: `${java.stdout}\n${java.stderr}`.match(/version "([^"]+)"/)?.[1],
    gradle: "8.11.1",
    agp: "8.9.1",
    android_platform: 36,
    build_tools: "36.0.0",
  };
}
