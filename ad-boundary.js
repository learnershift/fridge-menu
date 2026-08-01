export const AD_PLACEHOLDER = Object.freeze({
  mode: "placeholder-only",
  providerDirection: "Google AdMob (future evaluation)",
  networkRequests: false,
  sdkLoaded: false,
  productionIdentifier: null,
});

export function renderAdPlaceholder(container) {
  if (!container) return;
  container.replaceChildren();
  const label = document.createElement("p");
  label.className = "ad-placeholder__label";
  label.textContent = "Advertising placeholder";
  const detail = document.createElement("p");
  detail.className = "ad-placeholder__detail";
  detail.textContent = "Test boundary only — no SDK, live ad, tracking, account, or production ad unit is connected.";
  container.append(label, detail);
}
