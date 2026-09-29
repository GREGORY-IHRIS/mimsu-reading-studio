"use client";

import { progressLabel } from "./useSpeechGeneration";

// The big "generate" button plus a stop button while a long job is running.
export default function GenerateButton({ idleLabel, loading, progress, onGenerate, onStop }) {
  return (
    <>
      <button className="generate-button" onClick={onGenerate} disabled={loading}>
        {loading ? progressLabel(progress) : idleLabel}
      </button>
      {loading && (
        <div className="stop-row">
          <button type="button" className="chip" onClick={onStop}>중지</button>
          <span className="hint">
            긴 작업은 시간이 걸려요. 끝날 때까지 이 페이지를 열어 두세요. 중간에 멈춰도 완성된 구간은 저장돼요.
          </span>
        </div>
      )}
    </>
  );
}
