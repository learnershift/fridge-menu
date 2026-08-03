# Fridge Menu release QA checklist

This checklist separates locally verified release evidence from owner-only device and Play Console actions. Record date, tester, device/OS, source revision, and result for every manual item. A failed item blocks submission readiness.

## 1. Artifact identity (local, reversible)

- [ ] Confirm the clean source revision matches `release/artifacts/release-manifest.json`.
- [ ] Run `npm run verify:release` and retain its passing output.
- [ ] Build the unsigned Android artifact with `npm run android:aab`.
- [ ] Confirm the artifact is `android/app/build/outputs/bundle/release/app-release.aab` and the application ID is `com.learnershift.fridgemenu`.
- [ ] Build twice from the same clean revision and confirm identical SHA-256 digests.
- [ ] Confirm no signing key, production ad identifier, analytics, tracker, remote API, or Android network permission is present.

## 2. Physical device QA (owner/device required)

- [ ] Install a properly authorized test build on a physical Android device.
- [ ] Add, edit, and remove ingredients; verify expiry ordering and expired-item exclusion.
- [ ] Generate menus, favorite an item, inspect history, close the app, reopen it, and verify local persistence.
- [ ] Verify touch targets, focus indication, text scaling, portrait layout, and reduced-motion behavior.
- [ ] Record device model, Android version, build identity, tester, date, and PASS/FAIL.

## 3. Offline QA (owner/device required)

- [ ] Launch once, enable airplane mode, fully close and reopen the app.
- [ ] Complete the pantry → menu → favorite/history flow offline.
- [ ] Confirm no broken external resource, network error, or data loss appears.

## 4. TalkBack accessibility QA (owner/device required)

- [ ] Navigate every interactive control using TalkBack only.
- [ ] Confirm labels, roles, state changes, errors, headings, reading order, and live announcements are understandable.
- [ ] Confirm keyboard/switch focus is visible and no control traps focus.

## 5. Screenshots and Play materials (owner/device required)

- [ ] Capture at least two final phone screenshots from the exact candidate build without personal data.
- [ ] Verify screenshots, icon, feature graphic, listing, privacy policy, data-safety answers, and release notes describe the same candidate.
- [ ] Supply the final public privacy-policy URL and support contact in Play Console.

## 6. Owner approval boundary

Do not sign, upload, submit, publish, or launch without fresh owner approval naming the exact action and target. Local QA completion and review PASS do not grant that approval.

- [ ] Owner confirms the exact candidate digest and target Play track.
- [ ] Owner explicitly approves signing/upload/submission for that target.
- [ ] Owner separately approves any final publication or production rollout.

## 7. Rollback

- [ ] Preserve the prior accepted source revision, version code, artifact digest, and store metadata.
- [ ] Before rollout, document how to halt/withdraw the release in Play Console and restore the prior listing/build where the platform permits.
- [ ] If crash, data-loss, accessibility, privacy, or policy failure appears, halt rollout, retain evidence, and return to the prior accepted candidate.
