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
const koWith = (word) => `${word}${koParticle(word, "과", "와")}`;

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
  {
    id: "kimchi-fried-rice",
    order: 10,
    minutes: 20,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.rice) && Boolean(profile.kimchi),
    score: () => 19,
    text(profile, locale) {
      const kimchi = profile.kimchi.name;
      const rice = profile.rice.name;
      const rest = without(profile.names, [kimchi, rice]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 마지막에 넣어 한 번 더 볶아 주세요.` : "";
        return {
          title: `${kimchi} 볶음밥`,
          method: `팬에 ${koObject(kimchi)} 먼저 볶아 숨을 죽이고, ${koObject(rice)} 넣어 눌러가며 볶아 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, then fold in ${listNames(rest)} at the end` : "";
      return {
        title: `${kimchi} pan fried rice`,
        method: `Cook ${kimchi} in a hot pan until it softens, press in ${rice}, and keep turning it${finish}.`,
      };
    },
  },
  {
    id: "kimchi-braise",
    order: 11,
    minutes: 30,
    difficulty: "normal",
    eligible: (profile) => Boolean(profile.kimchi) && profile.proteins.length > 0,
    score: () => 18,
    text(profile, locale) {
      const kimchi = profile.kimchi.name;
      const protein = profile.proteins[0].name;
      const rest = without(profile.names, [kimchi, protein]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 위에 얹어 함께 익혀 주세요.` : "";
        return {
          title: `${kimchi} ${protein} 조림`,
          method: `냄비에 ${koObject(kimchi)} 깔고 ${koObject(protein)} 올린 뒤, 물을 자작하게 부어 약한 불에서 푹 익혀 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, laying ${listNames(rest)} on top partway through` : "";
      return {
        title: `braised ${kimchi} with ${protein}`,
        method: `Line a pot with ${kimchi}, set ${protein} on top, add enough water to reach halfway, and simmer gently${finish}.`,
      };
    },
  },
  {
    id: "noodle-stir-fry",
    order: 12,
    minutes: 20,
    difficulty: "normal",
    eligible: (profile) => Boolean(profile.noodle) && profile.proteins.length > 0,
    score: () => 17,
    text(profile, locale) {
      const noodle = profile.noodle.name;
      const protein = profile.proteins[0].name;
      const rest = without(profile.names, [noodle, protein]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 함께 넣어 주세요.` : "";
        return {
          title: `${protein} ${noodle} 볶음`,
          method: `${koObject(noodle)} 미리 삶아 건져두고, 팬에 ${koObject(protein)} 익힌 뒤 삶은 면을 넣어 센 불에서 빠르게 볶아 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, adding ${listNames(rest)} as you go` : "";
      return {
        title: `stir-fried ${noodle} with ${protein}`,
        method: `Cook ${noodle} ahead and drain it, sear ${protein} in a hot pan, then toss the ${noodle} through over high heat${finish}.`,
      };
    },
  },
  {
    id: "egg-rice-bowl",
    order: 13,
    minutes: 15,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.rice) && Boolean(profile.egg),
    score: () => 16,
    text(profile, locale) {
      const egg = profile.egg.name;
      const rice = profile.rice.name;
      const rest = without(profile.names, [egg, rice]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 곁들여 비벼 드세요.` : "";
        return {
          title: `${egg} 덮밥`,
          method: `${koObject(rice)} 그릇에 담고, ${koObject(egg)} 반숙으로 익혀 위에 올려 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, with ${listNames(rest)} tucked around the edge` : "";
      return {
        title: `${egg} rice bowl`,
        method: `Spoon ${rice} into a bowl and set a softly cooked ${egg} on top${finish}.`,
      };
    },
  },
  {
    id: "noodle-soup",
    order: 14,
    minutes: 25,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.noodle) && (profile.vegetables.length > 0 || profile.proteins.length > 0),
    score: () => 16,
    text(profile, locale) {
      const noodle = profile.noodle.name;
      const partner = (profile.vegetables[0] ?? profile.proteins[0]).name;
      const rest = without(profile.names, [noodle, partner]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 급한 순서대로 넣어 주세요.` : "";
        return {
          title: `${partner} ${noodle} 국물요리`,
          method: `냄비에 물을 넉넉히 잡아 ${koObject(partner)} 먼저 우려내고, ${koObject(noodle)} 넣어 익혀 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, then add ${listNames(rest)} in use-first order` : "";
      return {
        title: `${noodle} soup with ${partner}`,
        method: `Simmer ${partner} in a pot of water to build the broth, then slip in ${noodle} until tender${finish}.`,
      };
    },
  },
  {
    id: "bread-sandwich",
    order: 15,
    minutes: 10,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.bread) && profile.proteins.length > 0,
    score: () => 15,
    text(profile, locale) {
      const bread = profile.bread.name;
      const protein = profile.proteins[0].name;
      const rest = without(profile.names, [bread, protein]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 사이에 층층이 끼워 주세요.` : "";
        return {
          title: `${protein} 샌드위치`,
          method: `${koObject(bread)} 노릇하게 구워 식히고, ${koObject(protein)} 익혀 사이에 넣어 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, stacking ${listNames(rest)} between the layers` : "";
      return {
        title: `${protein} sandwich`,
        method: `Warm ${bread} until it crisps, cook ${protein}, and press them together${finish}.`,
      };
    },
  },
  {
    id: "egg-bread",
    order: 16,
    minutes: 15,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.bread) && Boolean(profile.egg),
    score: () => 15,
    text(profile, locale) {
      const bread = profile.bread.name;
      const egg = profile.egg.name;
      const rest = without(profile.names, [bread, egg]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 곁들이면 한 끼가 돼요.` : "";
        return {
          title: `${egg}물 입힌 ${bread}`,
          method: `${koObject(egg)} 풀어 ${koObject(bread)} 앞뒤로 적신 뒤, 약한 불 팬에서 천천히 구워 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `; serve ${listNames(rest)} on the side` : "";
      return {
        title: `${egg}-dipped ${bread}`,
        method: `Beat ${egg}, soak both sides of ${bread} in it, and cook slowly in a low pan until set${finish}.`,
      };
    },
  },
  {
    id: "chilled-noodle",
    order: 17,
    minutes: 15,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.noodle) && profile.vegetables.length >= 2,
    score: () => 15,
    text(profile, locale) {
      const noodle = profile.noodle.name;
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const rest = without(profile.names, [noodle, ...vegetableNames]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 따로 익혀 올려 주세요.` : "";
        return {
          title: `${vegetableNames[0]} 얹은 찬 ${noodle}`,
          method: `${koObject(noodle)} 삶아 찬물에 헹궈 물기를 빼고, ${koObject(listNames(vegetableNames))} 채 썰어 위에 소복이 올려 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, with ${listNames(rest)} cooked separately on top` : "";
      return {
        title: `chilled ${noodle} with ${vegetableNames[0]}`,
        method: `Cook ${noodle}, rinse it under cold water, drain well, and pile shredded ${listNames(vegetableNames)} over it${finish}.`,
      };
    },
  },
  {
    id: "protein-vegetable-stew",
    order: 18,
    minutes: 30,
    difficulty: "normal",
    eligible: (profile) => profile.proteins.length > 0 && profile.vegetables.length >= 2,
    score: () => 15,
    text(profile, locale) {
      const protein = profile.proteins[0].name;
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const rest = without(profile.names, [protein, ...vegetableNames]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 마지막에 넣어 주세요.` : "";
        return {
          title: `${protein} ${vegetableNames[0]} 전골`,
          method: `냄비에 ${koObject(listNames(vegetableNames))} 돌려 담고 가운데 ${koObject(protein)} 올린 뒤, 물을 부어 끓여 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, adding ${listNames(rest)} at the end` : "";
      return {
        title: `${protein} and ${vegetableNames[0]} hot pot`,
        method: `Arrange ${listNames(vegetableNames)} around a pot, set ${protein} in the middle, pour in water, and simmer until everything is tender${finish}.`,
      };
    },
  },
  {
    id: "rice-porridge",
    order: 19,
    minutes: 30,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.rice) && profile.vegetables.length > 0,
    score: () => 14,
    text(profile, locale) {
      const rice = profile.rice.name;
      const vegetable = profile.vegetables[0].name;
      const rest = without(profile.names, [rice, vegetable]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 잘게 썰어 함께 끓여 주세요.` : "";
        return {
          title: `${vegetable} ${rice}죽`,
          method: `${rice}에 물을 넉넉히 붓고 약한 불에서 저어가며 퍼질 때까지 끓이고, ${koObject(vegetable)} 잘게 썰어 넣어 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, stirring in finely chopped ${listNames(rest)}` : "";
      return {
        title: `${vegetable} ${rice} porridge`,
        method: `Simmer ${rice} in plenty of water over low heat, stirring until it breaks down, then add chopped ${vegetable}${finish}.`,
      };
    },
  },
  {
    id: "rolled-egg",
    order: 20,
    minutes: 15,
    difficulty: "normal",
    eligible: (profile) => Boolean(profile.egg) && profile.vegetables.length >= 2,
    score: () => 14,
    text(profile, locale) {
      const egg = profile.egg.name;
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const rest = without(profile.names, [egg, ...vegetableNames]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 곁들여 드세요.` : "";
        return {
          title: `${vegetableNames[0]} ${egg}말이`,
          method: `${koObject(egg)} 곱게 풀고 ${koObject(listNames(vegetableNames))} 잘게 다져 섞은 뒤, 약한 불 팬에 얇게 부어 한쪽부터 말아 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `; serve ${listNames(rest)} alongside` : "";
      return {
        title: `rolled ${egg} with ${vegetableNames[0]}`,
        method: `Beat ${egg} smooth, mix in finely diced ${listNames(vegetableNames)}, pour a thin layer into a low pan, and roll it from one side${finish}.`,
      };
    },
  },
  {
    id: "braised-proteins",
    order: 21,
    minutes: 30,
    difficulty: "normal",
    eligible: (profile) => profile.proteins.length >= 2,
    score: () => 14,
    text(profile, locale) {
      const first = profile.proteins[0].name;
      const second = profile.proteins[1].name;
      const rest = without(profile.names, [first, second]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 나중에 넣어 함께 조려 주세요.` : "";
        return {
          title: `${first} ${second} 두 가지 조림`,
          method: `${koObject(first)} 먼저 냄비에 넣고 물을 자작하게 부어 끓이다가, ${koObject(second)} 넣어 국물이 줄 때까지 조려 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, adding ${listNames(rest)} later` : "";
      return {
        title: `${first} and ${second} braise`,
        method: `Start ${first} in a pot with just enough water, add ${second}, and cook down until the liquid thickens${finish}.`,
      };
    },
  },
  {
    id: "melted-toast",
    order: 22,
    minutes: 10,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.bread) && profile.dairy.length > 0,
    score: () => 14,
    text(profile, locale) {
      const bread = profile.bread.name;
      const dairy = profile.dairy[0].name;
      const rest = without(profile.names, [bread, dairy]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 위에 올려 함께 구워 주세요.` : "";
        return {
          title: `${dairy} 올린 ${bread}`,
          method: `${koObject(bread)} 팬에 올리고 ${koObject(dairy)} 얹어 뚜껑을 덮은 채 약한 불에서 녹여 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, layering ${listNames(rest)} on top before it melts` : "";
      return {
        title: `${dairy} melt on ${bread}`,
        method: `Set ${bread} in a pan, cover it with ${dairy}, put a lid on, and heat gently until it melts${finish}.`,
      };
    },
  },
  {
    id: "rice-vegetable-soup",
    order: 23,
    minutes: 25,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.rice) && profile.vegetables.length >= 2,
    score: () => 13,
    text(profile, locale) {
      const rice = profile.rice.name;
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const rest = without(profile.names, [rice, ...vegetableNames]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 함께 넣어 주세요.` : "";
        return {
          title: `${vegetableNames[0]} 넣은 ${rice}국`,
          method: `냄비에 물을 붓고 ${koObject(listNames(vegetableNames))} 먼저 끓여 맛을 낸 다음, ${koObject(rice)} 넣어 한소끔 더 끓여 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, along with ${listNames(rest)}` : "";
      return {
        title: `${vegetableNames[0]} and ${rice} soup`,
        method: `Simmer ${listNames(vegetableNames)} in a pot of water until the broth tastes full, then stir in ${rice} and heat through${finish}.`,
      };
    },
  },
  {
    id: "steamed-egg",
    order: 24,
    minutes: 20,
    difficulty: "normal",
    eligible: (profile) => Boolean(profile.egg) && (profile.proteins.length >= 2 || profile.dairy.length > 0),
    score: () => 13,
    text(profile, locale) {
      const egg = profile.egg.name;
      const rest = without(profile.names, [egg]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 잘게 썰어 섞어 주세요.` : "";
        return {
          title: `부드러운 ${egg}찜`,
          method: `${koObject(egg)} 풀어 물을 조금 섞고, 그릇째 냄비에 앉혀 뚜껑을 덮은 뒤 약한 불에서 몽글하게 익혀 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, folding in finely chopped ${listNames(rest)}` : "";
      return {
        title: `soft steamed ${egg}`,
        method: `Whisk ${egg} with a little water, set the bowl in a covered pot, and steam over low heat until just set${finish}.`,
      };
    },
  },
  {
    id: "baked-vegetables",
    order: 25,
    minutes: 30,
    difficulty: "normal",
    eligible: (profile) => profile.dairy.length > 0 && profile.vegetables.length > 0,
    score: () => 13,
    text(profile, locale) {
      const dairy = profile.dairy[0].name;
      const vegetable = profile.vegetables[0].name;
      const rest = without(profile.names, [dairy, vegetable]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 사이사이에 끼워 주세요.` : "";
        return {
          title: `${dairy} 얹은 ${vegetable} 구이`,
          method: `${koObject(vegetable)} 도톰하게 썰어 팬에 깔고 ${koObject(dairy)} 덮은 뒤, 뚜껑을 덮고 약한 불에서 녹을 때까지 익혀 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, tucking ${listNames(rest)} in between` : "";
      return {
        title: `${vegetable} baked under ${dairy}`,
        method: `Slice ${vegetable} thick, spread it in a pan, blanket it with ${dairy}, cover, and cook on low until melted through${finish}.`,
      };
    },
  },
  {
    id: "vegetable-wrap",
    order: 26,
    minutes: 10,
    difficulty: "easy",
    eligible: (profile) => Boolean(profile.bread) && profile.vegetables.length > 0,
    score: () => 13,
    text(profile, locale) {
      const bread = profile.bread.name;
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const rest = without(profile.names, [bread, ...vegetableNames]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 함께 넣어 말아 주세요.` : "";
        return {
          title: `${vegetableNames[0]} ${bread} 롤`,
          method: `${koObject(bread)} 살짝 데워 부드럽게 만들고, ${koObject(listNames(vegetableNames))} 길게 썰어 한쪽 끝에 올린 뒤 단단히 말아 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, rolling ${listNames(rest)} in with them` : "";
      return {
        title: `${vegetableNames[0]} ${bread} wrap`,
        method: `Warm ${bread} until it bends easily, lay strips of ${listNames(vegetableNames)} along one edge, and roll it up tightly${finish}.`,
      };
    },
  },
  {
    id: "kimchi-pancake",
    order: 27,
    minutes: 20,
    difficulty: "normal",
    eligible: (profile) => Boolean(profile.kimchi) && profile.vegetables.length >= 2,
    score: () => 13,
    text(profile, locale) {
      const kimchi = profile.kimchi.name;
      const partner = profile.vegetables.find((item) => item.name !== kimchi)?.name ?? profile.anchor.name;
      const rest = without(profile.names, [kimchi, partner]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 잘게 썰어 반죽에 섞어 주세요.` : "";
        return {
          title: `${kimchi} ${partner} 부침`,
          method: `${koObject(kimchi)} 잘게 썰어 ${koWith(partner)} 함께 섞고, 팬에 얇게 펴 앞뒤로 노릇하게 부쳐 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, mixing chopped ${listNames(rest)} into the batter` : "";
      return {
        title: `${kimchi} and ${partner} pan cake`,
        method: `Chop ${kimchi} small, combine it with ${partner}, spread the mixture thin in a pan, and cook both sides until browned${finish}.`,
      };
    },
  },
  {
    id: "vegetable-pancake",
    order: 28,
    minutes: 20,
    difficulty: "normal",
    eligible: (profile) => profile.vegetables.length >= 3,
    score: () => 12,
    text(profile, locale) {
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const rest = without(profile.names, vegetableNames);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 곁들여 드세요.` : "";
        return {
          title: `${vegetableNames[0]} ${vegetableNames[1]} 모둠 전`,
          method: `${koObject(listNames(vegetableNames))} 가늘게 채 썰어 한데 섞고, 팬에 넓게 펴 눌러가며 앞뒤로 부쳐 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `; serve ${listNames(rest)} on the side` : "";
      return {
        title: `${vegetableNames[0]} & ${vegetableNames[1]} mixed pan cake`,
        method: `Shred ${listNames(vegetableNames)} finely, mix them together, spread wide in a pan, and press while cooking both sides${finish}.`,
      };
    },
  },
  {
    id: "steamed-vegetables",
    order: 29,
    minutes: 15,
    difficulty: "easy",
    eligible: (profile) => profile.vegetables.length >= 2,
    score: () => 11,
    text(profile, locale) {
      const vegetableNames = profile.vegetables.map((item) => item.name);
      const rest = without(profile.names, vegetableNames);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 따로 데워 함께 담아 주세요.` : "";
        return {
          title: `${vegetableNames[0]} ${vegetableNames[1]} 찜`,
          method: `냄비에 물을 조금만 붓고 ${koObject(listNames(vegetableNames))} 큼직하게 썰어 넣은 뒤, 뚜껑을 덮고 김이 오르면 숨이 죽을 때까지 쪄 주세요.${finish}`,
        };
      }
      const finish = rest.length ? `, warming ${listNames(rest)} separately to serve with them` : "";
      return {
        title: `steamed ${vegetableNames[0]} & ${vegetableNames[1]}`,
        method: `Put a shallow layer of water in a pot, add ${listNames(vegetableNames)} in large pieces, cover, and steam until they soften${finish}.`,
      };
    },
  },
  {
    id: "simple-plate",
    order: 30,
    minutes: 10,
    difficulty: "easy",
    eligible: () => true,
    score: () => 9,
    text(profile, locale) {
      const anchor = profile.anchor.name;
      const rest = without(profile.names, [anchor]);
      if (locale === "ko") {
        const finish = rest.length ? ` ${koObject(listNames(rest))} 곁들여 한 접시에 담아 주세요.` : "";
        return {
          title: `${anchor} 한 접시`,
          method: `${koObject(anchor)} 먹기 좋게 손질해 가장 잘 익는 방법으로 데워 주세요.${finish} 급한 재료를 먼저 비우는 구성이에요.`,
        };
      }
      const finish = rest.length ? `, then arrange ${listNames(rest)} beside it on one plate` : "";
      return {
        title: `${anchor} simple plate`,
        method: `Trim ${anchor} into easy pieces and warm it whichever way suits it best${finish}, clearing the most urgent ingredient first.`,
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
