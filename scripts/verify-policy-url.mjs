import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_POLICY_URL = "https://nuvopilot.com/apps/fridge-menu/privacy/";
export const REQUIRED_IDENTITY_STRINGS = ["Fridge Menu Privacy Policy", "LABONDANCE", "송문길"];

export function evaluatePolicyContent(html) {
  const failures = [];
  for (const requiredIdentity of REQUIRED_IDENTITY_STRINGS) {
    if (!html.includes(requiredIdentity)) {
      failures.push({ code: "POLICY_CONTENT_MISSING_REQUIRED_IDENTITY", message: `Missing required identity string: ${requiredIdentity}` });
    }
  }
  if (html.includes("OWNER_REQUIRED")) {
    failures.push({ code: "POLICY_CONTENT_OWNER_REQUIRED_MARKER", message: "Policy contains literal OWNER_REQUIRED marker" });
  }
  return failures;
}

export function evaluatePolicyResponse({ status, html }) {
  const failures = [];
  if (status < 200 || status >= 300) {
    failures.push({ code: "POLICY_HTTP_STATUS_INVALID", message: `Policy URL returned HTTP ${status}` });
  }
  return [...failures, ...evaluatePolicyContent(html)];
}

export function evaluateSoft404ProbeResponse(status) {
  return status === 200
    ? [{ code: "SOFT_404_DETECTED", message: "Random same-origin missing path returned HTTP 200" }]
    : [];
}

async function fetchPolicy(url) {
  const response = await fetch(url);
  return { status: response.status, html: await response.text() };
}

async function fetchProbe(url) {
  const response = await fetch(url);
  return { status: response.status };
}

export async function verifyPolicyUrl(policyUrl = DEFAULT_POLICY_URL) {
  const origin = new URL(policyUrl).origin;
  const probeUrl = new URL(`/.well-known/fridge-menu-policy-probe-${randomUUID()}`, origin).href;
  const [policyResult, probeResult] = await Promise.allSettled([fetchPolicy(policyUrl), fetchProbe(probeUrl)]);
  const failures = [];

  console.log(`POLICY_URL: ${policyUrl}`);
  console.log(`SOFT_404_PROBE_URL: ${probeUrl}`);

  if (policyResult.status === "fulfilled") {
    console.log(`POLICY_HTTP_STATUS: ${policyResult.value.status}`);
    failures.push(...evaluatePolicyResponse(policyResult.value));
  } else {
    failures.push({ code: "POLICY_FETCH_FAILED", message: `Policy fetch failed for ${policyUrl}: ${policyResult.reason.message}` });
  }

  if (probeResult.status === "fulfilled") {
    console.log(`SOFT_404_PROBE_HTTP_STATUS: ${probeResult.value.status}`);
    failures.push(...evaluateSoft404ProbeResponse(probeResult.value.status));
  } else {
    failures.push({ code: "SOFT_404_PROBE_FETCH_FAILED", message: `Soft-404 probe fetch failed for ${probeUrl}: ${probeResult.reason.message}` });
  }

  for (const failure of failures) console.error(`${failure.code}: ${failure.message}`);
  if (failures.length > 0) process.exitCode = 1;
  else console.log("POLICY_URL_VERIFIED");
  return { policyUrl, probeUrl, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyPolicyUrl(process.argv[2] ?? DEFAULT_POLICY_URL);
}
