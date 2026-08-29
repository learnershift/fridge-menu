import {
  MAX_INGREDIENTS,
  MIN_INGREDIENTS,
  generateSuggestions,
  getExpiryStatus,
  normalizeName,
  sortUseFirst,
  validateIngredients,
} from "./meal-engine.js";
import {
  applyStaticTranslations,
  detectLocale,
  readStoredLocale,
  saveStoredLocale,
  translate,
} from "./i18n.js";

export const STORAGE_KEY = "fridge-menu:v1";
export const STORAGE_VERSION = 1;
export const STATE_VERSION = 2;
export const HISTORY_LIMIT = 10;
export const FAVORITES_LIMIT = HISTORY_LIMIT * 3;
export const MAX_STORED_TEXT_LENGTH = 512;

const MAX_RAW_STORAGE_LENGTH = 128 * 1024;
const INGREDIENT_NAME_LIMIT = 48;
const SUGGESTIONS_LIMIT = 3;
const QUICK_INGREDIENT_KEYS = Object.freeze([
  "Egg", "Kimchi", "Onion", "Tofu", "Scallion", "Mushrooms", "Potato", "Carrot", "Zucchini", "BeanSprouts", "Spinach", "Tomato",
  "Rice", "Noodles", "Bread", "Ham", "Bacon", "Tuna", "Chicken", "Pork", "Beef", "Cheese", "Milk", "FishCake",
]);
const MIN_HISTORY_TIMESTAMP = Date.UTC(2020, 0, 1);
const MAX_HISTORY_TIMESTAMP = Date.UTC(2100, 0, 1);

const VALID_URGENCIES = new Set(["use-now", "use-soon", "stable"]);
const EMPTY_STATE = Object.freeze({ ingredients: [], favorites: [], history: [] });

function isStoredIngredient(value, index) {
  return Boolean(
    value && typeof value === "object" && validText(value.id) && validName(value.name) &&
    VALID_URGENCIES.has(value.urgency) && Number.isInteger(value.sequence) && value.sequence >= 0 &&
    value.sequence >= index - MAX_INGREDIENTS,
  );
}

function validText(value, limit = MAX_STORED_TEXT_LENGTH) {
  return typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
}

function validName(value) {
  if (typeof value !== "string") return null;
  const name = normalizeName(value);
  return name && name.length <= INGREDIENT_NAME_LIMIT ? name : null;
}

function sanitizeIngredient(value, index) {
  if (!value || typeof value !== "object") return null;
  const id = validText(value.id);
  const name = validName(value.name);
  const sequence = Number.isInteger(value.sequence) && value.sequence >= 0 ? value.sequence : index;
  const expiryDate = typeof value.expiryDate === "string" && getExpiryStatus(value.expiryDate) !== "invalid" ? value.expiryDate : null;
  const urgency = VALID_URGENCIES.has(value.urgency) ? value.urgency : null;
  if (!id || !name || (!expiryDate && !urgency)) return null;
  return expiryDate ? { id, name, expiryDate, sequence } : { id, name, urgency, sequence };
}

function sanitizeSuggestion(value, historyId) {
  if (!value || typeof value !== "object") return null;
  const id = validText(value.id);
  const title = validText(value.title);
  const anchor = validName(value.anchor);
  const useFirstReason = validText(value.useFirstReason);
  const method = validText(value.method);
  if (!id || !id.startsWith(`${historyId}:`) || !title || !anchor || !useFirstReason || !method || !Array.isArray(value.ingredients)) return null;
  const ingredients = value.ingredients.slice(0, MAX_INGREDIENTS).map(validName);
  if (!ingredients.length || ingredients.some((name) => !name)) return null;
  const ingredientKeys = ingredients.map((name) => name.toLocaleLowerCase("en-US"));
  const anchorKey = anchor.toLocaleLowerCase("en-US");
  if (new Set(ingredientKeys).size !== ingredientKeys.length || !ingredientKeys.includes(anchorKey)) return null;
  return { id, title, anchor, ingredients, useFirstReason, method };
}

export function isCanonicalHistoryTimestamp(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= MIN_HISTORY_TIMESTAMP && timestamp < MAX_HISTORY_TIMESTAMP &&
    new Date(timestamp).toISOString() === value;
}

