import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  HISTORY_LIMIT,
  STORAGE_KEY,
  loadIngredients,
  parseStoredIngredients,
  parseStoredState,
  saveIngredients,
  serializeIngredients,
  serializeState,
} from "../app.js";

const root = resolve(import.meta.dirname, "..");
const read = (name) => readFile(resolve(root, name), "utf8");

test("versioned local persistence round-trips and malformed data fails closed", () => {
  const records = [{ id: "one", name: "Kale", urgency: "use-now", sequence: 0 }];
  assert.deepEqual(parseStoredIngredients(serializeIngredients(records)), records);
  assert.deepEqual(parseStoredIngredients("not-json"), []);
  assert.deepEqual(parseStoredIngredients(JSON.stringify({ version: 99, ingredients: records })), []);
  assert.deepEqual(parseStoredIngredients(JSON.stringify({ version: 1, ingredients: [{ ...records[0], urgency: "later" }] })), []);
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(saveIngredients(storage, records), true);
  assert.equal(values.has(STORAGE_KEY), true);
  assert.deepEqual(loadIngredients(storage), records);
  assert.deepEqual(loadIngredients({ getItem() { throw new Error("blocked"); } }), []);
});

test("v2 local state migrates v1 ingredients and bounds favorites and history", () => {
  const legacy = JSON.stringify({ version: 1, ingredients: [{ id: "one", name: "Kale", urgency: "use-now", sequence: 0 }] });
  assert.deepEqual(parseStoredState(legacy), { ingredients: [{ id: "one", name: "Kale", urgency: "use-now", sequence: 0 }], favorites: [], history: [] });
  const history = Array.from({ length: HISTORY_LIMIT + 2 }, (_, index) => ({ id: `menu-${index}`, createdAt: "2026-08-01T00:00:00.000Z", suggestions: [] }));
  const restored = parseStoredState(serializeState({
    ingredients: [{ id: "one", name: "Kale", expiryDate: "2026-08-02", sequence: 0 }],
    favorites: ["suggestion-1", "suggestion-1"], history,
  }));
  assert.deepEqual(restored.favorites, ["suggestion-1"]);
  assert.equal(restored.history.length, HISTORY_LIMIT);
  assert.equal(restored.history[0].id, "menu-2");
  assert.deepEqual(parseStoredState("broken"), { ingredients: [], favorites: [], history: [] });
});

test("HTML contains semantic accessible pantry favorites history and install controls", async () => {
  const html = await read("index.html");
  for (const required of ["<main", "<h1", "<label", "role=\"status\"", "aria-live=\"polite\"", "skip-link", "menu-heading", "ingredient-expiry", "favorites-list", "history-list", "install-button"]) {
    assert.ok(html.includes(required), `missing ${required}`);
  }
  assert.doesNotMatch(html, /<script[^>]+https?:|<link[^>]+https?:/i);
});

test("responsive and reduced-motion rules are present", async () => {
  const css = await read("styles.css");
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
});

test("offline shell contains only relative same-origin assets", async () => {
  const worker = await read("service-worker.js");
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  assert.doesNotMatch(worker, /["']https?:\/\//i);
  for (const asset of ["./index.html", "./styles.css", "./app.js", "./meal-engine.js", "./ad-boundary.js", "./manifest.webmanifest"]) assert.ok(worker.includes(`"${asset}"`));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ["./icon.svg"]);
  assert.ok(worker.includes('"./icon.svg"'));
});

test("ad boundary is placeholder-only and contains no live integration", async () => {
  const ad = await read("ad-boundary.js");
  assert.match(ad, /placeholder-only/);
  assert.match(ad, /networkRequests: false/);
  assert.match(ad, /sdkLoaded: false/);
  assert.match(ad, /productionIdentifier: null/);
  assert.doesNotMatch(ad, /ca-app-pub-|https?:\/\//i);
});

test("user values are rendered with textContent and browser workflow persists all local state", async () => {
  const app = await read("app.js");
  assert.doesNotMatch(app, /innerHTML\s*=/);
  assert.match(app, /ingredientName\.textContent = item\.name/);
  assert.match(app, /heading\.textContent = suggestion\.title/);
  assert.match(app, /expiryDate: expiryInput\.value/);
  assert.match(app, /serializeState\(\{ ingredients, favorites, history \}\)/);
  assert.match(app, /favorite-button/);
  assert.match(app, /history\.push/);
  assert.match(app, /beforeinstallprompt/);
});

test("package has no dependency or install surface", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ["build", "start", "test"]);
});

test("source tree and build output stay inside the release allowlists", async () => {
  const top = (await readdir(root)).sort();
  assert.deepEqual(top.filter((name) => ![".git", "dist"].includes(name)), [
    ".gitignore", "AGENTS.md", "README.md", "ad-boundary.js", "app.js", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "package.json", "scripts", "service-worker.js", "styles.css", "tests",
  ]);
  if (top.includes("dist")) assert.deepEqual((await readdir(resolve(root, "dist"))).sort(), ["ad-boundary.js", "app.js", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "service-worker.js", "styles.css"]);
});
