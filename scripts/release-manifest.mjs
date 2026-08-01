import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "release/artifacts/release-manifest.json");
const files = ["dist/ad-boundary.js", "dist/app.js", "dist/icon.svg", "dist/index.html", "dist/manifest.webmanifest", "dist/meal-engine.js", "dist/service-worker.js", "dist/styles.css", "release/store-assets/fridge-menu-icon-512.png", "release/store-assets/fridge-menu-feature-graphic-1024x500.png"];
const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (revision.status !== 0) throw new Error("Cannot bind release manifest: git revision unavailable.");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const entries = [];
for (const relativePath of files) {
  const bytes = await readFile(resolve(root, relativePath));
  entries.push({ path: relativePath, bytes: bytes.length, sha256: digest(bytes) });
}
const aab = resolve(root, "android/app/build/outputs/bundle/release/app-release.aab");
try {
  const bytes = await readFile(aab);
  entries.push({ path: "android/app/build/outputs/bundle/release/app-release.aab", bytes: bytes.length, sha256: digest(bytes), unsigned: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(resolve(root, "release/artifacts"), { recursive: true });
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, gitRevision: revision.stdout.trim(), generatedAt: new Date().toISOString(), files: entries }, null, 2)}\n`);
console.log(`RELEASE_MANIFEST_OK path=${output} files=${entries.length}`);
