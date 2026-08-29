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
- [ ] Run `npm run test:browser` against the fresh `dist` output and retain both English and Korean `STORE_UX_INTERACTION_OK` results.
- [ ] Confirm the Play upload icon is a 32-bit RGBA 512×512 PNG while PWA icons and the feature graphic retain their intended formats.
- [ ] Treat a CI receipt as current only when execution is `GITHUB_ACTIONS`, the run URL is non-null, and its Git SHA and AAB SHA-256 match this exact candidate. CI verification is evidence, not approval authority.
- [ ] Before Play upload, provide owner-controlled signing variables, rebuild, require `AAB_SIGNED_OK`, and record the signed AAB digest.

## 2. Physical device QA (owner/device required)

- [ ] Install a properly authorized test build on a physical Android device.
- [ ] Add, edit, and remove ingredients; verify expiry ordering and expired-item exclusion.
- [ ] Verify the app follows the device language (Korean device shows Korean, other devices show English), the in-app language toggle switches every visible string, and the choice survives an app restart.
- [ ] Add ingredients with no expiry date and confirm they are accepted, labeled as date-free, and sorted after dated ingredients.
- [ ] Generate menus with rice + egg, with kimchi, and with vegetables only; confirm the three directions differ and match the ingredients.
- [ ] Generate menus, favorite an item, inspect history, close the app, reopen it, and verify local persistence.
- [ ] Verify touch targets, focus indication, text scaling, portrait layout, and reduced-motion behavior.
- [ ] Record device model, Android version, build identity, tester, date, and PASS/FAIL.
- [ ] Verify predictive-back animation and root back-to-home behavior on a supported Android device; static source inspection is not device evidence.

## 3. Offline QA (owner/device required)

- [ ] Launch once, enable airplane mode, fully close and reopen the app.
- [ ] Complete the pantry → menu → favorite/history flow offline.
- [ ] Confirm no broken external resource, network error, or data loss appears.

## 4. TalkBack accessibility QA (owner/device required)

- [ ] Navigate every interactive control using TalkBack only, in both English and Korean UI language.
- [ ] Confirm labels, roles, state changes, errors, headings, reading order, and live announcements are understandable.
- [ ] Confirm keyboard/switch focus is visible and no control traps focus.

## 5. Screenshots and Play materials (owner/device required)

- [ ] Treat the repository captures as `LOCAL_CHROME_SIMULATION`, not Android candidate evidence. Replace or explicitly approve them only after final Android-device screenshots are captured from the exact signed candidate.
- [ ] Confirm all four final 1080×1920 Android phone screenshots match the exact signed candidate and contain no personal data or unfinished advertising UI.
- [ ] Verify screenshots, icon, feature graphic, listing, privacy policy, data-safety answers, and release notes describe the same candidate.
- [ ] Supply the final public privacy-policy URL and support contact in Play Console.
- [ ] Record `Health form access date:`, `final Health answer:`, owner, current Console wording, and evidence ID. A blank value or HOLD blocks closed, open, and production release.

## 6. Owner approval boundary

Do not sign, upload, submit, publish, or launch without fresh owner approval naming the exact action and target. Local QA completion and review PASS do not grant that approval.

- [ ] Owner confirms the exact candidate digest and target Play track.
- [ ] Record a separate policy hosting/publication approval receipt for the exact HTTPS target and Git SHA.
- [ ] Record a signing approval receipt for the exact Git SHA and AAB SHA-256.
- [ ] Record a separate internal-test upload approval receipt for the exact target track, citing the policy and signing predecessor receipt IDs.
- [ ] Record a separate production submission approval receipt, including country availability and the internal-QA predecessor receipt ID.
- [ ] Record a separate app publication approval receipt for the exact visibility and rollout target, citing the production-submission receipt ID.
- [ ] Every receipt records action, exact target, Git SHA, AAB SHA-256 when applicable, approver, timestamp, and authority evidence ID.

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
