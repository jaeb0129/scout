"""
외국인 선수 스카우트 - 지표 동기화 스크립트 (틀)
=====================================================================
로컬 MariaDB(pbp/aaa 테이블, 피치별 스탯캐스트형 데이터)에서 시즌 데이터를 읽어 선수별 지표를
계산하고, Firestore players/{id}.metrics 에 반영합니다. sync.py(로스터/기본 스탯, GitHub Actions)와는
완전히 독립된 파이프라인이라 이 스크립트가 실패해도 로스터 동기화에는 영향이 없습니다.

실행 방법
---------
1) 이 폴더의 .env.example을 복사해 .env로 만들고 MariaDB 접속 정보 + Firebase 서비스 계정 정보를 채웁니다.
2) 필요 패키지 설치: pip install -r scripts/requirements.txt
3) 실행: python scripts/sync_metrics.py  (또는 scripts/run_sync_metrics.bat 더블클릭)

새벽 자동 실행이 필요 없고, 필요할 때 수동으로 돌리거나 Windows 작업 스케줄러에 원하는 시간대로
등록해도 됩니다 (자세한 내용은 README.md의 "지표 동기화(로컬)" 참고).

지표를 채우는 법
----------------
아래 METRIC_DEFS 딕셔너리만 채우면 나머지 코드(피치 데이터 조회, Firestore 저장,
meta/metricsConfig 갱신)는 그대로 동작합니다. 예시 3개가 이미 채워져 있어 지금 바로 실행해도
동작을 확인할 수 있습니다 - 자유롭게 수정/삭제/추가하세요.

주의: pbp/aaa 테이블에 해당 시즌(기본값: 올해) 데이터가 없으면 그 레벨은 건너뜁니다.
      스카우트용으로 최신 시즌 지표가 나오려면 그 시즌 데이터를 MariaDB에 먼저 적재해야 합니다.
"""

import json
import os
from datetime import datetime

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine
import firebase_admin
from firebase_admin import credentials, firestore


# ============================================================
# 지표 정의 - 이 딕셔너리만 채우면 됩니다
# ============================================================
# 아래 예시 3개(평균 구속 / Hard-Hit% / 평균 타구속도)는 실제로 동작하는 지표입니다.
# compute 함수는 그 선수의 해당 시즌 피치 데이터(pandas DataFrame, 한 행 = 피치 1개)를 받아서
# 숫자 하나(또는 None)를 반환하면 됩니다. 사용 가능한 컬럼은 아래 PITCH_COLUMNS 참고.
#
# format 값: "avg1"/"avg2"/"avg3" = 소수점 n자리, "pct1" = 퍼센트(소수 1자리)
#            (프론트가 meta/metricsConfig의 이 값을 보고 표시 형식을 정합니다)
# ============================================================
def _pct(numerator_mask, denominator_mask):
    """denominator_mask를 만족하는 피치 중 numerator_mask도 만족하는 비율(%). 분모가 0이면 None."""
    denom = int(denominator_mask.sum())
    if denom == 0:
        return None
    return 100.0 * int(numerator_mask.sum()) / denom


METRIC_DEFS = {
    "pitcher": {
        "avg_velo": {
            "label": "패스트볼 평균 구속",
            "format": "avg1",
            "higherIsBetter": True,
            "compute": lambda g: g.loc[g["pitch_name"].isin(['4-Seam Fastball', 'Sinker', 'Cutter']), "release_speed"].mean(),
        },
         "whiff_pct": {
             "label": "Whiff%",
             "format": "pct1",
             "higherIsBetter": True,
             "compute": lambda g: _pct(
                 g["description"].isin(["swinging_strike", "swinging_strike_blocked", "foul_tip"]),
                 g["description"].isin([
                     "swinging_strike", "swinging_strike_blocked", "foul",
                     "foul_tip", "hit_into_play",
                 ]),
             ),
         },
    },
    "batter": {
        "hard_hit_pct": {
            "label": "Hard-Hit%",
            "format": "pct1",
            "higherIsBetter": True,
            # 공식 Statcast 기준: 타구 속도 95mph 이상인 인플레이 타구의 비율 (분모 = 타구 속도가 기록된 인플레이 타구)
            "compute": lambda g: _pct(
                g["description"].isin(["hit_into_play"]) & g["launch_speed"].notna() & (g["launch_speed"] >= 95),
                g["description"].isin(["hit_into_play"]) & g["launch_speed"].notna().notna(),
            ),
        },
        "avg_ev": {
            "label": "평균 타구속도",
            "format": "avg1",
            "higherIsBetter": True,
            "compute": lambda g: g.loc[(g["description"].isin(["hit_into_play"])) & (g["launch_speed"].notna()), "launch_speed"].mean(),
        },
         "whiff_pct": {
             "label": "Whiff%",
             "format": "pct1",
             "higherIsBetter": True,
             "compute": lambda g: _pct(
                 g["description"].isin(["swinging_strike", "swinging_strike_blocked", "foul_tip"]),
                 g["description"].isin([
                     "swinging_strike", "swinging_strike_blocked", "foul",
                     "foul_tip", "hit_into_play",
                 ]),
             ),
         },
        
        # "xwoba": {
        #     "label": "xwOBA",
        #     "format": "avg3",
        #     "higherIsBetter": True,
        #     # 간단화된 버전(타구 단위 단순 평균)입니다 - 실제 xwOBA는 볼넷/사구 등을 포함한
        #     # woba_denom 가중 평균입니다. 참고용 시작점으로만 쓰고 필요하면 다듬으세요.
        #     "compute": lambda g: g["estimated_woba_using_speedangle"].mean(),
        # },
    },
}


