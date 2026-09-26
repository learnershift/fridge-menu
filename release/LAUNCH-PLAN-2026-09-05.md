# 냉장고 메뉴 출시 준비 계획 — 2026-09-05

상태: **출시 준비 부분완료 / 제출·공개 보류**. 기존 Android 인수인계를 기준으로 Google Play 출시를 준비한다. 현재 Play Console 등록·트랙·최대 versionCode·공개 여부는 직접 확인하지 못했다. 앱 기능 추가보다 현재 후보의 빌드·검증·제출 자료 일치부터 마무리한다.

## 2026-09-26 현재 확인 — 아래 9월 7일 기록보다 우선

- 9월 9일 승인된 Android SDK 36 설치는 완료됐다. 오늘 서버에서 JDK 17·SDK 36·Gradle 8.11.1로 미서명 AAB를 다시 빌드했고, 앱 ID `com.learnershift.fridgemenu`, versionCode 2, target SDK 36, 권한 0개, `dist/`와 동일한 웹 파일 11개를 확인했다. 이 AAB는 서명되지 않았고 clean Git SHA에 묶인 최종 후보가 아니다.
- `npm test` 75/75, `npm run build`, `npm run test:browser:orca` 영어·한국어 저장 후 새로고침, `npm run verify:policy-url`, `npm run store-assets`가 통과했다. 표준 `npm run test:browser`는 서버의 Chrome 샌드박스 제한으로 실패한다. 검사기 수정으로 현재 종료 신호 `SIGABRT`와 `No usable sandbox!` 원문을 표시한다.
- 이 문서 작성 시 미커밋 릴리스 변경은 Git SHA로 확정되지 않아 `verify:aab-repro`와 전체 `verify:release`의 최종 증빙이 없었다. 당시 최신 원격 Release readiness 실행은 9월 4일 실패했다. 미국 공개 Play URL은 9월 26일 HTTP 404였으며 Console 내부 트랙·국가 설정은 확인하지 못했다. 이후 커밋·CI 결과를 별도로 확인해야 한다.
- 아래의 “2026-09-07 재개 후 현재 상태”와 그 시점 검증 표는 당시 기록이다. 현재 제출 준비 판단에는 이 갱신 및 새 clean SHA의 CI·실기기 증빙을 사용한다. 서명·Play 업로드·심사 제출·미국 공개는 각각 해당 대상에 대한 새 승인 전까지 보류한다.

## 2026-09-07 재개 후 현재 상태

- 현재 작업 위치는 `/home/ax/work/repos/fridge-menu`이며 원래 UUID/Astra high 대화에서 계속 작업 중이다. 아래 9월 5일 기준의 옛 경로·도구 실패는 당시 관측 기록이다.
- JDK 17.0.20.1+1과 Gradle 8.11.1 실행 환경을 사용자 전용 경로에 준비했다. 공식 배포 해시 확인, 실제 Java 컴파일·실행 및 Gradle 실행 성공으로 JDK 부재 문제를 해결했다.
- Android SDK는 약관 동의 권한 확인이 남았다. 당시 검토안은 로컬 `reports/android-sdk-install-proposal-20260907.md`에 있다. SDK 설치·AAB 빌드는 당시 미실행이었다.
- `npm run test:browser:orca`를 추가해 기존 영어/한국어 DOM 상호작용 검증과 새로고침 후 저장 재조회를 실행했다. 두 언어 PASS. 전용 랜덤 localhost 서버와 생성한 page ID만 사용·정리한다. `verify:release`의 기존 standalone Chrome 검사를 이 결과로 대체하지 않는다.
- standalone Chrome에는 사용 가능한 sandbox 환경이 부족하다. 당시 공식 Chrome 설치 검토안은 로컬 `reports/browser-sandbox-20260907.md`에 있다.
- 현재 서버 메모리 digest/refresh/search는 정상 실행했다. 필수 domain/creator 원문 3개 부재는 별도 미확인으로 유지한다.
- 9월 7일 수정 후 75개 테스트와 build PASS. 로컬 보고서는 root에 허용하고 dist의 11개 파일 허용 목록은 유지했다. 당시 상세 증거는 로컬 `reports/launch-preparation-20260907.md`에 기록했다.

## 확인한 기준

