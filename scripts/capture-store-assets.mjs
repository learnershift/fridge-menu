import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "release/captures/fridge-menu-phone-1080x1920.png");
const url = process.env.FRIDGE_MENU_CAPTURE_URL || "http://127.0.0.1:4173";
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
await mkdir(resolve(root, "release/captures"), { recursive: true });
const result = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1080,1920", `--screenshot=${output}`, url], { stdio: "inherit" });
if (result.error || result.status !== 0) throw new Error("Chrome screenshot capture failed. Start the local app first or set FRIDGE_MENU_CAPTURE_URL.");
await access(output);
console.log(`STORE_CAPTURE_OK path=${output}`);
