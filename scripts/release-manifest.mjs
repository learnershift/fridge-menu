import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { computeReleaseChecks, inspectAabSigning, requirePassingChecks } from "./release-checks.mjs";
import {
  assertCleanGitTree,
  assertGitIdentityUnchanged,
  fileEvidence,
  gitIdentity,
  inspectAabArtifact,
} from "./release-evidence-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "release/artifacts/release-manifest.json");
const aabPath = "android/app/build/outputs/bundle/release/app-release.aab";
const expectedIdentity = Object.freeze({
  application_id: "com.learnershift.fridgemenu",
  version_code: 1,
  version_name: "1.0.0",
  min_sdk: 23,
  target_sdk: 36,
});
const requiredFiles = [
  "dist/app.js", "dist/i18n.js", "dist/icon-192.png", "dist/icon-512.png", "dist/icon.svg", "dist/index.html", "dist/manifest.webmanifest", "dist/meal-engine.js", "dist/privacy.html", "dist/service-worker.js", "dist/styles.css",
  "release/store-assets/fridge-menu-icon-512.png", "release/store-assets/fridge-menu-feature-graphic-1024x500.png",
  "release/captures/fridge-menu-01-empty-home-1080x1920.png",
  "release/captures/fridge-menu-02-use-first-list-1080x1920.png",
  "release/captures/fridge-menu-03-menu-results-1080x1920.png",
  "release/captures/fridge-menu-04-favorites-history-1080x1920.png",
  "release/captures/fridge-menu-01-empty-home-1200x1920.png",
  "release/captures/fridge-menu-02-use-first-list-1200x1920.png",
  "release/captures/fridge-menu-03-menu-results-1200x1920.png",
  "release/captures/fridge-menu-04-favorites-history-1200x1920.png",
  "release/captures/fridge-menu-01-empty-home-1600x2560.png",
  "release/captures/fridge-menu-02-use-first-list-1600x2560.png",
  "release/captures/fridge-menu-03-menu-results-1600x2560.png",
  "release/captures/fridge-menu-04-favorites-history-1600x2560.png",
  "release/captures/fridge-menu-ko-01-empty-home-1080x1920.png",
  "release/captures/fridge-menu-ko-02-use-first-list-1080x1920.png",
  "release/captures/fridge-menu-ko-03-menu-results-1080x1920.png",
  "release/captures/fridge-menu-ko-04-favorites-history-1080x1920.png",
  "release/captures/fridge-menu-ko-01-empty-home-1200x1920.png",
  "release/captures/fridge-menu-ko-02-use-first-list-1200x1920.png",
  "release/captures/fridge-menu-ko-03-menu-results-1200x1920.png",
  "release/captures/fridge-menu-ko-04-favorites-history-1200x1920.png",
  "release/captures/fridge-menu-ko-01-empty-home-1600x2560.png",
  "release/captures/fridge-menu-ko-02-use-first-list-1600x2560.png",
  "release/captures/fridge-menu-ko-03-menu-results-1600x2560.png",
  "release/captures/fridge-menu-ko-04-favorites-history-1600x2560.png",
];

await assertCleanGitTree(root);
const source = gitIdentity(root);
const checks = await computeReleaseChecks(root);
requirePassingChecks(checks);

const files = [];
for (const relativePath of requiredFiles) {
  const entry = await fileEvidence(root, relativePath);
  files.push(relativePath.startsWith("release/captures/") ? { ...entry, capture_origin: "LOCAL_CHROME_SIMULATION" } : entry);
}

const inspected = await inspectAabArtifact(root, aabPath, expectedIdentity);
const signing = inspectAabSigning(resolve(root, aabPath));
if (signing === "UNKNOWN") throw new Error("AAB signing status is unknown.");
const aab = { path: inspected.path, bytes: inspected.bytes, sha256: inspected.sha256, signing };

const reproducibility = JSON.parse(await readFile(resolve(root, "release/artifacts/aab-reproducibility.json"), "utf8"));
if (reproducibility.gitRevision !== source.gitRevision || reproducibility.sourceTree !== source.sourceTree ||
    reproducibility.first_sha256 !== aab.sha256 || reproducibility.second_sha256 !== aab.sha256) {
  throw new Error("AAB reproducibility evidence is stale or mismatched.");
}

await assertCleanGitTree(root);
assertGitIdentityUnchanged(source, gitIdentity(root));

const releaseEvidence = {
  schemaVersion: 2,
  ...source,
  generatedAt: new Date().toISOString(),
  identity: inspected.identity,
  checks,
  toolchain: reproducibility.toolchain,
  reproducibility: { first_sha256: reproducibility.first_sha256, second_sha256: reproducibility.second_sha256 },
  capture_origin: "LOCAL_CHROME_SIMULATION",
  files,
  aab,
  packaged_pwa: inspected.packaged_pwa,
};
await mkdir(resolve(root, "release/artifacts"), { recursive: true });
await writeFile(output, `${JSON.stringify(releaseEvidence, null, 2)}\n`);
console.log(`RELEASE_MANIFEST_OK path=${output} files=${files.length + 1}`);
