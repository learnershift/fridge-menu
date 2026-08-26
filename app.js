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

export async function commitStateTransaction(locks, storage, mutate) {
  try {
    if (!locks || typeof locks.request !== "function" || !storage ||
        typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return { status: "blocked" };
    return await locks.request(`${STORAGE_KEY}:writer`, { mode: "exclusive" }, async () => {
      const currentRaw = storage.getItem(STORAGE_KEY);
      const current = parseStoredState(currentRaw);
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
    nextMenuSequence = history.length;
  }

  async function persist(mutate) {
    const result = await commitStateTransaction(navigator.locks, storage, mutate);
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
      favorite.addEventListener("click", async () => {
        favorites = active ? favorites.filter((id) => id !== suggestion.id) : [...favorites, suggestion.id];
        const result = await persist((state) => ({
          ...state,
          favorites: active ? state.favorites.filter((id) => id !== suggestion.id) : [...new Set([...state.favorites, suggestion.id])],
        }));
        renderSuggestions(currentSuggestions);
        renderFavorites();
        focusFavoriteButton(suggestion.id);
        announce(persistenceMessage(
          result,
          active ? "Favorite removed." : "Meal idea favorited.",
          `${active ? "Favorite removed" : "Meal idea favorited"} for this session only; safe multi-tab saving is unavailable.`,
          "Favorite change was not applied because another tab changed the saved data. Try again.",
        ), result.status === "saved" ? "success" : "warning");
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
      remove.addEventListener("click", async () => {
        const position = ordered.findIndex((candidate) => candidate.id === item.id);
        const focusId = ordered[position + 1]?.id ?? ordered[position - 1]?.id;
        ingredients = ingredients.filter((candidate) => candidate.id !== item.id);
        const result = await persist((state) => ({ ...state, ingredients: state.ingredients.filter((candidate) => candidate.id !== item.id) }));
        render();
        renderSuggestions();
        renderFavorites();
        renderHistory();
        focusIngredientAfterRemoval(focusId);
        announce(persistenceMessage(result, `${item.name} removed.`, `${item.name} removed for this session only; safe multi-tab saving is unavailable.`, `${item.name} was not removed because another tab changed the saved data. Try again.`), result.status === "saved" ? "neutral" : "warning");
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

  function scheduleDayRollover() {
    window.clearTimeout(dayRolloverTimer);
    dayRolloverTimer = window.setTimeout(() => {
      render();
      renderSuggestions(currentSuggestions);
      renderFavorites();
      renderHistory();
      announce("Freshness updated for a new day.");
      scheduleDayRollover();
    }, millisecondsUntilNextLocalDay());
  }

  form.addEventListener("input", (event) => {
    if (event.target === nameInput || event.target === expiryInput) clearFormErrors([event.target]);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = normalizeName(nameInput.value);
    if (!name || !expiryInput.value) {
      const invalidFields = [!name && nameInput, !expiryInput.value && expiryInput].filter(Boolean);
      showFormError("Enter an ingredient and expiry date.", invalidFields);
      return;
    }
    if (getExpiryStatus(expiryInput.value) === "expired") {
      showFormError("Remove expired ingredients before adding new ones.", [expiryInput]);
      return;
    }
    if (ingredients.length >= MAX_INGREDIENTS || ingredients.some((item) => item.name.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"))) {
      if (ingredients.length >= MAX_INGREDIENTS) {
        showFormError("Your fridge list is full.", []);
        clearButton.focus();
      } else {
        showFormError(`“${name}” is already in your fridge.`, [nameInput]);
      }
      return;
    }
    clearFormErrors();
    const ingredient = { id: `ingredient-${tabId}-${nextSequence}`, name, expiryDate: expiryInput.value, sequence: nextSequence++ };
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
    announce(persistenceMessage(result, `${name} added.`, `${name} added for this session only; safe multi-tab saving is unavailable.`, `${name} was not added because another tab changed the saved data. Check the list and try again.`), result.status === "saved" ? "success" : "warning");
  });

  suggestButton.addEventListener("click", async () => {
    const validation = validateIngredients(ingredients);
    if (!validation.ok) { announce(validation.message, "error"); return; }
    const menuId = `menu-${tabId}-${nextMenuSequence++}`;
    const generated = bindSuggestionsToMenu(menuId, generateSuggestions(ingredients));
    history.push({ id: menuId, createdAt: new Date().toISOString(), suggestions: generated });
    history = history.slice(-HISTORY_LIMIT);
    const result = await persist((state) => {
      if (!validateIngredients(state.ingredients).ok) return null;
      const latestSuggestions = bindSuggestionsToMenu(menuId, generateSuggestions(state.ingredients));
      return { ...state, history: [...state.history, { id: menuId, createdAt: new Date().toISOString(), suggestions: latestSuggestions }].slice(-HISTORY_LIMIT) };
    });
    renderSuggestions(result.status === "blocked" ? generated : currentSuggestions);
    renderHistory();
    announce(persistenceMessage(result, "Three offline use-first ideas are ready.", "Three ideas are ready for this session only; safe multi-tab saving is unavailable.", "A menu was not created because another tab changed the saved ingredients. Check the list and try again."), result.status === "saved" ? "success" : "warning");
    document.querySelector("#menu-heading").focus();
  });

  clearButton.addEventListener("click", async () => {
    ingredients = [];
    nextSequence = 0;
    const result = await persist((state) => ({ ...state, ingredients: [] }));
    render();
    renderSuggestions();
    renderFavorites();
    renderHistory();
    announce(persistenceMessage(result, "Fridge list cleared.", "Fridge list cleared for this session only; safe multi-tab saving is unavailable.", "The list was not cleared because another tab changed the saved data. Try again."), result.status === "saved" ? "neutral" : "warning");
    nameInput.focus();
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
      announce(choice?.outcome === "accepted" ? "Installation accepted." : "Installation dismissed.", choice?.outcome === "accepted" ? "success" : "neutral");
    } catch {
      announce("Installation could not be started.", "warning");
    } finally {
      installPrompt = undefined;
      installButton.hidden = true;
    }
  });
  window.addEventListener("appinstalled", () => announce("Fridge Menu installed.", "success"));

  window.addEventListener("storage", (event) => {
    if ((event.storageArea && event.storageArea !== storage) || (event.key !== STORAGE_KEY && event.key !== null)) return;
    const externalRaw = event.key === null ? null : event.newValue;
    if (externalRaw === lastKnownRaw) return;
    if (hasSessionOnlyChanges) {
      announce("Another tab changed saved data. This tab has session-only changes; reload before saving again.", "warning");
      return;
    }
    const external = parseStoredState(externalRaw);
    applyState(external);
    lastKnownRaw = externalRaw;
    render();
    renderSuggestions(currentSuggestions);
    renderFavorites();
    renderHistory();
    announce("Updated from another tab.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    render();
    renderSuggestions(currentSuggestions);
    renderFavorites();
    renderHistory();
    scheduleDayRollover();
  });

  render();
  renderSuggestions(currentSuggestions);
  renderFavorites();
  renderHistory();
  scheduleDayRollover();
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
