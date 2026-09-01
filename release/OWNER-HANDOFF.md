# Owner handoff and submission gate

## Owner-supplied privacy values

- `LEGAL_NAME`: LABONDANCE Co., Ltd. (주식회사 라봉당스)
- `PRIVACY_EMAIL`: support@nuvopilot.com
- `PUBLIC_POLICY_URL`: https://nuvopilot.com/apps/fridge-menu/privacy/
- `PRIVACY_OFFICER`: 송문길

## Locally reproducible evidence

1. Use JDK 17, Android SDK 36, and Gradle 8.11.1. Set `FRIDGE_MENU_ANDROID_SDK`, then run `npm run verify:release` from a clean revision.
2. The build writes `android/app/build/outputs/bundle/release/app-release.aab`. Without owner signing variables it is a local **unsigned** verification artifact only.
3. A Play upload requires a **signed AAB**. With Play App Signing, Google holds the app signing key used for distributed APKs; the owner-controlled upload key signs the AAB sent to Play. Store the upload keystore and its backup outside the repository, record the account recovery procedure, and supply all four environment variables: `FRIDGE_MENU_KEYSTORE_PATH`, `FRIDGE_MENU_KEYSTORE_PASSWORD`, `FRIDGE_MENU_KEY_ALIAS`, and `FRIDGE_MENU_KEY_PASSWORD`.
4. Rebuild and require `AAB_SIGNED_OK`; then regenerate `release/artifacts/release-manifest.json` and `android-evidence.json`. Never upload an unsigned AAB.

## Account and production-track gates (owner only)

1. Account type is confirmed as an **organization account** by the owner on 2026-08-25.
2. Check only the current developer identity status. If Google Play Console requests remediation, complete the organization verification using the matching D-U-N-S number and business documents before submission.
3. Complete device verification when Play Console shows the task: use the Play Console mobile app and its QR flow on a non-rooted physical Android 10+ device while signed in as the account owner.
4. Verify the contact email and phone number with the required OTP codes, and keep both operational.
5. Confirm that the production track is available. If Play Console presents an unexpected account gate, stop and follow the current first-party requirement rather than assuming a personal-account workflow.

Official references: [device verification](https://support.google.com/googleplay/android-developer/answer/14316361), [developer identity](https://support.google.com/googleplay/android-developer/answer/10841920), [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756), [Health apps declaration](https://support.google.com/googleplay/android-developer/answer/14738291), [internal testing](https://support.google.com/googleplay/android-developer/answer/9845334), and [preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151).

## Play Console questionnaire answers

Re-confirm every answer against the exact signed candidate before saving it in Play Console.

| Console item | Candidate answer | Repository basis |
|---|---|---|
| App access | All functionality is available without special access | No account, login, subscription, or restricted flow |
| Ads declaration | No | Advertising UI and SDK are absent |
| Data safety | No data collected or shared | Zero Android permissions, no INTERNET permission, no third-party dependencies, local WebView storage only |
| Data deletion | Clear list removes ingredients only; clear the app or browser storage, or uninstall, to remove ingredients, favorites, and history | No server copy exists |
| Content rating | No violence, sexual content, gambling, drugs, or user-generated content | Deterministic local cooking directions only |
| Target audience | Not directed to children | Product copy and privacy policy state this boundary |
| Health apps declaration | HOLD — owner resolution required | Google lists tools for planning meals under `Nutrition and Weight Management`. This app offers ingredient-based menu suggestions but no nutrition data, diet/weight goal, health tracking, medical claim, or health data. The owner must compare the exact signed candidate with the current Console wording and record the selected answer and evidence. Do not save the Health form or proceed to closed, open, or production release until this HOLD is resolved |
| Government apps | Not a government app | No government affiliation or service |
| Financial features | None | No financial product, transaction, or advice |
| Advertising ID | Not used | No `AD_ID` permission, ads SDK, or identifier access |

## Submission sequence (owner only)

1. **Policy hosting/publication approval:** finalize the four privacy values above, obtain fresh approval for the exact HTTPS target, publish the policy, run `npm run verify:policy-url` as the named gate, and enter its URL in Play Console only after it passes. This gate requires the exact policy identity strings, zero OWNER_REQUIRED markers (literal occurrences), and a non-200 randomized missing-path probe; HTTP 200 alone is insufficient because this site is known to return soft-404 responses.
2. **Signing approval:** name the exact Git SHA and unsigned AAB digest, then use the owner-controlled upload key outside the repository to rebuild. Require `AAB_SIGNED_OK`, regenerate the release evidence, and record the signed AAB SHA-256.
3. **Internal-test upload approval:** only after steps 1–2 pass, obtain fresh approval for the exact signed AAB and internal track, then upload. Record the tester list, feedback channel, rollout status, opt-in URL, and test dates. Each tester must open the opt-in URL with the matching Google account, install from the Play Store, and record the delivered version and application identity before completing the exact QA checklist.
4. **Health declaration resolution:** after internal QA, open the current Console form, compare its wording with the exact signed candidate, resolve the HOLD above, and record the form access date, final answer, owner, and evidence ID. Do not progress to closed, open, or production release while the answer is unresolved.
5. **Production submission approval:** after internal QA passes, confirm the exact signed candidate's app access, ads, Data safety, target audience, content rating, Health apps declaration, Government apps, Financial features, Advertising ID, en-US/ko-KR listing, Android screenshots, 32-bit RGBA 512×512 icon, alpha-free 1024×500 feature graphic, production-track availability, and country availability. Submit only under fresh approval naming that target.
6. **App publication approval:** after review, obtain a separate fresh approval for publication, visibility, country availability, and rollout target. A production-submission receipt does not authorize publication or rollout.

## Separate approval receipts

Never combine these authorities. Record a separate receipt for each action actually approved:

- signing approval
- policy hosting/publication approval
- internal-test upload approval
- production submission approval
- app publication approval, including visibility and rollout target

Every receipt must contain: action, exact target (HTTPS URL or Play track), Git SHA, AAB SHA-256 when applicable, approver, timestamp, and authority evidence ID. An earlier receipt does not authorize a later action or a different artifact, track, country availability, visibility, or rollout.

GitHub Pages is a separate publication action. Before dispatching its workflow, protect the `github-pages` environment with the owner as required reviewer, set repository variable `OWNER_APPROVED_PAGES_SHA` to the exact approved `main` SHA, and enter that SHA plus the fresh publication approval evidence ID. Remove or change the variable after the action. Source-level guards do not replace the protected-environment approval.

A CI receipt is usable only when its execution is `GITHUB_ACTIONS`, its run URL is non-null, and its Git SHA and AAB SHA-256 match the exact candidate. `LOCAL_SIMULATION_ONLY` is not current CI evidence, and a stale or mismatched receipt grants no approval or readiness credit.

## Internal-test and release QA record

Record the Git revision, release-manifest and AAB SHA-256, AAB signing status, CI run URL, Android/Gradle versions, tester list, opt-in URL, matching Google account confirmation, delivered version, device/OS, install and offline-relaunch results, feedback disposition, TalkBack result, screenshot identity, Health form access date and final Health answer, final questionnaire answers, target track, and country availability. Stop if any unexpected permission, SDK, analytics, identifier, account flow, external URL, unresolved declaration, or `OWNER_REQUIRED` marker appears.

## Current boundary

Local automation did not create/import a signing key, access Play Console, fill questionnaires, publish the privacy policy, upload an artifact, run a physical-device test, submit, or publish.
