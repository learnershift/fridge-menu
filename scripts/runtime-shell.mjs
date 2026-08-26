import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const CACHED_SHELL_FILES = Object.freeze([
  "index.html",
  "styles.css",
  "app.js",
  "meal-engine.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon.svg",
]);

export async function runtimeShellVersion(root) {
  const hash = createHash("sha256");
  for (const name of CACHED_SHELL_FILES) {
    hash.update(name);
    hash.update("\0");
    hash.update(await readFile(resolve(root, name)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export async function assertServiceWorkerCacheVersion(root) {
  const expected = `fridge-menu-shell-${await runtimeShellVersion(root)}`;
  const worker = await readFile(resolve(root, "service-worker.js"), "utf8");
  if (!worker.includes(`const CACHE_NAME = "${expected}";`)) {
    throw new Error(`Service-worker cache name is stale; expected ${expected}.`);
  }
  return expected;
}
