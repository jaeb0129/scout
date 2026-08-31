// MLB Stats API에서 선수의 트랜잭션(이적/DFA/부상자명단 등) 이력을 브라우저에서 직접 조회하는 헬퍼.
//
// 이 데이터는 Firestore/동기화 스크립트를 안 건드리고(스키마 변경 없음) 선수 상세 모달을
// 열 때마다 그때그때 statsapi.mlb.com에서 바로 fetch 한다. 이 API는
// Access-Control-Allow-Origin: * 를 내려줘서 백엔드 없이 프론트에서 바로 호출 가능함을 확인함.
//
// 주의: MLB Stats API에는 "부상 이력" 전용 엔드포인트가 없다. 대신 로스터 상태변경
// 트랜잭션(typeCode "SC") 중 설명에 "injured list"가 들어간 것만 걸러서 부상 이력으로 보여준다.
// (scripts/sync.py의 IL 판정 로직과 같은 접근 - description에 부상 부위/사유가 함께 내려온다.)

const STATS_API = "https://statsapi.mlb.com/api/v1";

// 선수 데뷔 시점을 정확히 몰라도 커리어 전체를 커버하도록 넉넉히 잡은 조회 시작일.
const TRANSACTIONS_START_DATE = "2000-01-01";

export async function fetchPlayerTransactions(playerId) {
  const endDate = new Date().toISOString().slice(0, 10);
  const url = `${STATS_API}/transactions?playerId=${playerId}&startDate=${TRANSACTIONS_START_DATE}&endDate=${endDate}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB Stats API 요청 실패 (${res.status})`);
  }
  const data = await res.json();
  const list = data.transactions || [];
  return [...list].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export function extractInjuryHistory(transactions) {
  return (transactions || []).filter(
    (t) => t.typeCode === "SC" && /injured list/i.test(t.description || "")
  );
}
