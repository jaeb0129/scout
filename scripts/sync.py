"""
외국인 선수 스카우트 - 동기화 스크립트
=====================================================================
GitHub Actions가 정해진 스케줄(cron)에 이 스크립트를 실행:
  1. MLB Stats API에서 MLB + AAA 투수/타자 로스터·상태 수집
  2. 각 선수의 MLB(sportId=1) / AAA(sportId=11) 스탯을 각각 따로 조회해서
     doc["mlb"], doc["aaa"] 에 저장 (한 시즌에 콜업/옵션으로 두 레벨 다 뛴 선수 대응)
  3. 팀 필터에서 "메이저리그 팀 선택 시 산하 AAA까지 같이 검색"되도록
     doc["orgId"]/doc["orgName"]에 항상 MLB 모기업 기준 값을 저장
  4. Firestore Admin SDK로 직접 저장

주의: 선수 1명당 API 호출이 늘어나서(로스터+40인+MLB스탯+AAA스탯+트랜잭션+개인정보) 예전보다 오래 걸립니다.
전체 로스터 규모에 따라 10~20분 이상 걸릴 수 있어요.

필요 시크릿: FIREBASE_SERVICE_ACCOUNT_KEY (Firestore 서비스 계정 JSON, GitHub Secrets에 등록)
"""

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone

import requests
import firebase_admin
from firebase_admin import credentials, firestore

BASE = "https://statsapi.mlb.com/api/v1"
SESSION = requests.Session()

SPORT_MLB = 1
SPORT_AAA = 11


