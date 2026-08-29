export const MIN_INGREDIENTS = 3;
export const MAX_INGREDIENTS = 8;
export const SUPPORTED_MEAL_LOCALES = Object.freeze(["en", "ko"]);

const URGENCY_RANK = Object.freeze({ expired: -1, "use-now": 0, "use-soon": 1, stable: 2 });

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function calendarDayNumber(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(timestamp / 86_400_000);
}

export function getExpiryStatus(expiryDate, today = localToday()) {
  const expiryDay = calendarDayNumber(expiryDate);
  const todayDay = calendarDayNumber(today);
  if (expiryDay === null || todayDay === null) return "invalid";
  const remaining = expiryDay - todayDay;
  if (remaining < 0) return "expired";
  if (remaining <= 1) return "use-now";
  if (remaining <= 3) return "use-soon";
  return "stable";
}

export function normalizeName(value) {
  return String(value ?? "").trim().replace(/[\t\n\r ]+/g, " ");
}

const VALIDATION_MESSAGES = Object.freeze({
  "not-a-list": "Ingredients must be a list.",
  "count-out-of-range": `Add between ${MIN_INGREDIENTS} and ${MAX_INGREDIENTS} ingredients to make a menu.`,
  "missing-name": "Every ingredient needs a name.",
  "invalid-urgency": "Every ingredient needs a valid expiry date.",
  expired: "Remove expired ingredients before making a menu.",
  duplicate: "“{name}” is already in your fridge.",
  ready: "Ready.",
});

function validationResult(ok, code, params = {}) {
  const message = VALIDATION_MESSAGES[code].replace(/\{(\w+)\}/g, (match, key) => String(params[key] ?? match));
  return params.name ? { ok, code, message, params } : { ok, code, message };
}

export function validateIngredients(records, today = localToday()) {
  if (!Array.isArray(records)) return validationResult(false, "not-a-list");
  if (records.length < MIN_INGREDIENTS || records.length > MAX_INGREDIENTS) {
    return validationResult(false, "count-out-of-range");
  }
  const names = new Set();
  for (const record of records) {
    const name = normalizeName(record?.name);
    const derived = getExpiryStatus(record?.expiryDate, today);
    const urgency = derived === "invalid" ? record?.urgency : derived;
    if (!name) return validationResult(false, "missing-name");
    if (!(urgency in URGENCY_RANK)) return validationResult(false, "invalid-urgency");
    if (urgency === "expired") return validationResult(false, "expired");
    const key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) return validationResult(false, "duplicate", { name });
    names.add(key);
  }
  return validationResult(true, "ready");
}

export function sortUseFirst(records, today = localToday()) {
  return records.map((record, index) => {
    const hasDate = calendarDayNumber(record.expiryDate) !== null;
    return {
      id: String(record.id ?? index),
      name: normalizeName(record.name),
      expiryDate: hasDate ? record.expiryDate : undefined,
      urgency: hasDate ? getExpiryStatus(record.expiryDate, today) : record.urgency,
      sequence: Number.isInteger(record.sequence) ? record.sequence : index,
    };
  }).sort((a, b) => {
    if (a.expiryDate && b.expiryDate) return a.expiryDate.localeCompare(b.expiryDate) || a.sequence - b.sequence;
    return (URGENCY_RANK[a.urgency] ?? 99) - (URGENCY_RANK[b.urgency] ?? 99) || a.sequence - b.sequence;
  });
}

// --- Ingredient understanding -------------------------------------------------
// Each matcher assigns one category and one flag. The first matcher that hits
// wins, so more specific entries (eggplant before egg) come first. English
// keywords match on word boundaries; Korean keywords match as substrings.

