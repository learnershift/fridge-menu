import {
  MAX_INGREDIENTS,
  MIN_INGREDIENTS,
  generateSuggestions,
  getExpiryStatus,
  normalizeName,
  sortUseFirst,
  validateIngredients,
} from "./meal-engine.js";

export const STORAGE_KEY = "fridge-menu:v1";
export const STORAGE_VERSION = 1;
export const STATE_VERSION = 2;
export const HISTORY_LIMIT = 10;
export const FAVORITES_LIMIT = HISTORY_LIMIT * 3;
export const MAX_STORED_TEXT_LENGTH = 512;

const MAX_RAW_STORAGE_LENGTH = 128 * 1024;
const INGREDIENT_NAME_LIMIT = 48;
const SUGGESTIONS_LIMIT = 3;

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

function sanitizeSuggestion(value) {
  if (!value || typeof value !== "object") return null;
  const id = validText(value.id);
  const title = validText(value.title);
  const anchor = validText(value.anchor, INGREDIENT_NAME_LIMIT);
  const useFirstReason = validText(value.useFirstReason);
  const method = validText(value.method);
  if (!id || !title || !anchor || !useFirstReason || !method || !Array.isArray(value.ingredients)) return null;
  const ingredients = value.ingredients.slice(0, MAX_INGREDIENTS).map(validName).filter(Boolean);
  if (!ingredients.length) return null;
  return { id, title, anchor, ingredients, useFirstReason, method };
}

