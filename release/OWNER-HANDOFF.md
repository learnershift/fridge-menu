# Owner handoff and submission gate

## Owner-supplied privacy values

- `[OWNER_REQUIRED:LEGAL_NAME]`: legal developer or business name matching the Play listing
- `[OWNER_REQUIRED:PRIVACY_EMAIL]`: monitored privacy contact email
- `[OWNER_REQUIRED:PUBLIC_POLICY_URL]`: stable public HTTPS policy URL
- `[OWNER_REQUIRED:PRIVACY_OFFICER]`: Korean privacy officer name

## Locally reproducible evidence

1. Use JDK 17, Android SDK 36, and Gradle 8.11.1. Set `FRIDGE_MENU_ANDROID_SDK`, then run `npm run verify:release` from a clean revision.
2. The build writes `android/app/build/outputs/bundle/release/app-release.aab`. Without owner signing variables it is a local **unsigned** verification artifact only.
3. A Play upload requires a **signed AAB**. The owner stores the upload keystore outside the repository and supplies all four environment variables: `FRIDGE_MENU_KEYSTORE_PATH`, `FRIDGE_MENU_KEYSTORE_PASSWORD`, `FRIDGE_MENU_KEY_ALIAS`, and `FRIDGE_MENU_KEY_PASSWORD`.
4. Rebuild and require `AAB_SIGNED_OK`; then regenerate `release/artifacts/release-manifest.json` and `android-evidence.json`. Never upload an unsigned AAB.

## Account and production-track gates (owner only)

1. Account type is confirmed as an **organization account** by the owner on 2026-08-25.
2. Check only the current developer identity status. If Play Console requests remediation, complete the organization verification using the matching D-U-N-S number and business documents before submission.
3. Complete device verification when Play Console shows the task: use the Play Console mobile app and its QR flow on a non-rooted physical Android 10+ device while signed in as the account owner.
4. Verify the contact email and phone number with the required OTP codes, and keep both operational.
5. Confirm that the production track is available. If Play Console presents an unexpected account gate, stop and follow the current first-party requirement rather than assuming a personal-account workflow.

Official references: [device verification](https://support.google.com/googleplay/android-developer/answer/14316361), [developer identity](https://support.google.com/googleplay/android-developer/answer/10841920), and [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756).

## Play Console questionnaire answers

Re-confirm every answer against the exact signed candidate before saving it in Play Console.

| Console item | Candidate answer | Repository basis |
|---|---|---|
| App access | All functionality is available without special access | No account, login, subscription, or restricted flow |
| Ads declaration | No | Advertising UI and SDK are absent |
| Data safety | No data collected or shared | Zero Android permissions, no INTERNET permission, no third-party dependencies, local WebView storage only |
| Data deletion | Clear list, clear app storage, or uninstall | No server copy exists |
| Content rating | No violence, sexual content, gambling, drugs, or user-generated content | Deterministic local cooking directions only |
| Target audience | Not directed to children | Product copy and privacy policy state this boundary |
| Health apps declaration | `My app doesn't provide any health features` | No nutrition data, diet/weight goal, health tracking, medical claim, or health data; meal output is generic cooking-direction text. Re-check the current form because Google's examples include some meal-planning tools |
| Government apps | Not a government app | No government affiliation or service |
| Financial features | None | No financial product, transaction, or advice |
| Advertising ID | Not used | No `AD_ID` permission, ads SDK, or identifier access |

## Submission sequence (owner only)

1. Finalize the four privacy values above, approve stable HTTPS hosting, publish the policy, and enter its URL in Play Console.
2. Upload the signed AAB to internal testing, install it on a physical device, and complete the exact QA checklist.
3. Use the four tracked 1080×1920 screenshots, 512×512 icon, and alpha-free 1024×500 feature graphic only if they still match the signed candidate.
4. Complete app access, ads, Data safety, target audience, content rating, Health apps declaration, Government apps, Financial features, and Advertising ID forms using the table above.
5. Confirm production-track availability and stop for owner action if Play Console presents any additional account requirement.
6. Final submission, publication, visibility changes, and production rollout each require fresh owner approval for the exact target.

## Release QA record

Record the Git revision, release-manifest and AAB SHA-256, AAB signing status, CI run URL, Android/Gradle versions, device/OS, install and offline-relaunch results, TalkBack result, screenshot identity, and final questionnaire answers. Stop if any unexpected permission, SDK, analytics, identifier, account flow, or external URL appears.

## Current boundary

Local automation did not create/import a signing key, access Play Console, fill questionnaires, publish the privacy policy, upload an artifact, run a physical-device test, submit, or publish.