function sanitizeHistoryEntry(value) {
  if (!value || typeof value !== "object") return null;
  const id = validText(value.id);
  const createdAt = validText(value.createdAt);
  if (!id || !createdAt || !isCanonicalHistoryTimestamp(createdAt) || !Array.isArray(value.suggestions)) return null;
  const suggestionIds = new Set();
  const suggestions = value.suggestions.slice(0, SUGGESTIONS_LIMIT).map((suggestion) => sanitizeSuggestion(suggestion, id)).filter((suggestion) => {
    if (!suggestion || suggestionIds.has(suggestion.id)) return false;
    suggestionIds.add(suggestion.id);
    return true;
  });
  return { id, createdAt, suggestions };
}

function sanitizeState(state) {
  const ingredients = Array.isArray(state?.ingredients)
    ? state.ingredients.slice(0, MAX_INGREDIENTS).map(sanitizeIngredient).filter(Boolean)
    : [];
  const uniqueNames = new Set();
  const uniqueIds = new Set();
  const deduplicatedIngredients = ingredients.filter((item) => {
    const key = item.name.toLocaleLowerCase("en-US");
    if (uniqueNames.has(key) || uniqueIds.has(item.id)) return false;
    uniqueNames.add(key);
    uniqueIds.add(item.id);
    return true;
  });
  const historyIds = new Set();
  const suggestionIds = new Set();
  const history = Array.isArray(state?.history)
    ? state.history.slice(-HISTORY_LIMIT).map(sanitizeHistoryEntry).filter(Boolean)
      .filter((entry) => {
        if (historyIds.has(entry.id)) return false;
        historyIds.add(entry.id);
        return true;
      })
      .map((entry) => ({ ...entry, suggestions: entry.suggestions.filter((suggestion) => {
        if (suggestionIds.has(suggestion.id)) return false;
        suggestionIds.add(suggestion.id);
        return true;
      }) }))
    : [];
  const suggestionIdCounts = new Map();
  for (const suggestion of history.flatMap((entry) => entry.suggestions)) {
    suggestionIdCounts.set(suggestion.id, (suggestionIdCounts.get(suggestion.id) ?? 0) + 1);
  }
  const favorites = Array.isArray(state?.favorites)
    ? [...new Set(state.favorites.slice(0, FAVORITES_LIMIT).map((value) => validText(value)).filter(Boolean))]
      .filter((id) => suggestionIdCounts.get(id) === 1)
    : [];
  return { ingredients: deduplicatedIngredients, favorites, history };
}

export function parseStoredIngredients(raw) {
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw);
    if (payload?.version !== STORAGE_VERSION || !Array.isArray(payload.ingredients)) return [];
    if (payload.ingredients.length > MAX_INGREDIENTS || !payload.ingredients.every(isStoredIngredient)) return [];
    const normalized = payload.ingredients.map((item) => ({
      id: item.id, name: normalizeName(item.name), urgency: item.urgency, sequence: item.sequence,
    }));
    const names = normalized.map((item) => item.name.toLocaleLowerCase("en-US"));
    const ids = normalized.map((item) => item.id);
    return new Set(names).size === names.length && new Set(ids).size === ids.length ? normalized : [];
  } catch {
    return [];
  }
}

export function serializeIngredients(ingredients) {
  return JSON.stringify({ version: STORAGE_VERSION, ingredients });
}

function emptyState() {
  return { ingredients: [], favorites: [], history: [] };
}

export function parseStoredState(raw) {
  if (!raw) return emptyState();
  if (typeof raw !== "string" || raw.length > MAX_RAW_STORAGE_LENGTH) return emptyState();
  try {
    const payload = JSON.parse(raw);
    if (payload?.version === STORAGE_VERSION) {
      return { ingredients: parseStoredIngredients(raw), favorites: [], history: [] };
    }
    if (payload?.version !== STATE_VERSION || !Array.isArray(payload.ingredients)) return emptyState();
    return sanitizeState(payload);
  } catch {
    return emptyState();
  }
}

export function serializeState(state) {
  return JSON.stringify({ version: STATE_VERSION, ...sanitizeState(state) });
}

