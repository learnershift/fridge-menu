import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  FAVORITES_LIMIT,
  HISTORY_LIMIT,
  MAX_STORED_TEXT_LENGTH,
  STORAGE_KEY,
  loadState,
  loadIngredients,
  millisecondsUntilNextLocalDay,
  isCanonicalHistoryTimestamp,
  accessStorage,
  bindSuggestionsToMenu,
  parseStoredIngredients,
  parseStoredState,
  saveIngredients,
  serializeIngredients,
  serializeState,
  usableSuggestions,
  writeStateIfUnchanged,
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
  const migrated = parseStoredState(legacy);
  assert.deepEqual(migrated, { ingredients: [{ id: "one", name: "Kale", urgency: "use-now", sequence: 0 }], favorites: [], history: [] });
  assert.deepEqual(parseStoredState(serializeState(migrated)), migrated, "v1 ingredients must survive the first v2 save and reload");
  const history = Array.from({ length: HISTORY_LIMIT + 2 }, (_, index) => ({ id: `menu-${index}`, createdAt: "2026-08-01T00:00:00.000Z", suggestions: [] }));
  const restored = parseStoredState(serializeState({
    ingredients: [{ id: "one", name: "Kale", expiryDate: "2026-08-02", sequence: 0 }],
    favorites: ["suggestion-1", "suggestion-1"], history,
  }));
  assert.deepEqual(restored.favorites, [], "favorite IDs without one matching retained suggestion must be dropped");
  assert.equal(restored.history.length, HISTORY_LIMIT);
  assert.equal(restored.history[0].id, "menu-2");
  assert.deepEqual(parseStoredState("broken"), { ingredients: [], favorites: [], history: [] });
});

test("state loading and serialization fail closed on blocked or oversized storage", () => {
  assert.deepEqual(loadState({ getItem() { throw new Error("blocked"); } }), { ingredients: [], favorites: [], history: [] });

  const long = "x".repeat(MAX_STORED_TEXT_LENGTH + 50);
  const oversized = {
    ingredients: [{ id: long, name: long, expiryDate: "2026-08-30", sequence: 0 }],
    favorites: Array.from({ length: FAVORITES_LIMIT + 10 }, (_, index) => `favorite-${index}`),
    history: [{
      id: "history-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      suggestions: Array.from({ length: 20 }, (_, index) => ({
        id: `history-1:suggestion-${index}`,
        title: `Suggestion ${index}`,
        anchor: "item-0",
        ingredients: Array.from({ length: 20 }, (_, ingredientIndex) => `item-${ingredientIndex}`),
        useFirstReason: "Use this first.",
        method: "Cook until ready.",
      })),
    }],
  };
  const restored = parseStoredState(serializeState(oversized));
  assert.deepEqual(restored.ingredients, [], "oversized ingredient records must be dropped rather than silently truncated");
  assert.ok(restored.favorites.length <= FAVORITES_LIMIT);
  assert.ok(restored.history[0].suggestions.length <= 3);
  assert.ok(restored.history[0].suggestions[0].ingredients.length <= 8);
  assert.ok(restored.history[0].suggestions[0].method.length <= MAX_STORED_TEXT_LENGTH);
});

