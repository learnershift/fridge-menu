export const MIN_INGREDIENTS = 3;
export const MAX_INGREDIENTS = 8;

const URGENCY_RANK = Object.freeze({ expired: -1, "use-now": 0, "use-soon": 1, stable: 2 });
const MEAL_TEMPLATES = Object.freeze([
  { title: "Use-first skillet", method: "Cook the anchor ingredient first, then fold in the remaining available ingredients." },
  { title: "Flexible warm bowl", method: "Cook the anchor ingredient until tender, then layer in the remaining available ingredients." },
  { title: "Quick soup or stew", method: "Simmer the anchor ingredient first, then add the remaining available ingredients in order." },
]);

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

export function validateIngredients(records, today = localToday()) {
  if (!Array.isArray(records)) return { ok: false, message: "Ingredients must be a list." };
  if (records.length < MIN_INGREDIENTS || records.length > MAX_INGREDIENTS) {
    return { ok: false, message: `Add between ${MIN_INGREDIENTS} and ${MAX_INGREDIENTS} ingredients to make a menu.` };
  }
  const names = new Set();
  for (const record of records) {
    const name = normalizeName(record?.name);
    const derived = getExpiryStatus(record?.expiryDate, today);
    const urgency = derived === "invalid" ? record?.urgency : derived;
    if (!name) return { ok: false, message: "Every ingredient needs a name." };
    if (!(urgency in URGENCY_RANK)) return { ok: false, message: "Every ingredient needs a valid expiry date." };
    if (urgency === "expired") return { ok: false, message: "Remove expired ingredients before making a menu." };
    const key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) return { ok: false, message: `“${name}” is already in your fridge.` };
    names.add(key);
  }
  return { ok: true, message: "Ready." };
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

export function generateSuggestions(records, today = localToday()) {
  const validation = validateIngredients(records, today);
  if (!validation.ok) return [];
  const ordered = sortUseFirst(records, today);
  return MEAL_TEMPLATES.map((template, index) => {
    const anchorIndex = index % ordered.length;
    const ingredients = ordered.map((_, offset) => ordered[(anchorIndex + offset) % ordered.length].name);
    const anchor = ordered[anchorIndex];
    return {
      id: `suggestion-${index + 1}`,
      title: template.title,
      anchor: anchor.name,
      ingredients,
      useFirstReason: `${anchor.name} leads because it is ${anchor.urgency.replace("-", " ")}; the rest stay in a stable use-first order.`,
      method: template.method,
    };
  });
}
