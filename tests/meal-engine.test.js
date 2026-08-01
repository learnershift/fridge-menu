import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_INGREDIENTS,
  MIN_INGREDIENTS,
  generateSuggestions,
  getExpiryStatus,
  normalizeName,
  sortUseFirst,
  validateIngredients,
} from "../meal-engine.js";

const sample = [
  { id: "a", name: "Rice", urgency: "stable", sequence: 0 },
  { id: "b", name: " Spinach ", urgency: "use-now", sequence: 1 },
  { id: "c", name: "Mushrooms", urgency: "use-soon", sequence: 2 },
  { id: "d", name: "Tofu", urgency: "use-now", sequence: 3 },
];

test("expiry status follows exact local calendar-day boundaries", () => {
  const today = "2026-08-01";
  assert.equal(getExpiryStatus("2026-07-31", today), "expired");
  assert.equal(getExpiryStatus("2026-08-01", today), "use-now");
  assert.equal(getExpiryStatus("2026-08-02", today), "use-now");
  assert.equal(getExpiryStatus("2026-08-03", today), "use-soon");
  assert.equal(getExpiryStatus("2026-08-04", today), "use-soon");
  assert.equal(getExpiryStatus("2026-08-05", today), "stable");
});

test("expired ingredients stay visible in ordering but cannot generate meal guidance", () => {
  const records = [
    { id: "expired", name: "Spinach", expiryDate: "2026-07-31", sequence: 0 },
    { id: "today", name: "Tofu", expiryDate: "2026-08-01", sequence: 1 },
    { id: "later", name: "Rice", expiryDate: "2026-08-05", sequence: 2 },
  ];
  assert.deepEqual(sortUseFirst(records, "2026-08-01").map((item) => item.urgency), ["expired", "use-now", "stable"]);
  assert.deepEqual(validateIngredients(records, "2026-08-01"), {
    ok: false,
    message: "Remove expired ingredients before making a menu.",
  });
  assert.deepEqual(generateSuggestions(records, "2026-08-01"), []);
});

test("use-first sorting uses expiry date, then insertion order, and derives status", () => {
  const records = [
    { id: "late", name: "Rice", expiryDate: "2026-08-10", sequence: 0 },
    { id: "today-b", name: "Tofu", expiryDate: "2026-08-01", sequence: 3 },
    { id: "expired", name: "Spinach", expiryDate: "2026-07-31", sequence: 1 },
    { id: "today-a", name: "Mushrooms", expiryDate: "2026-08-01", sequence: 2 },
  ];
  const sorted = sortUseFirst(records, "2026-08-01");
  assert.deepEqual(sorted.map((item) => item.id), ["expired", "today-a", "today-b", "late"]);
  assert.deepEqual(sorted.map((item) => item.urgency), ["expired", "use-now", "use-now", "stable"]);
});

test("normalization trims and collapses ASCII whitespace", () => {
  assert.equal(normalizeName("  green\t  beans\n"), "green beans");
});

test("validation enforces the 3-8 boundary", () => {
  assert.equal(MIN_INGREDIENTS, 3);
  assert.equal(MAX_INGREDIENTS, 8);
  assert.equal(validateIngredients(sample.slice(0, 2)).ok, false);
  assert.equal(validateIngredients(sample.slice(0, 3)).ok, true);
  const nine = Array.from({ length: 9 }, (_, sequence) => ({ id: String(sequence), name: `item ${sequence}`, urgency: "stable", sequence }));
  assert.equal(validateIngredients(nine.slice(0, 8)).ok, true);
  assert.equal(validateIngredients(nine).ok, false);
});

test("duplicates are rejected case-insensitively after normalization", () => {
  const duplicate = [...sample.slice(0, 3), { id: "x", name: " spinach", urgency: "stable", sequence: 4 }];
  assert.match(validateIngredients(duplicate).message, /already/);
  assert.deepEqual(generateSuggestions(duplicate), []);
});

test("use-first sorting prioritizes urgency then insertion sequence", () => {
  assert.deepEqual(sortUseFirst(sample).map((item) => item.name), ["Spinach", "Tofu", "Mushrooms", "Rice"]);
});

test("suggestions are deterministic, three in count, and rotate the anchor", () => {
  const first = generateSuggestions(sample);
  const second = generateSuggestions(structuredClone(sample));
  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.anchor), ["Spinach", "Tofu", "Mushrooms"]);
  assert.deepEqual(first[0].ingredients, ["Spinach", "Tofu", "Mushrooms", "Rice"]);
});

test("date-backed suggestions are deterministic and mention no unavailable food", () => {
  const records = [
    { id: "a", name: "Tomatoes", expiryDate: "2026-08-03", sequence: 0 },
    { id: "b", name: "Beans", expiryDate: "2026-08-01", sequence: 1 },
    { id: "c", name: "Corn", expiryDate: "2026-08-02", sequence: 2 },
  ];
  const first = generateSuggestions(records, "2026-08-01");
  assert.equal(first.length, 3);
  assert.deepEqual(first, generateSuggestions(structuredClone(records), "2026-08-01"));
  const available = new Set(records.map((item) => item.name));
  for (const suggestion of first) {
    assert.ok(suggestion.ingredients.every((name) => available.has(name)));
    assert.doesNotMatch(`${suggestion.title} ${suggestion.method}`, /grain|dressing|seasoning|oil|salt/i);
  }
});
