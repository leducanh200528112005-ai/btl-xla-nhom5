"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Contrast,
  Droplets,
  Expand,
  LoaderCircle,
  Palette,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { AlgorithmDescriptor, ParameterDescriptor, ToolId } from "@/types/api";
import {
  configsEqual,
  createDefaultConfig,
  TOOL_DISPLAY_ORDER,
  TOOL_ORDER,
  TOOL_PRESENTATION,
} from "@/features/editor/serialization";
import type { EditorAction, EditorState } from "@/features/editor/editor-state";

const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  scratches: ScanLine,
  denoise: Waves,
  yellowing: Droplets,
  brightness: Sun,
  contrast: Contrast,
  colorize: Palette,
  sharpen: Sparkles,
  upscale: Expand,
};

type ToolsPanelProps = {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  busy: boolean;
  onProcess: () => void;
};

export function ToolsPanel({ state, dispatch, busy, onProcess }: ToolsPanelProps) {
  const [expandedTool, setExpandedTool] = useState<ToolId | null>("denoise");
  const catalog = state.catalog ?? [];
  const canEdit =
    state.connectionStatus === "ready" &&
    catalog.length > 0 &&
    state.uploadStatus === "uploaded" &&
    Boolean(state.uploaded);
  const hasEnabledTool = TOOL_ORDER.some((toolId) => state.config.enabled[toolId]);
  const hasChanges = catalog.length > 0 && !configsEqual(state.config, createDefaultConfig(catalog));
  const canReset = catalog.length > 0 && hasChanges;
  const canProcess = canEdit && hasEnabledTool && !busy;

  return (
    <div className="tools-panel">
      <div className="sidebar-intro">
        <div className="sidebar-title-row">
          <span className="sidebar-heading-icon"><SlidersHorizontal size={16} /></span>
          <div>
            <h2>Công cụ phục hồi</h2>
            <p>Chọn tác vụ và tinh chỉnh tham số</p>
          </div>
        </div>
        <span className="small-status-label">XỬ LÝ ẢNH TRÊN MÁY CHỦ</span>
      </div>

      {state.connectionStatus === "offline" && (
        <div className="sidebar-inline-notice" role="status">
          <span>{state.connectionError?.message ?? "Không tải được danh mục."}</span>
        </div>
      )}
      {state.connectionStatus === "checking" && (
        <div className="catalog-loading"><LoaderCircle size={14} className="spin" /> Đang tải danh mục từ máy chủ…</div>
      )}

      <div className="tools-scroll-area">
        <div className="tool-list">
          {TOOL_DISPLAY_ORDER.map((toolId, index) => {
            const Icon = TOOL_ICONS[toolId];
            const algorithms = catalog.filter((item) => item.tool_id === toolId);
            const expanded = expandedTool === toolId;
            const enabled = state.config.enabled[toolId];
            return (
              <section className={`tool-card${expanded ? " is-expanded" : ""}`} key={toolId}>
                <div className="tool-card-header">
                  <button
                    type="button"
                    className="tool-expand-button"
                    aria-expanded={expanded}
                    aria-controls={`tool-settings-${toolId}`}
                    onClick={() => setExpandedTool(expanded ? null : toolId)}
                  >
                    <span className="tool-icon"><Icon size={17} strokeWidth={1.8} /></span>
                    <span className="tool-title-block">
                      <strong>{TOOL_PRESENTATION[toolId].label}</strong>
                      <small>{algorithms.length ? `${algorithms.length} phương pháp` : "Đang chờ danh mục"}</small>
                    </span>
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <button
                    className={`switch${enabled ? " is-on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? "Tắt" : "Bật"} ${TOOL_PRESENTATION[toolId].label}`}
                    disabled={!canEdit || busy}
                    onClick={() => dispatch({ type: "SET_ENABLED", toolId, enabled: !enabled })}
                  ><span /></button>
                </div>

                <div className="tool-card-content" id={`tool-settings-${toolId}`} hidden={!expanded}>
                    {algorithms.length > 0 ? (
                      <ToolSettings
                        toolId={toolId}
                        algorithms={algorithms}
                        state={state}
                        dispatch={dispatch}
                        canEdit={canEdit && !busy}
                      />
                    ) : (
                      <p className="catalog-empty-copy">
                        {state.connectionStatus === "checking"
                          ? "Đang chờ danh mục cấu hình từ backend."
                          : "Chưa có cấu hình tham số từ backend."}
                      </p>
                    )}
                    {algorithms.length > 0 && (
                      <div className="implementation-note">
                        <span className="implementation-dot" /> {algorithms.some((item) => item.implementation_status === "implemented") ? "Đã triển khai" : "Chưa triển khai"}
                      </div>
                    )}
                </div>
                {index < TOOL_DISPLAY_ORDER.length - 1 && <span className="tool-row-divider" />}
              </section>
            );
          })}
        </div>
        {!canEdit && state.connectionStatus !== "offline" && (
          <div className="locked-hint">
            <span className="locked-hint-mark">i</span>
            <span>Tải ảnh lên backend để mở các điều khiển.</span>
          </div>
        )}
      </div>

      <div className="sidebar-actions">
        <p className="no-preview-note">Thay đổi thông số không làm biến đổi ảnh xem trước.</p>
        {state.processStatus === "loading" && (
          <div className="request-message" role="status" aria-live="polite">
            <LoaderCircle size={14} className="spin" /> Đang gửi yêu cầu xử lý…
          </div>
        )}
        {(state.processStatus === "error" || state.processStatus === "not_implemented") && state.processError && (
          <div className="request-message request-error" role="alert">
            {state.processError.message}
          </div>
        )}
        {state.processStatus === "succeeded" && (
          <div className="request-message request-success" role="status">
            <Check size={14} /> Máy chủ đã trả về kết quả.
          </div>
        )}
        <div className="sidebar-action-row">
          <button
            type="button"
            className="secondary-button reset-button"
            disabled={!canReset || busy}
            onClick={() => dispatch({ type: "RESET_CONFIG" })}
            title="Đặt thông số về mặc định trong danh mục"
          ><RotateCcw size={14} /> Đặt lại</button>
          <button
            type="button"
            className="primary-button process-button"
            disabled={!canProcess}
            onClick={onProcess}
            title={!canEdit ? "Cần tải ảnh lên backend" : !hasEnabledTool ? "Bật ít nhất một công cụ" : undefined}
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
            {state.processStatus === "loading" ? "Đang xử lý…" : "Xử lý ảnh"}
          </button>
        </div>
        <p className="stub-footnote">Đã hỗ trợ giảm ố vàng, tô màu và phóng ảnh. Các công cụ khác đang được hoàn thiện.</p>
      </div>
    </div>
  );
}