- 실행: `ax-main`, `/home/ax/work/fridge-menu`, Orca 관리 작업공간, `main`.
- 시작 HEAD: `80918a63b6cb37137b3242d76f336a4a5ed807c4`, 시작 시 Git 변경 없음. 이번 수정은 작업트리에 있으며 아직 새 출시 후보 SHA가 아니다.
- Orca `runtime.state=ready`. 서버 자신은 `local`로 등록되어 있으며 `--environment ax-server` 별칭은 없어 해당 명령은 실패했다. Mac으로 작업을 옮기지 않았다.
- 현재 프로젝트의 다른 활성 writer와 STOP 파일을 발견하지 않았다. 기존 사용자 터미널에는 입력하지 않았다. 현재 요청 전용 구현자·독립 검증자만 사용했다.
- 기존 `release/play-update-vc2.md`의 서명 AAB·Mac 경로·SHA는 과거 기록이다. 현재 서버에는 그 AAB와 `release/artifacts/`의 후보 증거 4종이 없다.
- 세컨브레인 기본 경로가 없고, 발견한 서버 사본의 digest도 `canonical.sqlite` 부재로 실패했다. 필수 DOMAIN/creator 자료도 지정 경로에서 읽지 못했다. 사용자 제공 규칙과 저장소 인수인계를 적용했으며 새 시장·수익화·기능 방향은 결정하지 않았다.

## 이번에 완료한 작업

1. 출시 검사기의 구식 `file:///android_asset` 기준을 현재 `WebViewAssetLoader`의 고정 자산 원점 기준으로 수정했다. 원점·경로·차단 코드가 바뀌면 실패하도록 좁은 정적 회귀 검사를 유지한다.
2. 출시 매니페스트 기대 versionCode를 실제 Gradle 값 `2`와 일치시켰다. 이후 Console에 이미 2가 업로드되어 있다면 다음 후보는 더 높은 번호가 필요하므로 현재 값을 업로드 가능하다고 단정하지 않는다.
3. 실제 Java 소스를 사용하는 회귀 검사와 조기 허용·경로 검증 무력화·보호 WebViewClient 교체·interception 반전 검사를 보강했다. 독립 검토에서 발견한 최초 우회와 문서 테스트 실패를 수정 후 재검증했다.
4. CI의 unsigned AAB와 최종 signed AAB 해시를 구분하도록 인수인계·QA 문서를 고쳤다. 동일 소스·앱 식별자·도구 버전·패키지 내 웹 파일 해시는 대조하되 서명으로 달라지는 전체 AAB 해시를 같다고 요구하지 않는다.
5. 개인정보 신고 근거의 오래된 “third-party dependencies 없음” 표현을 현재 AndroidX WebKit 포함 사실과 일치시켰다. 최종 AAB 신고 검토는 그대로 남긴다.

## 직접 실행한 검증

| 검사 | 결과 및 범위 |
| --- | --- |
| `npm test` | 수정 후 75/75 PASS. 정적 변이 회귀 포함. 독립 검증자도 직접 재실행 |
| `npm run build` | `BUILD_OK files=11 output=dist`; 앱 런타임 소스와 dist에는 이번 변경 없음 |
| `computeReleaseChecks()` | tests/build/touch_target_static/privacy_security_static/offline_static 모두 PASS. Android 실기기·보안 인증을 뜻하지 않음 |
| 원래 `npm run release:manifest` | 수정 전 `privacy_security_static, offline_static` 실패 재현. 수정 후 해당 계산은 PASS이나 전체 manifest 생성은 현재 clean candidate/AAB 부재로 미완료 |
| `npm run verify:policy-url` | 기존 공개 주소 HTTP 200, 필수 식별문구 검증 통과, 무작위 없는 경로 HTTP 404, `POLICY_URL_VERIFIED`. 이번에 게시하거나 변경한 것은 없음 |
| `npm run test:browser` | 기본 Chrome 탐색 실패. 설치된 Chromium을 명시한 재시도도 `No usable sandbox`로 실패. `--no-sandbox`나 시스템 보안 설정 변경으로 우회하지 않음 |
| Orca 브라우저 대체 확인 | 서버의 `npm start` 진입점에서 빈 목록 → 계란/밥/시금치에 해당하는 영어 재료 3개 → 메뉴 3개 → 겹치지 않는 다른 메뉴 → 즐겨찾기 1개/기록 1개 저장 확인 |
| 저장·언어 회귀 | 한국어 전환 후 reload에서 재료 3개·즐겨찾기 1개·기록 1개·언어 선택 재조회 확인 |
| 웹 오프라인 | 이번 작업의 테스트 서버만 종료해 HTTP 연결 거절 확인 후 같은 페이지 reload 성공. 메뉴 3개 생성 및 기록 증가 확인. 이어 한국어 재료 계란/밥/시금치로 한국어 메뉴 3개 생성 확인 |
| 새 실행 | 서버에서 다시 `FRIDGE_MENU_PORT=0 npm start`; 새 포트의 HTTP 응답 11개가 dist 파일 바이트와 일치. 첫 테스트 서버 종료 코드 143은 의도한 오프라인 시험 종료 |
| `npm run android:aab` | Android SDK 경로 없음으로 실패. java/javac/adb/sdkmanager/jarsigner도 PATH에 없고 일반 설치 경로에 SDK/JDK가 없음 |
| 최종 diff | 관련 검사·문서·테스트만 변경. `git diff --check` PASS |

