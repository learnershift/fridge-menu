import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectAabSigning } from "./release-checks.mjs";
import {
  assertCleanGitTree,
  assertEvidenceAgreement,
  digest,
  gitIdentity,
  inspectAabArtifact,
} from "./release-evidence-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const aabPath = "android/app/build/outputs/bundle/release/app-release.aab";
const manifestPath = resolve(root, "release/artifacts/release-manifest.json");
const manifestBytes = await readFile(manifestPath);
const releaseManifest = JSON.parse(manifestBytes.toString("utf8"));
const expectedIdentity = releaseManifest.identity;

await assertCleanGitTree(root);
const source = gitIdentity(root);
if (releaseManifest.gitRevision !== source.gitRevision || releaseManifest.sourceTree !== source.sourceTree) {
  throw new Error("Release manifest is not bound to the current clean source tree.");
}

const inspected = await inspectAabArtifact(root, aabPath, expectedIdentity);
const signing = inspectAabSigning(resolve(root, aabPath));
if (signing === "UNKNOWN") throw new Error("Cannot bind Android evidence: AAB signing status is unknown.");
const aab = { path: inspected.path, bytes: inspected.bytes, sha256: inspected.sha256, signing };

const submissionBlockers = [];
if (signing !== "SIGNED") submissionBlockers.push("SIGNED_AAB_OWNER_REQUIRED");
const privacy = await readFile(resolve(root, "release/privacy-policy.md"), "utf8");
if (/OWNER_REQUIRED:/.test(privacy)) submissionBlockers.push("PUBLIC_PRIVACY_VALUES_OWNER_REQUIRED");
submissionBlockers.push("PLAY_CONSOLE_AND_PHYSICAL_QA_OWNER_REQUIRED", "FRESH_TARGET_BOUND_APPROVAL_OWNER_REQUIRED");

const evidence = {
  schema: "android-evidence-v2",
  source_revision: source.gitRevision,
  source_tree: source.sourceTree,
  identity: expectedIdentity,
  release_manifest_sha256: digest(manifestBytes),
  toolchain: releaseManifest.toolchain,
  reproducibility: releaseManifest.reproducibility,
  aab,
  checks: releaseManifest.checks,
  local_readiness: "PASS",
  submission_readiness: submissionBlockers.length ? "BLOCKED" : "PASS",
  submission_blockers: submissionBlockers,
  manual_checks: {
    physical_device: "OWNER_REQUIRED",
    offline_relaunch: "OWNER_REQUIRED",
    talkback: "OWNER_REQUIRED",
    android_candidate_screenshots: "OWNER_REQUIRED",
  },
};
assertEvidenceAgreement(releaseManifest, evidence, aab);

const output = resolve(root, "release/artifacts/android-evidence.json");
await mkdir(resolve(root, "release/artifacts"), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`ANDROID_EVIDENCE_OK path=${output} source=${source.gitRevision} sha256=${aab.sha256} submission=${evidence.submission_readiness}`);
