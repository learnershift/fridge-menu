import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { computeReleaseChecks, inspectAabSigning, requirePassingChecks } from "./release-checks.mjs";

const root = resolve(import.meta.dirname, "..");
const gradle = await readFile(resolve(root, "android/app/build.gradle.kts"), "utf8");
const androidManifest = await readFile(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
const mainActivity = await readFile(resolve(root, "android/app/src/main/java/com/learnershift/fridgemenu/MainActivity.java"), "utf8");
const releaseManifest = JSON.parse(await readFile(resolve(root, "release/artifacts/release-manifest.json"), "utf8"));
const aabPath = "android/app/build/outputs/bundle/release/app-release.aab";
const aab = await readFile(resolve(root, aabPath));
const signing = inspectAabSigning(resolve(root, aabPath));
if (signing === "UNKNOWN") throw new Error("Cannot bind Android evidence: AAB signing status is unknown.");
const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (revision.status !== 0) throw new Error("Cannot bind Android evidence: Git revision unavailable.");
const sourceRevision = revision.stdout.trim();
if (releaseManifest.gitRevision !== sourceRevision) throw new Error("Release manifest is not bound to current HEAD.");

const capture = (pattern, label) => {
  const match = gradle.match(pattern);
  if (!match) throw new Error(`Android ${label} is missing.`);
  return match[1];
};
const applicationId = capture(/applicationId\s*=\s*"([^"]+)"/, "application ID");
const versionCode = Number(capture(/versionCode\s*=\s*(\d+)/, "version code"));
const versionName = capture(/versionName\s*=\s*"([^"]+)"/, "version name");
if (applicationId !== "com.learnershift.fridgemenu") throw new Error("Unexpected Android application ID.");
if (/uses-permission/i.test(androidManifest) || /https?:\/\//i.test(mainActivity)) throw new Error("Android shell must remain permissionless and offline.");
const releaseChecks = await computeReleaseChecks(root);
requirePassingChecks(releaseChecks);

const evidence = {
  schema: "android-evidence-v1",
  source_revision: sourceRevision,
  application_id: applicationId,
  version_code: versionCode,
  version_name: versionName,
  aab: {
    path: aabPath,
    sha256: createHash("sha256").update(aab).digest("hex"),
    signing,
    unsigned: signing === "UNSIGNED",
  },
  checks: {
    ...releaseChecks,
    artifact_identity: applicationId === "com.learnershift.fridgemenu" && versionCode === 1 && versionName === "1.0.0" ? "PASS" : "FAIL",
    permissionless_shell: !/uses-permission/i.test(androidManifest) && !/https?:\/\//i.test(mainActivity) ? "PASS" : "FAIL",
    physical_device: "OWNER_REQUIRED",
    offline_relaunch: "OWNER_REQUIRED",
    talkback: "OWNER_REQUIRED",
  },
};
const output = resolve(root, "release/artifacts/android-evidence.json");
await mkdir(resolve(root, "release/artifacts"), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`ANDROID_EVIDENCE_OK path=${output} source=${sourceRevision} sha256=${evidence.aab.sha256}`);
