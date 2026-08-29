import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assertServiceWorkerCacheVersion } from "./runtime-shell.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const runtimeFiles = Object.freeze([
  "app.js",
  "i18n.js",
  "icon-192.png",
  "icon-512.png",
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "meal-engine.js",
  "service-worker.js",
  "styles.css",
]);

await assertServiceWorkerCacheVersion(root);

await mkdir(output, { recursive: true });
const existing = await readdir(output);
const extras = existing.filter((name) => !runtimeFiles.includes(name));
if (extras.length) throw new Error(`Unexpected dist entries; refusing to delete: ${extras.join(", ")}`);

for (const name of runtimeFiles) {
  const source = resolve(root, name);
  if (!(await stat(source)).isFile()) throw new Error(`Runtime source is not a regular file: ${name}`);
  await copyFile(source, resolve(output, name));
}

const built = (await readdir(output)).sort();
if (JSON.stringify(built) !== JSON.stringify([...runtimeFiles].sort())) {
  throw new Error(`Dist manifest mismatch: ${built.join(", ")}`);
}
console.log(`BUILD_OK files=${built.length} output=dist`);
