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
  const validation = validateIngredients(records, "2026-08-01");
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "expired");
  assert.equal(validation.message, "Remove expired ingredients before making a menu.");
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

test("validation enforces the 3-8 boundary and reports stable codes", () => {
  assert.equal(MIN_INGREDIENTS, 3);
  assert.equal(MAX_INGREDIENTS, 8);
  assert.equal(validateIngredients(sample.slice(0, 2)).ok, false);
  assert.equal(validateIngredients(sample.slice(0, 2)).code, "count-out-of-range");
  assert.equal(validateIngredients(sample.slice(0, 3)).ok, true);
  assert.equal(validateIngredients(sample.slice(0, 3)).code, "ready");
  const nine = Array.from({ length: 9 }, (_, sequence) => ({ id: String(sequence), name: `item ${sequence}`, urgency: "stable", sequence }));
  assert.equal(validateIngredients(nine.slice(0, 8)).ok, true);
  assert.equal(validateIngredients(nine).ok, false);
});

test("duplicates are rejected case-insensitively after normalization", () => {
  const duplicate = [...sample.slice(0, 3), { id: "x", name: " spinach", urgency: "stable", sequence: 4 }];
  const validation = validateIngredients(duplicate);
  assert.equal(validation.code, "duplicate");
  assert.equal(validation.params.name, "spinach");
  assert.match(validation.message, /already/);
  assert.deepEqual(generateSuggestions(duplicate), []);
});

test("use-first sorting prioritizes urgency then insertion sequence", () => {
  assert.deepEqual(sortUseFirst(sample).map((item) => item.name), ["Spinach", "Tofu", "Mushrooms", "Rice"]);
});

test("suggestions are deterministic, distinct, and keep the use-first ingredient as every anchor", () => {
  const first = generateSuggestions(sample);
  const second = generateSuggestions(structuredClone(sample));
  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.anchor), ["Spinach", "Spinach", "Spinach"]);
  assert.equal(new Set(first.map((item) => item.title)).size, 3, "the three menu titles must be genuinely different");
  assert.equal(new Set(first.map((item) => item.method)).size, 3, "the three cooking methods must be genuinely different");
  for (const suggestion of first) {
    assert.deepEqual(suggestion.ingredients, ["Spinach", "Tofu", "Mushrooms", "Rice"]);
    assert.ok(suggestion.minutes >= 10 && suggestion.minutes <= 30);
    assert.ok(["easy", "normal"].includes(suggestion.difficulty));
  }
});

test("suggestions support a deterministic offset for the next three ranked templates", () => {
  const first = generateSuggestions(sample, undefined, "en");
  const alternatives = generateSuggestions(sample, undefined, "en", { offset: 3 });
  assert.equal(alternatives.length, 3);
  assert.deepEqual(alternatives, generateSuggestions(structuredClone(sample), undefined, "en", { offset: 3 }));
  assert.deepEqual(alternatives.map((item) => item.id), ["suggestion-4", "suggestion-5", "suggestion-6"]);
  assert.ok(alternatives.every((item) => !first.some((primary) => primary.title === item.title)));
});

test("suggestions adapt to what the ingredients actually are", () => {
  const riceAndEgg = generateSuggestions([
    { id: "a", name: "Egg", urgency: "use-now", sequence: 0 },
    { id: "b", name: "Rice", urgency: "stable", sequence: 1 },
    { id: "c", name: "Spinach", urgency: "use-soon", sequence: 2 },
  ]);
  assert.ok(riceAndEgg.some((item) => /fried rice/i.test(item.title)), "rice plus egg must surface a fried-rice direction");

  const noodles = generateSuggestions([
    { id: "a", name: "Noodles", urgency: "stable", sequence: 0 },
    { id: "b", name: "Mushrooms", urgency: "use-now", sequence: 1 },
    { id: "c", name: "Scallion", urgency: "use-soon", sequence: 2 },
  ]);
  assert.ok(noodles.some((item) => /Noodles/.test(item.title)), "noodle ingredients must surface a noodle direction");

  const vegetablesOnly = generateSuggestions([
    { id: "a", name: "Beans", urgency: "use-now", sequence: 0 },
    { id: "b", name: "Corn", urgency: "use-soon", sequence: 1 },
    { id: "c", name: "Tomatoes", urgency: "stable", sequence: 2 },
  ]);
  assert.ok(vegetablesOnly.some((item) => /salad/i.test(item.title)), "vegetable-only lists must surface a fresh direction");
});