test("browser storage access, duplicate identities, and invalid history fail closed", () => {
  let accessFailed = false;
  const blockedWindow = { get localStorage() { throw new DOMException("blocked", "SecurityError"); } };
  assert.equal(accessStorage(blockedWindow, () => { accessFailed = true; }), null);
  assert.equal(accessFailed, true);

  const duplicateIngredients = {
    version: 2,
    ingredients: [
      { id: "same", name: "Kale", expiryDate: "2099-01-02", sequence: 0 },
      { id: "same", name: "Tofu", expiryDate: "2099-01-03", sequence: 1 },
    ],
    favorites: [],
    history: [
      { id: "history", createdAt: "not-a-date", suggestions: [] },
      { id: "history", createdAt: "2026-08-25T08:00:00.000Z", suggestions: [] },
      { id: "history", createdAt: "2026-08-26T08:00:00.000Z", suggestions: [] },
    ],
  };
  const restored = parseStoredState(JSON.stringify(duplicateIngredients));
  assert.deepEqual(restored.ingredients.map(({ id, name }) => ({ id, name })), [{ id: "same", name: "Kale" }]);
  assert.deepEqual(restored.history.map((entry) => entry.createdAt), ["2026-08-25T08:00:00.000Z"]);

  const duplicateLegacyIds = JSON.stringify({ version: 1, ingredients: [
    { id: "same", name: "Kale", urgency: "use-now", sequence: 0 },
    { id: "same", name: "Tofu", urgency: "stable", sequence: 1 },
  ] });
  assert.deepEqual(parseStoredIngredients(duplicateLegacyIds), []);
  assert.equal(saveIngredients(null, [{ id: "one", name: "Kale", urgency: "use-now", sequence: 0 }]), false);

  const objectNames = JSON.stringify({
    version: 2,
    ingredients: [{ id: "object", name: { coerces: true }, expiryDate: "2099-01-02", sequence: 0 }],
    favorites: [],
    history: [{
      id: "history-object", createdAt: "2026-08-25T08:00:00.000Z",
      suggestions: [{ id: "history-object:suggestion-object", title: "Bad", anchor: "Kale", ingredients: [{ coerces: true }], useFirstReason: "Bad.", method: "Bad." }],
    }],
  });
  const objectState = parseStoredState(objectNames);
  assert.deepEqual(objectState.ingredients, []);
  assert.deepEqual(objectState.history[0].suggestions, []);

  assert.equal(isCanonicalHistoryTimestamp("2026-08-25T08:00:00.000Z"), true);
  assert.equal(isCanonicalHistoryTimestamp("2026-08-25T08:00:00Z"), false);
  assert.equal(isCanonicalHistoryTimestamp("2200-01-01T00:00:00.000Z"), false);
  const invalidTimes = parseStoredState(JSON.stringify({
    version: 2, ingredients: [], favorites: [], history: [
      { id: "noncanonical", createdAt: "2026-08-25T08:00:00Z", suggestions: [] },
      { id: "out-of-range", createdAt: "2200-01-01T00:00:00.000Z", suggestions: [] },
    ],
  }));
  assert.deepEqual(invalidTimes.history, []);
});

test("stale tabs cannot overwrite a newer local snapshot", () => {
  let raw = "newer-tab-state";
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  assert.deepEqual(writeStateIfUnchanged(storage, "stale-tab-state", { ingredients: [], favorites: [], history: [] }), { status: "conflict", raw: "stale-tab-state" });
  assert.equal(raw, "newer-tab-state");
  const saved = writeStateIfUnchanged(storage, "newer-tab-state", { ingredients: [], favorites: [], history: [] });
  assert.equal(saved.status, "saved");
  assert.equal(raw, saved.raw);
  assert.equal(writeStateIfUnchanged(null, null, { ingredients: [], favorites: [], history: [] }).status, "blocked");
});

test("menu and favorite identities stay unique across history entries", () => {
  const template = { id: "suggestion-1", title: "Skillet", anchor: "Kale", ingredients: ["Kale"], useFirstReason: "First.", method: "Cook." };
  const bound = bindSuggestionsToMenu("menu-a", [template])[0];
  assert.equal(bound.id, "menu-a:suggestion-1");
  assert.equal(bindSuggestionsToMenu("menu-b", [template])[0].id, "menu-b:suggestion-1");

  const validFavorite = parseStoredState(serializeState({
    ingredients: [{ id: "kale", name: "Kale", expiryDate: "2099-01-02", sequence: 0 }],
    favorites: [bound.id],
    history: [{ id: "menu-a", createdAt: "2026-08-25T08:00:00.000Z", suggestions: [bound] }],
  }));
  assert.deepEqual(validFavorite.favorites, [bound.id]);

  const restored = parseStoredState(JSON.stringify({
    version: 2, ingredients: [{ id: "kale", name: "Kale", expiryDate: "2099-01-02", sequence: 0 }],
    favorites: ["suggestion-1"],
    history: [
      { id: "menu-a", createdAt: "2026-08-25T08:00:00.000Z", suggestions: [template] },
      { id: "menu-b", createdAt: "2026-08-26T08:00:00.000Z", suggestions: [template] },
    ],
  }));
  assert.deepEqual(restored.favorites, [], "ambiguous legacy favorite IDs must fail closed");
});