브라우저 검증은 Orca의 새 테스트 탭과 임시 localhost origin에서 DOM 컨트롤 이벤트로 실행하고 실제 localStorage를 재조회했다. Orca `click` 응답만으로는 상태가 바뀌지 않아 성공으로 계산하지 않았다. 이 결과는 별도 Chrome 명령 통과, Android WebView 설치·실기기·TalkBack 검증을 대체하지 않는다.

## 실행 순서와 완료 조건

| 순서 | 할 일 | 완료 조건 / 현재 상태 |
| --- | --- | --- |
| 1 | 서버 Android 검증 환경 마련 | JDK 17·고정 Gradle 8.11.1은 9/7 실제 실행 완료. SDK platform 36/build-tools 36.0.0 약관 동의 권한 및 standalone Chrome 정상 sandbox 설치 조건이 남음. 기존 검증 메타데이터와 보안 경계 유지 |
| 2 | 검토한 변경을 clean Git 후보로 확정하고 unsigned AAB 재생성 | 서버에서 `FRIDGE_MENU_REQUIRE_UNSIGNED=1 npm run verify:release`; 독립된 두 빌드 해시 일치, manifest/Android evidence 생성, 실제 GitHub Actions CI proof 확보. 현재 미완료; 로컬 결과를 CI 영수증으로 만들지 않음 |
| 3 | Console 현재 상태 확인 및 최종 후보 식별 | 기존 등록 앱/트랙/최대 versionCode/계정 확인을 기록하고 충돌 없는 후보 결정. 조직 계정이라는 기존 기록은 현재 Console 확인을 대체하지 않음 |
| 4 | 정확한 후보 서명 준비 | Git SHA·unsigned digest·서명 대상이 준비된 뒤 별도 승인. 기존 소유자 업로드 키는 저장소 밖에서 사용. signed digest/패키지 내용/서명 증거 재검증. 키 생성·이전·서명은 이번에 수행 안 함 |
| 5 | 내부 테스트 업로드 및 실기기 QA | 정확한 signed AAB와 내부 트랙 승인 후 설치. 재료 입력·언어·저장·비행기 모드 재실행·뒤로가기·TalkBack, 기기/OS/설치 버전과 최종 스크린샷 기록 |
| 6 | 스토어 제출 자료 확정 | en-US/ko-KR 설명·아이콘·그래픽·실기기 스크린샷을 같은 후보와 대조. Data safety/광고/등급/연령/국가·Health 답변을 현재 Console 기준으로 확정. Health HOLD는 해소 전 다음 단계 차단 |
| 7 | 심사 제출, 이후 공개 출시 | 각각 정확한 후보·트랙·국가·공개 범위에 대한 새로운 명시적 승인. 제출 승인과 공개 승인은 별개. 현재 둘 다 수행하지 않음 |

기존 개인정보처리방침은 현재 접근 검사에 통과했으므로 무조건 재게시하지 않는다. 최종 후보와 내용이 일치하는지 다시 확인하고, 내용 변경·새 게시가 필요할 때만 정확한 URL에 대한 별도 승인을 받는다. 기존 게시의 승인 기록이 있었다고 추정하지 않는다.

## 현재 공식 기준 확인

- 2026-08-31부터 일반 Android 신규 앱·업데이트는 target API 36 이상이 필요하다. 현재 Gradle 설정은 36이나 최종 AAB의 manifest도 검사해야 한다. [Google Play 공식 기준](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- Health 신고는 관련 트랙에서 필요하고 식사 계획 도구가 영양·체중관리 예시에 포함된다. 이 앱의 최종 답은 현재 Console 문구와 정확한 후보를 보고 확정한다. [Health apps declaration](https://support.google.com/googleplay/android-developer/answer/14738291?hl=en-GB)
- 가상 HTTPS 원점으로 번들 파일을 제공하는 `WebViewAssetLoader`는 Android 공식 로컬 콘텐츠 로딩 방식이다. 그 원점을 실제 외부 서비스 접속과 혼동하지 않되, 앱의 허용 경로·네트워크 권한 검증은 유지한다. [Android 공식 문서](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)

## 2026-09-07 남은 확인과 인계 — 당시 기록

- 사용자의 현재 Play Console 단계 답변 대기. 무응답을 내부 테스트·공개 완료로 간주하지 않는다.
- 서버 도구·AAB·실기기·Console·Health 답변이 준비되지 않아 날짜가 확정된 출시 약속은 할 수 없다.
- 신규 기능·광고·결제·시장 검증은 이번 기술 준비의 완료 근거에 포함하지 않는다. 현재 앱은 계정·추적·광고 없이 기기 내 저장을 유지한다.
- 작업트리 수정은 검토 가능하게 남겼으며 커밋·push·서명·업로드·배포는 수행하지 않았다. `AGENTS.md`의 소유자 승인 경계를 유지한다.
