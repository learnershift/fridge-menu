import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  assertCleanGitTree,
  assertGitIdentityUnchanged,
  assertDeepRegularFile,
  assertEvidenceAgreement,
  fileEvidence,
  verifyReproducibleBytes,
} from "../scripts/release-evidence-lib.mjs";
import { validateCiReleaseProof } from "../scripts/ci-release-receipt.mjs";
import { computeStaticReleaseChecks } from "../scripts/release-checks.mjs";
import { CACHED_SHELL_FILES, runtimeShellVersion } from "../scripts/runtime-shell.mjs";

test("deep release evidence accepts regular files and rejects traversal and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "fridge-menu-evidence-"));
  try {
    await mkdir(join(root, "safe"));
    await writeFile(join(root, "safe", "asset.txt"), "safe");
    await symlink(join(root, "safe", "asset.txt"), join(root, "linked.txt"));
    await symlink(join(root, "safe"), join(root, "linked-dir"));
    await assertDeepRegularFile(root, "safe/asset.txt");
    await assert.rejects(() => assertDeepRegularFile(root, "../outside.txt"), /unsafe release path/i);
    await assert.rejects(() => assertDeepRegularFile(root, "linked.txt"), /symlink/i);
    await assert.rejects(() => assertDeepRegularFile(root, "linked-dir/asset.txt"), /symlink/i);
    assert.equal((await fileEvidence(root, "safe/asset.txt")).sha256.length, 64);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clean-tree binding rejects tracked and untracked source changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fridge-menu-git-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    await writeFile(join(root, "tracked.txt"), "committed");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    await assertCleanGitTree(root);
    await writeFile(join(root, "tracked.txt"), "dirty");
    await assert.rejects(() => assertCleanGitTree(root), /dirty source tree/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release checks reject concatenated remote URLs and use narrow check names", () => {
  const fixture = {
    css: ".remove-button { min-width: 2.75rem; min-height: 2.75rem; }",
    androidManifest: "<manifest><application /></manifest>",
    mainActivity: 'private static final String APP_ENTRY = "file:///android_asset/pwa/index.html"; view.loadUrl(APP_ENTRY);',
    serviceWorker: 'const APP_SHELL = Object.freeze(["./index.html"]); cache.addAll(APP_SHELL);',
  };
  assert.deepEqual(computeStaticReleaseChecks(fixture), {
    touch_target_static: "PASS",
    privacy_security_static: "PASS",
    offline_static: "PASS",
  });
  assert.equal(computeStaticReleaseChecks({ ...fixture, mainActivity: 'view.loadUrl("ht" + "tps://evil.example/");' }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: 'fetch("ht" + "tps://evil.example/")' }).offline_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: 'importScripts("//evil.example/worker.js")' }).offline_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, css: `${fixture.css} .remove-button { max-height: 1px; }` }).touch_target_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, css: ".remove-button { min-width: 2.75rem; min-height: 2.75rem; transform: scale(0.01); }" }).touch_target_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, mainActivity: `${fixture.mainActivity} view.loadUrl(String.fromCharCode(104));` }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, mainActivity: `${fixture.mainActivity} view.loadDataWithBaseURL("dynamic", "", "text/html", "UTF-8", null);` }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, mainActivity: `${fixture.mainActivity} Uri uri = new Uri.Builder().scheme("https").authority("evil.example").build();` }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, mainActivity: `${fixture.mainActivity} view.getClass().getMethod("load" + "Url", String.class).invoke(view, "dynamic");` }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: "fetch(String.fromCharCode(104))" }).offline_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: 'globalThis["fe" + "tch"]("dynamic")' }).offline_static, "FAIL");
});

test("reproducibility and manifest/evidence agreement fail closed", () => {
  const first = Buffer.from("candidate");
  assert.equal(verifyReproducibleBytes(first, Buffer.from("candidate")).sha256.length, 64);
  assert.throws(() => verifyReproducibleBytes(first, Buffer.from("different")), /not reproducible/i);

  const aab = { path: "candidate.aab", bytes: 9, sha256: "a".repeat(64), signing: "UNSIGNED" };
  const manifest = { gitRevision: "head", sourceTree: "tree", identity: { application_id: "app", version_code: 1, version_name: "1" }, checks: { tests: "PASS" }, aab };
  const evidence = { source_revision: "head", source_tree: "tree", identity: manifest.identity, checks: manifest.checks, aab };
  assert.doesNotThrow(() => assertEvidenceAgreement(manifest, evidence, aab));
  assert.throws(() => assertEvidenceAgreement(manifest, { ...evidence, aab: { ...aab, sha256: "b".repeat(64) } }, aab), /evidence mismatch/i);
  assert.doesNotThrow(() => assertGitIdentityUnchanged({ gitRevision: "head", sourceTree: "tree" }, { gitRevision: "head", sourceTree: "tree" }));
  assert.throws(() => assertGitIdentityUnchanged({ gitRevision: "head", sourceTree: "tree" }, { gitRevision: "other", sourceTree: "tree" }), /identity changed/i);
});

test("CI receipt binds an unsigned proof bundle to the exact workflow SHA", () => {
  const aab = { path: "android/app/build/outputs/bundle/release/app-release.aab", bytes: 9, sha256: "a".repeat(64), signing: "UNSIGNED" };
  const source = { gitRevision: "head", sourceTree: "tree" };
  const manifest = { ...source, aab };
  const manifestSha256 = createHash("sha256").update("manifest-bytes").digest("hex");
  const evidence = { source_revision: "head", source_tree: "tree", release_manifest_sha256: manifestSha256, aab, submission_readiness: "BLOCKED" };
  const reproducibility = { ...source, bytes: 9, first_sha256: aab.sha256, second_sha256: aab.sha256, sha256: aab.sha256 };
  const proof = { expectedSha: "head", source, aab, manifest, manifestSha256, evidence, reproducibility };
  assert.equal(validateCiReleaseProof(proof), true);
  assert.throws(() => validateCiReleaseProof({ ...proof, expectedSha: "other" }), /workflow SHA/i);
  assert.throws(() => validateCiReleaseProof({ ...proof, aab: { ...aab, signing: "SIGNED" } }), /unsigned/i);
  assert.throws(() => validateCiReleaseProof({ ...proof, manifest: { ...manifest, aab: { ...aab, sha256: "b".repeat(64) } } }), /proof mismatch/i);
  assert.throws(() => validateCiReleaseProof({ ...proof, manifestSha256: "b".repeat(64) }), /manifest bytes/i);
});

test("runtime cache identity binds shell bytes and normalized worker policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "fridge-menu-shell-"));
  try {
    for (const name of CACHED_SHELL_FILES) await writeFile(join(root, name), `fixture:${name}`);
    await writeFile(join(root, "service-worker.js"), 'const CACHE_NAME = "fridge-menu-shell-one";\nconst POLICY = "cache-first";\n');
    const first = await runtimeShellVersion(root);
    await writeFile(join(root, "service-worker.js"), 'const CACHE_NAME = "fridge-menu-shell-two";\nconst POLICY = "cache-first";\n');
    assert.equal(await runtimeShellVersion(root), first, "cache-name self reference must be normalized");
    await writeFile(join(root, "service-worker.js"), 'const CACHE_NAME = "fridge-menu-shell-two";\nconst POLICY = "network-first";\n');
    assert.notEqual(await runtimeShellVersion(root), first, "worker policy changes must rotate cache identity");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