test("history and favorites cannot render guidance for removed or expired ingredients", () => {
  const suggestion = {
    id: "suggestion-1", title: "Use-first skillet", anchor: "Kale",
    ingredients: ["Kale", "Tofu", "Rice"], useFirstReason: "Use Kale first.", method: "Cook it.",
  };
  const fresh = [
    { id: "kale", name: "Kale", expiryDate: "2026-08-25", sequence: 0 },
    { id: "tofu", name: "Tofu", expiryDate: "2026-08-26", sequence: 1 },
    { id: "rice", name: "Rice", expiryDate: "2026-08-30", sequence: 2 },
  ];
  assert.deepEqual(usableSuggestions([suggestion], fresh, "2026-08-25"), [suggestion]);
  assert.deepEqual(usableSuggestions([suggestion], fresh, "2026-08-27"), [], "expired history guidance must disappear");
  assert.deepEqual(usableSuggestions([suggestion], fresh.slice(0, 2), "2026-08-25"), [], "removed ingredients must invalidate history guidance");
  assert.deepEqual(usableSuggestions([{ ...suggestion, anchor: "Removed Chicken", ingredients: ["Kale", "Kale"] }], fresh, "2026-08-25"), [],
    "anchor and ingredient references must be unique and internally consistent");
});

test("stored suggestions are bound to one unique history identity", () => {
  const suggestion = { id: "menu-a:suggestion-1", title: "Skillet", anchor: "Kale", ingredients: ["Kale"], useFirstReason: "First.", method: "Cook." };
  const restored = parseStoredState(JSON.stringify({
    version: 2, ingredients: [{ id: "kale", name: "Kale", expiryDate: "2099-01-02", sequence: 0 }], favorites: [],
    history: [
      { id: "menu-a", createdAt: "2026-08-25T08:00:00.000Z", suggestions: [suggestion] },
      { id: "menu-b", createdAt: "2026-08-26T08:00:00.000Z", suggestions: [suggestion] },
    ],
  }));
  assert.deepEqual(restored.history.map((entry) => entry.suggestions.length), [1, 0]);
});