# ============================================================
# 여기부터는 보통 안 건드려도 되는 부분
# ============================================================

# pbp/aaa 테이블에서 가져올 컬럼 (fielder id, 스코어, deprecated 필드 등 지표 계산에 잘 안 쓰이는
# 컬럼은 빼서 조회 속도를 확보). 지표 계산에 다른 컬럼이 필요하면 여기에 추가하세요.
PITCH_COLUMNS = [
    "pitcher", "batter", "player_name", "game_year", "game_date", "game_pk",
    "at_bat_number", "pitch_number", "pitch_type", "pitch_name",
    "release_speed", "zone", "plate_x", "plate_z", "sz_top", "sz_bot",
    "balls", "strikes", "type", "description", "events",
    "bb_type", "hit_location", "launch_speed", "launch_angle",
    "estimated_ba_using_speedangle", "estimated_woba_using_speedangle",
    "woba_value", "woba_denom", "stand", "p_throws",
]

LEVEL_TABLES = (("mlb", "intl_mlb_pbp"), ("aaa", "intl_aaa_pbp"))  # (players 문서의 레벨 키, MariaDB 테이블명)

BATCH_MAX_COUNT = 150          # Firestore 문서 개수 제한(500)보다 여유 있게 낮춰서 커밋
BATCH_MAX_BYTES = 3 * 1024 * 1024


def get_engine():
    host = os.environ["MARIADB_HOST"]
    port = os.environ.get("MARIADB_PORT", "3306")
    user = os.environ["MARIADB_USER"]
    password = os.environ["MARIADB_PASSWORD"]
    database = os.environ["MARIADB_DATABASE"]
    url = f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}"
    return create_engine(url)


def init_firestore():
    if firebase_admin._apps:
        return firestore.client()
    key_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
    key_file = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY_FILE")
    if key_json:
        cred = credentials.Certificate(json.loads(key_json))
    elif key_file:
        cred = credentials.Certificate(key_file)
    else:
        raise RuntimeError(
            "FIREBASE_SERVICE_ACCOUNT_KEY 또는 FIREBASE_SERVICE_ACCOUNT_KEY_FILE 환경변수가 필요합니다. "
            ".env.example을 복사해 .env를 채워주세요."
        )
    firebase_admin.initialize_app(cred)
    return firestore.client()


def fetch_pitch_df(engine, table, season):
    cols = ", ".join(PITCH_COLUMNS)
    sql = f"SELECT {cols} FROM {table} WHERE game_year = %(season)s"
    return pd.read_sql_query(sql, engine, params={"season": season})


def get_known_player_ids(db):
    """Firestore players 컬렉션에 이미 등록된(로스터 동기화가 만들어둔) 선수 id 집합.
    이 집합에 없는 id는 지표를 계산해도 저장하지 않는다 - pbp/aaa에는 있지만 지금 추적 대상이
    아닌(과거 시즌 데이터 등) 선수의 문서를 새로 만들어버리는 걸 막기 위함.

    구현 노트: players 컬렉션을 통째로 스캔하면(.select([])를 써도 문서 수만큼 읽기로 과금됨)
    이 스크립트를 개발 중에 여러 번 돌릴 때마다 Firestore 무료 읽기 할당량(5만/일)을 순식간에
    다 써버린다 - 실제로 겪은 문제다. 그래서 sync.py가 로스터 동기화를 끝낼 때마다 미리 만들어두는
    meta/playerIds(문서 1개, id 배열만 담음)를 대신 읽는다 - 선수가 몇 명이든 읽기 1회로 끝난다.
    그 문서가 아직 없으면(sync.py를 이 변경 이전 버전으로 마지막에 돌렸거나 최초 실행인 경우)
    예전 방식(전체 컬렉션 스캔)으로 안전하게 폴백한다."""
    snap = db.collection("meta").document("playerIds").get()
    if snap.exists:
        ids = (snap.to_dict() or {}).get("ids") or []
        return {int(i) for i in ids}

    print("  meta/playerIds 문서가 없어 players 컬렉션 전체를 스캔합니다 "
          "(sync.py를 최신 버전으로 한 번 더 돌리면 다음부터는 이 스캔을 안 합니다).")
    docs = db.collection("players").select([]).stream()
    return {int(d.id) for d in docs}


