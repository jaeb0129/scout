// 선수 상세 모달에서 쓰는 외부 스카우팅 사이트 링크 생성 헬퍼.
// 전부 새 탭(target="_blank")으로 여는 걸 전제로 만든다.

// Baseball Savant: 이름 슬러그 없이 MLBAM playerId만으로도 정상적으로 선수 페이지를 찾아준다.
// (예: https://baseballsavant.mlb.com/savant-player/660271 -> Shohei Ohtani)
export function baseballSavantUrl(playerId) {
  return `https://baseballsavant.mlb.com/savant-player/${playerId}`;
}

// FanGraphs는 MLBAM id와 다른 자체 playerid 체계를 쓴다. sync.py가 동기화 시점에
// (Smart Fantasy Baseball의 공개 ID 크로스워크로) player.fangraphsUrl을 미리 만들어서
// Firestore에 저장해두면 그 정확한 선수 페이지로 바로 연결한다.
//
// 매핑이 없는 선수(주로 갓 데뷔한 신인/유망주)의 폴백은 fangraphs.com/search가 *아니다* -
// 직접 확인해보니 그 페이지는 선수 검색이 아니라 블로그/기사 검색(Meilisearch "articles" 인덱스)이라
// 선수 이름을 넣어도 대부분 결과가 안 나온다. FanGraphs의 진짜 선수 검색 API(/api/search/players/)는
// Cloudflare 인터랙티브 챌린지 뒤에 있어서 실제 브라우저로 타이핑할 때만 통과하고, 우리가 미리
// 링크만 만들어두는 방식(스크립트/서버사이드 요청)으로는 뚫을 수 없다 (403 + JS 챌린지 확인함).
// 그래서 폴백은 구글의 site: 검색으로 보낸다 - FanGraphs 선수 페이지는 구글에 워낙 잘 색인돼 있어서
// 거의 항상 한 번 더 클릭으로 정확한 페이지에 도달한다.
export function fangraphsUrlFor(player) {
  if (player?.fangraphsUrl) return player.fangraphsUrl;
  const q = `site:fangraphs.com/players ${player?.name || ""}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Prospect Savant(마이너/유망주 스탯캐스트)도 MLBAM playerId를 그대로 사용한다.
// (예: https://prospectsavant.com/player/686611 -> Dylan Crews)
// 등록 안 된(주로 메이저 경력이 오래된) 선수는 404가 뜰 수 있음 - 사이트 자체가 유망주 위주라 정상.
export function prospectSavantUrl(playerId) {
  return `https://prospectsavant.com/player/${playerId}`;
}

export function externalLinksFor(player) {
  if (!player) return [];
  return [
    { key: "savant", label: "Baseball Savant", url: baseballSavantUrl(player.playerId) },
    { key: "fangraphs", label: "FanGraphs", url: fangraphsUrlFor(player) },
    { key: "prospectSavant", label: "Prospect Savant", url: prospectSavantUrl(player.playerId) },
  ];
}
