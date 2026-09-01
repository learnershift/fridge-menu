import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "release/captures");
const verifyDomOnly = process.argv.includes("--verify-dom-only");
let url = process.env.FRIDGE_MENU_CAPTURE_URL || "http://127.0.0.1:4173";
const captures = [
  { name: "01-empty-home", action: "window.scrollTo(0, 0)" },
  { name: "02-use-first-list", action: 'document.querySelector("#ingredient-expiry").value = "2099-01-02"; document.querySelector("#fridge-heading").scrollIntoView({ block: "start" })' },
  { name: "03-menu-results", action: '(async () => { document.querySelector("#suggest-button").click(); while (!document.querySelector("#suggestions .favorite-button")) await new Promise((resolve) => setTimeout(resolve, 25)); document.querySelector("#menu-heading").scrollIntoView({ block: "start" }); })()' },
  { name: "04-favorites-history", action: '(async () => { document.querySelector("#suggest-button").click(); while (!document.querySelector("#suggestions .favorite-button")) await new Promise((resolve) => setTimeout(resolve, 25)); document.querySelector("#suggestions .favorite-button").click(); while (!document.querySelector("#favorites-list .meal-card")) await new Promise((resolve) => setTimeout(resolve, 25)); document.querySelector("#favorites-heading").scrollIntoView({ block: "start" }); })()' },
];
const seededState = {
  version: 2,
  ingredients: [
    { id: "spinach", name: "Spinach", expiryDate: "2099-01-02", sequence: 0 },
    { id: "mushrooms", name: "Mushrooms", expiryDate: "2099-01-03", sequence: 1 },
    { id: "eggs", name: "Eggs", expiryDate: "2099-01-05", sequence: 2 },
    { id: "rice", name: "Rice", expiryDate: "2099-02-01", sequence: 3 },
    { id: "tomatoes", name: "Tomatoes", expiryDate: "2099-01-04", sequence: 4 },
  ],
  favorites: [], history: [],
};
const seededStateKo = {
  version: 2,
  ingredients: [
    { id: "spinach", name: "시금치", expiryDate: "2099-01-02", sequence: 0 },
    { id: "mushrooms", name: "버섯", expiryDate: "2099-01-03", sequence: 1 },
    { id: "eggs", name: "계란", expiryDate: "2099-01-05", sequence: 2 },
    { id: "rice", name: "밥", expiryDate: "2099-02-01", sequence: 3 },
    { id: "tomatoes", name: "토마토", expiryDate: "2099-01-04", sequence: 4 },
  ],
  favorites: [], history: [],
};
// Phones emulate a touch device; tablet passes keep mobile emulation off so the
// layout viewport matches the CSS width the responsive breakpoints target.
const devicePasses = [
  { suffix: "1080x1920", width: 360, height: 640, deviceScaleFactor: 3, mobile: true },
  { suffix: "1200x1920", width: 600, height: 960, deviceScaleFactor: 2, mobile: false },
  { suffix: "1600x2560", width: 800, height: 1280, deviceScaleFactor: 2, mobile: false },
];
const localePasses = [
  { locale: "en", browserLocale: "en-US", filePrefix: "", state: seededState },
  { locale: "ko", browserLocale: "ko-KR", filePrefix: "ko-", state: seededStateKo },
];
const candidates = [
  process.env.FRIDGE_MENU_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "google-chrome",
].filter(Boolean);
let chrome;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
  if (!probe.error && probe.status === 0) { chrome = candidate; break; }
}
if (!chrome) throw new Error("Set FRIDGE_MENU_CHROME_BIN to an already installed Chrome executable; this script does not install a browser.");

