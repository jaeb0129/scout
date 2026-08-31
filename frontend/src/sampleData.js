// Firebase 설정 전, 로컬에서 화면 모양만 빠르게 확인하기 위한 샘플 데이터.
// 실제 배포 후에는 이 파일이 쓰이지 않고 Firestore의 진짜 데이터가 표시됩니다.

export const SAMPLE_PITCHERS = [
  {
    playerId: 1, name: "샘플 투수 A", teamName: "St. Louis Cardinals", level: "MLB",
    orgId: 100, orgName: "St. Louis Cardinals",
    headshotUrl: "",
    birthDate: "1996-03-14", currentAge: 30, batSide: "R", pitchHand: "R",
    mlb: { games: 25, gamesStarted: 11, inningsPitched: "116.0", era: "5.82", kPer9: "4.50", bbPer9: "1.78", whip: "1.38" },
    aaa: null,
    combinedGames: 25,
    derivedStatus: "Released", latestTransaction: { date: "2026-08-10" },
  },
  {
    playerId: 2, name: "샘플 투수 B (콜업/옵션 반복)", teamName: "El Paso Chihuahuas", level: "AAA",
    orgId: 101, orgName: "San Diego Padres",
    headshotUrl: "",
    birthDate: "1999-07-02", currentAge: 27, batSide: "L", pitchHand: "L",
    mlb: { games: 8, gamesStarted: 0, inningsPitched: "9.1", era: "6.75", kPer9: "7.20", bbPer9: "4.10", whip: "1.60" },
    aaa: { games: 10, gamesStarted: 17, inningsPitched: "88.1", era: "4.10", kPer9: "8.20", bbPer9: "2.90", whip: "1.22" },
    combinedGames: 18,
    derivedStatus: "FA", latestTransaction: null,
  },
  {
    playerId: 3, name: "샘플 투수 C", teamName: "Jacksonville Jumbo Shrimp", level: "AAA",
    orgId: 102, orgName: "Miami Marlins",
    headshotUrl: "",
    birthDate: "2001-11-20", currentAge: 24, batSide: "R", pitchHand: "R",
    mlb: null,
    aaa: { games: 30, gamesStarted: 0, inningsPitched: "35.0", era: "3.40", kPer9: "10.10", bbPer9: "3.20", whip: "1.15" },
    combinedGames: 30,
    derivedStatus: "Off-40", latestTransaction: null,
  },
];

export const SAMPLE_BATTERS = [
  {
    playerId: 4, name: "샘플 타자 A", teamName: "Los Angeles Dodgers", level: "MLB",
    orgId: 103, orgName: "Los Angeles Dodgers",
    headshotUrl: "",
    birthDate: "1998-05-09", currentAge: 28, batSide: "L", pitchHand: "R",
    mlb: { plateAppearances: 391, atBats: 360, hits: 85, homeRuns: 16, avg: ".236", obp: ".294", slg: ".408", ops: ".702" },
    aaa: null,
    combinedPA: 391,
    derivedStatus: "Active", latestTransaction: null,
  },
  {
    playerId: 5, name: "샘플 타자 B", teamName: "Scranton/WB RailRiders", level: "AAA",
    orgId: 104, orgName: "New York Yankees",
    headshotUrl: "",
    birthDate: "2000-01-15", currentAge: 26, batSide: "S", pitchHand: "R",
    mlb: null,
    aaa: { plateAppearances: 280, atBats: 250, hits: 70, homeRuns: 20, avg: ".280", obp: ".350", slg: ".520", ops: ".870" },
    combinedPA: 280,
    derivedStatus: "On-40", latestTransaction: null,
  },
];
