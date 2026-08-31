# Firestore 데이터 구조

## 컬렉션: `players`
문서 ID = MLB Stats API의 player id (예: `571945`)

```
players/{playerId}
{
  name: string,
  playerId: number,
  position: string,
  positionAbbrev: string,
  headshotUrl: string,
  category: "pitcher" | "batter",

  birthDate: string | null,       // 'YYYY-MM-DD'
  currentAge: number | null,      // 동기화 시점 기준 만나이 (MLB Stats API 제공값)
  batSide: "R" | "L" | "S" | null,     // 타석
  pitchHand: "R" | "L" | null,         // 투구팔

  level: "MLB" | "AAA",           // 현재 로스터 소속 레벨
  teamId: number,                 // 현재 소속팀 (AAA면 AAA 팀 자체)
  teamName: string,

  orgId: number,                  // 팀 필터용 - 항상 MLB 모기업 기준
  orgName: string,                // (MLB 선수는 자기 팀, AAA 선수는 모기업 이름)

  on40Man: boolean,
  rosterStatusCode: string,
  rosterStatusLabel: string,
  isIL: boolean,

  latestTransaction: { date, typeCode, label, description } | null,
  derivedStatus: "On-40" | "IL" | "DFA" | "Released" | "FA" | "Off-40",

  season: number,
  updatedAt: timestamp,

  // FanGraphs 선수 페이지 직접 연결용. sync.py가 동기화 시점에 FanGraphs RosterResource의
  // "팀 뎁스차트" 페이지(구단당 1페이지, mlbamid로 바로 매칭됨)에서 읽어와 채워둠 -
  // 별도 ID 크로스워크 불필요. 아직 이 데이터가 없는 선수(비활성 플래그 상태 등)는 null.
  fangraphsUrl: string | null,

  // FanGraphs RosterResource 연동 데이터 (Service Time / MiLB 옵션).
  // sync.py가 동기화 시점에 FanGraphs 팀 뎁스차트 페이지에서 읽어와 저장 - 프론트에서 실시간 재조회 안 함.
  // FA/연봉조정 예정 연도는 이 데이터 소스엔 없음 (선수 개별 페이지에만 있어서 현재는 미포함).
  rosterResource: {
    serviceTime: string | null,   // "9.051" 형식 (연차.일수)
    milbOptions: string | null,   // 남은 마이너 옵션 수, 또는 "n/a"(옵션 소진/해당없음)
  } | null,

  // 레벨별 스탯을 각각 따로 저장 (한 시즌에 콜업/옵션으로 두 레벨 다 뛴 선수 대응)
  mlb: {...} | null,
  aaa: {...} | null,
}
```

`category === "pitcher"`일 때 `mlb`/`aaa` 내부 구조:
```
{
  games: number,
  gamesStarted: number,
  inningsPitched: string,   // "116.1" 형식
  era: string,
  kPer9: string,
  bbPer9: string,
  whip: string,
}
```
추가로 `combinedGames: number` (MLB+AAA 등판 수 합산, 선발 자격 필터에 사용)

`category === "batter"`일 때 `mlb`/`aaa` 내부 구조:
```
{
  plateAppearances: number,
  atBats: number,
  hits: number,
  homeRuns: number,
  avg: string,
  obp: string,
  slg: string,
  ops: string,
}
```
추가로 `combinedPA: number` (MLB+AAA 타석 합산, 최소 타석 필터에 사용)

## 컬렉션: `meta`
```
meta/lastSync
{
  finishedAt: timestamp,   // 프론트엔드 상단 "업데이트 기준" 표시에 사용
  playersProcessed: number,
  errors: array<string>,
  season: number,
}
```

## 팀 필터 동작 원리
`orgId`를 MLB 모기업 기준으로 통일해뒀기 때문에, 프론트엔드에서 팀 드롭다운으로
특정 MLB 구단을 선택하면 그 구단 소속 MLB 선수 + 산하 AAA 선수가 동시에 필터링됩니다.

## 참고
- KBO/독립리그 경험 여부, 국적, 서비스타임/마이너리그 옵션 기반 상태(Near FA 등)는 MLB Stats API에 없어 미구현입니다.
- 생년월일/만나이/타석/투구팔은 `/people/{playerId}` 엔드포인트에서 바로 제공되어 `birthDate`/`currentAge`/`batSide`/`pitchHand`로 저장합니다.
- `mlb`/`aaa` 스탯 + 개인정보를 각각 조회하느라 예전보다 동기화 스크립트 실행 시간이 늘었습니다 (선수당 API 호출 증가).

## 컬렉션: `players` (지표 확장, scripts/sync_metrics.py가 채움)
기존 필드는 그대로 두고 아래 필드가 추가됩니다. 지표 동기화를 아직 한 번도 안 돌렸으면 이 필드
자체가 없습니다.
```
metrics: {
  mlb: { [지표 key: string]: number | null } | null,   // pbp 테이블(MLB) 기준 계산
  aaa: { [지표 key: string]: number | null } | null,   // aaa 테이블(AAA) 기준 계산
} | null
```
지표 key/라벨/표시 형식(소수점 자리, %, 높을수록 좋은지)은 하드코딩하지 않고 아래
`meta/metricsConfig`에서 관리합니다 - 지표를 추가·수정해도 프론트를 다시 배포할 필요가 없습니다.

## 컬렉션: `meta` (지표 확장)
```
meta/metricsConfig
{
  pitcher: [ { key: string, label: string, format: "avg1"|"avg2"|"avg3"|"pct1", higherIsBetter: boolean }, ... ],
  batter:  [ { key: string, label: string, format: string, higherIsBetter: boolean }, ... ],
  updatedAt: timestamp,
}

meta/metricsLastSync
{
  finishedAt: timestamp,
  playersProcessed: number,
  runBy: "manual" | "scheduler",
}
```

로스터(`meta/lastSync`, GitHub Actions)와 지표(`meta/metricsLastSync`, 로컬 스크립트)는 서로 다른
파이프라인이라 갱신 시점이 다를 수 있습니다. 화면에는 "업데이트 기준"과 별도로 "지표 업데이트 기준"을
같이 보여주는 걸 권장합니다.

## 컬렉션: `reports`
문서 ID = `players`와 동일한 playerId (예: `571945`)

외부 링크만 저장하는 컬렉션 - 보고서 원본은 지금처럼 Google Drive/Notion 등에 쓰고 저장하고,
앱에는 그 링크만 저장한다. `sync.py`/`sync_metrics.py`가 자동으로 채우는 다른 컬렉션과 달리,
로그인한 팀원이 선수 상세 모달에서 직접 입력해서 저장하는 유일한 컬렉션이다 (자동 배치 없음).

```
reports/{playerId}
{
  url: string,
  title: string | null,
  updatedAt: timestamp,
  updatedBy: string,   // 누가 마지막으로 저장했는지 (auth 이메일/표시 이름)
}
```

firestore.rules: 로그인한 사용자만 읽기 가능, 쓰기도 로그인한 사용자면 가능하되(클라이언트에서
바로 setDoc) 필드는 위 4개로만 제한(`hasOnly`)하고 `url`은 문자열이어야 한다.

화면 동작(`PlayerModal.jsx`): 링크가 있으면 Baseball Savant/FanGraphs 버튼과 같은 패턴으로
"스카우팅 리포트 보기 ↗" 새 탭 버튼. 없거나 바꾸고 싶으면 입력창에 링크(+선택적으로 제목)를
붙여넣고 저장 버튼 클릭 시 브라우저에서 바로 `setDoc(..., { merge: true })`로 반영된다.