test("unknown ingredients still produce three distinct menus", () => {
  const unknown = generateSuggestions([
    { id: "a", name: "Mystery jar", urgency: "use-now", sequence: 0 },
    { id: "b", name: "Leftover box", urgency: "use-soon", sequence: 1 },
    { id: "c", name: "Frozen block", urgency: "stable", sequence: 2 },
  ]);
  assert.equal(unknown.length, 3);
  assert.equal(new Set(unknown.map((item) => item.title)).size, 3);
  assert.equal(new Set(unknown.map((item) => item.method)).size, 3);
});

test("Korean ingredient names are understood and Korean output is Korean", () => {
  const records = [
    { id: "a", name: "계란", urgency: "use-now", sequence: 0 },
    { id: "b", name: "밥", urgency: "stable", sequence: 1 },
    { id: "c", name: "김치", urgency: "use-soon", sequence: 2 },
  ];
  const korean = generateSuggestions(records, "2026-08-01", "ko");
  assert.equal(korean.length, 3);
  assert.ok(korean.some((item) => item.title.includes("볶음밥")), "밥과 계란은 볶음밥 방향을 만들어야 한다");
  assert.ok(korean.some((item) => item.title.includes("찌개")), "김치는 찌개 방향을 만들어야 한다");
  for (const suggestion of korean) {
    assert.match(suggestion.title, /[가-힣]/);
    assert.match(suggestion.method, /[가-힣]/);
    assert.match(suggestion.useFirstReason, /[가-힣]/);
  }
  const english = generateSuggestions(records, "2026-08-01", "en");
  assert.ok(english.some((item) => /fried rice/i.test(item.title)), "한국어 재료 이름도 영어 로케일에서 인식되어야 한다");
  assert.deepEqual(korean.map((item) => item.ingredients), english.map((item) => item.ingredients));
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
  assert.deepEqual(first.map((item) => item.anchor), ["Beans", "Beans", "Beans"]);
  assert.ok(first.every((item) => item.ingredients.join(",") === "Beans,Corn,Tomatoes"));
  const available = new Set(records.map((item) => item.name));
  for (const suggestion of first) {
    assert.ok(suggestion.ingredients.every((name) => available.has(name)));
    assert.doesNotMatch(`${suggestion.title} ${suggestion.method}`, /grain|dressing|seasoning|oil|salt/i);
  }
});

const VARIETY_COMBOS = Object.freeze([
  ["Rice", "Egg", "Spinach"], ["Rice", "Kimchi", "Pork"], ["Noodles", "Mushrooms", "Scallion"],
  ["Noodles", "Chicken", "Cabbage"], ["Bread", "Cheese", "Tomatoes"], ["Bread", "Egg", "Milk"],
  ["Tofu", "Zucchini", "Carrot"], ["Beans", "Corn", "Tomatoes"], ["Kimchi", "Tofu", "Onion"],
  ["Rice", "Mushrooms", "Carrot"], ["Egg", "Cheese", "Spinach"], ["Chicken", "Beef", "Onion"],
  ["Bread", "Lettuce", "Ham"], ["Noodles", "Kimchi", "Egg"], ["Potato", "Onion", "Carrot", "Cabbage"],
  ["Rice", "Tuna", "Cucumber"], ["Milk", "Broccoli", "Cheese"], ["Squid", "Pepper", "Onion"],
  ["Mystery jar", "Leftover box", "Frozen block"], ["Rice", "Noodles", "Egg", "Kimchi", "Tofu"],
]);

