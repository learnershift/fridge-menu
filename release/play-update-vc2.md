# Play update handoff — version code 2

## Signed upload artifact

- Path: `/Users/timeabout/projects/fridge-menu/android/app/build/outputs/bundle/release/app-release.aab`
- SHA-256: `d926f533b41cedb692cdf5a9fdd7f806a16435c3a2c909c31d2611d7adfde8a2`
- versionCode: `2`
- versionName: `1.0.0`

## Current evidence status — BLOCKED

This is **not** present release approval. The signed candidate was independently inspected, but fresh local release evidence generation is blocked and all Play Console actions remain future human-only work.

| Check | Actual status | Evidence |
| --- | --- | --- |
| A1 — candidate identity | PASS | At the start of the A audit, the Git worktree was clean and `HEAD=origin/main=live remote` was `fa552595d2a2d07c78d0b732e86254e1714af062`; `fa55259` ancestor check passed. |
| A2 — signed package contents and web-runtime route | PASS | `META-INF/MANIFEST.MF`, `FRIDGE-M.SF`, and `FRIDGE-M.RSA` were present; all 11 packaged PWA paths and SHA-256 values equaled `dist/`; DEX contained `appassets.androidplatform.net`. |
| A3 — Android identity and signature verification | PASS | `/usr/bin/jarsigner -verify` reported `jar verified`; `android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml` reported `versionCode 2`, `versionName 1.0.0`. |
| A4 — signed AAB integrity | PASS | SHA-256 was `d926f533b41cedb692cdf5a9fdd7f806a16435c3a2c909c31d2611d7adfde8a2`; the A audit pre/post AAB was unchanged, HEAD was unchanged, and the worktree was clean. This historical A snapshot preceded creation of this document. |
| B1 — `npm test` | PASS | 75/75 tests passed (exit 0). |
| B2 — `npm run build` | PASS | `BUILD_OK files=11 output=dist` (exit 0). |
| B3 — `npm run release:manifest` | FAIL | Exit 1: `Release checks failed: privacy_security_static, offline_static`. |
| B4 — `npm run android:evidence` | FAIL | Exit 1: `Release manifest is not bound to the current clean source tree.` |
| Submission readiness | BLOCKED | Fresh release-manifest and Android-evidence success are absent; physical phone QA, Play Console work, and fresh target-bound owner approval remain human-only gates. |

## Human-only Play Console steps

No Play Console access or browser automation was performed for this handoff. Only after the BLOCKED evidence is resolved and the owner gives fresh approval for this exact target, a human owner may perform this future sequence:

1. 테스트 → 내부 테스트 → 새 릴리스 만들기 → AAB 업로드 → '2 (1.0.0)' 확인 → 검토 → 출시

## Release notes

- en: `Fixed an issue that prevented ingredient entry, language switching, and menu suggestions from working.`
- ko: `재료 입력, 언어 전환, 메뉴 제안이 작동하지 않던 문제를 수정했습니다.`

## Phone QA — required before promotion

- [ ] 재료 3개 입력 → 메뉴 생성
- [ ] 언어 전환
- [ ] 재시작 후 데이터 유지
- [ ] 비행기모드 전체 흐름
- [ ] 뒤로가기

After all phone QA is complete, a human may use 내부 테스트 릴리스 프로모션 → 프로덕션, select countries, and submit for review **only after fresh owner approval for that exact action and target**. No agent performed these actions.

## Warnings and integrity record

- `jarsigner -verify` previously reported the signed AAB as verified, with the recorded warnings: self-signed/trust-chain, missing timestamp, POSIX attributes, and JarFile/JarInputStream consistency.
- The B3 failure root is static-validator drift: `release-checks.mjs` still expects `file:///android_asset/pwa/index.html` and rejects the current HTTPS `appassets.androidplatform.net` entry. No validator fix was made.
- Read-only inspection found additional downstream blockers that B3 did not reach: `scripts/release-manifest.mjs` pins `version_code: 1`; `release/artifacts/aab-reproducibility.json` binds source `3b68828e714522bab12f05a8c2b5c16a6dcec552` and SHA-256 `c1c08969...`, not the current signed AAB.
- No CI receipt failure is claimed here; it was not checked in this task.
- Matching signed-AAB two-build reproducibility evidence cannot be honestly generated without unauthorized signing or replacing the candidate. Do not bypass this gate.
- The eight protected web source files remained byte-identical after the authorized build.
- The signed AAB SHA-256 remained `d926f533b41cedb692cdf5a9fdd7f806a16435c3a2c909c31d2611d7adfde8a2` after all commands.
- Generated-file outcome: `npm run build` ran, but `git diff` showed no generated-file changes; both evidence scripts failed before writing their output files.
