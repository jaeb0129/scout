import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, googleProvider, db, isFirebaseConfigured } from "./firebase.js";
import { ALLOWED_EMAILS } from "./allowedUsers.js";
import { SAMPLE_PITCHERS, SAMPLE_BATTERS } from "./sampleData.js";
import PitcherFilters from "./components/PitcherFilters.jsx";
import BatterFilters from "./components/BatterFilters.jsx";
import PitcherTable from "./components/PitcherTable.jsx";
import BatterTable from "./components/BatterTable.jsx";
import PlayerModal from "./components/PlayerModal.jsx";
import { combinedGamesStarted, combinedInnings, combinedPA, primaryEra, primaryOps, buildOrgOptions } from "./statUtils.js";
import { getCachedCategory, setCachedCategory, getStaleCategory } from "./lib/rosterCache.js";

export default function App() {
  const [user, setUser] = useState(isFirebaseConfigured ? undefined : { photoURL: "", displayName: "미리보기" });
  const [posTab, setPosTab] = useState("pitchers");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [metricsLastSync, setMetricsLastSync] = useState(null);
  const [metricsConfig, setMetricsConfig] = useState({ pitcher: [], batter: [] });
  const [authError, setAuthError] = useState(null);

  // 탭별 데이터 캐시 - 같은 세션 안에서 한 번 불러온 탭은 다시 안 불러오고 재사용
  const [cache, setCache] = useState({ pitcher: null, batter: null });

  const [pitcherFilters, setPitcherFilters] = useState({
    season: new Date().getFullYear(),
    spEligible: false,
    hideIL: true,
    statusChips: new Set(),
    minInnings: 0,
    orgId: null,
  });

  const [batterFilters, setBatterFilters] = useState({
    season: new Date().getFullYear(),
    hideIL: true,
    statusChips: new Set(),
    minPA: 0,
    orgId: null,
  });

  // 허용된 이메일 목록(allowedUsers.js)에 없는 계정은 로그인 자체는 성공해도
  // 바로 signOut 시킨다 - onAuthStateChanged가 null로 다시 호출되면서 user가 정리된다.
  // 진짜 접근 통제는 firestore.rules에 있으니 이건 어색한 화면(로그인은 됐는데 데이터는
  // 다 권한 오류)을 막기 위한 UX 처리다.
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUser(null);
        return;
      }
      if (!ALLOWED_EMAILS.includes(u.email)) {
        setAuthError(`접근 권한이 없는 계정입니다 (${u.email}). 팀 계정으로 다시 로그인해주세요.`);
        signOut(auth);
        return;
      }
      setAuthError(null);
      setUser(u);
    });
    return unsub;
  }, []);

  // 마지막 동기화 시각(로스터/지표) + 지표 표시 설정 조회 (문서 3개, 1회성)
  useEffect(() => {
    if (!user || !isFirebaseConfigured) return;
    (async () => {
      try {
        const [snap, metricsSyncSnap, metricsConfigSnap] = await Promise.all([
          getDoc(doc(db, "meta", "lastSync")),
          getDoc(doc(db, "meta", "metricsLastSync")),
          getDoc(doc(db, "meta", "metricsConfig")),
        ]);
        if (snap.exists()) {
          const d = snap.data();
          setLastSync(d.finishedAt?.toDate ? d.finishedAt.toDate() : null);
        }
        if (metricsSyncSnap.exists()) {
          const d = metricsSyncSnap.data();
          setMetricsLastSync(d.finishedAt?.toDate ? d.finishedAt.toDate() : null);
        }
        if (metricsConfigSnap.exists()) {
          const d = metricsConfigSnap.data();
          setMetricsConfig({ pitcher: d.pitcher || [], batter: d.batter || [] });
        }
      } catch {
        // 조회 실패해도 화면 동작엔 지장 없으니 조용히 무시
      }
    })();
  }, [user]);

  // 탭 전환 시 캐시에 있으면 재사용, 없으면 Firestore에서 새로 조회.
  // Firestore 조회 전에 meta/lastSync(문서 1개)부터 먼저 확인해서, 지난번 동기화 이후로
  // 데이터가 안 바뀌었으면 브라우저(localStorage)에 저장해둔 캐시를 그대로 쓰고
  // 컬렉션 전체를 다시 읽지 않는다 - 새로고침/재접속을 자주 해도 읽기 횟수가 거의 안 늘어난다.
  useEffect(() => {
    if (!user) return;
    const category = posTab === "pitchers" ? "pitcher" : "batter";

    if (cache[category]) {
      setLoading(false);
      return; // 이미 이번 세션에 불러온 탭 - 재조회 없이 메모리 캐시 사용
    }

    if (!isFirebaseConfigured) {
      const sample = posTab === "pitchers" ? SAMPLE_PITCHERS : SAMPLE_BATTERS;
      setCache((c) => ({ ...c, [category]: sample }));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 1) meta/lastSync(로스터) + meta/metricsLastSync(지표)부터 먼저 확인
        //    (문서 2개 - 저렴한 읽기). 지표만 새로 갱신돼도 캐시가 무효화되도록 두 시각을
        //    합쳐서 하나의 cacheKey로 쓴다.
        const [metaSnap, metricsMetaSnap] = await Promise.all([
          getDoc(doc(db, "meta", "lastSync")),
          getDoc(doc(db, "meta", "metricsLastSync")),
        ]);
        const serverSyncMs = metaSnap.exists()
          ? metaSnap.data().finishedAt?.toMillis?.() ?? null
          : null;
        const metricsSyncMs = metricsMetaSnap.exists()
          ? metricsMetaSnap.data().finishedAt?.toMillis?.() ?? null
          : null;
        const cacheKey =
          serverSyncMs != null || metricsSyncMs != null
            ? `${serverSyncMs ?? "x"}:${metricsSyncMs ?? "x"}`
            : null;

        // 2) 로컬(localStorage) 캐시가 이 키 기준으로 이미 최신이면 그대로 사용
        const cachedPlayers = getCachedCategory(category, cacheKey);
        if (cachedPlayers) {
          if (!cancelled) setCache((c) => ({ ...c, [category]: cachedPlayers }));
          return;
        }

        // 3) 캐시가 없거나 오래됐을 때만 서버에서 다시 읽는다.
        //    players 컬렉션을 통째로 쿼리하면(선수 수만큼 읽기 과금) 캐시가 없는 사용자가
        //    접속할 때마다 비용이 커지므로, scripts/sync.py가 동기화 때마다 미리 만들어두는
        //    rosterChunks 스냅샷만 읽는다 - meta/rosterSnapshot에서 이 카테고리가 몇 개
        //    청크로 쪼개졌는지 확인한 뒤, 그 청크 문서들만 읽으면 끝난다 (선수가 몇 명이든
        //    보통 몇 개 수준의 읽기로 고정된다).
        const manifestSnap = await getDoc(doc(db, "meta", "rosterSnapshot"));
        if (!manifestSnap.exists()) {
          throw new Error(
            "meta/rosterSnapshot이 없습니다 - scripts/sync.py를 최신 버전으로 한 번 더 실행해주세요."
          );
        }
        const chunkCount = manifestSnap.data()[`${category}Chunks`] || 0;
        const chunkSnaps = await Promise.all(
          Array.from({ length: chunkCount }, (_, i) =>
            getDoc(doc(db, "rosterChunks", `${category}_${i}`))
          )
        );
        if (cancelled) return;
        const list = chunkSnaps.flatMap((s) => (s.exists() ? s.data().players || [] : []));
        setCachedCategory(category, list, cacheKey);
        setCache((c) => ({ ...c, [category]: list }));
      } catch (e) {
        if (cancelled) return;
        // Firestore 조회 자체가 실패했을 때(할당량 초과 등) - 이 브라우저에 마지막으로
        // 저장해둔 데이터가 있으면(신선한지 여부와 무관하게) 그거라도 보여준다. 캐시가
        // 있는 사용자가 할당량 초과 때문에 빈 화면만 보게 되는 걸 막기 위함. 캐시가 아예
        // 없는 사용자(처음 방문 등)는 지금처럼 오류만 표시한다.
        const stale = getStaleCategory(category);
        if (stale) {
          setCache((c) => ({ ...c, [category]: stale }));
          setError(
            `실시간 확인에 실패해 마지막으로 저장된 데이터를 보여드리고 있습니다 (${e.message || "네트워크/할당량 오류"}).`
          );
        } else {
          setError(e.message || "데이터를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, posTab, cache]);

  // 이 탭의 메모리 캐시만 비운다 - 실제로 Firestore 컬렉션을 다시 읽을지는 위 useEffect에서
  // meta/lastSync가 바뀌었는지로 판단한다 (안 바뀌었으면 localStorage 캐시를 그대로 씀)
  const refreshCurrentTab = () => {
    const category = posTab === "pitchers" ? "pitcher" : "batter";
    setCache((c) => ({ ...c, [category]: null }));
  };

  const players = cache[posTab === "pitchers" ? "pitcher" : "batter"] || [];
  const orgOptions = useMemo(() => buildOrgOptions(players), [players]);

  const filteredPitchers = useMemo(() => {
    if (posTab !== "pitchers") return [];
    let list = players;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name?.toLowerCase().includes(q));
    }
    if (pitcherFilters.orgId) list = list.filter((p) => p.orgId === pitcherFilters.orgId);
    if (pitcherFilters.hideIL) list = list.filter((p) => p.derivedStatus !== "IL");
    if (pitcherFilters.spEligible) {
      // 선발 투수 자격: 올해 MLB+AAA 합산 선발 10경기 이상 등판
      list = list.filter((p) => combinedGamesStarted(p) >= 10);
    }
    if (pitcherFilters.statusChips.size > 0) {
      list = list.filter((p) => pitcherFilters.statusChips.has(p.derivedStatus));
    }
    if (pitcherFilters.minInnings > 0) {
      list = list.filter((p) => combinedInnings(p) >= pitcherFilters.minInnings);
    }
    return [...list].sort((a, b) => primaryEra(a) - primaryEra(b));
  }, [players, posTab, search, pitcherFilters]);

  const filteredBatters = useMemo(() => {
    if (posTab !== "batters") return [];
    let list = players;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name?.toLowerCase().includes(q));
    }
    if (batterFilters.orgId) list = list.filter((p) => p.orgId === batterFilters.orgId);
    if (batterFilters.hideIL) list = list.filter((p) => p.derivedStatus !== "IL");
    if (batterFilters.statusChips.size > 0) {
      list = list.filter((p) => batterFilters.statusChips.has(p.derivedStatus));
    }
    if (batterFilters.minPA > 0) {
      list = list.filter((p) => combinedPA(p) >= batterFilters.minPA);
    }
    return [...list].sort((a, b) => primaryOps(b) - primaryOps(a));
  }, [players, posTab, search, batterFilters]);

  if (isFirebaseConfigured && user === undefined) {
    return <div className="loading">불러오는 중…</div>;
  }

  if (isFirebaseConfigured && !user) {
    return (
      <div className="gate">
        <h1>로그인</h1>
        <p>팀원 전용 페이지입니다. 구글 계정으로 로그인해주세요.</p>
        {authError && <div className="errbanner">{authError}</div>}
        <button onClick={() => signInWithPopup(auth, googleProvider)}>Google로 로그인</button>
      </div>
    );
  }

  return (
    <div className="app">
      {!isFirebaseConfigured && (
        <div className="errbanner" style={{ margin: "12px 16px 0" }}>
          미리보기 모드입니다 (샘플 데이터). Firebase 설정을 firebase.js에 채우면 실제 데이터로 전환됩니다.
        </div>
      )}
      <div className="topbar">
        <div className="brand">
          <div className="orb" />
        </div>
        <div className="searchbox">
          <input
            placeholder="선수 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="linkbtn" onClick={refreshCurrentTab} title="새 동기화가 있으면 이 탭 데이터를 다시 불러옵니다">
          새로고침
        </button>
        {isFirebaseConfigured && (
          <div className="userchip">
            <img src={user.photoURL} alt="" />
            <button className="linkbtn" onClick={() => signOut(auth)}>로그아웃</button>
          </div>
        )}
      </div>

      {lastSync && (
        <div className="lastsync">
          업데이트 기준: {lastSync.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
          {metricsLastSync && (
            <> · 지표 업데이트 기준: {metricsLastSync.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</>
          )}
        </div>
      )}

      <div className="subtabs">
        <button className={`subtab ${posTab === "pitchers" ? "active" : ""}`} onClick={() => setPosTab("pitchers")}>
          투수
        </button>
        <button className={`subtab ${posTab === "batters" ? "active" : ""}`} onClick={() => setPosTab("batters")}>
          타자
        </button>
      </div>

      <div className="content">
        {posTab === "pitchers" ? (
          <>
            <PitcherFilters state={pitcherFilters} setState={setPitcherFilters} resultCount={filteredPitchers.length} orgOptions={orgOptions} />
            {error && <div className="errbanner">{error}</div>}
            {loading ? <div className="loading">불러오는 중…</div> : <PitcherTable players={filteredPitchers} onSelectPlayer={setSelectedPlayer} metricsConfig={metricsConfig.pitcher} />}
          </>
        ) : (
          <>
            <BatterFilters state={batterFilters} setState={setBatterFilters} resultCount={filteredBatters.length} orgOptions={orgOptions} />
            {error && <div className="errbanner">{error}</div>}
            {loading ? <div className="loading">불러오는 중…</div> : <BatterTable players={filteredBatters} onSelectPlayer={setSelectedPlayer} metricsConfig={metricsConfig.batter} />}
          </>
        )}
      </div>

      <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} user={user} />
    </div>
  );
}