function comboRecords(names) {
  return names.map((name, index) => ({ id: String(index), name, urgency: index === 0 ? "use-now" : "stable", sequence: index }));
}

test("the template pool stays deterministic across many ingredient combinations", () => {
  for (const names of VARIETY_COMBOS) {
    const records = comboRecords(names);
    for (const offset of [0, 3]) {
      const suggestions = generateSuggestions(records, "2026-08-01", "en", { offset });
      assert.deepEqual(suggestions, generateSuggestions(structuredClone(records), "2026-08-01", "en", { offset }),
        `same ingredients must produce the same menus: ${names.join(", ")} offset=${offset}`);
    }
  }
});

test("every generated menu keeps the ingredient and vocabulary boundary", () => {
  for (const names of VARIETY_COMBOS) {
    const records = comboRecords(names);
    for (const locale of ["en", "ko"]) {
      for (const offset of [0, 3]) {
        for (const suggestion of generateSuggestions(records, "2026-08-01", locale, { offset })) {
          assert.doesNotMatch(`${suggestion.title} ${suggestion.method}`, /grain|dressing|seasoning|oil|salt/i,
            `menu text must stay inside the generic kitchen vocabulary: ${suggestion.title}`);
          assert.ok(suggestion.minutes >= 10 && suggestion.minutes <= 30);
          assert.ok(["easy", "normal"].includes(suggestion.difficulty));
          assert.deepEqual(suggestion.ingredients, names);
        }
      }
    }
  }
});

test("the first three menus stay distinct for every combination", () => {
  for (const names of VARIETY_COMBOS) {
    const suggestions = generateSuggestions(comboRecords(names), "2026-08-01", "en");
    assert.equal(suggestions.length, 3, `three menus expected for ${names.join(", ")}`);
    assert.equal(new Set(suggestions.map((item) => item.title)).size, 3, `distinct titles expected for ${names.join(", ")}`);
    assert.equal(new Set(suggestions.map((item) => item.method)).size, 3, `distinct methods expected for ${names.join(", ")}`);
  }
});

test("the expanded template pool widens the reachable menu variety", () => {
  const titles = new Set();
  for (const names of VARIETY_COMBOS) {
    const records = comboRecords(names);
    for (const offset of [0, 3]) {
      for (const suggestion of generateSuggestions(records, "2026-08-01", "en", { offset })) titles.add(suggestion.title);
    }
  }
  assert.ok(titles.size >= 95, `the ten-template pool reached 70 distinct titles here; expected at least 95, got ${titles.size}`);
});

test("alternative menus never repeat the primary titles", () => {
  for (const names of VARIETY_COMBOS) {
    const records = comboRecords(names);
    for (const locale of ["en", "ko"]) {
      const primary = generateSuggestions(records, "2026-08-01", locale).map((item) => item.title);
      const alternatives = generateSuggestions(records, "2026-08-01", locale, { offset: 3 }).map((item) => item.title);
      assert.equal(new Set([...primary, ...alternatives]).size, primary.length + alternatives.length,
        `primary and alternative titles must all differ: ${names.join(", ")} (${locale})`);
    }
  }
});

test("the store capture scenario keeps alternatives distinct from the primary menus", () => {
  const scenarios = [["ko", ["계란", "밥", "시금치"]], ["en", ["Egg", "Rice", "Spinach"]]];
  for (const [locale, names] of scenarios) {
    const records = names.map((name, sequence) => ({ id: `quick-${sequence}`, name, urgency: "stable", sequence }));
    const primary = generateSuggestions(records, undefined, locale).map((item) => item.title);
    const alternatives = generateSuggestions(records, undefined, locale, { offset: 3 }).map((item) => item.title);
    assert.equal(primary.length, 3, `three primary menus expected (${locale})`);
    assert.equal(alternatives.length, 3, `three alternative menus expected (${locale})`);
    for (const title of alternatives) {
      assert.ok(!primary.includes(title), `alternative menu repeats a primary title: ${title} (${locale})`);
    }
  }
});