test("ingredient changes and day rollover revalidate rendered history and favorites", async () => {
  const app = await read("app.js");
  assert.match(app, /remove\.addEventListener\("click",[\s\S]*?renderSuggestions\(\);\s*renderFavorites\(\);\s*renderHistory\(\);/);
  assert.match(app, /clearButton\.addEventListener\("click",[\s\S]*?renderSuggestions\(\);\s*renderFavorites\(\);\s*renderHistory\(\);/);
  assert.match(app, /document\.addEventListener\("visibilitychange"[\s\S]*?renderSuggestions\(currentSuggestions\);\s*renderFavorites\(\);\s*renderHistory\(\);/);
  assert.match(app, /scheduleDayRollover/);
  assert.equal(millisecondsUntilNextLocalDay(new Date(2026, 7, 25, 23, 59, 59, 900)), 150);
  assert.equal(millisecondsUntilNextLocalDay(new Date(2026, 7, 25, 12, 0, 0, 0)), 43_200_050);
});

test("HTML contains semantic accessible pantry favorites history and install controls", async () => {
  const html = await read("index.html");
  for (const required of ["<main", "<h1", "<label", "role=\"status\"", "aria-live=\"polite\"", "skip-link", "menu-heading", "ingredient-expiry", "favorites-list", "history-list", "install-button"]) {
    assert.ok(html.includes(required), `missing ${required}`);
  }
  assert.doesNotMatch(html, /<script[^>]+https?:|<link[^>]+https?:/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /aria-label="Ingredient count: 0 of 8"/);
  assert.match(html, /id="ingredient-name"[^>]*aria-describedby="status-message"/);
  assert.match(html, /id="ingredient-expiry"[^>]*aria-describedby="status-message"/);
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
  for (const document of [html, policy, handoff]) {
    assert.match(document, /Clear list[^.]*ingredients only/i);
    assert.match(document, /clear (?:the )?app or browser storage[^.]*favorites[^.]*history/i);
  }
});

test("owner handoff covers current Play gates, questionnaire answers, and future ad disclosure coupling", async () => {
  const [handoff, qa] = await Promise.all([read("release/OWNER-HANDOFF.md"), read("release/QA-CHECKLIST.md")]);
  for (const required of [
    "organization account", "D-U-N-S", "production track",
    "developer identity", "device verification", "OTP", "Health apps declaration",
    "Government apps", "Financial features", "Advertising ID", "signed AAB",
    "Play Console questionnaire answers", "No data collected or shared",
  ]) assert.match(handoff, new RegExp(required, "i"), `handoff missing ${required}`);
  assert.doesNotMatch(handoff, /Upload the unsigned AAB/i);
  assert.doesNotMatch(handoff, /12 testers|14 consecutive days|13 November 2023/i);
  assert.match(handoff, /Health apps declaration \| No — the app does not provide health functionality/i);
  for (const coupledUpdate of ["Ads declaration", "Data safety", "Advertising ID", "privacy-policy", "play-listing"]) {
    assert.match(qa, new RegExp(coupledUpdate, "i"), `QA missing future AdMob update: ${coupledUpdate}`);
  }
});

test("responsive and reduced-motion rules are present", async () => {
  const css = await read("styles.css");
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.urgency-dot--expired/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.urgency-label \{ display: inline; grid-column: 2; \}/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.meal-card \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.ingredient-item \{ grid-template-columns: auto minmax\(0, 1fr\) auto; \}/);
});

test("release UI color tokens meet WCAG text and non-text contrast floors", async () => {
  const css = await read("styles.css");
  const token = (name) => css.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, "i"))?.[1];
  const luminance = (hex) => {
    const channels = hex.match(/../g).map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const ratio = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };

  assert.ok(ratio(token("coral"), "fbf8ef") >= 4.5, "coral hero text must meet normal-text contrast");
  const placeholder = css.match(/input::placeholder\s*\{[^}]*color:\s*#([0-9a-f]{6})/i)?.[1];
  const border = css.match(/input, select\s*\{[^}]*border:\s*1px solid #([0-9a-f]{6})/i)?.[1];
  assert.ok(ratio(placeholder, "ffffff") >= 4.5, "placeholder text must meet text contrast");
  assert.ok(ratio(border, "ffffff") >= 3, "input boundary must meet non-text contrast");
});

test("remove control guarantees a 44 by 44 pixel touch target", async () => {
  const css = await read("styles.css");
  assert.match(css, /\.remove-button\s*\{[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/);
  assert.match(css, /\.history-button\s*\{[^}]*min-height:\s*2\.75rem;/);
});

test("form errors identify and focus invalid fields and install results are announced", async () => {
  const app = await read("app.js");
  assert.match(app, /field\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(app, /invalidFields\[0\]\?\.focus\(\)/);
  assert.match(app, /installPrompt\.userChoice/);
  assert.match(app, /Installation (?:accepted|dismissed|could not be started)/);
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
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ["./icon-192.png", "./icon-512.png", "./icon.svg"]);
  assert.deepEqual(manifest.icons.map((icon) => icon.purpose), ["any", "any", "any"]);
  for (const asset of ["./icon-192.png", "./icon-512.png", "./icon.svg"]) assert.ok(worker.includes(`"${asset}"`));
});

test("service-worker cache version is bumped for the current runtime shell", async () => {
  const worker = await read("service-worker.js");
  assert.match(worker, /const CACHE_NAME = "fridge-menu-shell-v12"/);
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
  assert.match(activity, /WindowInsets\.Type\.displayCutout\(\)/);
  assert.match(activity, /webView\.canGoBack\(\)/);
  assert.match(activity, /APP_ORIGIN/);
  assert.match(activity, /isAllowedAppUrl/);
  assert.match(activity, /path\.indexOf\('%'\) >= 0/);
  assert.match(activity, /shouldOverrideUrlLoading/);
  assert.match(activity, /shouldInterceptRequest/);
  assert.match(activity, /registerOnBackInvokedCallback/);
  assert.match(activity, /unregisterOnBackInvokedCallback/);
  assert.match(activity, /syncBackCallback/);
  assert.doesNotMatch(activity, /navigateBackOrFinish/);
  assert.match(activity, /setUseWideViewPort\(true\)/);
  assert.match(activity, /setLoadWithOverviewMode\(true\)/);
  assert.match(activity, /setAllowFileAccessFromFileURLs\(false\)/);
  assert.match(activity, /setAllowUniversalAccessFromFileURLs\(false\)/);
});

test("rerendered controls restore focus and expose changing state in accessible names", async () => {
  const app = await read("app.js");
  assert.match(app, /favorite\.dataset\.suggestionId = suggestion\.id/);
  assert.match(app, /favorite\.setAttribute\("aria-label"/);
  assert.match(app, /focusFavoriteButton\(suggestion\.id\)/);
  assert.match(app, /row\.dataset\.ingredientId = item\.id/);
  assert.match(app, /focusIngredientAfterRemoval/);
  assert.match(app, /count\.setAttribute\("aria-label", `Ingredient count: \$\{ingredients\.length\} of \$\{MAX_INGREDIENTS\}`\)/);
});

test("user values are rendered with textContent and browser workflow persists all local state", async () => {
  const app = await read("app.js");
  assert.doesNotMatch(app, /innerHTML\s*=/);
  assert.match(app, /ingredientName\.textContent = item\.name/);
  assert.match(app, /heading\.textContent = suggestion\.title/);
  assert.match(app, /expiryDate: expiryInput\.value/);
  assert.match(app, /writeStateIfUnchanged\(storage, lastKnownRaw, \{ ingredients, favorites, history \}\)/);
  assert.match(app, /favorite-button/);
  assert.match(app, /history\.push/);
  assert.match(app, /beforeinstallprompt/);
  assert.ok((app.match(/const saved = persist\(\)/g) ?? []).length >= 5);
  assert.match(app, /for this session only; local saving is blocked\./);
  assert.match(app, /window\.addEventListener\("storage"/);
  assert.match(app, /Another tab changed saved data/);
});

test("package has no dependency or install surface", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ["android:aab", "android:evidence", "build", "ci:receipt", "release:manifest", "start", "store-assets", "store-screenshot", "test", "verify:aab-repro", "verify:release"]);
});

test("verify:release builds the AAB before manifest and Android evidence", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const steps = pkg.scripts["verify:release"].split(" && ");
  const aab = steps.indexOf("npm run verify:aab-repro");

  assert.notEqual(aab, -1, "verify:release must produce the AAB");
  assert.ok(aab < steps.indexOf("node scripts/release-manifest.mjs"));
  assert.ok(aab < steps.indexOf("npm run android:evidence"));
});

test("release checks are computed from source files and executed commands", async () => {
  const { computeStaticReleaseChecks } = await import("../scripts/release-checks.mjs");
  const fixture = {
    css: ".remove-button { min-width: 2.75rem; min-height: 2.75rem; }",
    androidManifest: "<manifest><application /></manifest>",
    mainActivity: 'view.loadUrl("file:///android_asset/pwa/index.html");',
    serviceWorker: 'const files = ["./index.html"];',
    adBoundary: "networkRequests: false; sdkLoaded: false; productionIdentifier: null;",
  };
  const passing = computeStaticReleaseChecks(fixture);
  assert.deepEqual(passing, { touch_target_static: "PASS", privacy_security_static: "PASS", offline_static: "PASS" });
  assert.equal(computeStaticReleaseChecks({ ...fixture, css: ".remove-button { padding: 0; }" }).touch_target_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, androidManifest: "<uses-permission />" }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: 'fetch("https://example.test")' }).offline_static, "FAIL");
});