def compute_category_metrics(df, category, known_ids):
    defs = METRIC_DEFS.get(category) or {}
    if not defs or df.empty:
        return {}
    group_col = "pitcher" if category == "pitcher" else "batter"
    results = {}
    for player_id, g in df.groupby(group_col):
        player_id = int(player_id)
        if player_id not in known_ids:
            continue
        metrics = {}
        for key, spec in defs.items():
            try:
                val = spec["compute"](g)
                metrics[key] = None if val is None or pd.isna(val) else round(float(val), 4)
            except Exception as e:  # noqa: BLE001
                metrics[key] = None
                print(f"  지표 계산 실패 ({category}.{key}, player {player_id}): {e}")
        results[player_id] = metrics
    return results


def sync_metrics(engine, db, season):
    known_ids = get_known_player_ids(db)
    print(f"Firestore에 등록된 선수 {len(known_ids)}명 기준으로 매칭합니다.")

    combined = {}  # player_id -> {"mlb": {...} | None, "aaa": {...} | None}

    for level, table in LEVEL_TABLES:
        df = fetch_pitch_df(engine, table, season)
        if df.empty:
            print(f"[{level}/{table}] {season}시즌 데이터가 없습니다 - 건너뜁니다 "
                  f"(MariaDB에 이 시즌 데이터를 적재했는지 확인하세요).")
            continue
        print(f"[{level}/{table}] {season}시즌 피치 {len(df):,}건 조회됨")

        for category in ("pitcher", "batter"):
            cat_metrics = compute_category_metrics(df, category, known_ids)
            for player_id, metrics in cat_metrics.items():
                entry = combined.setdefault(player_id, {"mlb": None, "aaa": None})
                entry[level] = metrics

    write_metrics(db, combined)
    return len(combined)


def write_metrics(db, combined):
    batch = db.batch()
    count = 0
    approx_bytes = 0
    for player_id, entry in combined.items():
        ref = db.collection("players").document(str(player_id))
        batch.set(ref, {"metrics": entry}, merge=True)
        count += 1
        approx_bytes += len(json.dumps(entry, default=str, ensure_ascii=False).encode("utf-8"))
        if count >= BATCH_MAX_COUNT or approx_bytes >= BATCH_MAX_BYTES:
            batch.commit()
            batch = db.batch()
            count = 0
            approx_bytes = 0
    if count > 0:
        batch.commit()


def build_metrics_config():
    config = {"pitcher": [], "batter": [], "updatedAt": firestore.SERVER_TIMESTAMP}
    for category in ("pitcher", "batter"):
        for key, spec in METRIC_DEFS.get(category, {}).items():
            config[category].append({
                "key": key,
                "label": spec["label"],
                "format": spec["format"],
                "higherIsBetter": spec["higherIsBetter"],
            })
    return config


def write_metrics_config(db):
    db.collection("meta").document("metricsConfig").set(build_metrics_config())


def write_last_sync(db, players_processed, run_by):
    db.collection("meta").document("metricsLastSync").set({
        "finishedAt": firestore.SERVER_TIMESTAMP,
        "playersProcessed": players_processed,
        "runBy": run_by,
    })


def main():
    load_dotenv()
    season = int(os.environ.get("METRICS_SEASON", 2025))# datetime.now().year))
    run_by = os.environ.get("METRICS_RUN_BY", "manual")

    print(f"=== 지표 동기화 시작 ({season}시즌, runBy={run_by}) ===")

    db = init_firestore()
    engine = get_engine()

    processed = sync_metrics(engine, db, season)
    write_metrics_config(db)
    write_last_sync(db, processed, run_by)

    print(f"=== 완료: {processed}명 지표 갱신, meta/metricsConfig·meta/metricsLastSync 갱신됨 ===")


if __name__ == "__main__":
    main()