function sanitizeHistoryEntry(value) {
  if (!value || typeof value !== "object") return null;
  const id = validText(value.id);
  const createdAt = validText(value.createdAt);
  if (!id || !createdAt || !Number.isFinite(Date.parse(createdAt)) || !Array.isArray(value.suggestions)) return null;
  const suggestionIds = new Set();
  const suggestions = value.suggestions.slice(0, SUGGESTIONS_LIMIT).map(sanitizeSuggestion).filter((suggestion) => {
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
  const history = Array.isArray(state?.history)
    ? state.history.slice(-HISTORY_LIMIT).map(sanitizeHistoryEntry).filter(Boolean)
      .filter((entry) => {
        if (historyIds.has(entry.id)) return false;
        historyIds.add(entry.id);
        return true;
      })
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
  return suggestions.filter((suggestion) => Array.isArray(suggestion?.ingredients) &&
    suggestion.ingredients.every((name) => available.has(normalizeName(name).toLocaleLowerCase("en-US"))));
}

export function bindSuggestionsToMenu(menuId, suggestions) {
  const validMenuId = validText(menuId);
  if (!validMenuId || !Array.isArray(suggestions)) return [];
  return suggestions.map((suggestion) => ({ ...suggestion, id: `${validMenuId}:${suggestion.id}` }));
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

function boot() {
  const form = document.querySelector("#ingredient-form");
  const nameInput = document.querySelector("#ingredient-name");
  const expiryInput = document.querySelector("#ingredient-expiry");
  const list = document.querySelector("#ingredient-list");
  const count = document.querySelector("#ingredient-count");
  const status = document.querySelector("#status-message");
  const suggestButton = document.querySelector("#suggest-button");
  const clearButton = document.querySelector("#clear-button");
  const suggestions = document.querySelector("#suggestions");
  const favoritesList = document.querySelector("#favorites-list");
  const historyList = document.querySelector("#history-list");
  const useFirst = document.querySelector("#use-first-preview");
  const installButton = document.querySelector("#install-button");

  let storageReadBlocked = false;
  const storage = accessStorage(window, () => { storageReadBlocked = true; });
  const restored = storage
    ? loadState(storage, () => { storageReadBlocked = true; })
    : emptyState();
  let ingredients = restored.ingredients;
  let favorites = restored.favorites;
  let history = restored.history;
  let currentSuggestions = history.at(-1)?.suggestions ?? [];
  let installPrompt;
  let nextSequence = ingredients.reduce((max, item) => Math.max(max, item.sequence + 1), 0);
  let nextMenuSequence = history.length;

  function announce(message, tone = "neutral") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function persist() {
    try {
      if (!storage) throw new Error("Local storage unavailable");
      storage.setItem(STORAGE_KEY, serializeState({ ingredients, favorites, history }));
    } catch {
      announce("This browser blocked local saving; changes last only for this session.", "warning");
    }
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

  function mealCard(suggestion, favoriteEnabled = true) {
    const card = document.createElement("article");
    card.className = "meal-card";
    const content = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = `Use ${suggestion.anchor} first`;
    const heading = document.createElement("h3");
    heading.textContent = suggestion.title;
    const reason = document.createElement("p");
    reason.textContent = suggestion.useFirstReason;
    const order = document.createElement("p");
    order.className = "ingredient-line";
    const orderLabel = document.createElement("strong");
    orderLabel.textContent = "Available ingredients:";
    order.append(orderLabel, ` ${suggestion.ingredients.join(" → ")}`);
    const method = document.createElement("p");
    method.className = "method";
    method.textContent = suggestion.method;
    content.append(eyebrow, heading, reason, order, method);
    if (favoriteEnabled) {
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "button button--quiet favorite-button";
      const active = favorites.includes(suggestion.id);
      favorite.dataset.suggestionId = suggestion.id;
      favorite.textContent = active ? "Remove favorite" : "Favorite";
      favorite.setAttribute("aria-pressed", String(active));
      favorite.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${suggestion.title} ${active ? "from" : "to"} favorites`);
      favorite.addEventListener("click", () => {
        favorites = active ? favorites.filter((id) => id !== suggestion.id) : [...favorites, suggestion.id];
        persist();
        renderSuggestions(currentSuggestions);
        renderFavorites();
        focusFavoriteButton(suggestion.id);
        announce(active ? "Favorite removed." : "Meal idea favorited.", "success");
      });
      content.append(favorite);
    }
    card.append(content);
    return card;
  }

  function renderSuggestions(items = []) {
    const usable = usableSuggestions(items, ingredients);
    currentSuggestions = usable;
    suggestions.replaceChildren();
    if (!usable.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = `Add ${MIN_INGREDIENTS}–${MAX_INGREDIENTS} ingredients, then make a menu.`;
      suggestions.append(empty);
      return;
    }
    usable.forEach((item) => suggestions.append(mealCard(item)));
  }

  function renderFavorites() {
    favoritesList.replaceChildren();
    const known = usableSuggestions(history.flatMap((entry) => entry.suggestions), ingredients)
      .filter((item) => favorites.includes(item.id));
    const unique = [...new Map(known.map((item) => [item.id, item])).values()];
    if (!unique.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Favorite a meal idea to keep it here.";
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
      empty.textContent = "Your recent generated menus will appear here.";
      historyList.append(empty);
      return;
    }
    [...history].reverse().forEach((entry) => {
      const usable = usableSuggestions(entry.suggestions, ingredients);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-button";
      button.disabled = usable.length === 0;
      button.textContent = usable.length
        ? `${new Date(entry.createdAt).toLocaleString()} · ${usable.map((item) => item.title).join(", ")}`
        : `${new Date(entry.createdAt).toLocaleString()} · unavailable because ingredients changed or expired`;
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
      expiry.textContent = item.expiryDate
        ? `${item.urgency.replace("-", " ")} · ${item.expiryDate}`
        : `${item.urgency.replace("-", " ")} · legacy priority`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${item.name}`);
      remove.addEventListener("click", () => {
        const position = ordered.findIndex((candidate) => candidate.id === item.id);
        const focusId = ordered[position + 1]?.id ?? ordered[position - 1]?.id;
        ingredients = ingredients.filter((candidate) => candidate.id !== item.id);
        persist();
        render();
        renderSuggestions();
        renderFavorites();
        renderHistory();
        focusIngredientAfterRemoval(focusId);
        announce(`${item.name} removed.`);
      });
      row.append(dot, ingredientName, expiry, remove);
      list.append(row);
    }
    count.textContent = `${ingredients.length} / ${MAX_INGREDIENTS}`;
    count.setAttribute("aria-label", `Ingredient count: ${ingredients.length} of ${MAX_INGREDIENTS}`);
    suggestButton.disabled = ingredients.length < MIN_INGREDIENTS;
    clearButton.disabled = ingredients.length === 0;
    nameInput.disabled = ingredients.length >= MAX_INGREDIENTS;
    expiryInput.disabled = ingredients.length >= MAX_INGREDIENTS;
    useFirst.textContent = ordered.map((item) => item.name).join(" → ") || "Your use-first order will appear here.";
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = normalizeName(nameInput.value);
    if (!name || !expiryInput.value) {
      announce("Enter an ingredient and expiry date.", "error");
      return;
    }
    if (getExpiryStatus(expiryInput.value) === "expired") {
      announce("Remove expired ingredients before adding new ones.", "error");
      return;
    }
    if (ingredients.length >= MAX_INGREDIENTS || ingredients.some((item) => item.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"))) {
      announce(ingredients.length >= MAX_INGREDIENTS ? "Your fridge list is full." : `“${name}” is already in your fridge.`, "error");
      return;
    }
    ingredients.push({ id: `ingredient-${Date.now()}-${nextSequence}`, name, expiryDate: expiryInput.value, sequence: nextSequence++ });
    persist();
    render();
    renderSuggestions();
    renderFavorites();
    renderHistory();
    form.reset();
    nameInput.focus();
    announce(`${name} added.`, "success");
  });

  suggestButton.addEventListener("click", () => {
    const validation = validateIngredients(ingredients);
    if (!validation.ok) { announce(validation.message, "error"); return; }
    const menuId = `menu-${Date.now()}-${nextMenuSequence++}`;
    const generated = bindSuggestionsToMenu(menuId, generateSuggestions(ingredients));
    history.push({ id: menuId, createdAt: new Date().toISOString(), suggestions: generated });
    history = history.slice(-HISTORY_LIMIT);
    persist();
    renderSuggestions(generated);
    renderHistory();
    announce("Three offline use-first ideas are ready.", "success");
    document.querySelector("#menu-heading").focus();
  });

  clearButton.addEventListener("click", () => {
    ingredients = [];
    nextSequence = 0;
    persist();
    render();
    renderSuggestions();
    renderFavorites();
    renderHistory();
    announce("Fridge list cleared.");
    nameInput.focus();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = undefined;
    installButton.hidden = true;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    render();
    renderSuggestions(currentSuggestions);
    renderFavorites();
    renderHistory();
  });

  render();
  renderSuggestions(currentSuggestions);
  renderFavorites();
  renderHistory();
  announce(storageReadBlocked
    ? "This browser blocked local storage; changes last only for this session."
    : ingredients.length ? `Restored ${ingredients.length} locally saved ingredients.` : "Ready for your ingredients.",
  storageReadBlocked ? "warning" : "neutral");

  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => announce("Offline caching is unavailable in this browser.", "warning"));
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