test("Android evidence generator binds computed release checks and identity to the current artifact", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const generator = await read("scripts/android-evidence.mjs");

  assert.equal(pkg.scripts["android:evidence"], "node scripts/android-evidence.mjs");
  assert.match(pkg.scripts["verify:release"], /android:evidence/);
  assert.match(generator, /android-evidence-v2/);
  assert.match(generator, /inspectAabArtifact/);
  assert.match(generator, /assertEvidenceAgreement/);
  assert.match(generator, /inspectAabSigning/);
  assert.match(generator, /release_manifest_sha256/);
  assert.match(generator, /submission_readiness/);
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
  const wrapperProperties = await read("android/gradle/wrapper/gradle-wrapper.properties");
  const wrapperJar = await readFile(resolve(root, "android/gradle/wrapper/gradle-wrapper.jar"));

  assert.equal(pkg.scripts["android:aab"], "node scripts/android-package.mjs");
  assert.equal(pkg.scripts["verify:aab-repro"], "node scripts/verify-aab-repro.mjs");
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
  assert.doesNotMatch(packaging, /FRIDGE_MENU_GRADLE|\? "gradle\.bat" : "gradle"/);
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
  assert.match(capture, /--lang=en-US/);
  assert.match(capture, /Emulation\.setLocaleOverride/);
  assert.match(capture, /Emulation\.setTimezoneOverride/);
  assert.match(capture, /Page\.addScriptToEvaluateOnNewDocument/);
  assert.match(capture, /2026-08-25T08:00:00\.000Z/);
  assert.match(capture, /ingredient-expiry[^\n]*2099-01-02/);
  assert.match(capture, /FRIDGE_MENU_CHROME_BIN/);
  for (const name of ["01-empty-home", "02-use-first-list", "03-menu-results", "04-favorites-history"]) {
    assert.match(capture, new RegExp(name));
  }
  assert.match(wrapperProperties, /gradle-8\.11\.1-bin\.zip/);
  assert.match(wrapperProperties, /distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6/);
  assert.equal(createHash("sha256").update(wrapperJar).digest("hex"), "2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046");
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run verify:release/);
  assert.match(workflow, /npm run ci:receipt/);
  assert.match(workflow, /FRIDGE_MENU_REQUIRE_UNSIGNED:\s*["']?1/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /unsigned-release-proof-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /secrets\./);
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

test("owner handoff is fail-closed for unresolved declarations, approvals, testing, and first-release recovery", async () => {
  const [handoff, qa] = await Promise.all([read("release/OWNER-HANDOFF.md"), read("release/QA-CHECKLIST.md")]);
  for (const required of [
    "No — the app does not provide health functionality", "Play App Signing", "upload key", "zero OWNER_REQUIRED markers",
    "tester list", "opt-in URL", "matching Google account", "delivered version", "country availability",
    "target track", "Git SHA", "AAB SHA-256", "approver", "timestamp", "authority evidence ID",
  ]) assert.match(handoff, new RegExp(required, "i"), `handoff missing fail-closed field: ${required}`);
  for (const separateApproval of ["signing", "internal-test upload", "production submission", "publication"]) {
    assert.match(handoff, new RegExp(separateApproval, "i"), `handoff missing separate approval: ${separateApproval}`);
  }
  assert.match(qa, /LOCAL_CHROME_SIMULATION/);
  assert.match(qa, /withdraw[^.]*before publication/i);
  assert.match(qa, /fix-forward[^.]*higher versionCode/i);
  for (const field of ["Tester:", "Device model:", "Android version:", "Result: PASS\/FAIL", "Evidence path:"]) {
    assert.match(qa, new RegExp(field, "i"), `QA record missing ${field}`);
  }
});

test("GitHub Pages publication is manual-only and deploys only the freshly built dist artifact", async () => {
  const workflow = await read(".github/workflows/deploy-pages.yml");

  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /actions\/upload-pages-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /path:\s*dist/);
  assert.match(workflow, /actions\/deploy-pages@[0-9a-f]{40}/);
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

test("Android launcher artwork uses the canonical bowl and leaf palette instead of the old lettermark", async () => {
  const [canonical, foreground, legacy, round] = await Promise.all([
    read("icon.svg"), read("android/app/src/main/res/drawable/ic_launcher_foreground.xml"),
    read("android/app/src/main/res/mipmap/ic_launcher.xml"), read("android/app/src/main/res/mipmap/ic_launcher_round.xml"),
  ]);
  for (const color of ["E7A64B", "2F7D63", "173F35"]) {
    assert.match(canonical.toUpperCase(), new RegExp(color));
    assert.match(foreground.toUpperCase(), new RegExp(color));
    assert.match(legacy.toUpperCase(), new RegExp(color));
    assert.match(round.toUpperCase(), new RegExp(color));
  }
  assert.doesNotMatch(foreground, /#E9F46A/i);
});

test("Play upload icon is a 512px PNG derived from the canonical app artwork", async () => {
  const icon = await readFile(resolve(root, "release/store-assets/fridge-menu-icon-512.png"));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
});

test("PWA provides deterministic bitmap install icons", async () => {
  for (const size of [192, 512]) {
    const icon = await readFile(resolve(root, `icon-${size}.png`));
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
    assert.equal(icon[25], 2, "PWA icons must be truecolor RGB without alpha");
  }
});

test("Play feature graphic is a deterministic 1024 by 500 PNG", async () => {
  const graphic = await readFile(resolve(root, "release/store-assets/fridge-menu-feature-graphic-1024x500.png"));
  assert.deepEqual([...graphic.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(graphic.readUInt32BE(16), 1024);
  assert.equal(graphic.readUInt32BE(20), 500);
  assert.equal(graphic[25], 2, "feature graphic must be truecolor RGB without alpha");
});

test("source tree and build output stay inside the release allowlists", async () => {
  const top = (await readdir(root)).sort();
  assert.deepEqual(top.filter((name) => ![".git", ".hermes", "dist"].includes(name)), [
    ".github", ".gitignore", "AGENTS.md", "README.md", "android", "app.js", "icon-192.png", "icon-512.png", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "package.json", "release", "scripts", "service-worker.js", "styles.css", "tests",
  ]);
  if (top.includes("dist")) assert.deepEqual((await readdir(resolve(root, "dist"))).sort(), ["app.js", "icon-192.png", "icon-512.png", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "service-worker.js", "styles.css"]);
});
