"use client";

import { useCallback, useRef, useState } from "react";
import { generateSpeech } from "../lib/client/generate.js";
import { JobStopped } from "../lib/client/speechJob.js";
import { useUsage } from "./UsageProvider";

// State and wiring shared by both studios for "press the button → audio
// appears in the history": progress, errors, cancelling and the budget warning.

function formatWhen(iso) {
  if (!iso) return "한도가 갱신된 뒤";
  return `${new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })} 이후`;
}

function confirmBudget(budget, usage) {
  const reset = formatWhen(usage?.resetAt);
  const message = budget.level === "exhausted"
    ? `기록상 오늘 Gemini 사용 한도(${usage.limit}회)를 모두 썼어요.\n` +
      `이 작업에는 요청 ${budget.needed}회가 필요해요 (이미 저장된 구간은 뺀 횟수). 한도는 ${reset}에 갱신돼요.\n\n` +
      "그래도 시도해볼까요? (실제로 막혀 있으면 바로 멈춰요)"
    : `이 작업은 Gemini 요청이 ${budget.needed}회 필요한데, 오늘 남은 횟수는 ${budget.remaining}회예요.\n\n` +
      `남은 횟수만큼 먼저 만들어 두고, 한도가 갱신된 뒤(${reset}) 같은 내용으로 다시 누르면 이어서 만들어요.\n` +
      "지금 시작할까요?";
  return window.confirm(message);
}

export function progressLabel(progress) {
  if (!progress) return "만드는 중...";
  if (progress.saving) return "음성 합치고 저장하는 중...";
  const detail = `${progress.done}/${progress.total} 구간${progress.cached ? `, 저장분 ${progress.cached}개 재사용` : ""}`;
  if (progress.waitSeconds) return `요청 제한 대기 중... 약 ${progress.waitSeconds}초 (${detail})`;
  return `생성 중... (${detail})`;
}

export default function useSpeechGeneration(onLibrary) {
  const { applyToday, refresh } = useUsage();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const stopRequested = useRef(false);

  const run = useCallback(async ({ turns, purpose, entry }) => {
    setError("");
    stopRequested.current = false;
    setLoading(true);
    try {
      const library = await generateSpeech({
        turns, purpose, entry, confirmBudget,
        onProgress: setProgress,
        onUsage: applyToday,
        shouldStop: () => stopRequested.current,
      });
      if (library) onLibrary(library);
    } catch (e) {
      setError(e instanceof JobStopped
        ? "생성을 중지했어요. 완성된 구간은 저장돼 있어서, 다시 누르면 이어서 만들어요."
        : e.message);
    } finally {
      setProgress(null);
      setLoading(false);
      refresh();
    }
  }, [onLibrary, applyToday, refresh]);

  const stop = useCallback(() => { stopRequested.current = true; }, []);

  return { run, stop, loading, progress, error, setError };
}