function ToolSettings({
  toolId,
  algorithms,
  state,
  dispatch,
  canEdit,
}: {
  toolId: ToolId;
  algorithms: AlgorithmDescriptor[];
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  canEdit: boolean;
}) {
  const selectedId = state.config.selectedAlgorithms[toolId];
  const selected = algorithms.find((algorithm) => algorithm.id === selectedId) ?? algorithms[0];

  return (
    <div className="tool-settings">
      {algorithms.length > 1 && (
        <label className="control-label algorithm-select-label">
          Phương pháp
          <select
            value={selected.id}
            disabled={!canEdit}
            onChange={(event) => dispatch({ type: "SELECT_ALGORITHM", toolId, algorithmId: event.target.value })}
          >
            {algorithms.map((algorithm) => (
              <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>
            ))}
          </select>
        </label>
      )}
      {selected.description && <p className="algorithm-description">{selected.description}</p>}
      {selected.params.length > 0 ? (
        <div className="parameter-list">
          {selected.params.map((parameter) => (
            <ParameterControl
              key={`${selected.id}-${parameter.key}`}
                algorithm={selected}
                parameter={parameter}
                value={state.config.params[selected.id]?.[parameter.key] ?? parameter.default}
                syncVersion={state.draftSyncVersion}
                dispatch={dispatch}
                disabled={!canEdit}
            />
          ))}
        </div>
      ) : (
        <p className="catalog-empty-copy">Thuật toán này không có tham số điều chỉnh.</p>
      )}
    </div>
  );
}

