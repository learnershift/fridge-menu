export const LOCALE_STORAGE_KEY = "fridge-menu:locale:v1";
export const SUPPORTED_LOCALES = Object.freeze(["en", "ko"]);

export function normalizeLocale(value) {
  if (typeof value !== "string") return null;
  const lower = value.toLocaleLowerCase("en-US");
  if (lower === "ko" || lower.startsWith("ko-")) return "ko";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  return null;
}

export function detectLocale(candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return "en";
}

export const STRINGS = Object.freeze({
  en: Object.freeze({
    appTitle: "Fridge Menu — use what matters first",
    langToggle: "한국어",
    langToggleAria: "한국어로 보기",
    langChanged: "Language switched to English.",
    skipLink: "Skip to main content",
    headerNote: "Local-first · no account needed",
    installApp: "Install app",
    heroEyebrow: "Cook the food that needs you",
    heroTitleLead: "A calmer answer to",
    heroTitleQuote: "“what should we eat?”",
    heroCopy: "Add what is in your fridge, and get three dependable meal directions led by what needs using first. Your list stays on this device.",
    heroCardStrong: "ideas, every time.",
    heroCardCopy: "Urgent ingredients lead. Your original order breaks ties. No random shuffle.",
    step1Eyebrow: "Step 1",
    fridgeHeading: "Build your fridge list",
    ingredientLabel: "Ingredient",
    expiryLabel: "Expiry date (optional)",
    ingredientPlaceholder: "e.g. spinach",
    addIngredient: "Add ingredient",
    useFirstBoxLabel: "Use-first order",
    useFirstEmpty: "Your use-first order will appear here.",
    makeMenu: "Make my menu",
    clearList: "Clear list",
    step2Eyebrow: "Step 2",
    menuHeading: "Your flexible menu",
    menuIntro: "These are adaptable cooking directions, not recipes or nutrition advice. Use pantry basics and season to your needs.",
    savedLocally: "Saved locally",
    favoritesHeading: "Favorites",
    recentMenus: "Recent menus",
    historyHeading: "History",
    scopeEyebrow: "Transparent by design",
    scopeHeading: "Your food data stays with you.",
    scopeCopy: "Fridge Menu works without an account, analytics, tracking, or credentialed APIs. Clear list removes ingredients only. Clear the app or browser storage, or uninstall the app, to remove ingredients, favorites, and history.",
    privacyEyebrow: "Privacy policy",
    privacyHeading: "Local data, under your control.",
    privacyCopy: "Fridge Menu has no account, analytics, advertising SDK, tracking, or remote API. Your ingredient list, favorites, and recent menus stay in local browser or Android WebView storage and are not sent to the publisher or shared with third parties.",
    privacyRetentionHeading: "Data retention and deletion",
    privacyRetentionCopy: "Clear list removes ingredients only. Clear the app or browser storage, or uninstall the app, to remove ingredients, favorites, and history. The publisher has no server copy to retain or delete.",
    privacyRightsHeading: "Your privacy rights",
    privacyRightsCopy: "Because the publisher does not receive or process this on-device data, it does not act as a controller for that data. Privacy questions may be sent to the monitored developer contact in the Play listing. People in the EEA may also lodge a complaint with their local data-protection authority, and people in Korea may contact the privacy officer identified in the public policy.",
    privacyChildrenHeading: "Children",
    privacyChildrenCopy: "Fridge Menu is not directed to children and does not knowingly collect personal information from children.",
    privacyChangesHeading: "Policy changes",
    privacyChangesCopy: "Material changes will be posted in this in-app policy and at the public policy URL before they take effect.",
    footerText: "Fridge Menu · saved only in your browser · no analytics or tracking · ",
    footerPrivacyLink: "Privacy",
    ingredientCountLabel: "Ingredient count: {count} of {max}",
    mealCardEyebrow: "Use {anchor} first",
    availableIngredients: "Available ingredients:",
    brandAria: "Fridge Menu home",
    heroCardAria: "How it works",
    ingredientListAria: "Ingredients, sorted by use-first priority",
    favorite: "Favorite",
    removeFavorite: "Remove favorite",
    favoriteAddAria: "Add {title} to favorites",
    favoriteRemoveAria: "Remove {title} from favorites",
    favorited: "Meal idea favorited.",
    favoriteRemoved: "Favorite removed.",
    favoritedSessionOnly: "Meal idea favorited for this session only; safe multi-tab saving is unavailable.",
    favoriteRemovedSessionOnly: "Favorite removed for this session only; safe multi-tab saving is unavailable.",
    favoriteConflict: "Favorite change was not applied because another tab changed the saved data. Try again.",
    suggestionsEmpty: "Add {min}–{max} ingredients, then make a menu.",
    favoritesEmpty: "Favorite a meal idea to keep it here.",
    historyEmpty: "Your recent generated menus will appear here.",
    historyUnavailable: "unavailable because ingredients changed or expired",
    urgencyUseNow: "use now",
    urgencyUseSoon: "use soon",
    urgencyStable: "stable",
    urgencyExpired: "expired",
    noDateLabel: "no date · flexible",
    removeIngredient: "Remove",
    removeIngredientAria: "Remove {name}",
    errorNameRequired: "Enter an ingredient name.",
    errorExpiredNotAdded: "Remove expired ingredients before adding new ones.",
    errorListFull: "Your fridge list is full.",
    errorDuplicate: "“{name}” is already in your fridge.",
    ingredientAdded: "{name} added.",
    ingredientAddedSessionOnly: "{name} added for this session only; safe multi-tab saving is unavailable.",
    ingredientAddedConflict: "{name} was not added because another tab changed the saved data. Check the list and try again.",
    ingredientRemoved: "{name} removed.",
    ingredientRemovedSessionOnly: "{name} removed for this session only; safe multi-tab saving is unavailable.",
    ingredientRemovedConflict: "{name} was not removed because another tab changed the saved data. Try again.",
    listCleared: "Fridge list cleared.",
    listClearedSessionOnly: "Fridge list cleared for this session only; safe multi-tab saving is unavailable.",
    listClearedConflict: "The list was not cleared because another tab changed the saved data. Try again.",
    menuReady: "Three offline use-first ideas are ready.",
    menuReadySessionOnly: "Three ideas are ready for this session only; safe multi-tab saving is unavailable.",
    menuReadyConflict: "A menu was not created because another tab changed the saved ingredients. Check the list and try again.",
    "validation.not-a-list": "Ingredients must be a list.",
    "validation.count-out-of-range": "Add between {min} and {max} ingredients to make a menu.",
    "validation.missing-name": "Every ingredient needs a name.",
    "validation.invalid-urgency": "Every ingredient needs a valid expiry date.",
    "validation.expired": "Remove expired ingredients before making a menu.",
    "validation.duplicate": "“{name}” is already in your fridge.",
    installAccepted: "Installation accepted.",
    installDismissed: "Installation dismissed.",
    installFailed: "Installation could not be started.",
    appInstalled: "Fridge Menu installed.",
    offlineCacheUnavailable: "Offline caching is unavailable in this browser.",
    storageBlocked: "This browser blocked local storage; changes last only for this session.",
    restoredIngredients: "Restored {count} locally saved ingredients.",
    readyForIngredients: "Ready for your ingredients.",
    dayRollover: "Freshness updated for a new day.",
    anotherTabConflict: "Another tab changed saved data. This tab has session-only changes; reload before saving again.",
    updatedFromTab: "Updated from another tab.",
    updatedOnReturn: "Updated from saved data after returning to this tab.",
    checkBlockedOnReturn: "Saved data could not be checked after returning to this tab.",
  }),
  ko: Object.freeze({
    appTitle: "냉장고 메뉴 — 급한 재료부터",
    langToggle: "English",
    langToggleAria: "Switch to English",
    langChanged: "한국어로 표시할게요.",
    skipLink: "본문으로 건너뛰기",
    headerNote: "내 기기에만 저장 · 계정 불필요",
    installApp: "앱 설치",
    heroEyebrow: "먼저 써야 할 재료부터",
    heroTitleLead: "“오늘 뭐 먹지?”에 대한",
    heroTitleQuote: "차분한 대답",
    heroCopy: "냉장고에 있는 재료를 3~8개 담으면, 급한 재료부터 쓰는 오늘의 메뉴 3가지를 만들어 드려요. 목록은 이 기기에만 저장돼요.",
    heroCardStrong: "가지 메뉴, 매번.",
    heroCardCopy: "급한 재료가 앞장서요. 추가한 순서로 동점을 가려요. 무작위 섞기는 없어요.",
    step1Eyebrow: "1단계",
    fridgeHeading: "냉장고 재료 담기",
    ingredientLabel: "재료",
    expiryLabel: "유통기한 (선택)",
    ingredientPlaceholder: "예: 계란",
    addIngredient: "재료 추가",
    useFirstBoxLabel: "사용 순서",
    useFirstEmpty: "먼저 쓸 순서가 여기에 표시돼요.",
    makeMenu: "메뉴 만들기",
    clearList: "목록 비우기",
    step2Eyebrow: "2단계",
    menuHeading: "오늘의 추천 메뉴",
    menuIntro: "정해진 레시피가 아니라 자유롭게 응용하는 요리 방향이에요. 영양·알레르기 정보가 아니니 재료 상태를 확인하고 조리해 주세요.",
    savedLocally: "내 기기에 저장",
    favoritesHeading: "즐겨찾기",
    recentMenus: "최근 메뉴",
    historyHeading: "기록",
    scopeEyebrow: "투명한 설계",
    scopeHeading: "재료 데이터는 내 것.",
    scopeCopy: "냉장고 메뉴는 계정, 분석 도구, 추적, 외부 API 없이 동작해요. ‘목록 비우기’는 재료만 지워요. 즐겨찾기와 기록까지 지우려면 앱(또는 브라우저) 저장 데이터를 삭제하거나 앱을 삭제하세요.",
    privacyEyebrow: "개인정보처리방침",
    privacyHeading: "내 데이터는 내 기기에.",
    privacyCopy: "냉장고 메뉴에는 계정, 분석 도구, 광고 SDK, 추적, 외부 API가 없어요. 재료 목록·즐겨찾기·최근 메뉴는 브라우저 또는 Android WebView 저장소에만 남고, 개발자나 제3자에게 전송되지 않아요.",
    privacyRetentionHeading: "데이터 보관과 삭제",
    privacyRetentionCopy: "‘목록 비우기’는 재료만 지워요. 재료·즐겨찾기·기록을 모두 지우려면 앱(또는 브라우저) 저장 데이터를 삭제하거나 앱을 삭제하세요. 개발자는 서버 사본을 갖고 있지 않아요.",
    privacyRightsHeading: "이용자의 권리",
    privacyRightsCopy: "개발자는 기기 안에만 있는 이 데이터를 받거나 처리하지 않으므로 해당 데이터의 컨트롤러가 아니에요. 개인정보 문의는 Play 등록정보의 개발자 연락처로 보낼 수 있어요. EEA 거주자는 현지 감독기구에, 한국 이용자는 공개 처리방침에 안내된 개인정보 보호책임자에게 문의할 수 있어요.",
    privacyChildrenHeading: "아동",
    privacyChildrenCopy: "냉장고 메뉴는 아동을 대상으로 하지 않으며, 아동의 개인정보를 알면서 수집하지 않아요.",
    privacyChangesHeading: "정책 변경",
    privacyChangesCopy: "중요한 변경은 시행 전에 앱 내 정책과 공개 정책 URL에 먼저 안내할게요.",
    footerText: "냉장고 메뉴 · 브라우저에만 저장 · 분석/추적 없음 · ",
    footerPrivacyLink: "개인정보",
    ingredientCountLabel: "재료 개수: {max}개 중 {count}개",
    mealCardEyebrow: "{anchor} 먼저 쓰기",
    availableIngredients: "사용 재료:",
    brandAria: "냉장고 메뉴 홈",
    heroCardAria: "작동 방식",
    ingredientListAria: "재료 목록, 먼저 쓸 순서로 정렬됨",
    favorite: "즐겨찾기",
    removeFavorite: "즐겨찾기 해제",
    favoriteAddAria: "‘{title}’ 즐겨찾기에 추가",
    favoriteRemoveAria: "‘{title}’ 즐겨찾기에서 제거",
    favorited: "즐겨찾기에 담았어요.",
    favoriteRemoved: "즐겨찾기에서 뺐어요.",
    favoritedSessionOnly: "즐겨찾기가 이 세션에서만 적용돼요. 여러 탭 동시 저장을 지금은 사용할 수 없어요.",
    favoriteRemovedSessionOnly: "즐겨찾기 해제가 이 세션에서만 적용돼요. 여러 탭 동시 저장을 지금은 사용할 수 없어요.",
    favoriteConflict: "다른 탭이 저장 데이터를 바꿔서 즐겨찾기 변경이 적용되지 않았어요. 다시 시도해 주세요.",
    suggestionsEmpty: "재료를 {min}~{max}개 담고 메뉴를 만들어 보세요.",
    favoritesEmpty: "마음에 드는 메뉴를 즐겨찾기하면 여기에 모여요.",
    historyEmpty: "최근에 만든 메뉴가 여기에 표시돼요.",
    historyUnavailable: "재료가 바뀌었거나 기한이 지나 볼 수 없어요",
    urgencyUseNow: "오늘·내일",
    urgencyUseSoon: "3일 안에",
    urgencyStable: "여유",
    urgencyExpired: "기한 지남",
    noDateLabel: "날짜 없음 · 여유",
    removeIngredient: "빼기",
    removeIngredientAria: "‘{name}’ 빼기",
    errorNameRequired: "재료 이름을 입력해 주세요.",
    errorExpiredNotAdded: "기한이 지난 재료는 담을 수 없어요.",
    errorListFull: "냉장고 목록이 가득 찼어요.",
    errorDuplicate: "‘{name}’ 재료가 이미 목록에 있어요.",
    ingredientAdded: "‘{name}’ 담았어요.",
    ingredientAddedSessionOnly: "‘{name}’ 추가가 이 세션에서만 유지돼요. 여러 탭 동시 저장을 지금은 사용할 수 없어요.",
    ingredientAddedConflict: "다른 탭이 저장 데이터를 바꿔서 ‘{name}’ 추가가 적용되지 않았어요. 목록을 확인하고 다시 시도해 주세요.",
    ingredientRemoved: "‘{name}’ 뺐어요.",
    ingredientRemovedSessionOnly: "‘{name}’ 빼기가 이 세션에서만 유지돼요. 여러 탭 동시 저장을 지금은 사용할 수 없어요.",
    ingredientRemovedConflict: "다른 탭이 저장 데이터를 바꿔서 ‘{name}’ 빼기가 적용되지 않았어요. 다시 시도해 주세요.",
    listCleared: "목록을 비웠어요.",
    listClearedSessionOnly: "목록 비우기가 이 세션에서만 유지돼요. 여러 탭 동시 저장을 지금은 사용할 수 없어요.",
    listClearedConflict: "다른 탭이 저장 데이터를 바꿔서 목록을 비우지 못했어요. 다시 시도해 주세요.",
    menuReady: "급한 재료부터 쓰는 메뉴 3가지가 준비됐어요.",
    menuReadySessionOnly: "메뉴 3가지가 이 세션에서만 준비됐어요. 여러 탭 동시 저장을 지금은 사용할 수 없어요.",
    menuReadyConflict: "다른 탭이 재료를 바꿔서 메뉴를 만들지 못했어요. 목록을 확인하고 다시 시도해 주세요.",
    "validation.not-a-list": "재료 목록 형식이 올바르지 않아요.",
    "validation.count-out-of-range": "메뉴를 만들려면 재료를 {min}~{max}개 담아 주세요.",
    "validation.missing-name": "모든 재료에는 이름이 필요해요.",
    "validation.invalid-urgency": "모든 재료에는 올바른 유통기한이 필요해요.",
    "validation.expired": "기한 지난 재료를 빼야 메뉴를 만들 수 있어요.",
    "validation.duplicate": "‘{name}’ 재료가 이미 목록에 있어요.",
    installAccepted: "설치를 시작했어요.",
    installDismissed: "설치를 취소했어요.",
    installFailed: "설치를 시작할 수 없어요.",
    appInstalled: "냉장고 메뉴가 설치됐어요.",
    offlineCacheUnavailable: "이 브라우저에서는 오프라인 캐시를 사용할 수 없어요.",
    storageBlocked: "브라우저가 로컬 저장을 차단해서 변경사항이 이 세션에서만 유지돼요.",
    restoredIngredients: "저장된 재료 {count}개를 불러왔어요.",
    readyForIngredients: "재료를 담아 볼까요?",
    dayRollover: "날짜가 바뀌어 신선도를 새로 계산했어요.",
    anotherTabConflict: "다른 탭이 저장 데이터를 바꿨어요. 이 탭에는 세션 전용 변경이 있으니 저장 전에 새로고침해 주세요.",
    updatedFromTab: "다른 탭의 변경을 반영했어요.",
    updatedOnReturn: "탭으로 돌아와 저장 데이터를 다시 불러왔어요.",
    checkBlockedOnReturn: "탭으로 돌아왔지만 저장 데이터를 확인할 수 없었어요.",
  }),
});

export function translate(locale, key, params = {}) {
  const table = STRINGS[locale] ?? STRINGS.en;
  const template = table[key] ?? STRINGS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}

export function applyStaticTranslations(documentRef, locale) {
  documentRef.documentElement.lang = locale;
  documentRef.title = translate(locale, "appTitle");
  for (const element of documentRef.querySelectorAll("[data-i18n]")) {
    element.textContent = translate(locale, element.dataset.i18n);
  }
  for (const element of documentRef.querySelectorAll("[data-i18n-placeholder]")) {
    element.setAttribute("placeholder", translate(locale, element.dataset.i18nPlaceholder));
  }
  for (const element of documentRef.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", translate(locale, element.dataset.i18nAriaLabel));
  }
}

export function readStoredLocale(storage) {
  try {
    return normalizeLocale(storage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveStoredLocale(storage, locale) {
  try {
    if (!storage || typeof storage.setItem !== "function") return false;
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
