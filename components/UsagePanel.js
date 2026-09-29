"use client";

import { useCallback, useEffect, useState } from "react";
import { adjustUsage } from "../lib/client/api.js";
import { openClipCache } from "../lib/client/clipCache.js";
import { useUsage } from "./UsageProvider";

const PURPOSE_LABELS = {
  script: "대본", single: "한 목소리", preview: "미리듣기", format: "AI 대사 구분",
  "voice-design": "목소리 디자인", "voices-list": "목소리 목록",
};
const OUTCOME_LABELS = {
  ok: "성공", rate_limited: "분당 제한(429)", quota_exhausted: "일일 한도(429)",
  rejected: "요청 거절", error: "서버 오류", timeout: "시간 초과", network: "연결 실패",
};

const time = (iso) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateTime = (iso) =>
  new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(1);

function TodayBar({ today }) {
  const percent = Math.min(100, Math.round((today.used / today.limit) * 100));
  const level = today.remaining === 0 ? "exhausted" : percent >= 80 ? "tight" : "ok";
  return (
    <div>
      <p className="usage-headline">
        오늘 <strong>{today.used}</strong> / {today.limit}회 사용 · 남은 횟수 <strong>{today.remaining}회</strong>
      </p>
      <div className="usage-bar" role="progressbar" aria-valuenow={today.used} aria-valuemax={today.limit}>
        <div className={`usage-bar-fill ${level}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="hint">
        횟수는 {dateTime(today.resetAt)}에 새로 시작해요 (Google 기준 태평양 시간 자정).
      </p>
      {today.exhaustedAt && (
        <p className="error" style={{ margin: "8px 0" }}>
          Gemini가 {time(today.exhaustedAt)}에 오늘 한도를 다 썼다고 알려왔어요.
        </p>
      )}
    </div>
  );
}

function Outcomes({ today }) {
  const entries = Object.entries(today.outcomes);
  if (entries.length === 0) return <p className="hint">오늘은 아직 Gemini를 부르지 않았어요.</p>;
  return (
    <p className="hint">
      오늘 호출 결과 —{" "}
      {entries.map(([outcome, count]) => `${OUTCOME_LABELS[outcome] || outcome} ${count}`).join(" · ")}
      <br />
      한도(횟수)에는 성공·서버 오류만 세고, 429 거절·요청 거절·연결 실패는 세지 않아요. AI 대사 구분과 목소리
      목록 조회는 별도로 기록만 해요.
    </p>
  );
}

function DayChart({ days, limit }) {
  const peak = Math.max(limit, ...days.map((day) => day.used));
  return (
    <div className="usage-chart" aria-label="최근 사용량">
      {days.map((day) => (
        <div className="usage-chart-col" key={day.day} title={`${day.day}: ${day.used}회`}>
          <span className="usage-chart-count">{day.used || ""}</span>
          <div className="usage-chart-track">
            <div
              className={`usage-chart-bar ${day.remaining === 0 ? "exhausted" : ""}`}
              style={{ height: `${(day.used / peak) * 100}%` }}
            />
          </div>
          <span className="usage-chart-day">{day.day.slice(5).replace("-", "/")}</span>
        </div>
      ))}
    </div>
  );
}

function CallLog({ events }) {
  if (events.length === 0) return null;
  return (
    <details className="usage-details">
      <summary>오늘 호출 기록 ({events.length}건)</summary>
      <div className="usage-table-wrap">
        <table className="usage-table">
          <thead>
            <tr><th>시각</th><th>용도</th><th>결과</th><th>글자</th><th>초</th><th>구간</th></tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className={event.outcome === "ok" || event.type === "adjust" ? "" : "usage-row-bad"}>
                <td>{time(event.ts)}</td>
                {event.type === "adjust" ? (
                  <td colSpan={5}>직접 보정: 오늘 사용 {event.used}회로 맞춤</td>
                ) : (
                  <>
                    <td>{PURPOSE_LABELS[event.purpose] || event.purpose}</td>
                    <td title={event.error}>{OUTCOME_LABELS[event.outcome] || event.outcome}</td>
                    <td>{event.chars ?? "-"}</td>
                    <td>{(event.ms / 1000).toFixed(1)}</td>
                    <td>{event.job ? `${event.job.index + 1}/${event.job.total}${event.job.attempt > 1 ? ` (재시도 ${event.job.attempt - 1})` : ""}${event.job.fallback ? " 분할" : ""}` : "-"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AdjustForm({ used, onSaved }) {
  const [value, setValue] = useState(String(used));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await adjustUsage(Number.parseInt(value, 10));
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="usage-details">
      <summary>횟수가 실제와 다를 때 직접 맞추기</summary>
      <p className="hint">
        이 앱 밖에서(AI Studio 등) 같은 키를 썼거나, 앱을 고치기 전에 쓴 횟수가 있다면 오늘 사용 횟수를 직접
        입력해 맞출 수 있어요. 맞추면 &quot;한도 소진&quot; 표시도 함께 풀려요.
      </p>
      <div className="usage-adjust">
        <input type="number" min="0" className="style-input" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="chip" disabled={busy || value === ""} onClick={save}>
          {busy ? "저장 중..." : "오늘 사용 횟수로 저장"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </details>
  );
}

function BrowserStorage() {
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    try { setStats(await openClipCache()?.stats() ?? null); } catch { setStats(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function clear() {
    if (!window.confirm("이 브라우저에 저장된 만들어 둔 구간을 모두 지울까요?\n지우면 같은 대본을 다시 만들 때 Gemini 요청을 다시 써요.")) return;
    try { await openClipCache()?.clear(); } finally { load(); }
  }

  if (!stats) return <p className="hint">이 브라우저에서는 임시 저장을 쓸 수 없어요.</p>;
  return (
    <p className="hint">
      이 브라우저에 만들어 둔 구간: {stats.clips}개 ({megabytes(stats.bytes)}MB) — 같은 내용을 다시 만들 때 요청을
      아끼는 데 쓰여요.{" "}
      {stats.clips > 0 && <button type="button" className="link-btn" onClick={clear}>비우기</button>}
    </p>
  );
}

export default function UsagePanel() {
  const { overview, today, error, refresh } = useUsage();
  const [open, setOpen] = useState(false);

  function toggle(next) {
    setOpen(next);
    if (next) refresh(14);
  }

  const warn = today && (today.remaining === 0 || today.remaining <= today.limit * 0.1);

  return (
    <>
      <button type="button" className="signout-btn" onClick={() => toggle(true)}>
        {warn ? "⚠ 사용량" : "사용량"}
      </button>

      {open && (
        <div className="help-overlay" onClick={() => toggle(false)}>
          <div className="help-panel" onClick={(e) => e.stopPropagation()}>
            <div className="help-header">
              <h2>Gemini 사용량</h2>
              <button type="button" className="help-close" onClick={() => toggle(false)}>✕</button>
            </div>

            <div className="help-body">
              {!overview && <p className="hint">{error || "불러오는 중..."}</p>}
              {overview && (
                <>
                  <section>
                    <TodayBar today={today} />
                    <Outcomes today={today} />
                  </section>

                  <section>
                    <h3>최근 {overview.days.length}일</h3>
                    <DayChart days={overview.days} limit={overview.limit} />
                  </section>

                  <section>
                    <CallLog events={today.events} />
                    <AdjustForm key={today.used} used={today.used} onSaved={() => refresh(14)} />
                  </section>

                  <section>
                    <h3>기록 내려받기</h3>
                    <p className="hint">
                      모든 Gemini 요청(시각·용도·결과·글자 수·걸린 시간)이 남아 있어요. 대본 내용은 저장하지 않아요.
                      문제가 생기면 이 파일을 개발자(Claude)에게 보여주면 원인을 추적할 수 있어요.
                    </p>
                    <p>
                      <a className="chip" href="/api/usage?export=json" download>JSON</a>{" "}
                      <a className="chip" href="/api/usage?export=csv" download>CSV (엑셀)</a>
                    </p>
                    <p className="hint">
                      기록 저장 위치: {overview.storage === "blob" ? "Vercel Blob" : "이 컴퓨터의 .data/usage 폴더"}
                    </p>
                    {overview.errors.length > 0 && (
                      <p className="error">기록 일부를 읽지 못했어요: {overview.errors[0]}</p>
                    )}
                  </section>

                  <section>
                    <h3>이 브라우저의 임시 저장</h3>
                    <BrowserStorage />
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