function ParameterControl({
  algorithm,
  parameter,
  value,
  syncVersion,
  dispatch,
  disabled,
}: {
  algorithm: AlgorithmDescriptor;
  parameter: ParameterDescriptor;
  value: number;
  syncVersion: number;
  dispatch: React.Dispatch<EditorAction>;
  disabled: boolean;
}) {
  const [storedDraft, setStoredDraft] = useState(() => createParameterDraft(value, syncVersion));
  const draft =
    storedDraft.sourceValue === value && storedDraft.syncVersion === syncVersion
      ? storedDraft
      : createParameterDraft(value, syncVersion);

  function updateDraft(update: Partial<ParameterDraft>) {
    setStoredDraft((current) => {
      const currentDraft =
        current.sourceValue === value && current.syncVersion === syncVersion
          ? current
          : createParameterDraft(value, syncVersion);
      return { ...currentDraft, ...update };
    });
  }

  function commitNumber() {
    const trimmed = draft.numberText.trim();
    const next = trimmed === "" ? Number.NaN : Number(trimmed);
    if (
      !Number.isFinite(next) ||
      (parameter.integer && !Number.isInteger(next)) ||
      (parameter.min !== null && next < parameter.min) ||
      (parameter.max !== null && next > parameter.max)
    ) {
      setStoredDraft(createParameterDraft(value, syncVersion));
      return;
    }
    setStoredDraft(createParameterDraft(value, syncVersion));
    dispatch({ type: "SET_PARAM", algorithmId: algorithm.id, key: parameter.key, value: next });
  }

  function commitRange() {
    if (draft.rangeValue === null) return;
    const next = draft.rangeValue;
    setStoredDraft(createParameterDraft(value, syncVersion));
    dispatch({ type: "SET_PARAM", algorithmId: algorithm.id, key: parameter.key, value: next });
  }

  function handleNumberKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitNumber();
      event.currentTarget.blur();
    }
  }

  if (parameter.kind === "select") {
    return (
      <label className="control-label parameter-select-label">
        <span className="parameter-label-line">
          <span>{parameter.label}</span>
          <span className="parameter-current-value">{formatOption(parameter, value)}</span>
        </span>
        <select
          value={value}
          disabled={disabled}
          aria-label={parameter.label}
          onChange={(event) => dispatch({
            type: "SET_PARAM",
            algorithmId: algorithm.id,
            key: parameter.key,
            value: Number(event.target.value),
          })}
        >
          {parameter.options.map((option) => (
            <option key={option.value} value={option.value}>{formatOption(parameter, option.value, option.label)}</option>
          ))}
        </select>
        {parameter.description && <small>{parameter.description}</small>}
      </label>
    );
  }

  const min = parameter.min ?? 0;
  const max = parameter.max ?? 1;
  const step = parameter.step ?? 1;

  return (
    <div className="parameter-control">
      <div className="parameter-label-line">
        <label htmlFor={`${algorithm.id}-${parameter.key}`} className="control-label-text">
          {parameter.label}
        </label>
        <input
          id={`${algorithm.id}-${parameter.key}`}
          className="number-input"
          type="number"
          inputMode="decimal"
          min={parameter.min ?? undefined}
          max={parameter.max ?? undefined}
          step={parameter.step ?? undefined}
          value={draft.numberText}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraft({
            numberText: event.target.value,
            rangeValue: null,
          })}
          onBlur={commitNumber}
          onKeyDown={handleNumberKey}
          aria-label={`${parameter.label}, giá trị số`}
        />
      </div>
      <input
        className="parameter-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft.rangeValue ?? value}
        disabled={disabled}
        aria-label={`${parameter.label}, thanh điều chỉnh`}
        onChange={(event) => {
          const next = Number(event.target.value);
          updateDraft({ rangeValue: next, numberText: formatInputNumber(next) });
        }}
        onPointerUp={commitRange}
        onPointerCancel={commitRange}
        onKeyUp={commitRange}
        onBlur={commitRange}
      />
      {parameter.description && <small className="parameter-description">{parameter.description}</small>}
      {parameter.key === "gamma" && (
        <small className="parameter-description parameter-contract-note">Gamma lớn hơn 1 làm ảnh sáng hơn.</small>
      )}
      {parameter.key === "tile_grid_size" && (
        <small className="parameter-description parameter-contract-note">Số ô trên mỗi chiều của lưới vuông.</small>
      )}
    </div>
  );
}

type ParameterDraft = {
  sourceValue: number;
  syncVersion: number;
  numberText: string;
  rangeValue: number | null;
};

function createParameterDraft(value: number, syncVersion: number): ParameterDraft {
  return {
    sourceValue: value,
    syncVersion,
    numberText: String(value),
    rangeValue: null,
  };
}

function formatInputNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function formatOption(parameter: ParameterDescriptor, value: number, fallback?: string): string {
  if (parameter.key === "scale") return `${value}×`;
  return fallback ?? parameter.options.find((option) => option.value === value)?.label ?? String(value);
}
