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

const VALID_URGENCIES = new Set(["use-now", "use-soon", "stable"]);
const EMPTY_STATE = Object.freeze({ ingredients: [], favorites: [], history: [] });

function isStoredIngredient(value, index) {
  return Boolean(
    value && typeof value === "object" && typeof value.id === "string" && normalizeName(value.name) &&
    VALID_URGENCIES.has(value.urgency) && Number.isInteger(value.sequence) && value.sequence >= 0 &&
    value.sequence >= index - MAX_INGREDIENTS,
  );
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
    return new Set(names).size === names.length ? normalized : [];
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
  try {
    const payload = JSON.parse(raw);
    if (payload?.version === STORAGE_VERSION) {
      return { ingredients: parseStoredIngredients(raw), favorites: [], history: [] };
    }
    if (payload?.version !== STATE_VERSION || !Array.isArray(payload.ingredients)) return emptyState();
    const ingredients = payload.ingredients
      .filter((item) => item && typeof item.id === "string" && normalizeName(item.name) && typeof item.expiryDate === "string" && Number.isInteger(item.sequence))
      .slice(0, MAX_INGREDIENTS)
      .map((item) => ({ id: item.id, name: normalizeName(item.name), expiryDate: item.expiryDate, sequence: item.sequence }));
    const favorites = Array.isArray(payload.favorites)
      ? [...new Set(payload.favorites.filter((value) => typeof value === "string"))]
      : [];
    const history = Array.isArray(payload.history)
      ? payload.history.filter((entry) => entry && typeof entry.id === "string" && Array.isArray(entry.suggestions)).slice(-HISTORY_LIMIT)
      : [];
    return { ingredients, favorites, history };
  } catch {
    return emptyState();
  }
}

export function serializeState(state) {
  return JSON.stringify({
    version: STATE_VERSION,
    ingredients: Array.isArray(state?.ingredients) ? state.ingredients.slice(0, MAX_INGREDIENTS) : [],
    favorites: [...new Set(Array.isArray(state?.favorites) ? state.favorites.filter((value) => typeof value === "string") : [])],
    history: Array.isArray(state?.history) ? state.history.slice(-HISTORY_LIMIT) : [],
  });
}

export function loadIngredients(storage) {
  try { return parseStoredIngredients(storage?.getItem(STORAGE_KEY)); } catch { return []; }
}

export function saveIngredients(storage, ingredients) {
  try {
    storage?.setItem(STORAGE_KEY, serializeIngredients(ingredients));
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

  const restored = parseStoredState(window.localStorage.getItem(STORAGE_KEY));
  let ingredients = restored.ingredients;
  let favorites = restored.favorites;
  let history = restored.history;
  let currentSuggestions = history.at(-1)?.suggestions ?? [];
  let installPrompt;
  let nextSequence = ingredients.reduce((max, item) => Math.max(max, item.sequence + 1), 0);

  function announce(message, tone = "neutral") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeState({ ingredients, favorites, history }));
    } catch {
      announce("This browser blocked local saving; changes last only for this session.", "warning");
    }
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
      favorite.textContent = active ? "Remove favorite" : "Favorite";
      favorite.setAttribute("aria-pressed", String(active));
      favorite.addEventListener("click", () => {
        favorites = active ? favorites.filter((id) => id !== suggestion.id) : [...favorites, suggestion.id];
        persist();
        renderSuggestions(currentSuggestions);
        renderFavorites();
        announce(active ? "Favorite removed." : "Meal idea favorited.", "success");
      });
      content.append(favorite);
    }
    card.append(content);
    return card;
  }

  function renderSuggestions(items = []) {
    currentSuggestions = items;
    suggestions.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = `Add ${MIN_INGREDIENTS}–${MAX_INGREDIENTS} ingredients, then make a menu.`;
      suggestions.append(empty);
      return;
    }
    items.forEach((item) => suggestions.append(mealCard(item)));
  }

  function renderFavorites() {
    favoritesList.replaceChildren();
    const known = history.flatMap((entry) => entry.suggestions).filter((item) => favorites.includes(item.id));
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
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-button";
      button.textContent = `${new Date(entry.createdAt).toLocaleString()} · ${entry.suggestions.map((item) => item.title).join(", ")}`;
      button.addEventListener("click", () => {
        renderSuggestions(entry.suggestions);
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
      const dot = document.createElement("span");
      dot.className = `urgency-dot urgency-dot--${item.urgency}`;
      dot.setAttribute("aria-hidden", "true");
      const ingredientName = document.createElement("span");
      ingredientName.className = "ingredient-item__name";
      ingredientName.textContent = item.name;
      const expiry = document.createElement("span");
      expiry.className = "urgency-label";
      expiry.textContent = `${item.urgency.replace("-", " ")} · ${item.expiryDate}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${item.name}`);
      remove.addEventListener("click", () => {
        ingredients = ingredients.filter((candidate) => candidate.id !== item.id);
        persist();
        render();
        renderSuggestions();
        announce(`${item.name} removed.`);
      });
      row.append(dot, ingredientName, expiry, remove);
      list.append(row);
    }
    count.textContent = `${ingredients.length} / ${MAX_INGREDIENTS}`;
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
    form.reset();
    nameInput.focus();
    announce(`${name} added.`, "success");
  });

  suggestButton.addEventListener("click", () => {
    const validation = validateIngredients(ingredients);
    if (!validation.ok) { announce(validation.message, "error"); return; }
    const generated = generateSuggestions(ingredients);
    history.push({ id: `menu-${Date.now()}`, createdAt: new Date().toISOString(), suggestions: generated });
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

  render();
  renderSuggestions(currentSuggestions);
  renderFavorites();
  renderHistory();
  announce(ingredients.length ? `Restored ${ingredients.length} locally saved ingredients.` : "Ready for your ingredients.");

  if ("serviceWorker" in navigator && window.isSecureContext && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => announce("Offline caching is unavailable in this browser.", "warning"));
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
