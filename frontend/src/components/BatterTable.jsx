import React from "react";
import { statusClass, formatBio, formatMetricValue } from "../statUtils.js";

const COLS = [
  { key: "plateAppearances", label: "PA" },
  { key: "atBats", label: "AB" },
  { key: "hits", label: "H" },
  { key: "homeRuns", label: "HR" },
  { key: "avg", label: "AVG" },
  { key: "obp", label: "OBP" },
  { key: "slg", label: "SLG" },
  { key: "ops", label: "OPS" },
];

export default function BatterTable({ players, onSelectPlayer, metricsConfig }) {
  if (players.length === 0) {
    return <div className="empty">조건에 맞는 선수가 없습니다. 필터를 조정해보세요.</div>;
  }

  // meta/metricsConfig에서 내려온 지표 컬럼을 로스터 스탯 컬럼 뒤에 이어붙인다.
  // (scripts/sync_metrics.py를 아직 안 돌렸으면 metricsConfig가 비어있어 컬럼이 그대로 유지된다)
  const metricCols = (metricsConfig || []).map((m) => ({ key: m.key, label: m.label, format: m.format, isMetric: true }));
  const allCols = [...COLS, ...metricCols];

  return (
    <div className="table-wrap">
      <div className="table-head batter-grid" style={{ "--stat-cols": allCols.length }}>
        <div>BATTER</div>
        <div>BIO</div>
        {allCols.map((c) => (
          <div key={c.key}>{c.label}</div>
        ))}
        <div>STATUS</div>
      </div>
      {players.map((p) => (
        <Row key={p.playerId} p={p} onSelectPlayer={onSelectPlayer} allCols={allCols} />
      ))}
    </div>
  );
}

function Row({ p, onSelectPlayer, allCols }) {
  const txnDate = p.latestTransaction?.date;
  const hasBoth = p.mlb && p.aaa;

  return (
    <div className={`row batter-grid ${statusClass(p.derivedStatus)}`} style={{ "--stat-cols": allCols.length }}>
      <div
        className="playercell playercell-clickable"
        role="button"
        tabIndex={0}
        onClick={() => onSelectPlayer?.(p)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelectPlayer?.(p);
        }}
      >
        <img
          className="headshot"
          src={p.headshotUrl}
          alt=""
          loading="lazy"
          onError={(e) => (e.target.style.visibility = "hidden")}
        />
        <div>
          <div className="playername">{p.name}</div>
          <div className="playersub">{p.teamName} · {p.level}</div>
        </div>
      </div>

      <div className="statcell biocell">
        <div>{formatBio(p)}</div>
        {p.birthDate && <div className="bio-sub">{p.birthDate}</div>}
      </div>

      {allCols.map((c) => {
        const mlbVal = c.isMetric ? p.metrics?.mlb?.[c.key] : p.mlb?.[c.key];
        const aaaVal = c.isMetric ? p.metrics?.aaa?.[c.key] : p.aaa?.[c.key];
        const mlbDisplay = c.isMetric ? formatMetricValue(mlbVal, c.format) : (mlbVal ?? "—");
        const aaaDisplay = c.isMetric ? formatMetricValue(aaaVal, c.format) : (aaaVal ?? "—");
        return (
          <div key={c.key} className="statcell">
            {p.mlb && <div className={hasBoth ? "stat-line" : undefined}>{hasBoth && <span className="lvl-tag">M</span>}{mlbDisplay}</div>}
            {p.aaa && <div className={hasBoth ? "stat-line" : undefined}>{hasBoth && <span className="lvl-tag">A</span>}{aaaDisplay}</div>}
            {!p.mlb && !p.aaa && "—"}
          </div>
        );
      })}

      <div>
        <span className="status-pill">
          <span className="dot" />
          {p.derivedStatus}
        </span>
        {(p.derivedStatus === "Released" || p.derivedStatus === "DFA") && txnDate && (
          <div className="status-date">{txnDate.slice(0, 7)}</div>
        )}
      </div>
    </div>
  );
}
