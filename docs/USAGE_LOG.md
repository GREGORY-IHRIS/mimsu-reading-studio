# Gemini 사용량 기록 (usage log)

앱이 Gemini에 보내는 **모든 요청**은 한 줄씩 기록됩니다. 하루 100회 한도가 어디서 어떻게
소진되는지 추적하고, 나중에 Claude에게 "로그 보고 원인 찾아줘"라고 부탁할 수 있게 하려는
장부예요.

## 어디에 저장되나

| 환경 | 위치 |
|---|---|
| 로컬 개발 (`npm run dev`) | `.data/usage/YYYY-MM-DD.json` |
| 배포 (Vercel) | Vercel Blob의 `usage/<비밀 접두어>/YYYY-MM-DD.json` |
| 배포 (보조) | Vercel → 프로젝트 → Logs 에서 `[gemini-call]` 로 검색 (한 줄당 요청 1건, 보관 기간 짧음) |

- 날짜는 **태평양 시간(PT)** 기준이에요. Google의 일일 한도가 그 자정(한국 16시/17시)에 초기화되기 때문입니다.
- 가족 모두 **같은 API 키를 공유**하므로 장부도 계정별이 아니라 하나예요. 누가 썼는지는 `user`(이메일 해시 앞 8자)로 구분해요.
- **대본 내용은 저장하지 않아요.** 글자 수·줄 수·화자 수·소요 시간·결과만 남깁니다.

## 로그를 가져오는 법 (Claude에게 넘기기)

1. 앱 상단 **사용량** 버튼 → 아래쪽 **기록 내려받기 → JSON**
2. 받은 파일을 이 저장소의 `logs/` 폴더(없으면 만드세요, git에는 올라가지 않아요) 같은 곳에 두고 Claude에게 경로를 알려주세요.
3. 분석은 아래 명령으로 바로 됩니다.

```bash
npm run usage:report -- logs/gemini-usage-2026-09-29.json    # 내려받은 파일
npm run usage:report                                           # 로컬 .data/usage 폴더
npm run usage:report -- logs/파일.json --day 2026-09-29        # 하루만
```

리포트는 하루 요약, 용도별 횟수, 그리고 **버튼 한 번(job)마다** 계획한 호출 수·실제 보낸 수·한도에
잡힌 수·429·400·재시도·분할 횟수를 한 줄로 보여줘요. "같은 구간에 두 번 돈을 냈다"는 경고도 나옵니다.

## 한 줄(이벤트)의 모양

```json
{"id":"a7b06b50","ts":"2026-09-29T09:18:52.078Z","type":"call","bucket":"tts","purpose":"script",
 "model":"gemini-3.8-flash-tts","outcome":"ok","http":200,"ms":18042,"chars":54,"lines":3,"speakers":2,
 "job":{"id":"ahlmyezi","index":0,"total":4,"attempt":1},"audioKB":127,"user":"b4508112"}
```

| 필드 | 뜻 |
|---|---|
| `ts` | 요청을 보낸 시각 (UTC ISO) |
| `bucket` | `tts` = 일일 한도에 세는 음성 생성 · `text` = AI 대사 구분(다른 모델) · `meta` = 목소리 목록 조회 |
| `purpose` | `script` 대본 · `single` 한 목소리 · `preview` 미리듣기 · `voice-design` 목소리 디자인 · `format` AI 대사 구분 · `voices-list` |
| `outcome` | `ok` 성공 · `rate_limited` 분당 제한(429) · `quota_exhausted` **일일 한도 소진(429)** · `rejected` 요청 거절(400/401/403) · `error` 서버 오류(5xx)/빈 응답 · `timeout` · `network` |
| `http` | HTTP 상태 (연결 실패면 0) |
| `ms` | 응답까지 걸린 시간 |
| `chars` / `lines` / `speakers` | 이 요청에 실린 글자 수 / 줄 수 / 화자 수 |
| `job` | `id` 버튼 한 번을 묶는 값 · `index`/`total` 몇 번째 구간/전체 · `attempt` 몇 번째 시도(2 이상 = 재시도) · `fallback` 묶음 거절 뒤 단일 목소리로 나눠 다시 보낸 호출 |
| `audioKB` | 받은 오디오 크기 |
| `error` | 실패했을 때 Gemini의 메시지 (300자까지) |
| `type: "adjust"` | 사용자가 **사용량 패널에서 오늘 횟수를 직접 맞춘** 기록 (`used` = 맞춘 값) |

## "한도에 몇 회로 세는가" — 가정

Gemini에는 남은 한도를 물어보는 API가 없어서, 앱은 자기 장부로 **추정**해요.

- 세는 것: `tts` 버킷의 `ok`, `error`, `timeout`
- 안 세는 것: 429(분당/일일), `rejected`(400 등), `network`, 그리고 `text`/`meta` 버킷
- Google이 429/400도 세는지는 확인하지 못했어요. 로그의 `quota_exhausted`가 찍힌 시점의 "한도에 세는 횟수"가
  100보다 한참 작다면 **가정이 틀린 것**이니, 그 숫자를 근거로 `lib/shared/quota.js`의 `COUNTED_OUTCOMES`를 고치면 돼요.
- `quota_exhausted`(Google의 "오늘 한도 끝" 응답)는 장부 숫자와 상관없이 그날을 소진으로 표시해요.
- 음성 디자인(`voice-design`)은 샘플 음성을 만들기 때문에 `tts`로 셉니다 (확인 못한 가정).
- 이 앱 밖(AI Studio 등)에서 같은 키를 쓰면 장부에 안 잡혀요 → 사용량 패널의 "직접 맞추기" 사용.

## 로그로 이런 걸 볼 수 있어요

- **한 번 누르면 몇 회?** 리포트의 `planned` vs `sent` vs `counted`
- **낭비가 있었나?** `429`(분당 제한에 걸림) · `400`(묶음 요청 거절) · `retries` · `split`(단일 목소리로 쪼갠 횟수) · "paid for twice"
- **글자당 효율** — 리포트 첫머리의 "chars per counted call". 낮으면 화자가 많아 잘게 쪼개진 것 (한 호출에 화자 2명까지)
- **호출 하나가 얼마나 걸리나** — `ms` (긴 글자 수로 늘릴 때 타임아웃 여유를 판단하는 근거)
- **언제 한도가 끝났나** — `quota_exhausted` 이벤트의 `ts`
