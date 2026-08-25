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

test("privacy policy is available in-app and keeps owner-only identity values explicit", async () => {
  const [html, policy, handoff] = await Promise.all([
    read("index.html"), read("release/privacy-policy.md"), read("release/OWNER-HANDOFF.md"),
  ]);
  assert.match(html, /href="#privacy"/);
  assert.match(html, /id="privacy"/);
  assert.match(html, /Data retention and deletion/);
  for (const heading of ["Data retention and deletion", "Your privacy rights", "Children", "Policy changes"]) {
    assert.match(policy, new RegExp(`## ${heading}`));
  }
  for (const marker of ["LEGAL_NAME", "PRIVACY_EMAIL", "PUBLIC_POLICY_URL", "PRIVACY_OFFICER"]) {
    assert.match(policy, new RegExp(`OWNER_REQUIRED:${marker}`));
  }
  assert.match(handoff, /Owner-supplied privacy values/);
});

test("responsive and reduced-motion rules are present", async () => {
  const css = await read("styles.css");
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.urgency-dot--expired/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.urgency-label \{ display: inline; \}/);
});

test("remove control guarantees a 44 by 44 pixel touch target", async () => {
  const css = await read("styles.css");
  assert.match(css, /\.remove-button\s*\{[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/);
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
  for (const asset of ["./index.html", "./styles.css", "./app.js", "./meal-engine.js", "./manifest.webmanifest"]) assert.ok(worker.includes(`"${asset}"`));
  assert.doesNotMatch(worker, /ad-boundary/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ["./icon.svg"]);
  assert.ok(worker.includes('"./icon.svg"'));
});

test("service-worker cache version is bumped for the current runtime shell", async () => {
  const worker = await read("service-worker.js");
  assert.match(worker, /const CACHE_NAME = "fridge-menu-shell-v4"/);
});

test("unfinished advertising UI and runtime code are absent", async () => {
  const [html, app, css] = await Promise.all([read("index.html"), read("app.js"), read("styles.css")]);
  assert.doesNotMatch(html, /ad-placeholder|advertising placeholder/i);
  assert.doesNotMatch(app, /ad-boundary|renderAdPlaceholder|AD_PLACEHOLDER/);
  assert.doesNotMatch(css, /\.ad-placeholder/);
});

test("Android shell handles system insets, WebView history, rotation, and file-safe navigation", async () => {
  const [html, app, manifest, activity] = await Promise.all([
    read("index.html"), read("app.js"), read("android/app/src/main/AndroidManifest.xml"),
    read("android/app/src/main/java/com/learnershift/fridgemenu/MainActivity.java"),
  ]);
  assert.match(html, /class="brand" href="\.\/index\.html"/);
  assert.match(app, /location\.protocol !== "file:"/);
  assert.match(manifest, /android:configChanges="orientation\|screenSize\|screenLayout\|keyboardHidden\|uiMode"/);
  assert.match(activity, /private WebView webView;/);
  assert.match(activity, /setOnApplyWindowInsetsListener/);
  assert.match(activity, /webView\.canGoBack\(\)/);
  assert.match(activity, /setUseWideViewPort\(true\)/);
  assert.match(activity, /setLoadWithOverviewMode\(true\)/);
  assert.match(activity, /setAllowFileAccessFromFileURLs\(false\)/);
  assert.match(activity, /setAllowUniversalAccessFromFileURLs\(false\)/);
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
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ["android:aab", "android:evidence", "build", "release:manifest", "start", "store-assets", "store-screenshot", "test", "verify:release"]);
});

test("verify:release builds the AAB before manifest and Android evidence", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const steps = pkg.scripts["verify:release"].split(" && ");
  const aab = steps.indexOf("npm run android:aab");

  assert.notEqual(aab, -1, "verify:release must produce the AAB");
  assert.ok(aab < steps.indexOf("node scripts/release-manifest.mjs"));
  assert.ok(aab < steps.indexOf("npm run android:evidence"));
});

test("release checks are computed from source files and executed commands", async () => {
  const { computeStaticReleaseChecks } = await import("../scripts/release-checks.mjs");
  const passing = computeStaticReleaseChecks({
    css: ".remove-button { min-width: 2.75rem; min-height: 2.75rem; }",
    androidManifest: "<manifest><application /></manifest>",
    mainActivity: 'view.loadUrl("file:///android_asset/pwa/index.html");',
    serviceWorker: 'const files = ["./index.html"];',
    adBoundary: "networkRequests: false; sdkLoaded: false; productionIdentifier: null;",
  });
  assert.deepEqual(passing, { accessibility: "PASS", privacy_security: "PASS", offline: "PASS" });
  assert.equal(computeStaticReleaseChecks({ ...passing, css: ".remove-button { padding: 0; }" }).accessibility, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...passing, androidManifest: "<uses-permission />" }).privacy_security, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...passing, serviceWorker: 'fetch("https://example.test")' }).offline, "FAIL");
});

