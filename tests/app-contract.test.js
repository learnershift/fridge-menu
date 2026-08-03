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
  assert.match(css, /\.urgency-dot--expired/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.urgency-label \{ display: inline; \}/);
});

test("expired entries are refused before they reach local state", async () => {
  const app = await read("app.js");
  assert.match(app, /getExpiryStatus\(expiryInput\.value\) === "expired"/);
  assert.match(app, /Remove expired ingredients before adding new ones\./);
});

test("README documents date-backed sorting and expired-ingredient exclusion", async () => {
  const readme = await read("README.md");
  assert.match(readme, /earliest valid expiry date/);
  assert.match(readme, /Expired ingredients remain visible so they can be removed, but are not accepted or used to generate meal directions\./);
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

test("service-worker cache version is bumped for the current runtime shell", async () => {
  const worker = await read("service-worker.js");
  assert.match(worker, /const CACHE_NAME = "fridge-menu-shell-v3"/);
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
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ["android:aab", "build", "release:manifest", "start", "store-assets", "store-screenshot", "test", "verify:release"]);
});

test("release path is reproducible, unsigned, privacy-preserving, and owner-safe", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const androidBuild = await read("android/app/build.gradle.kts");
  const androidRootBuild = await read("android/build.gradle.kts");
  const packaging = await read("scripts/android-package.mjs");
  const manifest = await read("scripts/release-manifest.mjs");
  const storeAssets = await read("scripts/generate-store-assets.mjs");
  const capture = await read("scripts/capture-store-assets.mjs");
  const workflow = await read(".github/workflows/release-readiness.yml");
  const privacy = await read("release/privacy-policy.md");
  const listing = await read("release/play-listing.md");
  const dataSafety = await read("release/data-safety.md");
  const handoff = await read("release/OWNER-HANDOFF.md");
  const qaChecklist = await read("release/QA-CHECKLIST.md");

  assert.equal(pkg.scripts["android:aab"], "node scripts/android-package.mjs");
  assert.equal(pkg.scripts["release:manifest"], "node scripts/release-manifest.mjs");
  assert.equal(pkg.scripts["store-assets"], "node scripts/generate-store-assets.mjs");
  assert.equal(pkg.scripts["store-screenshot"], "node scripts/capture-store-assets.mjs");
  assert.ok(pkg.scripts["verify:release"].includes("npm test"));
  assert.ok(pkg.scripts["verify:release"].includes("npm run build"));
  assert.match(androidBuild, /signingConfig\s*=\s*null/);
  assert.match(androidBuild, /applicationId\s*=\s*"com.learnershift.fridgemenu"/);
  assert.match(androidRootBuild, /com\.android\.application"\) version "8\.6\.1"/);
  assert.match(packaging, /FRIDGE_MENU_ANDROID_SDK/);
  assert.match(packaging, /unsigned.*\.aab/i);
  assert.match(packaging, /do not create or import signing keys/i);
  assert.match(manifest, /sha256/i);
  assert.match(manifest, /release\/store-assets\/fridge-menu-icon-512\.png/);
  assert.match(manifest, /release\/store-assets\/fridge-menu-feature-graphic-1024x500\.png/);
  assert.match(storeAssets, /deflateSync/);
  assert.match(storeAssets, /1024/);
  assert.match(capture, /--headless/);
  assert.match(capture, /FRIDGE_MENU_CHROME_BIN/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /release:manifest/);
  assert.match(privacy, /no account, analytics, advertising SDK, tracking, or remote API/i);
  assert.match(listing, /Short description/);
  assert.match(dataSafety, /No data collected or shared/);
  assert.match(handoff, /Google Play Console/);
  for (const required of [
    "Artifact identity",
    "Physical device",
    "Offline",
    "TalkBack",
    "Screenshots",
    "Owner approval",
    "Rollback",
  ]) assert.match(qaChecklist, new RegExp(required, "i"), `QA checklist missing ${required}`);
  assert.match(qaChecklist, /app-release\.aab/);
  assert.match(qaChecklist, /com\.learnershift\.fridgemenu/);
  assert.match(qaChecklist, /Do not sign, upload, submit, publish, or launch/i);
});

test("Android release shell has a launcher icon and remains offline with no permissions", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  const activity = await read("android/app/src/main/java/com/learnershift/fridgemenu/MainActivity.java");
  const icon = await read("android/app/src/main/res/drawable/ic_launcher.xml");

  assert.match(manifest, /android:icon="@drawable\/ic_launcher"/);
  assert.doesNotMatch(manifest, /uses-permission/);
  assert.match(activity, /file:\/\/\/android_asset\/pwa\/index\.html/);
  assert.doesNotMatch(activity, /https?:\/\//i);
  assert.match(icon, /<vector/);
});

test("Play upload icon is a 512px PNG derived from the canonical app artwork", async () => {
  const icon = await readFile(resolve(root, "release/store-assets/fridge-menu-icon-512.png"));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
});

test("Play feature graphic is a deterministic 1024 by 500 PNG", async () => {
  const graphic = await readFile(resolve(root, "release/store-assets/fridge-menu-feature-graphic-1024x500.png"));
  assert.deepEqual([...graphic.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(graphic.readUInt32BE(16), 1024);
  assert.equal(graphic.readUInt32BE(20), 500);
});

test("source tree and build output stay inside the release allowlists", async () => {
  const top = (await readdir(root)).sort();
  assert.deepEqual(top.filter((name) => ![".git", ".hermes", "dist"].includes(name)), [
    ".github", ".gitignore", "AGENTS.md", "README.md", "ad-boundary.js", "android", "app.js", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "package.json", "release", "scripts", "service-worker.js", "styles.css", "tests",
  ]);
  if (top.includes("dist")) assert.deepEqual((await readdir(resolve(root, "dist"))).sort(), ["ad-boundary.js", "app.js", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "service-worker.js", "styles.css"]);
});