function startLocalServer() {
  return new Promise((resolveServer, reject) => {
    const child = spawn(process.execPath, [resolve(root, "scripts/serve.mjs")], {
      env: { ...process.env, FRIDGE_MENU_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Local verification server did not start. ${stderr}`.trim()));
    }, 10000);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/SERVE_OK (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveServer({ child, serverUrl: match[1] });
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local verification server exited before use (${code}). ${stderr}`.trim()));
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  child.kill();
  await exited;
}

let localServer;
if (verifyDomOnly) {
  const started = await startLocalServer();
  localServer = started.child;
  url = started.serverUrl;
}
try {
  if (!(await fetch(url)).ok) throw new Error();
} catch {
  if (localServer) localServer.kill();
  throw new Error("Start the local app first or set FRIDGE_MENU_CAPTURE_URL.");
}

const profile = await mkdtemp(join(tmpdir(), "fridge-menu-capture-"));
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--lang=en-US", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });

function devtoolsPort() {
  return new Promise((resolvePort, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error("Chrome DevTools endpoint did not start.")), 10000);
    browser.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { clearTimeout(timeout); resolvePort(Number(match[1])); }
    });
    browser.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited before capture (${code}).`)); });
  });
}

function cdp(socket) {
  let nextId = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    const listeners = events.get(message.method) || [];
    events.delete(message.method);
    listeners.forEach((resolveEvent) => resolveEvent(message.params));
  });
  return {
    call(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }));
    },
    event(method) {
      return new Promise((resolveEvent) => events.set(method, [...(events.get(method) || []), resolveEvent]));
    },
  };
}

async function evaluate(protocol, expression, options = {}) {
  const response = await protocol.call("Runtime.evaluate", {
    expression,
    awaitPromise: options.awaitPromise ?? false,
    returnByValue: options.returnByValue ?? false,
  });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Browser evaluation failed.";
    throw new Error(detail);
  }
  return response.result?.value;
}

function uxVerificationExpression(pass) {
  const names = pass.locale === "ko" ? ["계란", "밥", "시금치"] : ["Egg", "Rice", "Spinach"];
  const difficulty = pass.locale === "ko" ? "(?:쉬움|보통)" : "(?:Easy|Normal)";
  const badgePattern = pass.locale === "ko" ? `^약 \\d+분 · ${difficulty}$` : `^About \\d+ min · ${difficulty}$`;
  return `(async () => {
    const expectedNames = ${JSON.stringify(names)};
    const badgePattern = new RegExp(${JSON.stringify(badgePattern)});
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const waitFor = async (predicate, message) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      throw new Error(message);
    };
    const readState = () => JSON.parse(localStorage.getItem("fridge-menu:v1") || "null");
    const chips = () => [...document.querySelectorAll(".quick-ingredient-chip")];
    const clickChip = (name) => {
      const chip = chips().find((candidate) => candidate.textContent === name);
      assert(chip && !chip.disabled, "missing enabled quick ingredient chip: " + name);
      chip.click();
    };

    assert(chips().length === 24, "quick ingredient chip count must be 24");
    clickChip(expectedNames[0]);
    await waitFor(() => readState()?.ingredients?.length === 1, "quick ingredient did not persist");
    assert(document.querySelector("#ingredient-count").textContent.trim() === "1 / 8", "ingredient count did not update");
    assert(document.querySelector(".ingredient-item__name")?.textContent === expectedNames[0], "ingredient row did not render");
    assert(chips().find((chip) => chip.textContent === expectedNames[0])?.disabled, "added ingredient chip did not disable");
    const first = readState().ingredients[0];
    assert(first.name === expectedNames[0] && !Object.hasOwn(first, "expiryDate"), "quick ingredient must persist without expiry");

    clickChip(expectedNames[1]);
    await waitFor(() => readState()?.ingredients?.length === 2, "second quick ingredient did not persist");
    clickChip(expectedNames[2]);
    await waitFor(() => readState()?.ingredients?.length === 3, "third quick ingredient did not persist");
    const suggest = document.querySelector("#suggest-button");
    assert(!suggest.disabled, "menu button did not enable after three ingredients");
    suggest.click();
    await waitFor(() => document.querySelectorAll("#suggestions .meal-card").length === 3 && readState()?.history?.length === 1, "primary menus did not render and persist");
    const primaryTitles = [...document.querySelectorAll("#suggestions .meal-card h3")].map((node) => node.textContent);
    const primaryBadges = [...document.querySelectorAll("#suggestions .meal-meta")].map((node) => node.textContent);
    assert(primaryTitles.length === 3 && new Set(primaryTitles).size === 3, "primary menus must be three distinct titles");
    assert(primaryBadges.length === 3 && primaryBadges.every((badge) => badgePattern.test(badge)), "menu badges must be localized and visible");

    const alternativeButton = document.querySelector("#alternative-menus-button");
    assert(!alternativeButton.hidden, "alternative menu button must be visible");
    alternativeButton.click();
    await waitFor(() => {
      const titles = [...document.querySelectorAll("#suggestions .meal-card h3")].map((node) => node.textContent);
      return titles.length === 3 && titles.every((title) => !primaryTitles.includes(title));
    }, "alternative menus did not replace the primary titles");
    assert(readState().history.length === 1, "alternative menus must not change history");
    assert(document.querySelectorAll("#suggestions .favorite-button").length === 0, "alternative menus must remain display-only");
    alternativeButton.click();
    await waitFor(() => JSON.stringify([...document.querySelectorAll("#suggestions .meal-card h3")].map((node) => node.textContent)) === JSON.stringify(primaryTitles), "primary menus did not restore");
    const restoredBadges = [...document.querySelectorAll("#suggestions .meal-meta")].map((node) => node.textContent);
    assert(JSON.stringify(restoredBadges) === JSON.stringify(primaryBadges), "primary menu badges did not restore");
    return { chips: chips().length, menus: primaryTitles.length, badges: primaryBadges.length };
  })()`;
}

if (!verifyDomOnly) await mkdir(outputDir, { recursive: true });
let socket;
try {
  const port = await devtoolsPort();
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const protocol = cdp(socket);
  await protocol.call("Page.enable");
  await protocol.call("Runtime.enable");
  await protocol.call("Emulation.setLocaleOverride", { locale: "en-US" });
  await protocol.call("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
  await protocol.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await protocol.call("Page.addScriptToEvaluateOnNewDocument", { source: `
    {
      const fixedTime = Date.parse("2026-08-25T08:00:00.000Z");
      const NativeDate = Date;
      globalThis.Date = class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [fixedTime])); }
        static now() { return fixedTime; }
      };
    }
  ` });
  await protocol.call("Emulation.setDeviceMetricsOverride", { width: devicePasses[0].width, height: devicePasses[0].height, deviceScaleFactor: devicePasses[0].deviceScaleFactor, mobile: true });
  let loaded = protocol.event("Page.loadEventFired");
  await protocol.call("Page.navigate", { url });
  await loaded;

  for (const device of verifyDomOnly ? devicePasses.slice(0, 1) : devicePasses) {
   await protocol.call("Emulation.setDeviceMetricsOverride", { width: device.width, height: device.height, deviceScaleFactor: device.deviceScaleFactor, mobile: device.mobile });
   for (const pass of localePasses) {
    await protocol.call("Emulation.setLocaleOverride", { locale: pass.browserLocale });
    if (verifyDomOnly) {
      loaded = protocol.event("Page.loadEventFired");
      await evaluate(protocol, `localStorage.removeItem("fridge-menu:v1"); localStorage.setItem("fridge-menu:locale:v1", ${JSON.stringify(pass.locale)}); location.reload()`);
      await loaded;
      const verified = await evaluate(protocol, uxVerificationExpression(pass), { awaitPromise: true, returnByValue: true });
      console.log(`STORE_UX_INTERACTION_OK locale=${pass.locale} chips=${verified.chips} menus=${verified.menus} badges=${verified.badges}`);
      continue;
    }
    for (let index = 0; index < captures.length; index += 1) {
      const storage = index === 0 ? null : JSON.stringify(pass.state);
      const localeSeed = `localStorage.setItem("fridge-menu:locale:v1", ${JSON.stringify(pass.locale)});`;
      loaded = protocol.event("Page.loadEventFired");
      await evaluate(protocol, storage === null
        ? `localStorage.removeItem("fridge-menu:v1"); ${localeSeed} location.reload()`
        : `localStorage.setItem("fridge-menu:v1", ${JSON.stringify(storage)}); ${localeSeed} location.reload()`);
      await loaded;
      await evaluate(protocol, captures[index].action, { awaitPromise: true });
      await evaluate(protocol, "document.fonts.ready", { awaitPromise: true });
      await evaluate(protocol, "new Promise(resolve => setTimeout(resolve, 300))", { awaitPromise: true });
      const screenshot = await protocol.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const output = resolve(outputDir, `fridge-menu-${pass.filePrefix}${captures[index].name}-${device.suffix}.png`);
      await writeFile(output, Buffer.from(screenshot.data, "base64"));
      await access(output);
      console.log(`STORE_CAPTURE_OK path=${output}`);
    }
   }
  }
} finally {
  if (socket) socket.close();
  await stopChild(browser);
  await stopChild(localServer);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
