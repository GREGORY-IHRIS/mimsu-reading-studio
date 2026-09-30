import { RATE_LIMIT_CALLS, RATE_WINDOW_MS } from "../shared/config.js";
import { assessBudget } from "../shared/quota.js";
import { createRateLimiter } from "../shared/rateLimiter.js";
import { planCalls, splitLongTurns } from "../shared/scriptPlan.js";
import { fetchUsage, requestSpeech, saveFinishedAudio } from "./api.js";
import { joinWavClips } from "./audioBlob.js";
import { openClipCache } from "./clipCache.js";
import { produceScript } from "./produceScript.js";
import { countUncached, JobStopped, runSpeechJob } from "./speechJob.js";

// The whole "make audio from turns" pipeline shared by the single-voice and
// script studios:  plan → check budget → run calls → stitch → save.

// One limiter for the page's lifetime: several jobs share Gemini's per-minute cap.
const limiter = createRateLimiter({ limit: RATE_LIMIT_CALLS, windowMs: RATE_WINDOW_MS });

// What a job would cost right now, taking browser-cached calls into account.
export async function estimateJob(turns, options) {
  const plan = planCalls(turns, options);
  const uncached = await countUncached(plan.calls, openClipCache());
  return { ...plan, uncached };
}

// The history list shows a short label and the first words of the text.
const snippet = (text) => text.trim().slice(0, 60);

export function scriptEntryInfo(turns) {
  const speakers = new Set(turns.map((turn) => turn.speaker)).size;
  return { label: `대본 · 등장인물 ${speakers}명`, snippet: snippet(turns.map((turn) => turn.text).join(" ")) };
}

export function singleEntryInfo({ text, voice, style }) {
  return { label: `${voice}${style ? ` · ${style}` : ""}`, snippet: snippet(text) };
}

function resetTimeLabel(resetAt) {
  if (!resetAt) return "한도가 갱신된 뒤";
  return `${new Date(resetAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })} 이후`;
}

// The sentence shown to the user when a job stops early.
export function describeFailure(error, { hasCache, resetAt } = {}) {
  if (error.code === "QUOTA_DAILY") {
    const saved = error.stats?.done ?? 0;
    const resume = !hasCache
      ? "이 브라우저에서는 임시 저장을 쓸 수 없어 다음에는 처음부터 만들어야 해요."
      : saved > 0
        ? `완성된 ${saved}개 구간은 이 브라우저에 저장했어요. 같은 대본으로 다시 누르면 이어서 만들어요.`
        : "같은 대본으로 다시 누르면 처음부터 시작해요.";
    return `Gemini의 오늘 생성 한도에 도달했어요. ${resetTimeLabel(resetAt)} 다시 시도해주세요. ${resume}`;
  }
  if (error.lines) {
    return `${error.lines[0] + 1}~${error.lines[1] + 1}번째 줄 구간 생성 실패: ${error.message}`;
  }
  return error.message;
}

// Returns the updated history, or null when the user declined the budget
// warning. Throws Error (with a user-readable message) on failure and
// JobStopped when cancelled.
export async function generateSpeech({ turns, purpose, entry, confirmBudget, onProgress, onUsage, shouldStop }) {
  const cache = openClipCache();
  const plan = await estimateJob(turns);

  const usage = await fetchUsage({ days: 1 }).then((data) => data.today).catch(() => null);
  if (usage) onUsage?.(usage);
  const budget = assessBudget({ needed: plan.uncached, usage });
  if (budget.needsConfirm && !(await confirmBudget(budget, usage))) return null;

  let resetAt = usage?.resetAt;
  let round = { round: 1, pending: plan.pieceCount };
  const runRound = (roundPlan, fresh, onClip) => runSpeechJob({
    calls: roundPlan.calls, purpose, cache, limiter, shouldStop, requestSpeech, joinClips: joinWavClips, fresh, onClip,
    onProgress: (progress) => onProgress({ ...progress, ...round }),
    onUsage: (next) => {
      if (!next) return;
      resetAt = next.resetAt ?? resetAt;
      onUsage?.(next);
    },
  });

  try {
    const { audio } = await produceScript({
      pieces: splitLongTurns(turns),
      runRound,
      onRound: (next) => { round = { round: next.round, pending: next.pending }; },
    });
    onProgress({ total: plan.calls.length, done: plan.calls.length, saving: true });
    return await saveFinishedAudio(audio, entry);
  } catch (error) {
    if (error instanceof JobStopped) throw error;
    throw new Error(describeFailure(error, { hasCache: Boolean(cache), resetAt }));
  }
}
