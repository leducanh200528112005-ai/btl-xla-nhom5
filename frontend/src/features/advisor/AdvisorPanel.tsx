"use client";

import { ArrowUp, Bot, Check, Info, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AdviceProposal, ProcessingStep } from "@/types/api";
import { getActiveVersion, versionLabel, type ChatEntry, type EditorState, type ResultSnapshot } from "@/features/editor/editor-state";
import { configMatchesProposal, configsEqual, createDefaultConfig } from "@/features/editor/serialization";
import { apiClient } from "@/services/api-client";

type AdvisorPanelProps = {
  state: EditorState;
  busy: boolean;
  onAdvise: (prompt: string) => void;
  onApplyProposal: (proposal: AdviceProposal) => string | null;
  onProcess: () => void;
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
    <strong>{snapshot.source === "ai" ? "Đã xử lý theo đề xuất AI" : "Bạn đã tự điều chỉnh và xử lý ảnh"} - {versionLabel(state, snapshot.result.result_id)}</strong>
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

function NoticeMessage({ entry }: { entry: Extract<ChatEntry, { kind: "notice" }> }) {
  const label = entry.decision === "answer"
    ? "Trả lời về ảnh"
    : entry.decision === "unsupported"
      ? "Chưa hỗ trợ thao tác này"
      : "Ngoài phạm vi";
  return <div className={`advisor-notice advisor-notice-${entry.decision}`}>
    <p className="advisor-notice-label"><Info size={13} /> {label}</p>
    <p className="advisor-notice-text">{entry.text}</p>
  </div>;
}

function stepsMatchProposal(steps: ProcessingStep[], proposal: AdviceProposal): boolean {
  if (steps.length !== proposal.steps.length) return false;
  return proposal.steps.every((proposed, index) => {
    const step = steps[index];
    return step.algorithm === proposed.algorithm &&
      Object.keys(step.params).length === Object.keys(proposed.params).length &&
      Object.entries(step.params).every(([key, value]) => proposed.params[key] === value);
  });
}

function ProposalMessage({ proposal, state, busy, onApplyProposal, onProcess, versionId }: {
  proposal: AdviceProposal; state: EditorState; busy: boolean;
  versionId: string | null;
  onApplyProposal: AdvisorPanelProps["onApplyProposal"];
  onProcess: AdvisorPanelProps["onProcess"];
}) {
  const [applyError, setApplyError] = useState<string | null>(null);
  const matches = Boolean(state.catalog && configMatchesProposal(state.config, state.catalog, proposal));
  const canApply = state.connectionStatus === "ready" && Boolean(state.uploaded && state.catalog);
  const sameVersion = versionId === state.activeVersionId;
  const hasSteps = proposal.steps.length > 0;
  const processing = state.processStatus === "loading";
  const processedVersion = matches
    ? state.versions.find((version) => stepsMatchProposal(version.steps, proposal)) ?? null
    : null;
  const matchedLabel = processedVersion
    ? `Đã xử lý · ${versionLabel(state, processedVersion.result.result_id)}`
    : hasSteps ? "Đã khớp đề xuất · Xử lý ảnh" : "Đã khớp đề xuất";
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
      disabled={matches ? (!canApply || busy || !hasSteps || Boolean(processedVersion)) : (busy || !canApply || !sameVersion || !hasSteps)}
      onClick={() => {
        if (matches) { onProcess(); return; }
        setApplyError(onApplyProposal(proposal));
      }}>
      {matches
        ? processedVersion
          ? <><Check size={14} /> {matchedLabel}</>
          : processing
            ? <><LoaderCircle className="spin" size={14} /> Đang xử lý ảnh…</>
            : <><Check size={14} /> {matchedLabel}</>
        : <><Check size={14} /> Áp dụng cấu hình</>}
    </button>
    <p className="proposal-match-status" role="status">
      {matches
        ? !hasSteps
          ? "Đề xuất không cần bật công cụ nào nên không có gì để xử lý."
          : processedVersion
            ? `Cấu hình này đã tạo ${versionLabel(state, processedVersion.result.result_id)}. Chọn phiên bản đó để xem hoặc chỉnh tiếp.`
            : processing ? "Đang gửi yêu cầu xử lý tới máy chủ…"
            : "Cấu hình đang khớp đề xuất. Nhấn Xử lý ảnh để tạo phiên bản ngay tại đây."
        : !hasSteps ? "Đề xuất không có bước nào để áp dụng."
        : !sameVersion ? `Chọn ${versionLabel(state, versionId)} trong danh sách để áp dụng đề xuất này.`
        : "Áp dụng để thay cấu hình hiện tại. Ảnh chưa tự thay đổi."}
    </p>
  </div>;
}

export function AdvisorPanel({ state, busy, onAdvise, onApplyProposal, onProcess }: AdvisorPanelProps) {
  const [prompt, setPrompt] = useState("");
  const scrollArea = useRef<HTMLDivElement>(null);
  const hasUpload = state.connectionStatus === "ready" && Boolean(state.catalog?.length && state.uploaded);
  const canSubmit = hasUpload && prompt.trim().length > 0 && !busy;
  const activeVersion = getActiveVersion(state);
  const isDraftChanged = !configsEqual(state.config, activeVersion?.config ?? createDefaultConfig(state.catalog ?? []));
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [state.chat, state.adviseStatus, state.activeTab]);

  function submit() {
    if (!canSubmit) return;
    onAdvise(prompt.trim());
    setPrompt("");
  }

  return <div className="advisor-panel chat-panel">
    <div className="advisor-scroll-area chat-timeline" ref={scrollArea} aria-label="Lịch sử hội thoại">
      {!state.chat.length && <div className="advisor-explainer">
        <div className="advisor-explainer-icon"><Bot size={18} /></div>
        <div><strong>Bắt đầu với mục tiêu của bạn</strong>
          <p>AI xem ảnh gốc, phiên bản đang chỉnh và cấu hình đang chọn. Bạn có thể hỏi về ảnh hoặc mô tả điều muốn chỉnh sửa. Hai ảnh đối chiếu không thay đổi ngữ cảnh AI. Đổi ảnh gốc sẽ bắt đầu hội thoại mới.</p>
        </div>
      </div>}
      {state.chat.map((entry) => <article key={entry.id} className={`chat-entry chat-entry-${entry.kind}`}>
        {entry.kind === "user" && <>
          <span className="chat-speaker">Bạn</span>
          <small>Ngữ cảnh: {versionLabel(state, entry.versionId ?? null)}</small>
          <p className="chat-user-text">{entry.text}</p>
          {entry.status === "loading" && <p role="status"><LoaderCircle className="spin" size={14} /> AI đang phân tích…</p>}
          {entry.status === "error" && <div className="advisor-error">
            <p role="alert">{entry.error}</p>
            <button type="button" className="secondary-button" disabled={!hasUpload || busy || (entry.versionId ?? null) !== state.activeVersionId}
              onClick={() => onAdvise(entry.text)}>Thử gửi lại</button>
          </div>}
        </>}
        {entry.kind === "assistant" && <>
          <span className="chat-speaker">AI tư vấn</span>
          <small>Ngữ cảnh: {versionLabel(state, entry.versionId ?? null)}</small>
          <ProposalMessage proposal={entry.proposal} state={state} busy={busy} onApplyProposal={onApplyProposal}
            onProcess={onProcess} versionId={entry.versionId ?? null} />
        </>}
        {entry.kind === "notice" && <>
          <span className="chat-speaker">AI tư vấn</span>
          <small>Ngữ cảnh: {versionLabel(state, entry.versionId ?? null)}</small>
          <NoticeMessage entry={entry} />
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

    <div className="chat-composer">
      <div className="chat-input-box">
      <label className="visually-hidden" htmlFor="advisor-prompt">Bạn muốn cải thiện điều gì?</label>
      <textarea id="advisor-prompt" className="advisor-prompt" maxLength={2000} rows={2}
        value={prompt} onChange={(event) => setPrompt(event.target.value)}
        placeholder={hasUpload ? "Bạn muốn cải thiện điều gì?" : "Tải ảnh lên để bắt đầu tư vấn…"}
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }} />
      <div className="chat-input-toolbar">
        <span className="chat-input-context" role="status"
          title={hasUpload
            ? `Đang tư vấn cho: ${versionLabel(state, state.activeVersionId)}${isDraftChanged ? " · Cấu hình đã thay đổi, chưa xử lý lại. Ảnh đang xem chưa phản ánh thay đổi này." : ""}`
            : "Tải ảnh lên backend trước khi yêu cầu tư vấn."}>
          {versionLabel(state, state.activeVersionId)}{isDraftChanged && <span className="draft-context-mark" aria-label="Cấu hình chưa xử lý">*</span>}
          <span className="visually-hidden">{isDraftChanged ? "Cấu hình đã thay đổi, chưa xử lý lại. Ảnh đang xem chưa phản ánh thay đổi này." : ""}</span>
        </span>
        {prompt.length > 0 && <span className="chat-input-counter">{prompt.length}/2000</span>}
        <button type="button" className="primary-button advisor-submit" disabled={!canSubmit} onClick={submit}
          aria-label={state.adviseStatus === "loading" ? "Đang phân tích…" : "Gửi yêu cầu"}
          title="Gửi yêu cầu (Ctrl + Enter)">
        {state.adviseStatus === "loading" ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={16} />}
      </button>
      </div>
      </div>
    </div>
  </div>;
}