test("Android evidence generator binds computed release checks and identity to the current artifact", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const generator = await read("scripts/android-evidence.mjs");

  assert.equal(pkg.scripts["android:evidence"], "node scripts/android-evidence.mjs");
  assert.match(pkg.scripts["verify:release"], /android:evidence/);
  assert.match(generator, /android-evidence-v1/);
  assert.match(generator, /com\.learnershift\.fridgemenu/);
  assert.match(generator, /computeReleaseChecks/);
  assert.match(generator, /inspectAabSigning/);
  assert.doesNotMatch(generator, /tests: "PASS"|build: "PASS"|accessibility: "PASS"|privacy_security: "PASS"|offline: "PASS"/);
  for (const manualCheck of ["physical_device", "offline_relaunch", "talkback"]) {
    assert.match(generator, new RegExp(`${manualCheck}: \\"OWNER_REQUIRED\\"`));
  }
  assert.doesNotMatch(generator, /accessibility: \\"PASS\\"|offline: \\"PASS\\"/);
  assert.match(generator, /app-release\.aab/);
  assert.match(generator, /sha256/);
});

test("release path is reproducible, signing-ready, privacy-preserving, and owner-safe", async () => {
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
  const gitignore = await read(".gitignore");

  assert.equal(pkg.scripts["android:aab"], "node scripts/android-package.mjs");
  assert.equal(pkg.scripts["release:manifest"], "node scripts/release-manifest.mjs");
  assert.equal(pkg.scripts["store-assets"], "node scripts/generate-store-assets.mjs");
  assert.equal(pkg.scripts["store-screenshot"], "node scripts/capture-store-assets.mjs");
  assert.ok(pkg.scripts["verify:release"].includes("npm test"));
  assert.ok(pkg.scripts["verify:release"].includes("npm run build"));
  assert.match(androidBuild, /compileSdk\s*=\s*36/);
  assert.match(androidBuild, /targetSdk\s*=\s*36/);
  for (const variable of ["FRIDGE_MENU_KEYSTORE_PATH", "FRIDGE_MENU_KEYSTORE_PASSWORD", "FRIDGE_MENU_KEY_ALIAS", "FRIDGE_MENU_KEY_PASSWORD"]) {
    assert.match(androidBuild, new RegExp(variable));
  }
  assert.match(androidBuild, /applicationId\s*=\s*"com.learnershift.fridgemenu"/);
  assert.match(androidRootBuild, /com\.android\.application"\) version "8\.9\.1"/);
  assert.match(packaging, /FRIDGE_MENU_ANDROID_SDK/);
  assert.match(packaging, /inspectAabSigning/);
  assert.match(packaging, /do not create or import signing keys/i);
  assert.match(gitignore, /\*\.jks/);
  assert.match(gitignore, /\*\.keystore/);
  assert.match(manifest, /sha256/i);
  assert.match(manifest, /application_id:\s*"com\.learnershift\.fridgemenu"/);
  assert.match(manifest, /version_code:\s*1/);
  assert.match(manifest, /version_name:\s*"1\.0\.0"/);
  assert.match(manifest, /computeReleaseChecks/);
  assert.doesNotMatch(manifest, /tests: "PASS"|build: "PASS"|accessibility: "PASS"|privacy_security: "PASS"|offline: "PASS"/);
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

test("GitHub Pages publication is manual-only and deploys only the freshly built dist artifact", async () => {
  const workflow = await read(".github/workflows/deploy-pages.yml");

  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /path:\s*dist/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
});

test("Android release shell has a launcher icon and remains offline with no permissions", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  const activity = await read("android/app/src/main/java/com/learnershift/fridgemenu/MainActivity.java");
  const icon = await read("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml");

  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.doesNotMatch(manifest, /uses-permission/);
  assert.match(activity, /file:\/\/\/android_asset\/pwa\/index\.html/);
  assert.doesNotMatch(activity, /https?:\/\//i);
  assert.match(icon, /<adaptive-icon/);
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
    ".github", ".gitignore", "AGENTS.md", "README.md", "android", "app.js", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "package.json", "release", "scripts", "service-worker.js", "styles.css", "tests",
  ]);
  if (top.includes("dist")) assert.deepEqual((await readdir(resolve(root, "dist"))).sort(), ["app.js", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "service-worker.js", "styles.css"]);
});
