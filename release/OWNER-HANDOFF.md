# Owner handoff and submission gate

## Locally reproducible evidence

1. Run `npm run verify:release` to test, rebuild `dist/`, and create `release/artifacts/release-manifest.json`. It binds the current Git revision to SHA-256 checksums.
2. With an already installed Android SDK and Gradle, set `FRIDGE_MENU_ANDROID_SDK` to that SDK path and run `npm run android:aab`. The output, if successful, is `android/app/build/outputs/bundle/release/app-release.aab`; it is intentionally unsigned.
3. Run `npm run release:manifest` again after the AAB is made to include its checksum. Do not create or import signing keys.

## Owner-only Google Play Console work

- Register or select the Play Console app, complete app access, ads, target audience, content rating, countries, and contact fields.
- Publish `privacy-policy.md` at a stable public HTTPS URL and enter it in Google Play Console.
- The repository now supplies `release/store-assets/fridge-menu-icon-512.png` and `release/store-assets/fridge-menu-feature-graphic-1024x500.png`; regenerate the feature graphic with `npm run store-assets`. Provide at least two device screenshots captured from the final app. Run `npm start` and then `npm run store-screenshot`; set `FRIDGE_MENU_CHROME_BIN` or `FRIDGE_MENU_CAPTURE_URL` if needed. This captures a reproducible 1080 x 1920 browser image but does not replace final physical-device captures.
- Upload the unsigned AAB only through the owner-controlled Play Console signing flow, then verify the generated test-track artifact on a physical device.

## Release QA record

Record the Git revision, release-manifest SHA-256 entries, AAB SHA-256, CI run URL, Android/Gradle versions, device/OS, install result, offline launch result, screen-reader check, and final questionnaire answers. Stop if any network permission, SDK, analytics, identifier, account flow, or external URL appears.

## Current boundary

No signing key, Play account access, public policy URL, store assets, Play questionnaire, upload, publication, real-device test, or Android SDK/Gradle installation is performed by this repository.
