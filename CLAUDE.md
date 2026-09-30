# 엄마의 낭독 스튜디오 (geminiTTS) — 개발 메모

Next.js 15 + next-auth(구글 로그인, 화이트리스트) + Gemini TTS. Vercel 배포, 저장소는 Vercel Blob(로컬은 `.data/`).
사용자 문서는 `README.md`, 사용량 기록 문서는 `docs/USAGE_LOG.md`.

## 가장 중요한 제약: Gemini 하루 요청 100회

호출 하나 = 한도 1회. 그래서 구조 전체가 "호출을 덜 쓰는 것"과 "쓴 걸 기록하는 것"을 중심으로 짜여 있다.

- **계획** `lib/shared/scriptPlan.js#planPieces` — 대본 조각 → 최소 개수의 호출(호출 하나에 화자 2명·4000자·120줄까지,
  `lib/shared/config.js`). 세 모드 중 호출이 **엄격히 적은** 쪽을 고른다(동률이면 sequence → voices → pairs):
  `sequence`(대본 순서 그대로, 자르기 없음) · `voices`(목소리·스타일마다 단일 화자 호출, 줄 사이 `<long pause>`) ·
  `pairs`(두 목소리를 대본 순서로 한 호출에 — 줄마다 ` <long pause>` + `PAUSE_STYLE`). voices/pairs 호출은 하나의 긴
  녹음으로 돌아오므로 `call.cut.lines`(글자 수·문장 끝 위치·화자 그룹)를 달고 있고, 브라우저가 줄마다 잘라야 한다.
  n명이면 이론상 약 n/2회. 직접 만든 목소리(`voice_*`)는 다른 목소리와 못 묶인다.
- **자르기** `lib/shared/wavSplit.js#cutLines` — 무음 구간을 찾고, 글자 수로 예측한 "쉼이 있어야 할 시각"을 DP로 맞춘다.
  경계마다 `margin`(그 줄 끝을 다른 무음에 두거나 빼면 얼마나 나빠지나)·`fit`을 재고, `margin ≥ 5`·`fit ≤ 3`·쉼 ≥ 0.8초인
  **확실한 경계의 줄만** 반환한다(나머지는 `ranges[i] = null`). 절대 추측해서 자르지 않는다. 긴 쉼 한가운데의 숨소리 같은 작은 소리는
  하나의 쉼으로 합치고(`mergeBlips`), 어떤 쉼으로도 설명되지 않는 긴 무음은 감점한다(`UNEXPLAINED_*`).
  상수를 바꾸면 합성 시험(`tests/wavSplit.test.mjs`, `pipeline.test.mjs`)뿐 아니라 "잘못 자른 줄 0"이 유지되는지 봐야 한다.
- **라운드** `lib/client/produceScript.js` — 1라운드는 가장 싼 계획. 자른 뒤 확실한 줄만 채택하고 나머지는 `pending`으로 두었다가
  다음 라운드에서 **그 줄들만** 다시 계획(`planPieces(pending)`)한다. `MAX_CUT_ROUNDS=3` 초과, 자른 호출이 REJECTED,
  또는 누적 8줄 이상에서 성공률 40% 미만이면 `sequence`로 넘어가 반드시 끝낸다.
- **실행** `lib/client/speechJob.js` — 브라우저가 호출을 하나씩 보냄. 끝난 호출은 즉시 IndexedDB(`clipCache.js`)에
  요청 해시로 저장 → 실패/한도 초과/글 수정 후에도 바뀐 구간만 다시 생성. 재시도 정책도 여기(서버는 재시도 안 함).
  같은 실행 중 이미 물어본 요청(`fresh`)은 캐시를 읽지 않고 다시 부른다(같은 요청은 같은 실패 녹음을 돌려주기 때문).
- **서버** `app/api/tts/route.js` → `lib/server/tts.js` → `lib/server/gemini.js#callGemini` 가 유일한 Gemini 출입구.
  모든 요청을 `lib/server/usageLog.js` 장부에 한 줄씩 기록한다. **Gemini를 부르는 새 코드는 반드시 `callGemini`를 통과시킬 것.**
- **사전 경고** `lib/shared/quota.js#assessBudget` + `components/QuotaEstimate.js` — 남은 횟수보다 많이 필요하면 확인 창.

## 폴더