export async function commitStateTransaction(locks, storage, mutate, options = {}) {
  try {
    if (!locks || typeof locks.request !== "function" || !storage ||
        typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return { status: "blocked" };
    return await locks.request(`${STORAGE_KEY}:writer`, { mode: "exclusive" }, async () => {
      const currentRaw = storage.getItem(STORAGE_KEY);
      const current = parseStoredState(currentRaw);
      if (Object.prototype.hasOwnProperty.call(options, "expectedRaw") && currentRaw !== options.expectedRaw) {
        return { status: "conflict", raw: currentRaw, state: current };
      }
      const next = mutate(current);
      if (!next) return { status: "conflict", raw: currentRaw, state: current };
      const raw = serializeState(next);
      storage.setItem(STORAGE_KEY, raw);
      return { status: "saved", raw, state: parseStoredState(raw) };
    });
  } catch {
    return { status: "blocked" };
  }
}

export function loadState(storage, onError = () => {}) {
  try { return parseStoredState(storage?.getItem(STORAGE_KEY)); }
  catch { onError(); return emptyState(); }
}

export function accessStorage(scope, onError = () => {}) {
  try { return scope?.localStorage ?? null; }
  catch { onError(); return null; }
}

export function usableSuggestions(suggestions, ingredients, today) {
  if (!Array.isArray(suggestions) || !Array.isArray(ingredients)) return [];
  const available = new Set(ingredients.filter((item) => {
    if (item.expiryDate) return !["expired", "invalid"].includes(getExpiryStatus(item.expiryDate, today));
    return VALID_URGENCIES.has(item.urgency);
  }).map((item) => normalizeName(item.name).toLocaleLowerCase("en-US")));
  return suggestions.filter((suggestion) => {
    const anchor = validName(suggestion?.anchor);
    if (!anchor || !Array.isArray(suggestion?.ingredients)) return false;
    const names = suggestion.ingredients.map(validName);
    if (!names.length || names.some((name) => !name)) return false;
    const keys = names.map((name) => name.toLocaleLowerCase("en-US"));
    return new Set(keys).size === keys.length && keys.includes(anchor.toLocaleLowerCase("en-US")) &&
      keys.every((key) => available.has(key));
  });
}

export function bindSuggestionsToMenu(menuId, suggestions) {
  const validMenuId = validText(menuId);
  if (!validMenuId || !Array.isArray(suggestions)) return [];
  return suggestions.map((suggestion) => ({ ...suggestion, id: `${validMenuId}:${suggestion.id}` }));
}

export function recoverSuggestionMetadata(suggestion) {
  const match = /(?:^|:)suggestion-(\d+)$/.exec(validText(suggestion?.id) ?? "");
  const rank = Number(match?.[1]);
  if (!Number.isSafeInteger(rank) || rank < 1 || !Array.isArray(suggestion?.ingredients)) return null;
  const names = suggestion.ingredients.map(validName);
  if (names.length < MIN_INGREDIENTS || names.length > MAX_INGREDIENTS || names.some((name) => !name)) return null;
  const keys = names.map((name) => name.toLocaleLowerCase("en-US"));
  if (new Set(keys).size !== keys.length) return null;
  const records = names.map((name, sequence) => ({ id: `metadata-${sequence}`, name, urgency: "stable", sequence }));
  const metadata = generateSuggestions(records, undefined, "en", { offset: rank - 1 })[0];
  return metadata && Number.isInteger(metadata.minutes) && ["easy", "normal"].includes(metadata.difficulty)
    ? { minutes: metadata.minutes, difficulty: metadata.difficulty }
    : null;
}

export function loadIngredients(storage) {
  try { return parseStoredIngredients(storage?.getItem(STORAGE_KEY)); } catch { return []; }
}

export function saveIngredients(storage, ingredients) {
  try {
    if (!storage || typeof storage.setItem !== "function") return false;
    storage.setItem(STORAGE_KEY, serializeIngredients(ingredients));
    return true;
  } catch { return false; }
}

export function millisecondsUntilNextLocalDay(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("A valid Date is required.");
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 0, 50);
  return Math.max(1, nextDay.getTime() - now.getTime());
}

