# 엄마의 낭독 스튜디오 (geminiTTS) — 개발 메모

Next.js 15 + next-auth(구글 로그인, 화이트리스트) + Gemini TTS. Vercel 배포, 저장소는 Vercel Blob(로컬은 `.data/`).
사용자 문서는 `README.md`, 사용량 기록 문서는 `docs/USAGE_LOG.md`.

## 가장 중요한 제약: Gemini 하루 요청 100회

호출 하나 = 한도 1회. 그래서 구조 전체가 "호출을 덜 쓰는 것"과 "쓴 걸 기록하는 것"을 중심으로 짜여 있다.

- **계획** `lib/shared/scriptPlan.js` — 대본 → 최소 개수의 호출. 두 방식 중 더 적게 드는 쪽을 자동 선택:
  (1) `sequence`: 순서대로, 호출 하나에 화자 2명·4000자·120줄까지(`lib/shared/config.js`).
  (2) `voices`: 같은 목소리의 모든 대사를 한 호출에 몰아 `<long pause>`로 구분해 만든 뒤, 브라우저가 무음 구간으로 잘라
  (`lib/shared/wavSplit.js`, 글자 수 비례 검증 포함) 원래 순서로 재조립. 호출 수 = 목소리 수. 자르기 실패(SPLIT_FAILED)는
  캐시하지 않고 같은 계획을 1번 재시도, 또 실패하면 `sequence`로 (`lib/client/generate.js`).
- **실행** `lib/client/speechJob.js` — 브라우저가 호출을 하나씩 보냄. 끝난 호출은 즉시 IndexedDB(`clipCache.js`)에
  요청 해시로 저장 → 실패/한도 초과/글 수정 후에도 바뀐 구간만 다시 생성. 재시도 정책도 여기(서버는 재시도 안 함).
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

## 사용량 문제를 조사해 달라는 요청을 받으면

1. 사용자에게 앱의 **사용량 → 기록 내려받기 → JSON** 파일을 받는다 (배포 데이터는 Blob에 있어 로컬에서 못 읽음).
2. `npm run usage:report -- <파일>` 로 job별 `planned/sent/counted/429/400/retries/split`을 본다.
3. "한도에 세는 규칙"은 가정이다(`docs/USAGE_LOG.md`). 실제 데이터와 안 맞으면 `lib/shared/quota.js#COUNTED_OUTCOMES`를 고친다.

## 아직 검증 못 한 것 (실제 API로만 확인 가능)

- 한 호출에 화자 3명 이상 (기존 조사: 400). 되면 `MAX_SPEAKERS_PER_CALL` 한 줄로 호출 수가 크게 준다.
- 한 호출 4000자(약 9분)를 넘겨도 되는지, 그리고 긴 오디오 뒤쪽의 음질 (`MAX_CHARS_PER_CALL`). 2026-09-30 실측: 4000자까지 잘림 없음, 화자 3명은 400.
- Google이 429/400 응답도 일일 한도에 세는지.
- Blob `get(..., {useCache:false})`로 읽는 장부가 실제 스토어에서 잘 동작하는지 (사용량 패널에 "기록 일부를 읽지 못했어요"가 뜨면 이 부분).
