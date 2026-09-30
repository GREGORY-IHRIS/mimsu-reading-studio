"use client";

import { useEffect, useState } from "react";
import { estimateJob } from "../lib/client/generate.js";
import { assessBudget } from "../lib/shared/quota.js";
import { useUsage } from "./UsageProvider";

// "This text needs N Gemini requests, M are left today" — shown under the
// generate button so a long text can't silently eat the whole day's quota.
// `turns` must be memoized by the caller (it is the effect's dependency).
// `busy` is true while a job runs; the estimate is redone when it ends, because
// the job has just filled the browser cache.
export default function QuotaEstimate({ turns, busy = false }) {
  const { today } = useUsage();
  const [estimate, setEstimate] = useState(null);

  useEffect(() => {
    if (!turns?.length) {
      setEstimate(null);
      return undefined;
    }
    if (busy) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { calls, uncached, mode } = await estimateJob(turns);
        if (!cancelled) setEstimate({ total: calls.length, uncached, mode });
      } catch {
        if (!cancelled) setEstimate(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [turns, busy]);

  if (!estimate) return null;
  const { level } = assessBudget({ needed: estimate.uncached, usage: today });
  const saved = estimate.total - estimate.uncached;

  return (
    <p className={`hint quota-estimate ${level}`}>
      이 글은 Gemini 요청 약 {estimate.total}회가 필요해요
      {saved > 0 && ` (이미 만들어 둔 ${saved}회분은 다시 쓰지 않아서 실제로는 ${estimate.uncached}회)`}.
      {estimate.mode === "voices" && " 같은 목소리의 대사를 묶어 한 번에 만들어 아끼는 방식이에요."}
      {today && ` 오늘 남은 횟수: ${today.remaining}/${today.limit}회.`}
      {level === "over" && " ⚠ 남은 횟수보다 많아요 — 시작하면 확인 창이 떠요."}
      {level === "exhausted" && " ⚠ 오늘 한도를 다 썼어요."}
      {level === "tight" && " 이 작업 후엔 얼마 안 남아요."}
    </p>
  );
}