function boot() {
  const form = document.querySelector("#ingredient-form");
  const nameInput = document.querySelector("#ingredient-name");
  const expiryInput = document.querySelector("#ingredient-expiry");
  const quickIngredients = document.querySelector("#quick-ingredients");
  const list = document.querySelector("#ingredient-list");
  const count = document.querySelector("#ingredient-count");
  const status = document.querySelector("#status-message");
  const suggestButton = document.querySelector("#suggest-button");
  const clearButton = document.querySelector("#clear-button");
  const suggestions = document.querySelector("#suggestions");
  const alternativeMenusButton = document.querySelector("#alternative-menus-button");
  const favoritesList = document.querySelector("#favorites-list");
  const historyList = document.querySelector("#history-list");
  const useFirst = document.querySelector("#use-first-preview");
  const installButton = document.querySelector("#install-button");
  const langToggle = document.querySelector("#lang-toggle");

  let storageReadBlocked = false;
  const storage = accessStorage(window, () => { storageReadBlocked = true; });
  let locale = readStoredLocale(storage)
    ?? detectLocale([...(navigator.languages ?? []), navigator.language]);
  const t = (key, params) => translate(locale, key, params);
  applyStaticTranslations(document, locale);
  let lastKnownRaw = null;
  const restored = (() => {
    if (!storage) return emptyState();
    try {
      lastKnownRaw = storage.getItem(STORAGE_KEY);
      return parseStoredState(lastKnownRaw);
    } catch {
      storageReadBlocked = true;
      return emptyState();
    }
  })();
  let ingredients = restored.ingredients;
  let favorites = restored.favorites;
  let history = restored.history;
  let currentSuggestions = history.at(-1)?.suggestions ?? [];
  let showingAlternativeMenus = false;
  const tabId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let installPrompt;
  let dayRolloverTimer;
  let hasSessionOnlyChanges = false;
  let nextSequence = ingredients.reduce((max, item) => Math.max(max, item.sequence + 1), 0);
  let nextMenuSequence = history.length;

  function announce(message, tone = "neutral") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function clearFormErrors(fields = [nameInput, expiryInput]) {
    fields.forEach((field) => field.removeAttribute("aria-invalid"));
  }

  function showFormError(message, invalidFields) {
    clearFormErrors();
    invalidFields.forEach((field) => field.setAttribute("aria-invalid", "true"));
    announce(message, "error");
    invalidFields[0]?.focus();
  }

  function applyState(next) {
    ingredients = next.ingredients;
    favorites = next.favorites;
    history = next.history;
    currentSuggestions = history.at(-1)?.suggestions ?? [];
    nextSequence = ingredients.reduce((max, item) => Math.max(max, item.sequence + 1), 0);
    nextMenuSequence = Math.max(nextMenuSequence, history.length);
  }

  async function persist(mutate, requireFresh = false) {
    const options = requireFresh ? { expectedRaw: lastKnownRaw } : undefined;
    const result = await commitStateTransaction(navigator.locks, storage, mutate, options);
    hasSessionOnlyChanges = result.status === "blocked";
    if (result.state) applyState(result.state);
    if (result.raw !== undefined) lastKnownRaw = result.raw;
    return result;
  }

  function persistenceMessage(result, success, sessionOnly, conflict) {
    if (result.status === "saved") return success;
    return result.status === "conflict" ? conflict : sessionOnly;
  }

  function focusFavoriteButton(suggestionId) {
    const button = [...document.querySelectorAll(".favorite-button")]
      .find((candidate) => candidate.dataset.suggestionId === suggestionId);
    (button ?? document.querySelector("#favorites-heading")).focus();
  }

  function focusIngredientAfterRemoval(ingredientId) {
    if (!ingredientId) { nameInput.focus(); return; }
    const row = [...list.querySelectorAll(".ingredient-item")]
      .find((candidate) => candidate.dataset.ingredientId === ingredientId);
    (row?.querySelector(".remove-button") ?? nameInput).focus();
  }

  function captureDynamicFocus() {
    const active = document.activeElement;
    if (active?.classList.contains("remove-button")) {
      return { kind: "ingredient", id: active.closest(".ingredient-item")?.dataset.ingredientId };
    }
    if (active?.classList.contains("favorite-button")) {
      return { kind: "favorite", id: active.dataset.suggestionId, scope: favoritesList.contains(active) ? "favorites" : "suggestions" };
    }
    if (active?.classList.contains("history-button")) {
      return { kind: "history", id: active.dataset.historyId };
    }
    return null;
  }

  function restoreDynamicFocus(snapshot) {
    if (!snapshot) return;
    let target;
    let fallback;
    if (snapshot.kind === "ingredient") {
      target = [...list.querySelectorAll(".ingredient-item")]
        .find((item) => item.dataset.ingredientId === snapshot.id)?.querySelector(".remove-button");
      fallback = nameInput;
    } else if (snapshot.kind === "favorite") {
      const container = snapshot.scope === "favorites" ? favoritesList : suggestions;
      target = [...container.querySelectorAll(".favorite-button")]
        .find((button) => button.dataset.suggestionId === snapshot.id);
      fallback = document.querySelector(snapshot.scope === "favorites" ? "#favorites-heading" : "#menu-heading");
    } else if (snapshot.kind === "history") {
      target = [...historyList.querySelectorAll(".history-button")]
        .find((button) => button.dataset.historyId === snapshot.id);
      fallback = document.querySelector("#history-heading");
    }
    (target && !target.disabled ? target : fallback)?.focus();
  }

  function quickIngredientNames(key) {
    return [translate("en", `quickIngredient${key}`), translate("ko", `quickIngredient${key}`)];
  }

  function renderQuickIngredients() {
    quickIngredients.replaceChildren();
    QUICK_INGREDIENT_KEYS.forEach((key) => {
      const name = t(`quickIngredient${key}`);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "quick-ingredient-chip";
      chip.textContent = name;
      const equivalentNames = new Set(quickIngredientNames(key).map((value) => value.toLocaleLowerCase("en-US")));
      chip.disabled = ingredients.length >= MAX_INGREDIENTS || ingredients.some((item) => equivalentNames.has(item.name.toLocaleLowerCase("en-US")));
      chip.addEventListener("click", () => addIngredient(name));
      quickIngredients.append(chip);
    });
  }

  function mealCard(suggestion, favoriteEnabled = true) {
    const card = document.createElement("article");
    card.className = "meal-card";
    const content = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = t("mealCardEyebrow", { anchor: suggestion.anchor });
    const heading = document.createElement("h3");
    heading.textContent = suggestion.title;
    const metadata = recoverSuggestionMetadata(suggestion);
    const badge = document.createElement("p");
    badge.className = "meal-meta";
    if (Number.isInteger(metadata?.minutes) && ["easy", "normal"].includes(metadata.difficulty)) {
      badge.textContent = t("mealMeta", { minutes: metadata.minutes, difficulty: t(`difficulty.${metadata.difficulty}`) });
    } else {
      badge.hidden = true;
    }
    const reason = document.createElement("p");
    reason.textContent = suggestion.useFirstReason;
    const order = document.createElement("p");
    order.className = "ingredient-line";
    const orderLabel = document.createElement("strong");
    orderLabel.textContent = t("availableIngredients");
    order.append(orderLabel, ` ${suggestion.ingredients.join(" → ")}`);
    const method = document.createElement("p");
    method.className = "method";
    method.textContent = suggestion.method;
    content.append(eyebrow, heading, badge, reason, order, method);
    if (favoriteEnabled) {
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "button button--quiet favorite-button";
      const active = favorites.includes(suggestion.id);
      favorite.dataset.suggestionId = suggestion.id;
      favorite.textContent = active ? t("removeFavorite") : t("favorite");
      favorite.setAttribute("aria-pressed", String(active));
      favorite.setAttribute("aria-label", t(active ? "favoriteRemoveAria" : "favoriteAddAria", { title: suggestion.title }));
      favorite.addEventListener("click", async () => {
        favorites = active ? favorites.filter((id) => id !== suggestion.id) : [...favorites, suggestion.id];
        const result = await persist((state) => ({
          ...state,
          favorites: active ? state.favorites.filter((id) => id !== suggestion.id) : [...new Set([...state.favorites, suggestion.id])],
        }), true);
        renderSuggestions(currentSuggestions);
        renderFavorites();
        focusFavoriteButton(suggestion.id);
        announce(persistenceMessage(
          result,
          t(active ? "favoriteRemoved" : "favorited"),
          t(active ? "favoriteRemovedSessionOnly" : "favoritedSessionOnly"),
          t("favoriteConflict"),
        ), result.status === "saved" ? "success" : "warning");
      });
      content.append(favorite);
    }
    card.append(content);
    return card;
  }

  function renderSuggestions(items = [], preserveCurrentSuggestions = false) {
    const usable = usableSuggestions(items, ingredients);
    if (!preserveCurrentSuggestions) {
      currentSuggestions = usable;
      showingAlternativeMenus = false;
    }
    suggestions.replaceChildren();
    if (!usable.length) {
      alternativeMenusButton.hidden = true;
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = t("suggestionsEmpty", { min: MIN_INGREDIENTS, max: MAX_INGREDIENTS });
      suggestions.append(empty);
      return;
    }
    usable.forEach((item) => suggestions.append(mealCard(item, !preserveCurrentSuggestions)));
    const alternatives = generateSuggestions(ingredients, undefined, locale, { offset: 3 });
    alternativeMenusButton.hidden = alternatives.length !== SUGGESTIONS_LIMIT;
    alternativeMenusButton.textContent = t(showingAlternativeMenus ? "firstMenus" : "otherMenus");
  }

  function renderFavorites() {
    favoritesList.replaceChildren();
    const known = usableSuggestions(history.flatMap((entry) => entry.suggestions), ingredients)
      .filter((item) => favorites.includes(item.id));
    const unique = [...new Map(known.map((item) => [item.id, item])).values()];
    if (!unique.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = t("favoritesEmpty");
      favoritesList.append(empty);
      return;
    }
    unique.forEach((item) => favoritesList.append(mealCard(item)));
  }

  function renderHistory() {
    historyList.replaceChildren();
    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = t("historyEmpty");
      historyList.append(empty);
      return;
    }
    [...history].reverse().forEach((entry) => {
      const usable = usableSuggestions(entry.suggestions, ingredients);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-button";
      button.dataset.historyId = entry.id;
      button.disabled = usable.length === 0;
      const createdAt = new Date(entry.createdAt).toLocaleString(locale === "ko" ? "ko-KR" : "en-US");
      button.textContent = usable.length
        ? `${createdAt} · ${usable.map((item) => item.title).join(", ")}`
        : `${createdAt} · ${t("historyUnavailable")}`;
      button.addEventListener("click", () => {
        renderSuggestions(usable);
        document.querySelector("#menu-heading").focus();
      });
      historyList.append(button);
    });
  }

  function render() {
    list.replaceChildren();
    const ordered = sortUseFirst(ingredients);
    for (const item of ordered) {
      const row = document.createElement("li");
      row.className = `ingredient-item ingredient-item--${item.urgency}`;
      row.dataset.ingredientId = item.id;
      const dot = document.createElement("span");
      dot.className = `urgency-dot urgency-dot--${item.urgency}`;
      dot.setAttribute("aria-hidden", "true");
      const ingredientName = document.createElement("span");
      ingredientName.className = "ingredient-item__name";
      ingredientName.textContent = item.name;
      const expiry = document.createElement("span");
      expiry.className = "urgency-label";
      const urgencyKeys = { "use-now": "urgencyUseNow", "use-soon": "urgencyUseSoon", stable: "urgencyStable", expired: "urgencyExpired" };
      expiry.textContent = item.expiryDate
        ? `${t(urgencyKeys[item.urgency] ?? "urgencyStable")} · ${item.expiryDate}`
        : t("noDateLabel");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-button";
      remove.textContent = t("removeIngredient");
      remove.setAttribute("aria-label", t("removeIngredientAria", { name: item.name }));
      remove.addEventListener("click", async () => {
        const position = ordered.findIndex((candidate) => candidate.id === item.id);
        const focusId = ordered[position + 1]?.id ?? ordered[position - 1]?.id;
        ingredients = ingredients.filter((candidate) => candidate.id !== item.id);
        const result = await persist((state) => ({ ...state, ingredients: state.ingredients.filter((candidate) => candidate.id !== item.id) }), true);
        render();
        renderSuggestions();
        renderFavorites();
        renderHistory();
        focusIngredientAfterRemoval(focusId);
        announce(persistenceMessage(result, t("ingredientRemoved", { name: item.name }), t("ingredientRemovedSessionOnly", { name: item.name }), t("ingredientRemovedConflict", { name: item.name })), result.status === "saved" ? "neutral" : "warning");
      });
      row.append(dot, ingredientName, expiry, remove);
      list.append(row);
    }
    count.textContent = `${ingredients.length} / ${MAX_INGREDIENTS}`;
    count.setAttribute("aria-label", t("ingredientCountLabel", { count: ingredients.length, max: MAX_INGREDIENTS }));
    suggestButton.disabled = ingredients.length < MIN_INGREDIENTS;
    clearButton.disabled = ingredients.length === 0;
    nameInput.disabled = ingredients.length >= MAX_INGREDIENTS;
    expiryInput.disabled = ingredients.length >= MAX_INGREDIENTS;
    useFirst.textContent = ordered.map((item) => item.name).join(" → ") || t("useFirstEmpty");
    renderQuickIngredients();
  }

  function refreshRenderedStatePreservingFocus() {
    const focusSnapshot = captureDynamicFocus();
    render();
    renderSuggestions(currentSuggestions);
    renderFavorites();
    renderHistory();
    restoreDynamicFocus(focusSnapshot);
  }

  function syncFromStorageIfChanged() {
    if (!storage || hasSessionOnlyChanges) return "unchanged";
    try {
      const latestRaw = storage.getItem(STORAGE_KEY);
      if (latestRaw === lastKnownRaw) return "unchanged";
      applyState(parseStoredState(latestRaw));
      lastKnownRaw = latestRaw;
      return "updated";
    } catch {
      return "blocked";
    }
  }

  function scheduleDayRollover() {
    window.clearTimeout(dayRolloverTimer);
    dayRolloverTimer = window.setTimeout(() => {
      refreshRenderedStatePreservingFocus();
      announce(t("dayRollover"));
      scheduleDayRollover();
    }, millisecondsUntilNextLocalDay());
  }

  form.addEventListener("input", (event) => {
    if (event.target === nameInput || event.target === expiryInput) clearFormErrors([event.target]);
  });

  async function addIngredient(rawName, expiryDate = "") {
    const name = normalizeName(rawName);
    if (!name) {
      showFormError(t("errorNameRequired"), [nameInput]);
      return false;
    }
    if (expiryDate && getExpiryStatus(expiryDate) === "expired") {
      showFormError(t("errorExpiredNotAdded"), [expiryInput]);
      return false;
    }
    if (ingredients.length >= MAX_INGREDIENTS || ingredients.some((item) => item.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"))) {
      if (ingredients.length >= MAX_INGREDIENTS) {
        showFormError(t("errorListFull"), []);
        clearButton.focus();
      } else {
        showFormError(t("errorDuplicate", { name }), [nameInput]);
      }
      return false;
    }
    clearFormErrors();
    const ingredient = expiryDate
      ? { id: `ingredient-${tabId}-${nextSequence}`, name, expiryDate, sequence: nextSequence++ }
      : { id: `ingredient-${tabId}-${nextSequence}`, name, urgency: "stable", sequence: nextSequence++ };
    ingredients.push(ingredient);
    const result = await persist((state) => {
      if (state.ingredients.length >= MAX_INGREDIENTS || state.ingredients.some((item) => item.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"))) return null;
      const sequence = state.ingredients.reduce((max, item) => Math.max(max, item.sequence + 1), 0);
      return { ...state, ingredients: [...state.ingredients, { ...ingredient, sequence }] };
    });
    render();
    renderSuggestions();
    renderFavorites();
    renderHistory();
    form.reset();
    nameInput.focus();
    announce(persistenceMessage(result, t("ingredientAdded", { name }), t("ingredientAddedSessionOnly", { name }), t("ingredientAddedConflict", { name })), result.status === "saved" ? "success" : "warning");
    return true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addIngredient(nameInput.value, expiryInput.value);
  });

  suggestButton.addEventListener("click", async () => {
    const validation = validateIngredients(ingredients);
    if (!validation.ok) {
      announce(t(`validation.${validation.code}`, { ...validation.params, min: MIN_INGREDIENTS, max: MAX_INGREDIENTS }), "error");
      return;
    }
    const menuId = `menu-${tabId}-${nextMenuSequence++}`;
    const generated = bindSuggestionsToMenu(menuId, generateSuggestions(ingredients, undefined, locale));
    showingAlternativeMenus = false;
    history.push({ id: menuId, createdAt: new Date().toISOString(), suggestions: generated });
    history = history.slice(-HISTORY_LIMIT);
    const result = await persist((state) => {
      if (!validateIngredients(state.ingredients).ok) return null;
      const latestSuggestions = bindSuggestionsToMenu(menuId, generateSuggestions(state.ingredients, undefined, locale));
      return { ...state, history: [...state.history, { id: menuId, createdAt: new Date().toISOString(), suggestions: latestSuggestions }].slice(-HISTORY_LIMIT) };
    });
    renderSuggestions(result.status === "blocked" ? generated : currentSuggestions);
    renderHistory();
    announce(persistenceMessage(result, t("menuReady"), t("menuReadySessionOnly"), t("menuReadyConflict")), result.status === "saved" ? "success" : "warning");
    document.querySelector("#menu-heading").focus();
  });

  alternativeMenusButton.addEventListener("click", () => {
    if (showingAlternativeMenus) {
      showingAlternativeMenus = false;
      renderSuggestions(currentSuggestions);
    } else {
      const alternatives = generateSuggestions(ingredients, undefined, locale, { offset: 3 });
      if (alternatives.length !== SUGGESTIONS_LIMIT) return;
      showingAlternativeMenus = true;
      renderSuggestions(alternatives, true);
    }
  });

  clearButton.addEventListener("click", async () => {
    ingredients = [];
    nextSequence = 0;
    const result = await persist((state) => ({ ...state, ingredients: [] }), true);
    render();
    renderSuggestions();
    renderFavorites();
    renderHistory();
    announce(persistenceMessage(result, t("listCleared"), t("listClearedSessionOnly"), t("listClearedConflict")), result.status === "saved" ? "neutral" : "warning");
    nameInput.focus();
  });

  langToggle.addEventListener("click", () => {
    locale = locale === "ko" ? "en" : "ko";
    saveStoredLocale(storage, locale);
    applyStaticTranslations(document, locale);
    refreshRenderedStatePreservingFocus();
    announce(t("langChanged"));
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      announce(t(choice?.outcome === "accepted" ? "installAccepted" : "installDismissed"), choice?.outcome === "accepted" ? "success" : "neutral");
    } catch {
      announce(t("installFailed"), "warning");
    } finally {
      installPrompt = undefined;
      installButton.hidden = true;
      document.querySelector(".brand").focus();
    }
  });
  window.addEventListener("appinstalled", () => announce(t("appInstalled"), "success"));

  window.addEventListener("storage", (event) => {
    if ((event.storageArea && event.storageArea !== storage) || (event.key !== STORAGE_KEY && event.key !== null)) return;
    const externalRaw = event.key === null ? null : event.newValue;
    if (externalRaw === lastKnownRaw) return;
    if (hasSessionOnlyChanges) {
      announce(t("anotherTabConflict"), "warning");
      return;
    }
    const external = parseStoredState(externalRaw);
    applyState(external);
    lastKnownRaw = externalRaw;
    refreshRenderedStatePreservingFocus();
    announce(t("updatedFromTab"));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const syncStatus = syncFromStorageIfChanged();
    refreshRenderedStatePreservingFocus();
    scheduleDayRollover();
    if (syncStatus === "updated") announce(t("updatedOnReturn"));
    if (syncStatus === "blocked") announce(t("checkBlockedOnReturn"), "warning");
  });

  render();
  renderSuggestions(currentSuggestions);
  renderFavorites();
  renderHistory();
  scheduleDayRollover();
  announce(storageReadBlocked
    ? t("storageBlocked")
    : ingredients.length ? t("restoredIngredients", { count: ingredients.length }) : t("readyForIngredients"),
  storageReadBlocked ? "warning" : "neutral");

  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => announce(t("offlineCacheUnavailable"), "warning"));
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
