import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertCleanGitTree,
  gitIdentity,
  verifyAndroidToolchain,
  verifyReproducibleBytes,
} from "./release-evidence-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const aabPath = resolve(root, "android/app/build/outputs/bundle/release/app-release.aab");
const runBuild = () => {
  const result = spawnSync(process.execPath, ["scripts/android-package.mjs", "--clean"], { cwd: root, stdio: "inherit", env: process.env });
  if (result.error || result.status !== 0) throw new Error("Clean AAB build failed during reproducibility verification.");
};

await assertCleanGitTree(root);
const source = gitIdentity(root);
const toolchain = await verifyAndroidToolchain(root);
runBuild();
await assertCleanGitTree(root);
const first = await readFile(aabPath);
runBuild();
await assertCleanGitTree(root);
const second = await readFile(aabPath);
const reproducibility = verifyReproducibleBytes(first, second);

const report = { schema: "aab-reproducibility-v1", ...source, toolchain, ...reproducibility };
await mkdir(resolve(root, "release/artifacts"), { recursive: true });
await writeFile(resolve(root, "release/artifacts/aab-reproducibility.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`AAB_REPRODUCIBLE_OK sha256=${report.sha256} bytes=${report.bytes}`);
