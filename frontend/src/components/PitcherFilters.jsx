import React from "react";

export default function PitcherFilters({ state, setState, resultCount, orgOptions }) {
  const toggleChip = (key) => {
    setState((s) => {
      const set = new Set(s.statusChips);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...s, statusChips: set };
    });
  };

  return (
    <>
      <div className="scout-header">
        <select
          className="teamselect"
          value={state.orgId ?? ""}
          onChange={(e) => setState((s) => ({ ...s, orgId: e.target.value ? Number(e.target.value) : null }))}
        >
          <option value="">전체 팀</option>
          {orgOptions.map((o) => (
            <option key={o.orgId} value={o.orgId}>{o.orgName}</option>
          ))}
        </select>

        <button
          className={`pill ${state.spEligible ? "on" : ""}`}
          onClick={() => setState((s) => ({ ...s, spEligible: !s.spEligible }))}
        >
          선발 투수 자격
        </button>
        <button
          className={`pill ${state.hideIL ? "on" : ""}`}
          onClick={() => setState((s) => ({ ...s, hideIL: !s.hideIL }))}
        >
          IL등재 제외
        </button>
        <span style={{ marginLeft: "auto", fontSize: 12 }}>{resultCount}명</span>
      </div>
      <p className="filter-note">
        * 선발 투수 자격: 올해 MLB+AAA 합산 선발 <strong>10경기 이상 등판</strong>한 투수만 표시합니다.
      </p>

      <div className="chiprow">
        <Chip label="FA" active={state.statusChips.has("FA")} onClick={() => toggleChip("FA")} />
        <Chip label="DFA" active={state.statusChips.has("DFA")} onClick={() => toggleChip("DFA")} />
        <Chip label="Released" active={state.statusChips.has("Released")} onClick={() => toggleChip("Released")} />
        <Chip label="Off-40" active={state.statusChips.has("Off-40")} onClick={() => toggleChip("Off-40")} />
        <Chip label="On-40" active={state.statusChips.has("On-40")} onClick={() => toggleChip("On-40")} />
      </div>

      <div className="sliderow">
        <span>Min {state.season} Innings (MLB+AAA 합산)</span>
        <input
          type="range"
          min="0"
          max="150"
          value={state.minInnings}
          onChange={(e) => setState((s) => ({ ...s, minInnings: Number(e.target.value) }))}
        />
        <span className="val">{state.minInnings}</span>
      </div>
    </>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button className={`chip ${active ? "on" : ""}`} onClick={onClick}>
      <span className="dot" />
      {label}
    </button>
  );
}