def api_get(path, **params):
    r = SESSION.get(f"{BASE}{path}", params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def init_firestore():
    key_json = os.environ["FIREBASE_SERVICE_ACCOUNT_KEY"]
    cred = credentials.Certificate(json.loads(key_json))
    firebase_admin.initialize_app(cred)
    return firestore.client()


# ---------------------------------------------------------------------------
# MLB Stats API 헬퍼
# ---------------------------------------------------------------------------
def get_teams(sport_id):
    return api_get("/teams", sportId=sport_id).get("teams", [])


def get_40man_ids(mlb_team_id):
    data = api_get(f"/teams/{mlb_team_id}/roster", rosterType="40Man")
    return {p["person"]["id"] for p in data.get("roster", [])}


def get_full_roster(team_id):
    data = api_get(f"/teams/{team_id}/roster", rosterType="fullRoster")
    return data.get("roster", [])


IL_CODES = {"D7", "D10", "D15", "D60", "ILF"}

ROSTER_STATUS_LABELS = {
    "A": "Active", "D7": "IL-7", "D10": "IL-10", "D15": "IL-15", "D60": "IL-60",
    "ILF": "IL (Season)", "RM": "Minors", "RST": "Restricted", "DEV": "Development List",
    "NYR": "Not Yet Reported", "RA": "Rehab Assignment", "PL": "Paternity List",
    "BRV": "Bereavement List",
}

# typeCode "DFA" = Declared Free Agency (자유계약 "선언")
# typeCode "DES" = Designated for Assignment (흔히 말하는 "DFA 당함") - 헷갈리기 쉬운 부분
TRANSACTION_LABELS = {
    "DES": "DFA", "DFA": "Declared Free Agency", "REL": "Released", "OUT": "Outrighted",
    "SFA": "Signed as Free Agent", "SGN": "Signed", "RET": "Retired",
    "CLW": "Claimed Off Waivers", "TR": "Traded", "SE": "Selected", "CU": "Recalled",
    "OPT": "Optioned",
}


def get_transactions(start_date, end_date, player_id=None):
    params = {"startDate": start_date, "endDate": end_date}
    if player_id:
        params["playerId"] = player_id
    return api_get("/transactions", **params).get("transactions", [])


def latest_status_from_transactions(player_id, lookback_days=365):
    end = datetime.now().date()
    start = end - timedelta(days=lookback_days)
    txns = get_transactions(start.isoformat(), end.isoformat(), player_id=player_id)
    if not txns:
        return None
    txns.sort(key=lambda t: t.get("date", ""), reverse=True)
    latest = txns[0]
    return {
        "date": latest.get("date"),
        "typeCode": latest.get("typeCode"),
        "label": TRANSACTION_LABELS.get(latest.get("typeCode"), latest.get("typeDesc")),
        "description": latest.get("description"),
    }


def derive_status(on_40man, status_code, txn):
    if status_code in IL_CODES:
        return "IL"
    if txn:
        code = txn["typeCode"]
        if code == "REL":
            return "Released"
        if code == "DES":
            return "DFA"
        if code == "DFA":
            return "FA"
        if code == "OUT" and not on_40man:
            return "Off-40"
    if not on_40man:
        return "Off-40"
    return "On-40"


# ---------------------------------------------------------------------------
# 레벨별(MLB/AAA) 스탯 조회 - sportId로 명시해야 각 레벨 스탯이 따로 나옴
# ---------------------------------------------------------------------------
def get_pitching_stats(player_id, season, sport_id):
    data = api_get(f"/people/{player_id}/stats", stats="season", group="pitching", season=season, sportId=sport_id)
    stats = data.get("stats", [])
    if not stats or not stats[0].get("splits"):
        return None
    stat = stats[0]["splits"][0]["stat"]
    return {
        "games": stat.get("gamesPlayed"),
        "gamesStarted": stat.get("gamesStarted"),
        "inningsPitched": stat.get("inningsPitched"),
        "era": stat.get("era"),
        "kPer9": stat.get("strikeoutsPer9Inn"),
        "bbPer9": stat.get("walksPer9Inn"),
        "whip": stat.get("whip"),
    }


def get_hitting_stats(player_id, season, sport_id):
    data = api_get(f"/people/{player_id}/stats", stats="season", group="hitting", season=season, sportId=sport_id)
    stats = data.get("stats", [])
    if not stats or not stats[0].get("splits"):
        return None
    stat = stats[0]["splits"][0]["stat"]
    return {
        "plateAppearances": stat.get("plateAppearances"),
        "atBats": stat.get("atBats"),
        "hits": stat.get("hits"),
        "homeRuns": stat.get("homeRuns"),
        "avg": stat.get("avg"),
        "obp": stat.get("obp"),
        "slg": stat.get("slg"),
        "ops": stat.get("ops"),
    }


# ---------------------------------------------------------------------------
# FanGraphs RosterResource 연동 (Service Time / MiLB Options)
# ---------------------------------------------------------------------------
# 처음엔 선수 개별 페이지(fangraphs.com/players/이름/id/stats)를 선수 수만큼(600+) 긁는 방식으로
# 만들었는데 두 가지 문제가 있었다:
#   1. FanGraphs 자체 playerId를 알아야 해서 Smart Fantasy Baseball의 공개 ID 크로스워크가 필요했고,
#      그 매핑이 40인 로스터는 83%, AAA는 42%만 커버해서 나머지는 아예 데이터를 못 가져왔다.
#   2. 선수당 1.2초씩 딜레이를 둬도 동기화 시간이 10분 이상 늘어났다.
#
# 대신 RosterResource의 "팀 뎁스차트" 페이지(fangraphs.com/roster-resource/depth-charts/{team-slug})
# 하나에 그 구단 산하 전체(MLB+AA+AAA+A+ 등) 선수의 옵션/서비스타임이 mlbamid 기준으로 다 들어있다는 걸
# 발견해서 이 방식으로 바꿨다. MLB 30개 구단 페이지만 돌면 되니:
#   - 우리 MLBAM playerId로 바로 매칭 가능 (별도 ID 크로스워크 불필요)
#   - 요청이 600+회 -> 30회로 줄어서 동기화 시간에 미치는 영향이 거의 없음
#   - 실제 확인해보니 블루제이스 산하 175명 전원(MLB~A 전 레벨) mlbamid 매칭 100%
# 다만 이 페이지에는 FA/연봉조정 예정 연도(seasonFreeAgent/seasonArbitration)는 안 들어있다 -
# 그건 선수 개별 페이지(dataContractStatus)에만 있어서, 필요해지면 그때 별도로 추가하면 됨.
FANGRAPHS_TEAM_SLUGS = {
    109: "diamondbacks", 133: "athletics", 144: "braves", 110: "orioles", 111: "red-sox",
    112: "cubs", 145: "white-sox", 113: "reds", 114: "guardians", 115: "rockies",
    116: "tigers", 117: "astros", 118: "royals", 108: "angels", 119: "dodgers",
    146: "marlins", 158: "brewers", 142: "twins", 121: "mets", 147: "yankees",
    143: "phillies", 134: "pirates", 135: "padres", 137: "giants", 136: "mariners",
    138: "cardinals", 139: "rays", 140: "rangers", 141: "blue-jays", 120: "nationals",
}  # MLB Stats API teamId(sportId=1 기준) -> FanGraphs RosterResource 팀 슬러그, 30개 구단 전부 curl로 200 확인함

# 요청 속도를 늦추지 않으면 FanGraphs 쪽에서 403(차단)을 내려준다 - 직접 확인함.
# 이제 구단당 1회(30회)만 부르면 되니 이 딜레이를 넣어도 동기화 시간엔 거의 영향 없음(+1분 내외).
FANGRAPHS_REQUEST_DELAY_SEC = 1.5

# 팀 뎁스차트 방식으로 바꾼 뒤(구단당 1회, mlbamid 직접 매칭)로는 커버리지/속도 문제가 둘 다
# 해결돼서 다시 켬. 끄고 싶으면 False로.
FANGRAPHS_ROSTER_RESOURCE_ENABLED = True
FANGRAPHS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


def get_fangraphs_team_depth_chart(slug):
    """FanGraphs RosterResource 팀 뎁스차트 페이지(Next.js 서버렌더링)에서 __NEXT_DATA__ JSON에
    박혀있는 산하 전체 선수 로스터(dataRoster)를 그대로 읽어온다. mlbamid/options/servicetime/UPURL
    (FanGraphs 선수 페이지 경로)이 선수별로 들어있다. 전용 API가 없어 페이지를 직접 읽는 방식이라
    FanGraphs가 페이지 구조를 바꾸면 깨질 수 있음."""
    url = f"https://www.fangraphs.com/roster-resource/depth-charts/{slug}"
    r = SESSION.get(url, headers=FANGRAPHS_HEADERS, timeout=20)
    r.raise_for_status()
    m = re.search(r'__NEXT_DATA__" type="application/json">(.*?)</script>', r.text)
    if not m:
        return []
    data = json.loads(m.group(1))
    queries = data.get("props", {}).get("pageProps", {}).get("dehydratedState", {}).get("queries", [])
    if not queries:
        return []
    return queries[0].get("state", {}).get("data", {}).get("dataRoster") or []


def build_fangraphs_index():
    """MLBAM playerId(문자열) -> {"milbOptions", "serviceTime", "fangraphsUrl"} 매핑을 MLB 30개 구단
    뎁스차트 페이지를 돌면서 한 번에 만든다. 구단 하나가 실패해도(네트워크/구조변경) 그 구단 선수들만
    빠지고 나머지는 정상 진행 - 동기화 전체를 막지 않는다."""
    index = {}
    for team_id, slug in FANGRAPHS_TEAM_SLUGS.items():
        try:
            roster = get_fangraphs_team_depth_chart(slug)
            for r in roster:
                mlbamid = r.get("mlbamid")
                if not mlbamid:
                    continue
                upurl = r.get("UPURL")
                index[str(mlbamid)] = {
                    "milbOptions": r.get("options"),
                    "serviceTime": r.get("servicetime"),
                    "fangraphsUrl": f"https://www.fangraphs.com{upurl}" if upurl else None,
                }
        except Exception as e:  # noqa: BLE001
            print(f"FanGraphs depth chart fetch failed for team {team_id} ({slug}): {e}")
        time.sleep(FANGRAPHS_REQUEST_DELAY_SEC)
    return index


def get_player_bio(player_id):
    """생년월일, 만나이, 타석, 투구팔 - MLB Stats API /people 엔드포인트에서 직접 제공."""
    data = api_get(f"/people/{player_id}")
    people = data.get("people", [])
    if not people:
        return {"birthDate": None, "currentAge": None, "batSide": None, "pitchHand": None}
    p = people[0]
    return {
        "birthDate": p.get("birthDate"),
        "currentAge": p.get("currentAge"),
        "batSide": p.get("batSide", {}).get("code"),
        "pitchHand": p.get("pitchHand", {}).get("code"),
    }


def headshot_url(player_id, size=213):
    return (
        f"https://img.mlbstatic.com/mlb-photos/image/upload/"
        f"w_{size},d_people:generic:headshot:67:current.png/v1/"
        f"people/{player_id}/headshot/67/current"
    )


# ---------------------------------------------------------------------------
# 메인 동기화 (투수 + 타자 함께)
# ---------------------------------------------------------------------------
def _approx_doc_bytes(doc):
    """Firestore 페이로드 크기를 정확히는 못 구하지만, JSON 직렬화 길이로 근사치를 낸다.
    실제 protobuf 인코딩보다 보수적으로 살짝 크게 잡는 편이라 안전마진 역할을 한다."""
    try:
        return len(json.dumps(doc, default=str, ensure_ascii=False).encode("utf-8"))
    except Exception:  # noqa: BLE001
        return 2000  # 직렬화 실패 시 넉넉히 잡아 안전 쪽으로 처리


BATCH_MAX_COUNT = 150          # Firestore 문서 개수 제한(500)보다 훨씬 낮게 잡아 여유를 둠
BATCH_MAX_BYTES = 3 * 1024 * 1024  # 요청 크기 제한(~10~11MB)보다 한참 낮은 3MB에서 미리 커밋
                                     # (JSON 근사치가 실제 protobuf 인코딩보다 작게 나올 수 있어 더 보수적으로 설정)

CHUNK_MAX_BYTES = 700 * 1024   # 문서 1개당 1MB 제한보다 한참 낮게 잡은 청크 크기 (안전마진)


def _chunk_players(players):
    """선수 목록(dict 리스트)을 문서 1개(1MB 제한)에 안전하게 들어갈 크기로 쪼갠다.
    프론트가 category(투수/타자)별로 이 청크 문서들만 읽으면 되게 해서, players 컬렉션
    전체를 선수 수만큼 읽기 과금되는 쿼리로 긁어오지 않아도 되게 하기 위함
    (meta/playerIds와 같은 목적의 최적화)."""
    chunks = []
    current, current_bytes = [], 0
    for p in players:
        p_bytes = _approx_doc_bytes(p)
        if current and current_bytes + p_bytes > CHUNK_MAX_BYTES:
            chunks.append(current)
            current, current_bytes = [], 0
        current.append(p)
        current_bytes += p_bytes
    chunks.append(current)  # 선수가 0명이어도 빈 배열 청크 1개는 만들어서 프론트가 항상 문서를 찾게 함
    return chunks


def write_roster_snapshot(db, roster_snapshot):
    """카테고리별 전체 선수 목록을 rosterChunks/{category}_{i} 문서 몇 개로 쪼개 저장하고,
    몇 개로 쪼갰는지는 meta/rosterSnapshot에 적어둔다. 프론트는 이 문서들만 읽어서 화면에
    쓸 선수 목록을 구성한다 (players 컬렉션 전체 쿼리 대신).

    이전 실행보다 청크가 줄었으면(로스터가 줄어든 경우) 안 쓰는 청크 문서가 계속 남지 않도록
    정리한다 - 읽기 1회 + 필요할 때만 삭제 몇 건이라 할당량에 사실상 영향 없다."""
    prev_snap = db.collection("meta").document("rosterSnapshot").get()
    prev = prev_snap.to_dict() if prev_snap.exists else {}

    manifest = {"updatedAt": firestore.SERVER_TIMESTAMP}
    for category in ("pitcher", "batter"):
        chunks = _chunk_players(roster_snapshot.get(category, []))
        for i, chunk in enumerate(chunks):
            db.collection("rosterChunks").document(f"{category}_{i}").set({"players": chunk})

        prev_count = prev.get(f"{category}Chunks") or 0
        for i in range(len(chunks), prev_count):
            db.collection("rosterChunks").document(f"{category}_{i}").delete()

        manifest[f"{category}Chunks"] = len(chunks)

    db.collection("meta").document("rosterSnapshot").set(manifest)


def sync_players(db, season):
    mlb_teams = get_teams(SPORT_MLB)
    aaa_teams = get_teams(SPORT_AAA)
    forty_man_cache = {}
    fangraphs_index = build_fangraphs_index() if FANGRAPHS_ROSTER_RESOURCE_ENABLED else {}

    batch = db.batch()
    batch_count = 0
    batch_bytes = 0
    processed = 0
    errors = []
    known_ids = set()  # meta/playerIds에 그대로 저장 - sync_metrics.py가 전체 컬렉션을 안 긁고
                        # 이 문서 1개만 읽어서 등록된 선수 id를 알 수 있게 하기 위함
    roster_snapshot = {"pitcher": [], "batter": []}  # rosterChunks에 그대로 저장 - 프론트가
                        # players 컬렉션을 통째로 쿼리하지 않고 이 스냅샷만 읽게 하기 위함
    sync_time = datetime.now(timezone.utc)  # 스냅샷 배열 안에는 SERVER_TIMESTAMP를 못 써서
                        # (필드 변환은 배열 원소 안에서 지원 안 됨) 대신 이 시각을 넣는다 -
                        # 개별 선수 문서(players/{id})는 그대로 SERVER_TIMESTAMP를 씀

    def commit_if_needed(force=False):
        nonlocal batch, batch_count, batch_bytes
        if batch_count == 0:
            return
        if not (force or batch_count >= BATCH_MAX_COUNT or batch_bytes >= BATCH_MAX_BYTES):
            return
        pending_batch = batch
        pending_count = batch_count
        # 커밋 성공/실패와 무관하게 배치 상태는 항상 새로 리셋한다.
        # (리셋을 안 하면 실패한 배치 위에 다음 선수들이 계속 쌓여서
        #  다음 커밋이 훨씬 더 크게 다시 실패하는 악순환이 생긴다 - 실제로 겪은 버그)
        batch = db.batch()
        batch_count = 0
        batch_bytes = 0
        try:
            pending_batch.commit()
        except Exception as e:  # noqa: BLE001
            errors.append(f"batch commit failed, {pending_count}건 유실: {e}")

    def process_team(team, level, parent_org_id=None, parent_org_name=None):
        nonlocal processed, batch_count, batch_bytes
        team_id = team["id"]
        try:
            roster = get_full_roster(team_id)
        except Exception as e:  # noqa: BLE001
            errors.append(f"roster fetch failed for team {team_id}: {e}")
            return

        forty_man = set()
        if level == "MLB":
            forty_man = get_40man_ids(team_id)
        elif parent_org_id:
            if parent_org_id not in forty_man_cache:
                try:
                    forty_man_cache[parent_org_id] = get_40man_ids(parent_org_id)
                except Exception as e:  # noqa: BLE001
                    errors.append(f"40man fetch failed for org {parent_org_id}: {e}")
                    forty_man_cache[parent_org_id] = set()
            forty_man = forty_man_cache[parent_org_id]

        # 팀 필터용 소속(org): MLB면 자기 자신, AAA면 모기업 MLB 구단 기준으로 통일
        org_id = team_id if level == "MLB" else parent_org_id
        org_name = team["name"] if level == "MLB" else parent_org_name

        for p in roster:
            pid = p["person"]["id"]
            is_pitcher = p["position"]["type"] == "Pitcher"
            try:
                on_40 = pid in forty_man
                txn = latest_status_from_transactions(pid)
                status_code = p["status"]["code"]
                bio = get_player_bio(pid)

                doc = {
                    "name": p["person"]["fullName"],
                    "playerId": pid,
                    "position": p["position"]["name"],
                    "positionAbbrev": p["position"]["abbreviation"],
                    "headshotUrl": headshot_url(pid),
                    "birthDate": bio["birthDate"],
                    "currentAge": bio["currentAge"],
                    "batSide": bio["batSide"],
                    "pitchHand": bio["pitchHand"],
                    "level": level,
                    "teamId": team_id,
                    "teamName": team["name"],
                    "orgId": org_id,
                    "orgName": org_name,
                    "on40Man": on_40,
                    "rosterStatusCode": status_code,
                    "rosterStatusLabel": ROSTER_STATUS_LABELS.get(status_code, status_code),
                    "isIL": status_code in IL_CODES,
                    "latestTransaction": txn,
                    "derivedStatus": derive_status(on_40, status_code, txn),
                    "season": season,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }

                # FanGraphs RosterResource 연동 (Service Time / MiLB Options) - 위에서 미리 만들어둔
                # fangraphs_index에서 조회만 하면 되니 선수별 추가 요청/딜레이가 없다.
                # 지금은 FANGRAPHS_ROSTER_RESOURCE_ENABLED = False라 인덱스 자체가 비어있어 항상 None.
                fg_entry = fangraphs_index.get(str(pid))
                if fg_entry:
                    doc["fangraphsUrl"] = fg_entry["fangraphsUrl"]
                    doc["rosterResource"] = {
                        "serviceTime": fg_entry["serviceTime"],
                        "milbOptions": fg_entry["milbOptions"],
                    }
                else:
                    doc["fangraphsUrl"] = None
                    doc["rosterResource"] = None

                if is_pitcher:
                    mlb_stat = get_pitching_stats(pid, season, SPORT_MLB)
                    aaa_stat = get_pitching_stats(pid, season, SPORT_AAA)
                    doc["category"] = "pitcher"
                    doc["mlb"] = mlb_stat
                    doc["aaa"] = aaa_stat
                    doc["combinedGames"] = (mlb_stat["games"] if mlb_stat else 0) + (aaa_stat["games"] if aaa_stat else 0)
                else:
                    mlb_stat = get_hitting_stats(pid, season, SPORT_MLB)
                    aaa_stat = get_hitting_stats(pid, season, SPORT_AAA)
                    doc["category"] = "batter"
                    doc["mlb"] = mlb_stat
                    doc["aaa"] = aaa_stat
                    doc["combinedPA"] = (mlb_stat["plateAppearances"] if mlb_stat else 0) + (aaa_stat["plateAppearances"] if aaa_stat else 0)

                batch.set(db.collection("players").document(str(pid)), doc, merge=True)
                batch_count += 1
                batch_bytes += _approx_doc_bytes(doc)
                processed += 1
                known_ids.add(pid)

                snapshot_doc = dict(doc)
                snapshot_doc["updatedAt"] = sync_time
                roster_snapshot[doc["category"]].append(snapshot_doc)
            except Exception as e:  # noqa: BLE001
                errors.append(f"player {pid} failed: {e}")

            # 배치 커밋은 선수별 예외 처리와 분리한다: 위 try에 묶여 있으면
            # 커밋 실패가 "이 선수만의 오류"로 위장돼 배치가 리셋 안 된 채
            # 계속 쌓이는 버그가 생긴다 (commit_if_needed 내부에서 자체 처리).
            commit_if_needed()
            time.sleep(0.05)

    for t in mlb_teams:
        process_team(t, level="MLB")
    for t in aaa_teams:
        process_team(t, level="AAA", parent_org_id=t.get("parentOrgId"), parent_org_name=t.get("parentOrgName"))

    commit_if_needed(force=True)

    db.collection("meta").document("lastSync").set({
        "finishedAt": firestore.SERVER_TIMESTAMP,
        "playersProcessed": processed,
        "errors": errors[:50],
        "season": season,
    })

    # scripts/sync_metrics.py가 "등록된 선수 id" 확인용으로 players 컬렉션을 통째로 스캔하지 않고
    # 이 문서 1개만 읽도록 하기 위한 인덱스. (컬렉션 전체 스캔은 선수 수만큼 읽기로 과금되어,
    # 지표 스크립트를 개발 중에 여러 번 돌리면 Firestore 무료 할당량을 순식간에 다 써버린다 -
    # 실제로 겪은 문제라 여기서 막아둔다.)
    db.collection("meta").document("playerIds").set({
        "ids": sorted(known_ids),
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })

    # 프론트엔드(App.jsx)가 players 컬렉션을 통째로 쿼리하지 않고 여기 저장해둔 스냅샷만
    # 읽도록 하기 위함 - 캐시가 없는 사용자(하루 중 첫 방문 등)가 접속할 때마다 선수 수만큼
    # 읽기 과금이 나가던 걸, 카테고리당 청크 몇 개(보통 몇 개 수준)로 고정시킨다.
    write_roster_snapshot(db, roster_snapshot)

    return processed, errors


if __name__ == "__main__":
    db = init_firestore()
    season = datetime.now().year
    processed, errors = sync_players(db, season)
    print(f"Synced {processed} players, {len(errors)} errors")
    if errors:
        print("--- errors (up to 20) ---")
        for e in errors[:20]:
            print(e)
