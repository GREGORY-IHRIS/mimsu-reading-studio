export default function HistoryList({ history }) {
  if (history.length === 0) return null;

  return (
    <div className="card">
      <label className="field-label">들어본 목소리</label>
      {history.map((h, i) => (
        <div className="history-item" key={h.id}>
          <p>
            {h.createdAt} · {h.label}
            {" — "}
            {h.snippet}
          </p>
          <div className="result">
            <audio controls src={h.url} autoPlay={i === 0} />
            <div className="result-actions">
              <a className="download-link" href={h.url} download={`낭독_${h.id}.${h.ext}`}>
                다운로드
              </a>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
