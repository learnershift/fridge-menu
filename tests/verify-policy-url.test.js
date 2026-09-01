import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluatePolicyContent,
  evaluatePolicyResponse,
  evaluateSoft404ProbeResponse,
} from "../scripts/verify-policy-url.mjs";

const validPolicyHtml = "<h1>Fridge Menu Privacy Policy</h1><p>LABONDANCE</p><p>송문길</p>";

test("valid policy content passes", () => {
  assert.deepEqual(evaluatePolicyContent(validPolicyHtml), []);
  assert.deepEqual(evaluatePolicyResponse({ status: 200, html: validPolicyHtml }), []);
});

for (const requiredIdentity of ["Fridge Menu Privacy Policy", "LABONDANCE", "송문길"]) {
  test(`missing required identity fails: ${requiredIdentity}`, () => {
    const html = validPolicyHtml.replace(requiredIdentity, "");
    assert.deepEqual(evaluatePolicyContent(html), [{ code: "POLICY_CONTENT_MISSING_REQUIRED_IDENTITY", message: `Missing required identity string: ${requiredIdentity}` }]);
  });
}

test("OWNER_REQUIRED marker fails", () => {
  assert.deepEqual(evaluatePolicyContent(`${validPolicyHtml} OWNER_REQUIRED`), [{ code: "POLICY_CONTENT_OWNER_REQUIRED_MARKER", message: "Policy contains literal OWNER_REQUIRED marker" }]);
});

test("status-only or irrelevant 200 response fails", () => {
  assert.deepEqual(evaluatePolicyResponse({ status: 200, html: "<h1>Welcome</h1>" }), [
    { code: "POLICY_CONTENT_MISSING_REQUIRED_IDENTITY", message: "Missing required identity string: Fridge Menu Privacy Policy" },
    { code: "POLICY_CONTENT_MISSING_REQUIRED_IDENTITY", message: "Missing required identity string: LABONDANCE" },
    { code: "POLICY_CONTENT_MISSING_REQUIRED_IDENTITY", message: "Missing required identity string: 송문길" },
  ]);
});

test("200 missing-path response yields SOFT_404_DETECTED", () => {
  assert.deepEqual(evaluateSoft404ProbeResponse(200), [{ code: "SOFT_404_DETECTED", message: "Random same-origin missing path returned HTTP 200" }]);
});