const CATEGORY_MATCHERS = Object.freeze([
  { flag: "vegetable", category: "vegetable", en: ["eggplant", "aubergine"], ko: ["가지"] },
  { flag: "egg", category: "protein", en: ["egg"], ko: ["계란", "달걀"] },
  { flag: "kimchi", category: "vegetable", en: ["kimchi"], ko: ["김치"] },
  { flag: "rice", category: "carb", en: ["rice"], ko: ["밥", "햇반", "쌀"] },
  {
    flag: "noodle", category: "carb",
    en: ["noodle", "noodles", "pasta", "spaghetti", "ramen", "udon", "soba", "macaroni"],
    ko: ["면", "국수", "라면", "우동", "소면", "칼국수", "파스타", "스파게티", "당면"],
  },
  {
    flag: "bread", category: "carb",
    en: ["bread", "toast", "baguette", "tortilla", "bun", "bagel"],
    ko: ["빵", "식빵", "베이글", "또띠아", "모닝빵", "바게트"],
  },
  {
    flag: "protein", category: "protein",
    en: ["tofu", "chicken", "pork", "beef", "fish", "salmon", "tuna", "mackerel", "shrimp", "prawn", "ham", "bacon",
      "sausage", "spam", "meat", "crab", "squid", "anchovy", "turkey", "duck", "lamb", "steak"],
    ko: ["두부", "닭", "돼지", "소고기", "쇠고기", "생선", "연어", "참치", "고등어", "새우", "햄", "베이컨", "소시지",
      "소세지", "스팸", "고기", "오징어", "멸치", "삼겹살", "목살", "불고기", "어묵", "맛살", "안심", "등심", "차돌"],
  },
  {
    flag: "dairy", category: "dairy",
    en: ["cheese", "milk", "butter", "yogurt", "yoghurt", "cream"],
    ko: ["치즈", "우유", "버터", "요거트", "요구르트", "생크림"],
  },
  {
    flag: "vegetable", category: "vegetable",
    en: ["spinach", "onion", "scallion", "shallot", "mushroom", "mushrooms", "tomato", "tomatoes", "carrot", "zucchini",
      "cabbage", "cucumber", "broccoli", "lettuce", "pepper", "sprout", "sprouts", "garlic", "radish", "corn", "bean",
      "beans", "pea", "peas", "kale", "celery", "leek", "pumpkin", "squash", "potato", "chive", "chives", "asparagus",
      "cauliflower", "greens", "perilla"],
    ko: ["시금치", "양파", "대파", "쪽파", "버섯", "토마토", "당근", "애호박", "호박", "양배추", "배추", "오이",
      "브로콜리", "상추", "고추", "피망", "파프리카", "콩나물", "숙주", "마늘", "옥수수", "콩", "완두", "케일",
      "셀러리", "부추", "감자", "고구마", "깻잎", "나물", "청경채", "단호박", "파"],
  },
]);

function classifyIngredientName(name) {
  const lower = name.toLocaleLowerCase("en-US");
  for (const matcher of CATEGORY_MATCHERS) {
    const englishHit = matcher.en.some((keyword) => new RegExp(`(?:^|[^a-z])${keyword}(?:$|[^a-z])`, "i").test(` ${lower} `));
    const koreanHit = matcher.ko.some((keyword) => lower.includes(keyword));
    if (englishHit || koreanHit) return { category: matcher.category, flag: matcher.flag };
  }
  return { category: "other", flag: "other" };
}

function buildProfile(ordered) {
  const items = ordered.map((item) => ({ ...item, ...classifyIngredientName(item.name) }));
  const firstWithFlag = (flag) => items.find((item) => item.flag === flag);
  const inCategory = (category) => items.filter((item) => item.category === category);
  return {
    items,
    anchor: items[0],
    names: items.map((item) => item.name),
    rice: firstWithFlag("rice"),
    noodle: firstWithFlag("noodle"),
    bread: firstWithFlag("bread"),
    egg: firstWithFlag("egg"),
    kimchi: firstWithFlag("kimchi"),
    proteins: items.filter((item) => item.category === "protein"),
    vegetables: inCategory("vegetable"),
    dairy: inCategory("dairy"),
  };
}

// --- Localized text helpers ---------------------------------------------------

function koParticle(word, withFinalConsonant, withoutFinalConsonant) {
  const code = word.charCodeAt(word.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return (code - 0xac00) % 28 ? withFinalConsonant : withoutFinalConsonant;
  }
  return withoutFinalConsonant;
}

const koObject = (word) => `${word}${koParticle(word, "을", "를")}`;

function listNames(names) {
  return names.join(", ");
}

