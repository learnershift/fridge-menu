import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "release/captures");
const url = process.env.FRIDGE_MENU_CAPTURE_URL || "http://127.0.0.1:4173";
const captures = [
  { name: "01-empty-home", action: "window.scrollTo(0, 0)" },
  { name: "02-use-first-list", action: 'document.querySelector("#ingredient-expiry").value = "2099-01-02"; document.querySelector("#fridge-heading").scrollIntoView({ block: "start" })' },
  { name: "03-menu-results", action: 'document.querySelector("#suggest-button").click(); document.querySelector("#menu-heading").scrollIntoView({ block: "start" })' },
  { name: "04-favorites-history", action: 'document.querySelector("#suggest-button").click(); document.querySelector(".favorite-button").click(); document.querySelector("#favorites-heading").scrollIntoView({ block: "start" })' },
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
try { if (!(await fetch(url)).ok) throw new Error(); } catch { throw new Error("Start the local app first or set FRIDGE_MENU_CAPTURE_URL."); }

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

await mkdir(outputDir, { recursive: true });
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
  await protocol.call("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
  let loaded = protocol.event("Page.loadEventFired");
  await protocol.call("Page.navigate", { url });
  await loaded;

  for (let index = 0; index < captures.length; index += 1) {
    const storage = index === 0 ? null : JSON.stringify(seededState);
    loaded = protocol.event("Page.loadEventFired");
    await protocol.call("Runtime.evaluate", { expression: storage === null
      ? 'localStorage.removeItem("fridge-menu:v1"); location.reload()'
      : `localStorage.setItem("fridge-menu:v1", ${JSON.stringify(storage)}); location.reload()` });
    await loaded;
    await protocol.call("Runtime.evaluate", { expression: captures[index].action });
    await protocol.call("Runtime.evaluate", { expression: "new Promise(resolve => setTimeout(resolve, 300))", awaitPromise: true });
    const screenshot = await protocol.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const output = resolve(outputDir, `fridge-menu-${captures[index].name}-1080x1920.png`);
    await writeFile(output, Buffer.from(screenshot.data, "base64"));
    await access(output);
    console.log(`STORE_CAPTURE_OK path=${output}`);
  }
} finally {
  if (socket) socket.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true });
}
