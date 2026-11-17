"use client";

import { Bot, Check, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AdviceResponse, ProcessingStep } from "@/types/api";
import type { EditorState, ResultSnapshot } from "@/features/editor/editor-state";
import { configMatchesProposal } from "@/features/editor/serialization";
import { apiClient } from "@/services/api-client";

type AdvisorPanelProps = {
  state: EditorState;
  busy: boolean;
  onAdvise: (prompt: string) => void;
  onApplyProposal: (proposal: AdviceResponse) => string | null;
};

function StepSummary({ steps, state }: { steps: ProcessingStep[]; state: EditorState }) {
  return <ul className="chat-config-summary">
    {steps.map((step) => <li key={step.algorithm}>
      <strong>{state.catalog?.find((item) => item.id === step.algorithm)?.name ?? step.algorithm}</strong>
      <span>{Object.entries(step.params).map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>
    </li>)}
    {!steps.length && <li>Tất cả công cụ đang tắt.</li>}
  </ul>;
}

function ResultMessage({ snapshot, state }: { snapshot: ResultSnapshot; state: EditorState }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <div className="chat-result">
    <strong>{snapshot.source === "ai" ? "Đã xử lý theo đề xuất AI" : "Bạn đã tự điều chỉnh và xử lý ảnh"}</strong>
    <p>{snapshot.result.width} × {snapshot.result.height} px · Chạy từ ảnh gốc</p>
    {!imageFailed ? <a href={apiClient.imageUrl(snapshot.result.url)} target="_blank" rel="noreferrer">
      <img src={apiClient.imageUrl(snapshot.result.url)} alt={`Phiên bản đã xử lý ${snapshot.result.filename}`}
        loading="lazy" onError={() => setImageFailed(true)} />
    </a> : <p>Ảnh phiên bản không còn truy cập được hoặc đã hết hạn.</p>}
    <details>
      <summary>Cấu hình đã tạo phiên bản này</summary>
      <StepSummary steps={snapshot.steps} state={state} />
    </details>
  </div>;
}

function ProposalMessage({ proposal, state, busy, onApplyProposal }: {
  proposal: AdviceResponse; state: EditorState; busy: boolean;
  onApplyProposal: AdvisorPanelProps["onApplyProposal"];
}) {
  const [applyError, setApplyError] = useState<string | null>(null);
  const matches = Boolean(state.catalog && configMatchesProposal(state.config, state.catalog, proposal));
  const canApply = state.connectionStatus === "ready" && Boolean(state.uploaded && state.catalog);
  return <div className="proposal-card">
    <div className="proposal-title"><Sparkles size={15} /><h3>Phân tích và đề xuất</h3></div>
    <p className="proposal-analysis">{proposal.analysis}</p>
    {proposal.steps.length ? <ol className="proposal-steps">
      {proposal.steps.map((step, index) => <li key={`${step.algorithm}-${index}`}>
        <div className="proposal-step-heading">
          <span className="proposal-step-number">{index + 1}</span>
          <strong>{state.catalog?.find((item) => item.id === step.algorithm)?.name ?? step.algorithm}</strong>
        </div>
        <p>{step.reason}</p>
        <p>{Object.entries(step.params).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>
      </li>)}
    </ol> : <p className="proposal-no-steps">Không cần bật công cụ nào theo đề xuất này.</p>}
    {applyError && <p role="alert" className="advisor-error">{applyError}</p>}
    <button type="button" className={`primary-button apply-proposal${matches ? " is-matched" : ""}`}
      disabled={matches || busy || !canApply}
      onClick={() => setApplyError(onApplyProposal(proposal))}>
      <Check size={14} /> {matches ? "Đã khớp đề xuất" : "Áp dụng cấu hình"}
    </button>
    <p className="proposal-match-status" role="status">
      {matches ? "Cấu hình đang khớp đề xuất. Nhấn Xử lý ảnh để xem kết quả."
        : "Áp dụng để thay cấu hình hiện tại. Ảnh chưa tự thay đổi."}
    </p>
  </div>;
}

export function AdvisorPanel({ state, busy, onAdvise, onApplyProposal }: AdvisorPanelProps) {
  const [prompt, setPrompt] = useState("");
  const scrollArea = useRef<HTMLDivElement>(null);
  const hasUpload = state.connectionStatus === "ready" && Boolean(state.catalog?.length && state.uploaded);
  const canSubmit = hasUpload && prompt.trim().length > 0 && !busy;
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [state.chat, state.adviseStatus, state.activeTab]);

  function submit() {
    if (!canSubmit) return;
    onAdvise(prompt.trim());
    setPrompt("");
  }

  return <div className="advisor-panel chat-panel">
    <div className="sidebar-intro advisor-intro">
      <div className="sidebar-title-row">
        <span className="sidebar-heading-icon advisor-heading-icon"><Bot size={16} /></span>
        <div><h2>AI tư vấn</h2><p>Cùng chỉnh ảnh qua từng lượt trao đổi</p></div>
      </div>
      <span className="small-status-label">HỘI THOẠI</span>
    </div>

    <div className="advisor-scroll-area chat-timeline" ref={scrollArea} aria-label="Lịch sử chỉnh ảnh">
      {!state.chat.length && <div className="advisor-explainer">
        <div className="advisor-explainer-icon"><Bot size={18} /></div>
        <div><strong>Bắt đầu với mục tiêu của bạn</strong>
          <p>AI xem ảnh gốc và kết quả gần nhất. Các lần bạn tự chỉnh và xử lý cũng được ghi nhận tại đây. Đổi ảnh sẽ bắt đầu hội thoại mới.</p>
        </div>
      </div>}
      {state.chat.map((entry) => <article key={entry.id} className={`chat-entry chat-entry-${entry.kind}`}>
        {entry.kind === "user" && <>
          <span className="chat-speaker">Bạn</span>
          <p className="chat-user-text">{entry.text}</p>
          {entry.status === "loading" && <p role="status"><LoaderCircle className="spin" size={14} /> AI đang phân tích…</p>}
          {entry.status === "error" && <div className="advisor-error">
            <p role="alert">{entry.error}</p>
            <button type="button" className="secondary-button" disabled={!hasUpload || busy}
              onClick={() => onAdvise(entry.text)}>Thử gửi lại</button>
          </div>}
        </>}
        {entry.kind === "assistant" && <>
          <span className="chat-speaker">AI tư vấn</span>
          <ProposalMessage proposal={entry.proposal} state={state} busy={busy} onApplyProposal={onApplyProposal} />
        </>}
        {entry.kind === "applied" && <>
          <p className="chat-event-label"><Check size={14} /> Đã áp dụng đề xuất vào cấu hình · Chưa xử lý ảnh</p>
          <details><summary>Xem cấu hình đã áp dụng</summary><StepSummary steps={entry.steps} state={state} /></details>
        </>}
        {entry.kind === "processed" && <ResultMessage snapshot={entry} state={state} />}
      </article>)}
      {state.adviseError && !state.chat.some((entry) => entry.kind === "user" && entry.error === state.adviseError?.message) &&
        <p className="advisor-error" role="alert">{state.adviseError.message}</p>}
      {state.processError && <p className="advisor-error" role="alert">Chưa tạo phiên bản mới: {state.processError.message}</p>}
    </div>

    <div className="sidebar-actions advisor-actions chat-composer">
      <p className="no-preview-note">
        {state.latestResult ? "AI sẽ xem ảnh gốc, kết quả gần nhất và cấu hình đang chọn."
          : "AI sẽ xem ảnh gốc và cấu hình đang chọn."}
      </p>
      <label className="advisor-prompt-label" htmlFor="advisor-prompt">Bạn muốn cải thiện điều gì?</label>
      <textarea id="advisor-prompt" className="advisor-prompt" maxLength={2000} rows={3}
        value={prompt} onChange={(event) => setPrompt(event.target.value)}
        placeholder="Ví dụ: Da hơi bệt, giảm khử nhiễu và giữ nét tóc…"
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }} />
      <div className="prompt-footline"><span>Ctrl + Enter để gửi</span><span>{prompt.length} / 2.000</span></div>
      {!hasUpload && <p className="advisor-requirement">Tải ảnh lên backend trước khi yêu cầu tư vấn.</p>}
      <button type="button" className="primary-button advisor-submit" disabled={!canSubmit} onClick={submit}>
        {state.adviseStatus === "loading" ? <LoaderCircle className="spin" size={15} /> : <Send size={14} />}
        {state.adviseStatus === "loading" ? "Đang phân tích…" : "Gửi yêu cầu"}
      </button>
      <p className="no-preview-note">Lịch sử trong phiên này · AI nhận tối đa 20 sự kiện gần nhất.</p>
    </div>
  </div>;
}