- `lib/shared/` 브라우저·서버 공용(순수 함수, `tests/`로 테스트) · `lib/server/` 서버 전용 · `lib/client/` 브라우저 전용
- 상대 import에는 `.js` 확장자를 붙인다 (Node 테스트가 같은 파일을 직접 import 하기 때문).
- 한도·상수는 전부 `lib/shared/config.js` 한 곳. `app/api/tts/route.js`의 `maxDuration`만 Next 규칙상 리터럴.

## 명령

```bash
npm test                      # 단위 테스트 (Gemini 호출 없음)
npm run dev:mock              # 가짜 Gemini + 임시 데이터 + 테스트 로그인으로 http://localhost:3100 (실제 할당량 0 사용)
npm run usage:report          # 사용량 기록 요약 (로컬 .data/usage 또는 내려받은 JSON 경로를 인자로)
```

`npm run dev:mock`의 가짜 서버는 `POST localhost:4010/__set`으로 한도/거절/지연을 바꿔가며 429·400 시나리오를 재현할 수 있다
(`scripts/mock-gemini.mjs` 상단 주석 참고). 로그인은 실행 시 출력되는 쿠키 한 줄을 브라우저 콘솔에 붙여넣기.
가짜 Gemini는 `scripts/synth-speech.mjs`로 줄마다 다른 음높이의 합성 음성과 쉼을 만들어서 자르기·라운드 전체를 시험할 수 있다
(`weakPauseShare`로 모델이 쉼 태그를 무시하는 상황도 재현). `tests/pipeline.test.mjs`는 같은 합성 음성으로 순서·누락·줄별 음높이를 검사한다.

## 실제 API로 잰 것 (2026-09-30) — 자르기 설계의 근거

- `<long pause>` 태그만으로는 쉼이 0.4~2초로 들쭉날쭉하고 가끔 0.3초 — 자르기 근거로 부족. 턴 스타일에
  `PAUSE_STYLE`("말을 마친 뒤 2초 정도 완전히 조용히 멈춘다.")을 함께 주면 2.5~14초가 된다. 문장 끝 쉼은 늘 0.4~0.75초.
- 그래도 모델이 가끔(특히 긴 호출의 앞부분) 지시를 무시한다. 4명 24줄 → 6회(순서대로면 12), 6명 36줄 → 8회(순서대로면 18).
  1라운드에 확실히 잘리는 줄은 약 60~70%였고 나머지는 다음 라운드에서 다시 만든다.
- 한 호출 12줄(약 480자, 60~85초 오디오)은 잘 동작. 4000자 한도는 안전 여유이지 Google의 한계가 아니다(9.4k자 호출도 성공).

## 사용량 문제를 조사해 달라는 요청을 받으면

1. 사용자에게 앱의 **사용량 → 기록 내려받기 → JSON** 파일을 받는다 (배포 데이터는 Blob에 있어 로컬에서 못 읽음).
2. `npm run usage:report -- <파일>` 로 job별 `planned/sent/counted/429/400/retries/split`을 본다.
3. "한도에 세는 규칙"은 가정이다(`docs/USAGE_LOG.md`). 실제 데이터와 안 맞으면 `lib/shared/quota.js#COUNTED_OUTCOMES`를 고친다.

## 아직 검증 못 한 것 (실제 API로만 확인 가능)

- 한 호출에 화자 3명 이상 (조사 결과 400). 되면 `MAX_SPEAKERS_PER_CALL` 한 줄로 호출 수가 크게 준다.
- 한 호출 4000자를 넘겨도 되는지, 긴 오디오 뒤쪽의 음질, 그리고 줄이 훨씬 많은 pair 호출에서 쉼 지시가 얼마나 지켜지는지
  (`MAX_CHARS_PER_CALL`, `MAX_TURNS_PER_CALL`). 9.4k자 호출이 잘림 없이 돌아온 적은 있지만 음질·쉼은 확인하지 않았다.
- 쉼 지시를 더 잘 지키게 하는 문구/구조 (지금은 `PAUSE_STYLE` + 태그). 1라운드 성공률이 곧 호출 수를 정한다.
- Google이 429/400 응답도 일일 한도에 세는지.
- Blob `get(..., {useCache:false})`로 읽는 장부가 실제 스토어에서 잘 동작하는지 (사용량 패널에 "기록 일부를 읽지 못했어요"가 뜨면 이 부분).
