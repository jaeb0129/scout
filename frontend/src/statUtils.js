// 이닝 표기("116.1" = 116과 1/3이닝)를 소수점 근사값으로 변환 (필터/정렬용)
export function parseIP(ipStr) {
  if (!ipStr) return 0;
  const [whole, frac] = String(ipStr).split(".");
  const w = parseInt(whole, 10) || 0;
  const f = frac === "1" ? 1 / 3 : frac === "2" ? 2 / 3 : 0;
  return w + f;
}

export function combinedGames(p) {
  return p.combinedGames ?? ((p.mlb?.games || 0) + (p.aaa?.games || 0));
}

// 선발 등판 횟수 합산 (총 등판 횟수 combinedGames와 다름 - 계투 등판은 여기 안 들어감)
export function combinedGamesStarted(p) {
  return (p.mlb?.gamesStarted || 0) + (p.aaa?.gamesStarted || 0);
}

export function combinedInnings(p) {
  return parseIP(p.mlb?.inningsPitched) + parseIP(p.aaa?.inningsPitched);
}

export function combinedPA(p) {
  return p.combinedPA ?? ((p.mlb?.plateAppearances || 0) + (p.aaa?.plateAppearances || 0));
}

// 정렬/기본 표시용 "대표 스탯": MLB 기록이 있으면 MLB, 없으면 AAA
export function primaryEra(p) {
  const v = p.mlb?.era ?? p.aaa?.era;
  return v ? parseFloat(v) : Infinity;
}
export function primaryOps(p) {
  const v = p.mlb?.ops ?? p.aaa?.ops;
  return v ? parseFloat(v) : 0;
}

// 상태별 구분 색상 (배경 음영용 클래스명)
export const STATUS_CLASS = {
  Active: "status-active",
  IL: "status-il",
  DFA: "status-dfa",
  Released: "status-released",
  FA: "status-fa",
  "Off-40": "status-off40",
  "On-40": "status-on40",
};

export function statusClass(status) {
  return STATUS_CLASS[status] || "status-active";
}

// 만나이 + 타석/투구팔 표시용 ("26세 · R/R" 형식, 데이터 없으면 "—")
export function formatBio(p) {
  const age = p.currentAge != null ? `${p.currentAge}세` : "—";
  const bat = p.batSide || "-";
  const throwHand = p.pitchHand || "-";
  return `${age} · ${bat}/${throwHand}`;
}

// 선수 목록에서 팀 필터용 소속(MLB 구단 기준, AAA는 모기업으로 통합) 옵션 계산
export function buildOrgOptions(players) {
  const map = new Map();
  for (const p of players) {
    if (p.orgId == null) continue;
    if (!map.has(p.orgId)) map.set(p.orgId, p.orgName || "미상");
  }
  return [...map.entries()]
    .map(([orgId, orgName]) => ({ orgId, orgName }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName));
}

// 지표(metrics) 값 포맷팅 - meta/metricsConfig의 format 필드 기준
// ("avg1"/"avg2"/"avg3" = 소수점 n자리, "pct1" = 퍼센트 소수 1자리)
export function formatMetricValue(value, format) {
  if (value === null || value === undefined) return "\u2014";
  const n = Number(value);
  if (Number.isNaN(n)) return "\u2014";
  if (format === "pct1") return `${n.toFixed(1)}%`;
  const m = /^avg(\d)$/.exec(format || "");
  if (m) return n.toFixed(Number(m[1]));
  return String(n);
}
