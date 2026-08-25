# Fridge Menu release QA checklist

This checklist separates locally verified release evidence from owner-only device and Play Console actions. Record date, tester, device/OS, source revision, and result for every manual item. A failed item blocks submission readiness.

For every manual item, fill in: `Tester:`, `Device model:`, `Android version:`, `Date/time:`, `Git SHA:`, `AAB SHA-256:`, `Result: PASS/FAIL`, and `Evidence path:`. Blank fields mean `OWNER_REQUIRED`, not PASS.

## 1. Artifact identity (local, reversible)

- [ ] Confirm the clean source revision matches `release/artifacts/release-manifest.json`.
- [ ] Run `npm run verify:release` and retain its passing output.
- [ ] Build the Android artifact with `npm run android:aab`; unsigned output is local evidence only.
- [ ] Confirm the artifact is `android/app/build/outputs/bundle/release/app-release.aab` and the application ID is `com.learnershift.fridgemenu`.
- [ ] Build twice from the same clean revision and confirm identical SHA-256 digests.
- [ ] Confirm no signing key, production ad identifier, analytics, tracker, remote API, or Android network permission is present.
- [ ] Before Play upload, provide owner-controlled signing variables, rebuild, require `AAB_SIGNED_OK`, and record the signed AAB digest.

## 2. Physical device QA (owner/device required)

- [ ] Install a properly authorized test build on a physical Android device.
- [ ] Add, edit, and remove ingredients; verify expiry ordering and expired-item exclusion.
- [ ] Generate menus, favorite an item, inspect history, close the app, reopen it, and verify local persistence.
- [ ] Verify touch targets, focus indication, text scaling, portrait layout, and reduced-motion behavior.
- [ ] Record device model, Android version, build identity, tester, date, and PASS/FAIL.
- [ ] Verify predictive-back animation and root back-to-home behavior on a supported Android device; static source inspection is not device evidence.

## 3. Offline QA (owner/device required)

- [ ] Launch once, enable airplane mode, fully close and reopen the app.
- [ ] Complete the pantry → menu → favorite/history flow offline.
- [ ] Confirm no broken external resource, network error, or data loss appears.

## 4. TalkBack accessibility QA (owner/device required)

- [ ] Navigate every interactive control using TalkBack only.
- [ ] Confirm labels, roles, state changes, errors, headings, reading order, and live announcements are understandable.
- [ ] Confirm keyboard/switch focus is visible and no control traps focus.

## 5. Screenshots and Play materials (owner/device required)

- [ ] Treat the repository captures as `LOCAL_CHROME_SIMULATION`, not Android candidate evidence. Replace or explicitly approve them only after final Android-device screenshots are captured from the exact signed candidate.
- [ ] Confirm all four final 1080×1920 Android phone screenshots match the exact signed candidate and contain no personal data or unfinished advertising UI.
- [ ] Verify screenshots, icon, feature graphic, listing, privacy policy, data-safety answers, and release notes describe the same candidate.
- [ ] Supply the final public privacy-policy URL and support contact in Play Console.

## 6. Owner approval boundary

Do not sign, upload, submit, publish, or launch without fresh owner approval naming the exact action and target. Local QA completion and review PASS do not grant that approval.

- [ ] Owner confirms the exact candidate digest and target Play track.
- [ ] Record a signing approval receipt for the exact Git SHA and AAB SHA-256.
- [ ] Record a separate internal-test upload approval receipt for the exact target track.
- [ ] Record a separate production submission approval receipt, including country availability.
- [ ] Record a separate publication approval receipt for the exact visibility and rollout target.
- [ ] Every receipt records action, target track, Git SHA, AAB SHA-256, approver, timestamp, and authority evidence ID.

## 7. Future AdMob disclosure coupling

If AdMob or any advertising SDK is introduced later, the same candidate change must update and re-verify all five surfaces before release:

- [ ] Ads declaration
- [ ] Data safety
- [ ] Advertising ID / Android permission state
- [ ] `release/privacy-policy.md`
- [ ] `release/play-listing.md`

Any mismatch blocks submission.

## 8. Rollback

- [ ] For this first release, preserve the accepted source revision, version code, artifact digest, and store metadata; do not promise a prior production build exists.
- [ ] Document how to halt or withdraw the pending release in Play Console before publication.
- [ ] After publication, a broken first release requires a fix-forward AAB with a higher versionCode; retain evidence, stop further rollout where available, and obtain fresh approvals for the replacement.
