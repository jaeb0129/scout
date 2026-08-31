import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured } from "../firebase.js";
import { externalLinksFor } from "../lib/externalLinks.js";
import { fetchPlayerTransactions, extractInjuryHistory } from "../lib/mlbApi.js";
import { formatBio } from "../statUtils.js";

// 선수 행을 클릭하면 뜨는 상세 모달.
// - 외부 스카우팅 사이트(Baseball Savant / FanGraphs / Prospect Savant) 링크
// - 트랜잭션 전체 이력 / 부상자명단 이력 (MLB Stats API에서 실시간 조회, Firestore 저장 안 함)
// - 선수 보고서(reports/{playerId}) 외부 링크 - 원본은 Google Drive/Notion 등에 그대로 두고
//   여기엔 링크만 저장한다. 로그인한 팀원이 앱에서 직접 setDoc으로 씀 (자동 배치 아님).
export default function PlayerModal({ player, onClose, user }) {
  const [txns, setTxns] = useState(null);
  const [txnError, setTxnError] = useState(null);
  const [tab, setTab] = useState("transactions"); // "transactions" | "injuries"

  const [report, setReport] = useState(undefined); // undefined=조회 중, null=없음, object=있음
  const [editingReport, setEditingReport] = useState(false);
  const [reportUrlInput, setReportUrlInput] = useState("");
  const [reportTitleInput, setReportTitleInput] = useState("");
  const [reportSaving, setReportSaving] = useState(false);
  const [reportError, setReportError] = useState(null);

  useEffect(() => {
    if (!player) return;
    let cancelled = false;
    setTxns(null);
    setTxnError(null);
    setTab("transactions");
    fetchPlayerTransactions(player.playerId)
      .then((list) => {
        if (!cancelled) setTxns(list);
      })
      .catch((e) => {
        if (!cancelled) setTxnError(e.message || "불러오기 실패");
      });
    return () => {
      cancelled = true;
    };
  }, [player]);

  useEffect(() => {
    if (!player) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, onClose]);

  // 선수 보고서 링크 조회 (reports/{playerId} 문서 1개)
  useEffect(() => {
    if (!player) return;
    setReport(undefined);
    setEditingReport(false);
    setReportError(null);

    if (!isFirebaseConfigured) {
      setReport(null); // 미리보기 모드 - 조회/저장 불가
      return;
    }

    let cancelled = false;
    getDoc(doc(db, "reports", String(player.playerId)))
      .then((snap) => {
        if (cancelled) return;
        setReport(snap.exists() ? snap.data() : null);
      })
      .catch((e) => {
        if (cancelled) return;
        setReport(null);
        setReportError(e.message || "보고서를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [player]);

  const startEditReport = () => {
    setReportUrlInput(report?.url || "");
    setReportTitleInput(report?.title || "");
    setReportError(null);
    setEditingReport(true);
  };

  const cancelEditReport = () => {
    setEditingReport(false);
    setReportError(null);
  };

  const saveReport = async () => {
    const url = reportUrlInput.trim();
    if (!url) {
      setReportError("링크를 입력해주세요.");
      return;
    }
    setReportSaving(true);
    setReportError(null);
    try {
      const data = {
        url,
        title: reportTitleInput.trim() || null,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || user?.displayName || "unknown",
      };
      // 브라우저에서 바로 setDoc - GitHub Actions나 관리자 콘솔을 거치지 않고 그 자리에서 반영
      await setDoc(doc(db, "reports", String(player.playerId)), data, { merge: true });
      setReport({ ...data, updatedAt: new Date() });
      setEditingReport(false);
    } catch (e) {
      setReportError(e.message || "저장에 실패했습니다.");
    } finally {
      setReportSaving(false);
    }
  };

  if (!player) return null;

  const links = externalLinksFor(player);
  const injuries = txns ? extractInjuryHistory(txns) : null;
  const list = tab === "injuries" ? injuries : txns;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>

        <div className="modal-header">
          <img
            className="headshot modal-headshot"
            src={player.headshotUrl}
            alt=""
            onError={(e) => (e.target.style.visibility = "hidden")}
          />
          <div>
            <div className="modal-name">{player.name}</div>
            <div className="modal-sub">
              {player.teamName} · {player.level} · {formatBio(player)}
            </div>
            {player.birthDate && <div className="modal-sub">생년월일: {player.birthDate}</div>}
          </div>
        </div>

        <div className="modal-links">
          {links.map((l) => (
            <a key={l.key} className="modal-linkbtn" href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
          ))}
        </div>

        <ReportSection
          report={report}
          editing={editingReport}
          urlInput={reportUrlInput}
          titleInput={reportTitleInput}
          saving={reportSaving}
          error={reportError}
          onStartEdit={startEditReport}
          onCancelEdit={cancelEditReport}
          onUrlChange={setReportUrlInput}
          onTitleChange={setReportTitleInput}
          onSave={saveReport}
        />

        <RosterResourceTable rr={player.rosterResource} />

        <div className="subtabs modal-subtabs">
          <button className={`subtab ${tab === "transactions" ? "active" : ""}`} onClick={() => setTab("transactions")}>
            트랜잭션 이력{txns ? ` (${txns.length})` : ""}
          </button>
          <button className={`subtab ${tab === "injuries" ? "active" : ""}`} onClick={() => setTab("injuries")}>
            부상 이력{injuries ? ` (${injuries.length})` : ""}
          </button>
        </div>

        <div className="modal-body">
          {txnError && <div className="errbanner">{txnError}</div>}
          {!txnError && txns === null && <div className="loading">불러오는 중…</div>}
          {!txnError && list && list.length === 0 && (
            <div className="empty">{tab === "injuries" ? "부상자명단 이력이 없습니다." : "트랜잭션 이력이 없습니다."}</div>
          )}
          {!txnError && list && list.length > 0 && (
            <ul className="txn-list">
              {list.map((t) => (
                <li key={t.id} className="txn-item">
                  <div className="txn-date">{t.date}</div>
                  <div className="txn-desc">{t.description}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="modal-note">
          </div>
        </div>
      </div>
    </div>
  );
}

// FanGraphs RosterResource 연동 데이터 (Service Time / MiLB Options).
// 매일 동기화 시점에 sync.py가 FanGraphs 팀 뎁스차트 페이지에서 미리 읽어와 Firestore에 저장해둔 값을
// 그대로 보여준다 (여기서 실시간으로 다시 불러오지 않음) - 값이 없으면(아직 집계 전 등) 안내만 표시.
// Free Agent/Arb Eligible 예정 연도는 이 데이터 소스(팀 뎁스차트)엔 없음 - 선수 개별 페이지에만 있어서
// 필요해지면 그건 선수당 별도 요청으로 추가해야 함 (지금은 뺌).
function RosterResourceTable({ rr }) {
  if (!rr) {
    return (
      <div className="rr-table rr-empty">
        FanGraphs RosterResource 데이터가 없는 선수입니다 (아직 집계 전이거나 산하 로스터에 없음).
      </div>
    );
  }

  const cells = [
    { label: "Service Time", value: rr.serviceTime ?? "—" },
    { label: "MiLB Options", value: rr.milbOptions ?? "—" },
  ];

  return (
    <div className="rr-table">
      {cells.map((c) => (
        <div key={c.label} className="rr-cell">
          <div className="rr-label">{c.label}</div>
          <div className="rr-value">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// 선수 보고서(reports/{playerId}) 링크 표시/편집.
// - 링크가 있으면: 기존 외부 링크들과 같은 패턴으로 새 탭에서 "스카우팅 리포트 보기 ↗" 버튼.
// - 없거나 바꾸고 싶으면: 입력창에 링크를 붙여넣고 저장 - 클릭 시 브라우저에서 바로 setDoc(merge: true).
function ReportSection({
  report,
  editing,
  urlInput,
  titleInput,
  saving,
  error,
  onStartEdit,
  onCancelEdit,
  onUrlChange,
  onTitleChange,
  onSave,
}) {
  return (
    <div className="report-section">
      {report === undefined && <div className="loading" style={{ padding: "4px 0" }}>보고서 확인 중…</div>}

      {report !== undefined && !editing && (
        <div className="report-row">
          {report?.url ? (
            <a className="modal-linkbtn" href={report.url} target="_blank" rel="noopener noreferrer">
              {report.title ? `${report.title} ↗` : "스카우팅 리포트 보기 ↗"}
            </a>
          ) : (
            <span className="report-empty">등록된 스카우팅 리포트가 없습니다.</span>
          )}
          <button className="linkbtn report-editbtn" onClick={onStartEdit}>
            {report?.url ? "링크 수정" : "링크 추가"}
          </button>
        </div>
      )}

      {editing && (
        <div className="report-form">
          <input
            className="report-input"
            placeholder="보고서 링크 (Google Drive/Notion 등) URL"
            value={urlInput}
            onChange={(e) => onUrlChange(e.target.value)}
            autoFocus
          />
          <input
            className="report-input"
            placeholder="제목 (선택)"
            value={titleInput}
            onChange={(e) => onTitleChange(e.target.value)}
          />
          <div className="report-form-actions">
            <button className="linkbtn" onClick={onSave} disabled={saving}>
              {saving ? "저장 중…" : "저장"}
            </button>
            <button className="linkbtn" onClick={onCancelEdit} disabled={saving}>
              취소
            </button>
          </div>
          {report?.updatedBy && <div className="report-meta">마지막 저장: {report.updatedBy}</div>}
        </div>
      )}

      {error && <div className="errbanner report-err">{error}</div>}
    </div>
  );
}