function without(names, excluded) {
  const excludedKeys = new Set(excluded.map((name) => name.toLocaleLowerCase("en-US")));
  return names.filter((name) => !excludedKeys.has(name.toLocaleLowerCase("en-US")));
}

const URGENCY_TEXT = Object.freeze({
  en: { "use-now": "use now", "use-soon": "use soon", stable: "stable" },
  ko: { "use-now": "오늘·내일까지 사용", "use-soon": "3일 안에 사용", stable: "여유 있음" },
});

function useFirstReason(locale, anchor) {
  if (locale === "ko") {
    return `지금 목록에서 가장 먼저 써야 하는 ${anchor.name}부터 시작해요(${URGENCY_TEXT.ko[anchor.urgency]}). 나머지 재료도 급한 순서대로 담았어요.`;
  }
  return `${anchor.name} leads because it is ${URGENCY_TEXT.en[anchor.urgency]}; the rest stay in a stable use-first order.`;
}

// --- Meal templates -----------------------------------------------------------
// Every template stays deterministic: eligibility and scores depend only on the
// classified ingredient profile, and text references only ingredient names the
// user actually has plus generic kitchen words (pan, pot, water, heat).

const MEAL_TEMPLATES = Object.freeze([
  {
    id: "fried-rice",
    order: 0,
    minutes: 20,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.rice),
    score: (profile) => 20 + (profile.egg ? 3 : 0) + (profile.kimchi ? 3 : 0) + (profile.proteins.length ? 3 : 0),
    text(profile, locale) {
      const rice = profile.rice.name;
      const highlight = profile.anchor.name !== rice ? profile.anchor.name : without(profile.names, [rice])[0];
      const leftovers = without(profile.names, [rice, highlight]);
      if (locale === "ko") {
        const finish = leftovers.length ? ` 남은 재료(${listNames(leftovers)})도 순서대로 넣어 함께 볶아 주세요.` : "";
        return {
          title: `${highlight} 볶음밥`,
          method: `달군 팬에 ${koObject(highlight)} 먼저 볶고, ${koObject(rice)} 넣어 고루 볶아 주세요.${finish}`,
        };
      }
      const finish = leftovers.length ? ` fold in ${listNames(leftovers)} in use-first order` : " keep tossing until everything is evenly mixed";
      return {
        title: `${highlight} fried rice`,
        method: `Stir ${highlight} in a hot pan, add ${rice}, and${finish}.`,
      };
    },
  },
  {
    id: "noodle-bowl",
    order: 1,
    minutes: 15,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.noodle),
    score: (profile) => 18 + (profile.egg ? 2 : 0) + (profile.vegetables.length ? 2 : 0),
    text(profile, locale) {
      const noodle = profile.noodle.name;
      const highlight = profile.anchor.name !== noodle ? profile.anchor.name : without(profile.names, [noodle])[0];
      const leftovers = without(profile.names, [noodle, highlight]);
      if (locale === "ko") {
        const finish = leftovers.length ? ` 남은 재료(${listNames(leftovers)})까지 얹으면 완성이에요.` : "";
        return {
          title: `${highlight} ${noodle}`,
          method: `${koObject(noodle)} 삶는 동안 ${koObject(highlight)} 준비하고, 삶은 ${noodle} 위에 올려 주세요.${finish}`,
        };
      }
      const finish = leftovers.length ? `, then top with ${listNames(leftovers)} in use-first order` : "";
      return {
        title: `${noodle} bowl with ${highlight}`,
        method: `Cook ${noodle} until springy and lay ${highlight} on top${finish}.`,
      };
    },
  },
  {
    id: "stir-fry",
    order: 2,
    minutes: 20,
    difficulty: "normal",
    eligible: (profile) => profile.proteins.length > 0 && profile.vegetables.length > 0,
    score: () => 17,
    text(profile, locale) {
      const protein = profile.proteins[0].name;
      const vegetable = profile.vegetables[0].name;
      const leftovers = without(profile.names, [protein, vegetable]);
      if (locale === "ko") {
        const finish = leftovers.length ? ` ${koObject(listNames(leftovers))} 곁들이면 한 끼로 충분해요.` : "";
        return {
          title: `${protein} ${vegetable} 볶음`,
          method: `센 불에서 ${koObject(protein)} 먼저 익히고, ${koObject(vegetable)} 넣어 함께 볶아 주세요.${finish}`,
        };
      }
      const finish = leftovers.length ? `; serve ${listNames(leftovers)} alongside` : "";
      return {
        title: `${protein} & ${vegetable} stir-fry`,
        method: `Sear ${protein} over high heat, add ${vegetable}, and cook until done${finish}.`,
      };
    },
  },
  {
    id: "rice-bowl",
    order: 3,
    minutes: 25,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.rice) && profile.proteins.length > 0,
    score: (profile) => 15 + (profile.vegetables.length ? 2 : 0),
    text(profile, locale) {
      const rice = profile.rice.name;
      const protein = profile.proteins[0].name;
      const others = without(profile.names, [rice, protein]);
      if (locale === "ko") {
        const withOthers = others.length ? `${koObject(protein)} ${listNames(others)}${koParticle(others.at(-1), "과", "와")} 함께 익힌 뒤` : `${koObject(protein)} 익힌 뒤`;
        return {
          title: `${protein} 덮밥`,
          method: `${withOthers}, 따뜻한 ${rice} 위에 얹어 한 그릇으로 완성해 주세요.`,
        };
      }
      const withOthers = others.length ? `Cook ${protein} with ${listNames(others)} until done` : `Cook ${protein} until done`;
      return {
        title: `${protein} rice bowl`,
        method: `${withOthers}, then spoon everything over warm ${rice}.`,
      };
    },
  },
  {
    id: "omelet",
    order: 4,
    minutes: 15,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.egg) && profile.vegetables.length > 0,
    score: (profile) => 16 + (profile.dairy.length ? 2 : 0),
    text(profile, locale) {
      const egg = profile.egg.name;
      const vegetable = profile.vegetables[0].name;
      const leftovers = without(profile.names, [egg, vegetable]);
      if (locale === "ko") {
        const finish = leftovers.length ? ` 남은 재료(${listNames(leftovers)})는 곁들이면 좋아요.` : "";
        return {
          title: `${vegetable} ${egg}부침`,
          method: `${koObject(egg)} 풀어 잘게 썬 ${koObject(vegetable)} 섞고, 팬에 얇게 부쳐 주세요.${finish}`,
        };
      }
      const finish = leftovers.length ? `; serve ${listNames(leftovers)} alongside` : "";
      return {
        title: `${vegetable} & ${egg} omelet`,
        method: `Beat ${egg}, stir in chopped ${vegetable}, and cook flat in a pan${finish}.`,
      };
    },
  },
  {
    id: "toast-plate",
    order: 5,
    minutes: 10,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.bread),
    score: (profile) => 14 + (profile.dairy.length ? 2 : 0),
    text(profile, locale) {
      const bread = profile.bread.name;
      const highlight = profile.anchor.name !== bread ? profile.anchor.name : without(profile.names, [bread])[0];
      const leftovers = without(profile.names, [bread, highlight]);
      if (locale === "ko") {
        const finish = leftovers.length ? ` ${koObject(listNames(leftovers))} 곁들여 주세요.` : "";
        return {
          title: `${highlight} 토스트`,
          method: `${koObject(bread)} 노릇하게 굽고 ${koObject(highlight)} 올려 주세요.${finish}`,
        };
      }
      const finish = leftovers.length ? `, and serve ${listNames(leftovers)} alongside` : "";
      return {
        title: `${highlight} toast plate`,
        method: `Toast ${bread} until golden and pile ${highlight} on top${finish}.`,
      };
    },
  },
  {
    id: "fresh-salad",
    order: 6,
    minutes: 10,
    difficulty: "easy",
    eligible: (profile) => profile.vegetables.length >= 2,
    score: (profile) => 12 + (profile.dairy.length ? 2 : 0),
    text(profile, locale) {
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const others = without(profile.names, vegetableNames);
      if (locale === "ko") {
        const finish = others.length ? ` ${koObject(listNames(others))} 따로 익혀 곁들이면 더 든든해요.` : "";
        return {
          title: `${vegetableNames[0]} ${vegetableNames[1]} 샐러드`,
          method: `${koObject(listNames(vegetableNames))} 먹기 좋게 썰어 가볍게 섞어 주세요.${finish}`,
        };
      }
      const finish = others.length ? `; cook ${listNames(others)} separately and add them on top to make it heartier` : "";
      return {
        title: `${vegetableNames[0]} & ${vegetableNames[1]} fresh salad`,
        method: `Chop ${listNames(vegetableNames)} into bite-size pieces and toss them together${finish}.`,
      };
    },
  },
  {
    id: "quick-soup",
    order: 7,
    minutes: 30,
    difficulty: "normal",
    eligible: () => true,
    score: (profile) => 9 + (profile.kimchi ? 9 : 0) + (profile.vegetables.length ? 1 : 0),
    text(profile, locale) {
      const lead = profile.kimchi?.name ?? profile.anchor.name;
      const rest = without(profile.names, [lead]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 급한 순서대로 넣어 주세요.` : "";
        return {
          title: profile.kimchi ? `${lead} 찌개` : `${lead} 국·찌개`,
          method: `냄비에 물을 끓여 ${koObject(lead)} 먼저 넣고, 재료가 부드러워질 때까지 끓여 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, then add ${listNames(rest)} in use-first order and cook until tender` : " and cook until tender";
      return {
        title: profile.kimchi ? `${lead} stew` : `${lead} quick soup or stew`,
        method: `Simmer ${lead} in a pot of water first${finish}.`,
      };
    },
  },
  {
    id: "one-pan-skillet",
    order: 8,
    minutes: 20,
    difficulty: "easy",
    eligible: () => true,
    score: (profile) => 10 + (profile.proteins.length ? 2 : 0),
    text(profile, locale) {
      const anchor = profile.anchor.name;
      const rest = without(profile.names, [anchor]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 순서대로 넣어 함께 익혀 주세요.` : "";
        return {
          title: `${anchor} 팬 요리`,
          method: `팬을 달군 뒤 ${koObject(anchor)} 먼저 익혀 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, then add ${listNames(rest)} one at a time until everything is warmed through` : " until warmed through";
      return {
        title: `${anchor} one-pan skillet`,
        method: `Heat a pan and cook ${anchor} first${finish}.`,
      };
    },
  },
  {
    id: "warm-bowl",
    order: 9,
    minutes: 15,
    difficulty: "easy",
    eligible: () => true,
    score: () => 8,
    text(profile, locale) {
      const anchor = profile.anchor.name;
      const rest = without(profile.names, [anchor]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 차례로 담아 주세요.` : "";
        return {
          title: `${anchor} 든든한 한 그릇`,
          method: `${koObject(anchor)} 먼저 데워 그릇에 담아 주세요.${finish} 급한 재료부터 먹는 구성이에요.`,
        };
      }
      const finish = rest.length ? `, then layer ${listNames(rest)} in the same bowl` : "";
      return {
        title: `${anchor} layered warm bowl`,
        method: `Warm ${anchor} first${finish} so the most urgent ingredients get eaten first.`,
      };
    },
  },
]);

export function generateSuggestions(records, today = localToday(), locale = "en", options = {}) {
  const resolvedLocale = SUPPORTED_MEAL_LOCALES.includes(locale) ? locale : "en";
  const validation = validateIngredients(records, today);
  if (!validation.ok) return [];
  const ordered = sortUseFirst(records, today);
  const profile = buildProfile(ordered);
  const offset = Number.isInteger(options?.offset) && options.offset > 0 ? options.offset : 0;
  const chosen = MEAL_TEMPLATES
    .filter((template) => template.eligible(profile))
    .map((template) => ({ template, score: template.score(profile) }))
    .sort((a, b) => b.score - a.score || a.template.order - b.template.order)
    .slice(offset, offset + 3);
  return chosen.map(({ template }, index) => {
    const { title, method } = template.text(profile, resolvedLocale);
    return {
      id: `suggestion-${offset + index + 1}`,
      title,
      anchor: profile.anchor.name,
      ingredients: profile.names,
      useFirstReason: useFirstReason(resolvedLocale, profile.anchor),
      method,
      minutes: template.minutes,
      difficulty: template.difficulty,
    };
  });
}
