"use client";

import { apiClient } from "@/services/api-client";
import { versionLabel, type EditorState } from "./editor-state";

export function VersionGallery({ state, selectedId, onSelect, editing = false, disabled = false }: {
  state: EditorState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  editing?: boolean;
  disabled?: boolean;
}) {
  return <div className="version-list">
    <button type="button" className="version-card"
      aria-label={editing ? "Chỉnh từ ảnh gốc" : "Chọn ảnh gốc"}
      aria-pressed={selectedId === null} disabled={disabled} onClick={() => onSelect(null)}>
      <img src={state.previewUrl!} alt="" />
      <strong>Ảnh gốc</strong><span>Tất cả công cụ tắt</span>
    </button>
    {state.versions.map((version) => {
      const label = versionLabel(state, version.result.result_id);
      return <div className="version-item" key={version.result.result_id}>
        <button type="button" className="version-card"
          aria-label={`${editing ? "Chỉnh tiếp" : "Chọn"} ${label}`}
          aria-pressed={selectedId === version.result.result_id}
          disabled={disabled} onClick={() => onSelect(version.result.result_id)}>
          <img src={apiClient.imageUrl(version.result.url)} alt="" loading="lazy" />
          <strong>{label}</strong>
          <span>{new Date(version.createdAt).toLocaleTimeString("vi-VN")} · {version.source === "ai" ? "AI" : "Thủ công"}</span>
          <span>{version.steps.map((step) => state.catalog?.find((item) => item.id === step.algorithm)?.name ?? step.algorithm).join(" · ")}</span>
        </button>
        <details className="version-config"><summary>Cấu hình {label}</summary>
          <ul>{version.steps.map((step) => <li key={step.algorithm}>
            <strong>{state.catalog?.find((item) => item.id === step.algorithm)?.name ?? step.algorithm}</strong>
            <span>{Object.entries(step.params).map(([key, value]) => `${key}: ${value}`).join(" · ")}</span>
          </li>)}</ul>
        </details>
      </div>;
    })}
  </div>;
}
