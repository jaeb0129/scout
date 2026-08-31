// 선수 목록을 브라우저(localStorage)에 캐시해서, meta/lastSync(로스터)와
// meta/metricsLastSync(지표)가 둘 다 안 바뀌었으면 Firestore 컬렉션 전체를 다시 읽지 않도록 한다.
// - App.jsx가 두 시각을 합쳐 만든 cacheKey 문자열을 넘겨준다 - 로스터만 갱신되거나 지표만
//   갱신되거나 둘 다 갱신되거나, 어느 쪽이든 하나만 바뀌어도 캐시가 무효화된다.
// - 새로고침/재접속을 아무리 해도, 실제로 새 동기화가 있었을 때만 진짜 재조회가 일어난다.
// - 캐시는 브라우저별(localStorage)이라 팀원끼리 공유되진 않지만, 한 사람 기준으로는
//   하루에 한 번(동기화 시점 이후 첫 접속)만 전체를 읽게 되어 Firestore 읽기 횟수가 크게 줄어든다.
const CACHE_KEY = "scout_roster_cache_v1";

function readStore() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    // localStorage를 못 쓰는 환경(프라이빗 모드 등)이어도 앱은 정상 동작해야 하니 조용히 무시
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    // 저장 용량 초과 등으로 캐시 저장에 실패해도 앱 동작에는 지장 없음 (다음에 다시 시도됨)
  }
}

// 캐시된 항목을 반환. cacheKey(로스터+지표 동기화 시각을 합친 문자열)가 넘어온 값과 같을 때만
// "신선한" 캐시로 취급. 서버 값을 못 가져왔거나(cacheKey == null) 캐시가 없거나 값이 다르면
// null을 반환해서 호출하는 쪽이 Firestore에서 다시 읽도록 한다.
export function getCachedCategory(category, cacheKey) {
  const store = readStore();
  const entry = store[category];
  if (!entry || cacheKey == null || entry.syncedAt !== cacheKey) {
    return null;
  }
  return entry.players;
}

export function setCachedCategory(category, players, cacheKey) {
  const store = readStore();
  store[category] = { syncedAt: cacheKey, players };
  writeStore(store);
}

// cacheKey가 최신인지 따지지 않고, 이 브라우저에 마지막으로 저장된 목록을 그냥 반환한다
// (없으면 null). Firestore 조회 자체가 실패했을 때(할당량 초과 등) "그래도 마지막으로 봤던
// 데이터는 계속 보여주자"는 용도 - App.jsx가 이 값을 쓸 땐 화면에 "실시간 확인 실패, 마지막
// 저장 데이터 표시 중" 안내를 같이 띄워서 최신이 아닐 수 있음을 알린다.
export function getStaleCategory(category) {
  const store = readStore();
  return store[category]?.players ?? null;
}
