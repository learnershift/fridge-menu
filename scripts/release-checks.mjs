import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const pass = (condition) => condition ? "PASS" : "FAIL";

function foldStringConcatenations(source = "") {
  let folded = String(source);
  const pattern = /(["'])([^"'\r\n]*)\1\s*\+\s*(["'])([^"'\r\n]*)\3/g;
  while (pattern.test(folded)) folded = folded.replace(pattern, (_, quote, left, _rightQuote, right) => `${quote}${left}${right}${quote}`);
  return folded;
}

function hasRemoteReference(source) {
  const folded = foldStringConcatenations(source);
  return /https?:\/\//i.test(folded) || /["'(]\s*\/\/[a-z0-9]/i.test(folded);
}

function hasExactTouchTarget(css) {
  const blocks = [...css.matchAll(/\.remove-button\s*\{[^}]*\}/g)].map((match) => match[0]);
  const block = blocks.join("\n");
  const values = (property) => [...block.matchAll(new RegExp(`${property}\\s*:\\s*([^;}]*)`, "g"))]
    .map((match) => match[1].trim());
  const minWidths = values("min-width");
  const minHeights = values("min-height");
  const maximums = [...values("max-width"), ...values("max-height")];
  return minWidths.length === 1 && minWidths[0] === "2.75rem" &&
    minHeights.length === 1 && minHeights[0] === "2.75rem" &&
    maximums.every((value) => value === "none") && !/(?:transform|zoom)\s*:/.test(block);
}

// Deliberately pin the reviewed routing bodies. This is a narrow source regression
// gate, not Java analysis or Android runtime security evidence. Routing changes
// require review of these bodies and the mutation tests before updating them.
function hasReviewedAssetRouting(mainActivity) {
  const compact = (source) => source.replace(/\s+/g, "");
  const expectedClient = String.raw`webView.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !isAllowedAppUrl(request.getUrl().toString());
      }

      @Override @SuppressWarnings("deprecation") public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !isAllowedAppUrl(url);
      }

      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return isAllowedAppUrl(request.getUrl().toString())
            ? assetLoader.shouldInterceptRequest(request.getUrl())
            : emptyResponse();
      }

      @Override @SuppressWarnings("deprecation") public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
        return isAllowedAppUrl(url)
            ? assetLoader.shouldInterceptRequest(Uri.parse(url))
            : emptyResponse();
      }

      @Override public void onPageFinished(WebView view, String url) {
        syncBackCallback();
      }
    });`;
  const expectedGuards = String.raw`private static boolean isAllowedAppUrl(String rawUrl) {
    try {
      Uri uri = Uri.parse(rawUrl);
      if (!"https".equals(uri.getScheme()) || !APP_HOST.equals(uri.getAuthority())) return false;
      String encodedPath = uri.getEncodedPath();
      if (encodedPath == null || encodedPath.indexOf('%') >= 0) return false;
      String path = Uri.decode(encodedPath);
      if (!path.startsWith(APP_PATH) || path.indexOf('\\') >= 0 || path.indexOf('%') >= 0) return false;
      for (String segment : path.substring(APP_PATH.length()).split("/")) {
        if (".".equals(segment) || "..".equals(segment)) return false;
      }
      return true;
    } catch (RuntimeException ignored) {
      return false;
    }
  }

  private static WebResourceResponse emptyResponse() {
    return new WebResourceResponse(
        "text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
  }`;
  const source = compact(mainActivity);
  return (mainActivity.match(/\.setWebViewClient\s*\(/g) || []).length === 1 &&
    (mainActivity.match(/private static boolean isAllowedAppUrl\s*\(/g) || []).length === 1 &&
    source.includes(compact(expectedClient)) && source.includes(compact(expectedGuards));
}

function hasOnlyAllowedWebViewEntry(mainActivity) {
  const withoutAllowedOrigin = mainActivity.replace(
    /private static final String APP_ORIGIN = "https:"\s*\+\s*"\/\/"\s*\+\s*APP_HOST\s*;/g,
    "",
  );
  const withoutAllowedEntry = mainActivity.replace(/\b\w+\.loadUrl\s*\(\s*APP_ENTRY\s*\)\s*;/g, "");
  return /private static final String APP_HOST = "appassets\.androidplatform\.net";/.test(mainActivity) &&
    /private static final String APP_ORIGIN = "https:"\s*\+\s*"\/\/"\s*\+\s*APP_HOST;/.test(mainActivity) &&
    /private static final String APP_PATH = "\/assets\/pwa\/";/.test(mainActivity) &&
    /private static final String APP_ENTRY = APP_ORIGIN\s*\+\s*APP_PATH\s*\+\s*"index\.html";/.test(mainActivity) &&
    /\.addPathHandler\s*\(\s*"\/assets\/"\s*,\s*new WebViewAssetLoader\.AssetsPathHandler\s*\(\s*this\s*\)\s*\)/.test(mainActivity) &&
    !/\.loadUrl\s*\(/.test(withoutAllowedEntry) &&
    !/\.(?:loadData|loadDataWithBaseURL|postUrl|evaluateJavascript)\s*\(/.test(mainActivity) &&
    !/\b(?:HttpURLConnection|Socket|WebSocket|OkHttp|URLConnection|Uri\.Builder|Class\.forName|java\.lang\.reflect)\b/.test(mainActivity) &&
    !/\b(?:getMethod|getDeclaredMethod|getMethods|getDeclaredMethods)\s*\(|\.\s*invoke\s*\(/.test(mainActivity) &&
    !hasRemoteReference(withoutAllowedOrigin) &&
    hasReviewedAssetRouting(mainActivity);
}

function hasOnlyAllowedServiceWorkerFetch(serviceWorker) {
  const withoutAllowedFetch = serviceWorker.replace(/\bfetch\s*\(\s*event\.request\s*\)/g, "");
  const folded = foldStringConcatenations(withoutAllowedFetch);
  return !/\bfetch\s*\(/.test(withoutAllowedFetch) &&
    !/\b(?:importScripts|WebSocket|EventSource|XMLHttpRequest)\s*\(/.test(serviceWorker) &&
    !/\[\s*["']fetch["']\s*\]|String\.fromCharCode|\batob\s*\(|Reflect\.get\s*\(/.test(folded);
}

function hasRelativeAppShell(serviceWorker) {
  const body = serviceWorker.match(/const APP_SHELL = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1];
  if (!body || !/cache\.addAll\(APP_SHELL\)/.test(serviceWorker)) return false;
  const entries = [...body.matchAll(/(["'])([^"']+)\1/g)].map((match) => match[2]);
  const remainder = body.replace(/(["'])([^"']+)\1/g, "").replace(/[\s,]/g, "");
  return !remainder && entries.length > 0 && entries.every((entry) => entry === "./" || /^\.\/[a-z0-9][a-z0-9._/-]*$/i.test(entry));
}

export function computeStaticReleaseChecks({ css, androidManifest, mainActivity, serviceWorker }) {
  return {
    touch_target_static: pass(hasExactTouchTarget(css)),
    privacy_security_static: pass(!/uses-permission/i.test(androidManifest) &&
      !/addJavascriptInterface/.test(mainActivity) && hasOnlyAllowedWebViewEntry(mainActivity)),
    offline_static: pass(!hasRemoteReference(serviceWorker) && hasOnlyAllowedServiceWorkerFetch(serviceWorker) && hasRelativeAppShell(serviceWorker) &&
      hasOnlyAllowedWebViewEntry(mainActivity)),
  };
}

const commandStatus = (command, args, root) => pass(spawnSync(command, args, { cwd: root, encoding: "utf8", shell: true }).status === 0);

export function inspectAabSigning(aabPath) {
  const command = process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, "bin/jarsigner") : "jarsigner";
  const result = spawnSync(command, ["-verify", aabPath], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  if (result.error) return "UNKNOWN";
  const output = `${result.stdout}\n${result.stderr}`;
  if (/jar is unsigned/i.test(output)) return "UNSIGNED";
  if (result.status === 0 && /jar verified/i.test(output)) return "SIGNED";
  return "UNKNOWN";
}

export async function computeReleaseChecks(root) {
  const [css, androidManifest, mainActivity, serviceWorker] = await Promise.all([
    readFile(resolve(root, "styles.css"), "utf8"),
    readFile(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8"),
    readFile(resolve(root, "android/app/src/main/java/com/learnershift/fridgemenu/MainActivity.java"), "utf8"),
    readFile(resolve(root, "service-worker.js"), "utf8"),
  ]);
  return {
    tests: commandStatus(process.execPath, ["--test", "tests/*.test.js"], root),
    build: commandStatus(process.execPath, ["scripts/build.mjs"], root),
    ...computeStaticReleaseChecks({ css, androidManifest, mainActivity, serviceWorker }),
  };
}

export function requirePassingChecks(checks) {
  const failed = Object.entries(checks).filter(([, status]) => status !== "PASS").map(([name]) => name);
  if (failed.length) throw new Error(`Release checks failed: ${failed.join(", ")}`);
}
