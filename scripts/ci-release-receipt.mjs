import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { digest, fileEvidence, gitIdentity } from "./release-evidence-lib.mjs";
import { inspectAabSigning } from "./release-checks.mjs";

const AAB_PATH = "android/app/build/outputs/bundle/release/app-release.aab";
const PROOF_PATHS = Object.freeze([
  AAB_PATH,
  "release/artifacts/aab-reproducibility.json",
  "release/artifacts/release-manifest.json",
  "release/artifacts/android-evidence.json",
]);

function sameArtifact(left, right) {
  return left?.path === right?.path && left?.bytes === right?.bytes &&
    left?.sha256 === right?.sha256 && left?.signing === right?.signing;
}

export function validateCiReleaseProof({ expectedSha, source, aab, manifest, manifestSha256, evidence, reproducibility }) {
  if (!expectedSha || expectedSha !== source.gitRevision) throw new Error("CI workflow SHA does not match the checked-out revision.");
  if (aab.signing !== "UNSIGNED") throw new Error("CI proof must contain an unsigned AAB.");
  if (manifest.gitRevision !== source.gitRevision || manifest.sourceTree !== source.sourceTree ||
      evidence.source_revision !== source.gitRevision || evidence.source_tree !== source.sourceTree ||
      reproducibility.gitRevision !== source.gitRevision || reproducibility.sourceTree !== source.sourceTree) {
    throw new Error("CI proof mismatch: source identity differs.");
  }
  if (!sameArtifact(manifest.aab, aab) || !sameArtifact(evidence.aab, aab) ||
      reproducibility.bytes !== aab.bytes || reproducibility.sha256 !== aab.sha256 ||
      reproducibility.first_sha256 !== aab.sha256 || reproducibility.second_sha256 !== aab.sha256) {
    throw new Error("CI proof mismatch: artifact bytes or hashes differ.");
  }
  if (!manifestSha256 || evidence.release_manifest_sha256 !== manifestSha256) {
    throw new Error("CI proof mismatch: release manifest bytes differ from Android evidence.");
  }
  if (evidence.submission_readiness !== "BLOCKED") throw new Error("Unsigned CI proof must remain blocked from Play submission.");
  return true;
}

async function createReceipt(root, env) {
  const requiredEnvironment = ["GITHUB_SHA", "GITHUB_REPOSITORY", "GITHUB_WORKFLOW", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"];
  const missing = requiredEnvironment.filter((name) => !env[name]);
  if (missing.length) throw new Error(`CI receipt requires ${missing.join(", ")}.`);

  const source = gitIdentity(root);
  const [reproducibility, manifestBytes, evidence] = await Promise.all([
    readFile(resolve(root, PROOF_PATHS[1]), "utf8").then(JSON.parse),
    readFile(resolve(root, PROOF_PATHS[2])),
    readFile(resolve(root, PROOF_PATHS[3]), "utf8").then(JSON.parse),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const aabFile = await fileEvidence(root, AAB_PATH);
  const aab = { ...aabFile, signing: inspectAabSigning(resolve(root, AAB_PATH)) };
  validateCiReleaseProof({ expectedSha: env.GITHUB_SHA, source, aab, manifest, manifestSha256: digest(manifestBytes), evidence, reproducibility });
  const githubActions = env.GITHUB_ACTIONS === "true";
  const status = githubActions ? "UNSIGNED_GITHUB_CI_VERIFICATION_ONLY" : "LOCAL_SIMULATION_ONLY";
  const artifacts = await Promise.all(PROOF_PATHS.map((path) => fileEvidence(root, path)));
  return {
    schema: "fridge-menu-ci-release-receipt-v2",
    status,
    play_submission: "BLOCKED",
    ...source,
    generatedAt: new Date().toISOString(),
    workflow: {
      repository: env.GITHUB_REPOSITORY,
      name: env.GITHUB_WORKFLOW,
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
      ref: env.GITHUB_REF ?? null,
      execution: githubActions ? "GITHUB_ACTIONS" : "LOCAL_SIMULATION",
      run_url: githubActions && env.GITHUB_SERVER_URL
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
      workflow_ref: env.GITHUB_WORKFLOW_REF ?? null,
    },
    artifacts,
  };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const root = resolve(import.meta.dirname, "..");
  const receipt = await createReceipt(root, process.env);
  const output = resolve(root, "release/artifacts/ci-release-receipt.json");
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`CI_RELEASE_RECEIPT_OK status=${receipt.status} source=${receipt.gitRevision}`);
}
