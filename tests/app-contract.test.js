import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { runtimeShellVersion } from "../scripts/runtime-shell.mjs";
import { generateSuggestions } from "../meal-engine.js";

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
  recoverSuggestionMetadata,
  parseStoredIngredients,
  parseStoredState,
  saveIngredients,
  serializeIngredients,
  serializeState,
  usableSuggestions,
  commitStateTransaction,
} from "../app.js";

const root = resolve(import.meta.dirname, "..");
const read = (name) => readFile(resolve(root, name), "utf8");

function decodeUnfilteredPng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  assert.equal(bitDepth, 8, "generated PNGs must use 8-bit channels");
  assert.ok(channels, `unsupported generated PNG color type: ${colorType}`);

  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  for (let row = 0; row < height; row += 1) {
    const source = row * (stride + 1);
    assert.equal(raw[source], 0, "generated PNG scanlines must use the deterministic no-filter mode");
    raw.copy(pixels, row * stride, source + 1, source + 1 + stride);
  }
  return { width, height, colorType, pixels };
}

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

test("cross-tab mutations serialize through one state writer", async () => {
  let raw = serializeState({ ingredients: [], favorites: [], history: [] });
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  let queue = Promise.resolve();
  const locks = {
    request(_name, _options, callback) {
      const result = queue.then(callback);
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const add = (id) => commitStateTransaction(locks, storage, (state) => ({
    ...state, ingredients: [...state.ingredients, { id, name: id, expiryDate: "2099-01-01", sequence: state.ingredients.length }],
  }));
  const [first, second] = await Promise.all([add("Kale"), add("Tofu")]);
  assert.equal(first.status, "saved");
  assert.equal(second.status, "saved");
  assert.deepEqual(parseStoredState(raw).ingredients.map((item) => item.name), ["Kale", "Tofu"]);

  const removeKale = commitStateTransaction(locks, storage, (state) => ({
    ...state, ingredients: state.ingredients.filter((item) => item.name !== "Kale"),
  }));
  const addRice = commitStateTransaction(locks, storage, (state) => ({
    ...state, ingredients: [...state.ingredients, { id: "Rice", name: "Rice", expiryDate: "2099-01-02", sequence: 2 }],
  }));
  await Promise.all([removeKale, addRice]);
  assert.deepEqual(parseStoredState(raw).ingredients.map((item) => item.name), ["Tofu", "Rice"]);
  assert.equal((await commitStateTransaction(null, storage, (state) => state)).status, "blocked");
});

test("stale destructive and UI-dependent mutations fail closed after acquiring the writer lock", async () => {
  const expectedRaw = serializeState({
    ingredients: [{ id: "kale", name: "Kale", expiryDate: "2099-01-01", sequence: 0 }],
    favorites: [],
    history: [],
  });
  const latestState = {
    ingredients: [
      { id: "kale", name: "Kale", expiryDate: "2099-01-01", sequence: 0 },
      { id: "tofu", name: "Tofu", expiryDate: "2099-01-02", sequence: 1 },
    ],
    favorites: [],
    history: [],
  };
  let raw = serializeState(latestState);
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  const locks = { request: (_name, _options, callback) => callback() };

  for (const mutate of [
    (state) => ({ ...state, ingredients: [] }),
    (state) => ({ ...state, ingredients: state.ingredients.filter((item) => item.id !== "kale") }),
    (state) => ({ ...state, favorites: [...state.favorites, "stale-favorite"] }),
  ]) {
    let invoked = false;
    const result = await commitStateTransaction(locks, storage, (state) => {
      invoked = true;
      return mutate(state);
    }, { expectedRaw });
    assert.equal(result.status, "conflict");
    assert.equal(invoked, false, "a stale intent must not run its mutation callback");
    assert.deepEqual(result.state, latestState, "the caller must receive the latest state for UI recovery");
    assert.equal(raw, serializeState(latestState), "stale clear, remove, or favorite intent must not overwrite newer data");
  }
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
  assert.match(html, /<main id="main" tabindex="-1">/, "skip-link target must accept programmatic focus");
});

test("privacy policy is available in-app and contains the finalized developer identity", async () => {
  const [html, publicPolicy, policy, handoff, listing, i18n] = await Promise.all([
    read("index.html"), read("privacy.html"), read("release/privacy-policy.md"), read("release/OWNER-HANDOFF.md"),
    read("release/play-listing.md"), read("i18n.js"),
  ]);
  const publicPolicyUrl = "https://nuvopilot.com/apps/fridge-menu/privacy/";
  const privacyEmail = "support@nuvopilot.com";
  const englishLegalName = "LABONDANCE Co., Ltd. (주식회사 라봉당스)";
  assert.match(html, /href="#privacy"/);
  assert.match(html, /id="privacy"/);
  assert.match(html, /Data retention and deletion/);
  assert.match(publicPolicy, /<html lang="ko">/);
  assert.match(publicPolicy, /<article lang="en"/);
  assert.match(publicPolicy, /2026-08-29/);
  assert.doesNotMatch(publicPolicy, /<(?:script|link|img|iframe|object|embed)\b/i);
  for (const heading of ["Data retention and deletion", "Your privacy rights", "Children", "Policy changes"]) {
    assert.match(policy, new RegExp(`## ${heading}`));
  }
  assert.doesNotMatch(policy, /OWNER_REQUIRED/);
  assert.ok(publicPolicy.includes(`<dt>게시자</dt><dd>주식회사 라봉당스</dd>`));
  assert.ok(publicPolicy.includes(`<dt>Publisher</dt><dd>${englishLegalName}</dd>`));
  assert.ok(policy.includes(`Publisher: ${englishLegalName}`));
  assert.ok(handoff.includes(`\`LEGAL_NAME\`: ${englishLegalName}`));
  for (const document of [publicPolicy, policy, handoff, listing, i18n]) {
    assert.ok(document.includes(publicPolicyUrl), "privacy policy URL must use the developer domain");
    assert.ok(document.includes(privacyEmail), "privacy contact must use the developer domain");
    assert.doesNotMatch(document, /learnershift\.github\.io\/fridge-menu\/privacy\.html|stevensong332@gmail\.com/);
  }
  assert.ok(publicPolicy.includes(`이 정책의 공식 공개본: <a href="${publicPolicyUrl}">${publicPolicyUrl}</a>`));
  assert.ok(publicPolicy.includes(`The official public copy of this policy: <a href="${publicPolicyUrl}">${publicPolicyUrl}</a>`));
  assert.match(policy, /송문길/);
  assert.match(handoff, /Owner-supplied privacy values/);
  for (const document of [html, publicPolicy, policy, handoff]) {
    assert.match(document, /Clear list[^.]*ingredients only/i);
    assert.match(document, /clear (?:the )?app or browser storage[^.]*favorites[^.]*history/i);
  }
});

test("owner handoff covers current Play gates, questionnaire answers, and future ad disclosure coupling", async () => {
  const [handoff, qa, dataSafety] = await Promise.all([
    read("release/OWNER-HANDOFF.md"), read("release/QA-CHECKLIST.md"), read("release/data-safety.md"),
  ]);
  for (const required of [
    "organization account", "D-U-N-S", "production track",
    "developer identity", "device verification", "OTP", "Health apps declaration",
    "Government apps", "Financial features", "Advertising ID", "signed AAB",
    "Play Console questionnaire answers", "No data collected or shared",
  ]) assert.match(handoff, new RegExp(required, "i"), `handoff missing ${required}`);
  assert.doesNotMatch(handoff, /Upload the unsigned AAB/i);
  assert.doesNotMatch(handoff, /12 testers|14 consecutive days|13 November 2023/i);
  assert.doesNotMatch(handoff, /Health apps declaration \| No — the app does not provide health functionality/i);
  assert.match(handoff, /Health apps declaration \| HOLD — owner resolution required/i);
  assert.match(handoff, /planning meals/i);
  assert.match(handoff, /Nutrition and Weight Management/i);
  assert.match(handoff, /Do not save the Health form or proceed to closed, open, or production release until this HOLD is resolved/i);
  assert.match(dataSafety, /Do not use this draft to answer the Health apps declaration/i);
  assert.match(qa, /Health form access date/i);
  assert.match(qa, /final Health answer/i);
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
  // The meal card renders a single content wrapper, so it must be one column at every
  // width. A leading fixed column squeezed the whole card into 40px above 620px.
  assert.match(css, /\.meal-card \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(css, /\.meal-card \{[^}]*grid-template-columns: 2\.5rem/);
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
  const [app, i18n] = await Promise.all([read("app.js"), read("i18n.js")]);
  assert.match(app, /field\.setAttribute\("aria-invalid", "true"\)/);
  assert.match(app, /invalidFields\[0\]\?\.focus\(\)/);
  assert.match(app, /installPrompt\.userChoice/);
  assert.match(app, /t\((?:choice\?\.outcome === "accepted" \? )?"install(?:Accepted|Dismissed|Failed)"/);
  assert.match(i18n, /Installation (?:accepted|dismissed|could not be started)/);
  assert.match(app, /document\.querySelector\("\.brand"\)\.focus\(\)/);
});

test("expired entries are refused before they reach local state", async () => {
  const [app, i18n] = await Promise.all([read("app.js"), read("i18n.js")]);
  assert.match(app, /expiryDate && getExpiryStatus\(expiryDate\) === "expired"/);
  assert.match(app, /t\("errorExpiredNotAdded"\)/);
  assert.match(i18n, /Remove expired ingredients before adding new ones\./);
});

test("expiry date is optional and undated ingredients fall back to stable urgency", async () => {
  const [app, html] = await Promise.all([read("app.js"), read("index.html")]);
  assert.match(app, /await addIngredient\(nameInput\.value, expiryInput\.value\)/);
  assert.match(app, /urgency: "stable", sequence: nextSequence\+\+/);
  assert.doesNotMatch(html, /id="ingredient-expiry"[^>]*\srequired/);
  assert.match(html, /data-i18n="expiryLabel"/);
});

test("UI is fully localized with matching English and Korean string tables", async () => {
  const [app, html] = await Promise.all([read("app.js"), read("index.html")]);
  const { STRINGS, translate, detectLocale, normalizeLocale } = await import("../i18n.js");
  assert.deepEqual(Object.keys(STRINGS.ko).sort(), Object.keys(STRINGS.en).sort(), "every English string needs a Korean counterpart");
  for (const key of ["heroCopy", "menuIntro", "privacyCopy", "menuReady", "errorDuplicate", "suggestionsEmpty", "quickIngredientEgg", "otherMenus", "mealMeta"]) {
    assert.match(STRINGS.ko[key], /[가-힣]/, `Korean table entry ${key} must be Korean`);
  }
  assert.equal(translate("ko", "ingredientAdded", { name: "계란" }), "‘계란’ 담았어요.");
  assert.equal(translate("en", "suggestionsEmpty", { min: 3, max: 8 }), "Add 3–8 ingredients, then make a menu.");
  assert.equal(detectLocale(["fr-FR", "ko-KR"]), "ko");
  assert.equal(detectLocale(["de-DE"]), "en");
  assert.equal(normalizeLocale("EN-GB"), "en");
  assert.match(app, /applyStaticTranslations\(document, locale\)/);
  assert.match(app, /langToggle\.addEventListener\("click"/);
  assert.match(app, /saveStoredLocale\(storage, locale\)/);
  assert.match(app, /generateSuggestions\(ingredients, undefined, locale\)/);
  assert.match(app, /generateSuggestions\(ingredients, undefined, locale, \{ offset: 3 \}\)/);
  assert.match(html, /id="lang-toggle"/);
  assert.match(html, /id="quick-ingredients"/);
  assert.match(html, /id="alternative-menus-button"/);
  for (const key of ["skipLink", "heroCopy", "fridgeHeading", "menuHeading", "privacyCopy", "footerText"]) {
    assert.match(html, new RegExp(`data-i18n="${key}"`), `index.html must localize ${key}`);
  }
});

test("quick ingredient chips and menu metadata stay local, accessible, and deterministic", async () => {
  const [app, html, css] = await Promise.all([read("app.js"), read("index.html"), read("styles.css")]);
  const { STRINGS } = await import("../i18n.js");
  const quickKeys = Object.keys(STRINGS.en).filter((key) => key.startsWith("quickIngredient") && key !== "quickIngredientsHeading");
  assert.equal(quickKeys.length, 24);
  assert.deepEqual(quickKeys.map((key) => STRINGS.en[key]), ["Egg", "Kimchi", "Onion", "Tofu", "Scallion", "Mushrooms", "Potato", "Carrot", "Zucchini", "Bean sprouts", "Spinach", "Tomato", "Rice", "Noodles", "Bread", "Ham", "Bacon", "Tuna", "Chicken", "Pork", "Beef", "Cheese", "Milk", "Fish cake"]);
  assert.deepEqual(quickKeys.map((key) => STRINGS.ko[key]), ["계란", "김치", "양파", "두부", "대파", "버섯", "감자", "당근", "애호박", "콩나물", "시금치", "토마토", "밥", "면", "식빵", "햄", "베이컨", "참치", "닭고기", "돼지고기", "소고기", "치즈", "우유", "어묵"]);
  assert.match(app, /const QUICK_INGREDIENT_KEYS = Object\.freeze\(\[/);
  assert.match(app, /quickIngredient\$\{key\}/);
  assert.match(app, /chip\.disabled = ingredients\.length >= MAX_INGREDIENTS \|\| ingredients\.some/);
  assert.match(app, /quickIngredientNames\(key\)/);
  assert.match(app, /badge\.textContent = t\("mealMeta", \{ minutes: metadata\.minutes, difficulty: t\(`difficulty\.\$\{metadata\.difficulty\}`\) \}\)/);
  assert.match(app, /mealCard\(item, !preserveCurrentSuggestions\)/);
  assert.match(html, /id="quick-ingredients"/);
  assert.match(html, /id="alternative-menus-button"/);
  assert.match(css, /\.quick-ingredient-chips/);
  assert.match(css, /\.quick-ingredient-chip\s*\{[^}]*min-height:\s*2\.75rem;/);
  assert.match(css, /\.meal-meta/);
});

test("menu metadata is display-only and does not change the persisted suggestion shape", () => {
  const state = parseStoredState(serializeState({
    ingredients: [{ id: "egg", name: "Egg", urgency: "stable", sequence: 0 }],
    favorites: [],
    history: [{
      id: "menu-1", createdAt: "2026-08-29T00:00:00.000Z",
      suggestions: [{ id: "menu-1:suggestion-1", title: "Egg bowl", anchor: "Egg", ingredients: ["Egg"], useFirstReason: "Egg first.", method: "Cook.", minutes: 15, difficulty: "easy" }],
    }],
  }));
  assert.deepEqual(Object.keys(state.history[0].suggestions[0]).sort(), ["anchor", "id", "ingredients", "method", "title", "useFirstReason"].sort());
});

test("stored primary suggestions deterministically recover display metadata without changing history", () => {
  const generated = generateSuggestions([
    { id: "egg", name: "Egg", urgency: "use-now", sequence: 0 },
    { id: "rice", name: "Rice", urgency: "stable", sequence: 1 },
    { id: "spinach", name: "Spinach", urgency: "use-soon", sequence: 2 },
  ]);
  const bound = bindSuggestionsToMenu("menu-1", generated)[0];
  const restored = parseStoredState(serializeState({
    ingredients: [{ id: "egg", name: "Egg", urgency: "stable", sequence: 0 }], favorites: [],
    history: [{ id: "menu-1", createdAt: "2026-08-29T00:00:00.000Z", suggestions: [bound] }],
  })).history[0].suggestions[0];
  assert.deepEqual(recoverSuggestionMetadata(restored), { minutes: generated[0].minutes, difficulty: generated[0].difficulty });
  assert.equal(recoverSuggestionMetadata({ ...restored, id: "menu-1:suggestion-x" }), null);
  assert.equal(recoverSuggestionMetadata({ ...restored, ingredients: ["Egg", "Rice"] }), null);
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
  for (const asset of ["./index.html", "./privacy.html", "./styles.css", "./app.js", "./meal-engine.js", "./i18n.js", "./manifest.webmanifest"]) assert.ok(worker.includes(`"${asset}"`));
  assert.doesNotMatch(worker, /ad-boundary/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ["./icon-192.png", "./icon-512.png", "./icon.svg"]);
  assert.deepEqual(manifest.icons.map((icon) => icon.purpose), ["any", "any", "any"]);
  for (const asset of ["./icon-192.png", "./icon-512.png", "./icon.svg"]) assert.ok(worker.includes(`"${asset}"`));
});

test("service-worker cache version is bumped for the current runtime shell", async () => {
  const worker = await read("service-worker.js");
  assert.match(worker, new RegExp(`const CACHE_NAME = "fridge-menu-shell-${await runtimeShellVersion(root)}"`));
  assert.match(worker, /event\.request\.mode === "navigate" \? caches\.match\("\.\/index\.html"\) : Response\.error\(\)/);
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
  const [app, html] = await Promise.all([read("app.js"), read("index.html")]);
  assert.match(app, /favorite\.dataset\.suggestionId = suggestion\.id/);
  assert.match(app, /favorite\.setAttribute\("aria-label"/);
  assert.match(app, /focusFavoriteButton\(suggestion\.id\)/);
  assert.match(app, /row\.dataset\.ingredientId = item\.id/);
  assert.match(app, /focusIngredientAfterRemoval/);
  assert.match(app, /button\.dataset\.historyId = entry\.id/);
  assert.match(app, /function captureDynamicFocus\(\)/);
  assert.match(app, /function restoreDynamicFocus\(snapshot\)/);
  assert.ok((app.match(/refreshRenderedStatePreservingFocus\(\)/g) ?? []).length >= 4);
  assert.match(html, /id="history-heading" tabindex="-1"/);
  assert.match(app, /count\.setAttribute\("aria-label", t\("ingredientCountLabel", \{ count: ingredients\.length, max: MAX_INGREDIENTS \}\)\)/);
});

test("user values are rendered with textContent and browser workflow persists all local state", async () => {
  const [app, i18n] = await Promise.all([read("app.js"), read("i18n.js")]);
  assert.doesNotMatch(app, /innerHTML\s*=/);
  assert.match(app, /ingredientName\.textContent = item\.name/);
  assert.match(app, /heading\.textContent = suggestion\.title/);
  assert.match(app, /\{ id: `ingredient-\$\{tabId\}-\$\{nextSequence\}`, name, expiryDate, sequence: nextSequence\+\+ \}/);
  assert.match(app, /commitStateTransaction\(navigator\.locks, storage/);
  assert.match(app, /nextMenuSequence = Math\.max\(nextMenuSequence, history\.length\)/);
  assert.match(app, /favorite-button/);
  assert.match(app, /history\.push/);
  assert.match(app, /beforeinstallprompt/);
  assert.ok((app.match(/const result = await persist\(/g) ?? []).length >= 5);
  assert.match(i18n, /for this session only; safe multi-tab saving is unavailable\./);
  assert.match(app, /window\.addEventListener\("storage"/);
  assert.match(app, /event\.key !== STORAGE_KEY && event\.key !== null/);
  assert.match(app, /function syncFromStorageIfChanged\(\)/);
  assert.match(app, /const latestRaw = storage\.getItem\(STORAGE_KEY\)/);
  assert.match(app, /t\("updatedOnReturn"\)/);
  assert.match(i18n, /Updated from saved data after returning to this tab\./);
  assert.match(i18n, /Another tab changed saved data/);
});

test("package has no dependency or install surface", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ["android:aab", "android:evidence", "build", "ci:receipt", "release:manifest", "start", "store-assets", "store-screenshot", "test", "test:browser", "verify:aab-repro", "verify:policy-url", "verify:release"]);
});

test("verify:release builds the AAB before manifest and Android evidence", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const steps = pkg.scripts["verify:release"].split(" && ");
  const build = steps.indexOf("npm run build");
  const browser = steps.indexOf("npm run test:browser");
  const aab = steps.indexOf("npm run verify:aab-repro");

  assert.notEqual(browser, -1, "verify:release must execute real local browser interactions");
  assert.ok(build < browser, "browser interactions must run against a fresh dist build");
  assert.ok(browser < aab, "browser interactions must pass before Android packaging");
  assert.notEqual(aab, -1, "verify:release must produce the AAB");
  assert.ok(aab < steps.indexOf("node scripts/release-manifest.mjs"));
  assert.ok(aab < steps.indexOf("npm run android:evidence"));
});

test("release checks are computed from source files and executed commands", async () => {
  const { computeStaticReleaseChecks } = await import("../scripts/release-checks.mjs");
  const fixture = {
    css: ".remove-button { min-width: 2.75rem; min-height: 2.75rem; }",
    androidManifest: "<manifest><application /></manifest>",
    mainActivity: 'private static final String APP_ENTRY = "file:///android_asset/pwa/index.html"; view.loadUrl(APP_ENTRY);',
    serviceWorker: 'const APP_SHELL = Object.freeze(["./index.html"]); cache.addAll(APP_SHELL);',
    adBoundary: "networkRequests: false; sdkLoaded: false; productionIdentifier: null;",
  };
  const passing = computeStaticReleaseChecks(fixture);
  assert.deepEqual(passing, { touch_target_static: "PASS", privacy_security_static: "PASS", offline_static: "PASS" });
  assert.equal(computeStaticReleaseChecks({ ...fixture, css: ".remove-button { padding: 0; }" }).touch_target_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, css: `${fixture.css} .remove-button { max-width: 1px; }` }).touch_target_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, css: ".remove-button { min-width: 2.75rem; min-height: 2.75rem; transform: scale(0.01); }" }).touch_target_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, androidManifest: "<uses-permission />" }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: 'fetch("https://example.test")' }).offline_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: "fetch(String.fromCharCode(104,116,116,112))" }).offline_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, serviceWorker: 'globalThis["fe" + "tch"]("dynamic")' }).offline_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, mainActivity: `${fixture.mainActivity} view.loadUrl(String.fromCharCode(104,116,116,112));` }).privacy_security_static, "FAIL");
  assert.equal(computeStaticReleaseChecks({ ...fixture, mainActivity: `${fixture.mainActivity} view.loadDataWithBaseURL("dynamic", "", "text/html", "UTF-8", null);` }).privacy_security_static, "FAIL");
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
  const verificationMetadata = await read("android/gradle/verification-metadata.xml");
  const wrapperJar = await readFile(resolve(root, "android/gradle/wrapper/gradle-wrapper.jar"));

  assert.equal(pkg.scripts["android:aab"], "node scripts/android-package.mjs");
  assert.equal(pkg.scripts["verify:aab-repro"], "node scripts/verify-aab-repro.mjs");
  assert.equal(pkg.scripts["release:manifest"], "node scripts/release-manifest.mjs");
  assert.equal(pkg.scripts["store-assets"], "node scripts/generate-store-assets.mjs");
  assert.equal(pkg.scripts["store-screenshot"], "node scripts/capture-store-assets.mjs");
  assert.equal(pkg.scripts["test:browser"], "node scripts/capture-store-assets.mjs --verify-dom-only");
  assert.match(capture, /async function stopChild\(child\)/);
  assert.match(capture, /await stopChild\(browser\)/);
  assert.match(capture, /await rm\(profile, \{ recursive: true, force: true, maxRetries: 5, retryDelay: 100 \}\)/);
  assert.ok(pkg.scripts["verify:release"].includes("npm test"));
  assert.ok(pkg.scripts["verify:release"].includes("npm run build"));
  assert.match(androidBuild, /compileSdk\s*=\s*36/);
  assert.match(androidBuild, /targetSdk\s*=\s*36/);
  for (const variable of ["FRIDGE_MENU_KEYSTORE_PATH", "FRIDGE_MENU_KEYSTORE_PASSWORD", "FRIDGE_MENU_KEY_ALIAS", "FRIDGE_MENU_KEY_PASSWORD"]) {
    assert.match(androidBuild, new RegExp(variable));
  }
  assert.match(androidBuild, /configuredKeystore\.toPath\(\)\.startsWith\(rootProject\.projectDir\.parentFile\.canonicalFile\.toPath\(\)\)/);
  assert.match(androidBuild, /Release keystore must be outside the repository\./);
  assert.match(androidBuild, /applicationId\s*=\s*"com.learnershift.fridgemenu"/);
  assert.match(androidRootBuild, /com\.android\.application"\) version "8\.9\.1"/);
  assert.match(packaging, /FRIDGE_MENU_ANDROID_SDK/);
  assert.doesNotMatch(packaging, /FRIDGE_MENU_GRADLE|\? "gradle\.bat" : "gradle"/);
  assert.match(packaging, /inspectAabSigning/);
  assert.match(packaging, /--dependency-verification", "strict/);
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
  assert.match(capture, /Emulation\.setEmulatedMedia/);
  assert.match(capture, /prefers-reduced-motion/);
  assert.match(capture, /document\.fonts\.ready/);
  assert.match(capture, /Page\.addScriptToEvaluateOnNewDocument/);
  assert.match(capture, /2026-08-25T08:00:00\.000Z/);
  assert.match(capture, /ingredient-expiry[^\n]*2099-01-02/);
  assert.match(capture, /FRIDGE_MENU_CHROME_BIN/);
  assert.match(capture, /--verify-dom-only/);
  assert.doesNotMatch(capture, /verifyDomOnly && !process\.env\.FRIDGE_MENU_CAPTURE_URL/);
  assert.match(capture, /STORE_UX_INTERACTION_OK/);
  assert.match(capture, /exceptionDetails/);
  assert.match(capture, /quick-ingredient-chip/);
  assert.match(capture, /alternative-menus-button/);
  for (const name of ["01-empty-home", "02-use-first-list", "03-menu-results", "04-favorites-history"]) {
    assert.match(capture, new RegExp(name));
  }
  assert.match(wrapperProperties, /gradle-8\.11\.1-bin\.zip/);
  assert.match(wrapperProperties, /distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6/);
  assert.equal(createHash("sha256").update(wrapperJar).digest("hex"), "2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046");
  assert.match(verificationMetadata, /<verify-metadata>true<\/verify-metadata>/);
  assert.match(verificationMetadata, /<component group="com\.android\.tools\.build" name="gradle" version="8\.9\.1">/);
  assert.match(verificationMetadata, /<sha256 value="[0-9a-f]{64}"/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run test:browser/);
  assert.match(workflow, /npm run verify:release/);
  assert.match(workflow, /npm run ci:receipt/);
  assert.match(workflow, /FRIDGE_MENU_REQUIRE_UNSIGNED:\s*["']?1/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /unsigned-release-proof-\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(privacy, /no account, analytics, advertising SDK, tracking, or remote API/i);
  assert.match(listing, /Short description/);
  assert.doesNotMatch(listing, /choose what needs using first/i);
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
    "HOLD — owner resolution required", "Play App Signing", "upload key", "zero OWNER_REQUIRED markers",
    "tester list", "opt-in URL", "matching Google account", "delivered version", "country availability",
    "target track", "Git SHA", "AAB SHA-256", "approver", "timestamp", "authority evidence ID",
  ]) assert.match(handoff, new RegExp(required, "i"), `handoff missing fail-closed field: ${required}`);
  for (const separateApproval of ["policy hosting/publication", "signing", "internal-test upload", "production submission", "app publication"]) {
    assert.match(handoff, new RegExp(separateApproval, "i"), `handoff missing separate approval: ${separateApproval}`);
  }
  const sequence = handoff.slice(handoff.indexOf("## Submission sequence"), handoff.indexOf("## Separate approval receipts"));
  const orderedGates = [
    "Policy hosting/publication approval", "Signing approval", "Internal-test upload approval",
    "Health declaration resolution", "Production submission approval", "App publication approval",
  ];
  let priorIndex = -1;
  for (const gate of orderedGates) {
    const gateIndex = sequence.indexOf(gate);
    assert.ok(gateIndex > priorIndex, `submission gate must appear in order: ${gate}`);
    priorIndex = gateIndex;
  }
  assert.match(handoff, /LOCAL_SIMULATION_ONLY[^.]*not current CI evidence/i);
  assert.match(handoff, /run URL[^.]*Git SHA[^.]*AAB SHA-256[^.]*exact candidate/i);
  assert.match(qa, /internal-test upload approval[^.]*policy and signing predecessor receipt IDs/i);
  assert.doesNotMatch(qa, /internal-test upload approval[^.]*Health-resolution predecessor receipt IDs/i);
  assert.match(qa, /AAB SHA-256 when applicable/i);
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
  assert.match(workflow, /approved_sha:/);
  assert.match(workflow, /approval_receipt:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /inputs\.approved_sha == github\.sha/);
  assert.match(workflow, /vars\.OWNER_APPROVED_PAGES_SHA == github\.sha/);
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
  const [icon, runtimeIcon] = await Promise.all([
    readFile(resolve(root, "release/store-assets/fridge-menu-icon-512.png")),
    readFile(resolve(root, "icon-512.png")),
  ]);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const store = decodeUnfilteredPng(icon);
  const runtime = decodeUnfilteredPng(runtimeIcon);
  assert.equal(store.width, 512);
  assert.equal(store.height, 512);
  assert.equal(store.colorType, 6, "Play icon must be a 32-bit RGBA PNG");
  assert.equal(runtime.colorType, 2, "PWA icon must remain truecolor RGB");
  const storeRgb = Buffer.alloc(runtime.pixels.length);
  for (let source = 0, target = 0; source < store.pixels.length; source += 4, target += 3) {
    storeRgb[target] = store.pixels[source];
    storeRgb[target + 1] = store.pixels[source + 1];
    storeRgb[target + 2] = store.pixels[source + 2];
    assert.equal(store.pixels[source + 3], 255, "Play icon alpha must be fully opaque");
  }
  assert.deepEqual(storeRgb, runtime.pixels, "Play and PWA icons must use the same canonical RGB artwork");
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
    ".github", ".gitignore", "AGENTS.md", "README.md", "android", "app.js", "i18n.js", "icon-192.png", "icon-512.png", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "package.json", "privacy.html", "release", "scripts", "service-worker.js", "styles.css", "tests",
  ]);
  if (top.includes("dist")) assert.deepEqual((await readdir(resolve(root, "dist"))).sort(), ["app.js", "i18n.js", "icon-192.png", "icon-512.png", "icon.svg", "index.html", "manifest.webmanifest", "meal-engine.js", "privacy.html", "service-worker.js", "styles.css"]);
});
