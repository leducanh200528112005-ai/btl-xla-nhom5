"use client";

import {
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Download,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
  RefreshCcw,
  Upload,
  Undo2,
} from "lucide-react";
import { useRef, useState, type DragEvent, type PointerEvent } from "react";
import { getActiveVersion, versionLabel, type EditorState } from "./editor-state";
import { apiClient } from "@/services/api-client";
import { VersionHistory } from "./VersionHistory";
import { ComparisonVersionPicker } from "./ComparisonVersionPicker";
import { configsEqual, createDefaultConfig } from "./serialization";
import type { ProcessResult } from "@/types/api";

export type CanvasView = "single" | "compare";

type CanvasProps = {
  state: EditorState;
  resultUrl: string | null;
  view: CanvasView;
  onViewChange: (view: CanvasView) => void;
  onSelectVersion: (id: string | null) => void;
  onCompareVersion: (side: "left" | "right", id: string | null) => void;
  onSwapCompare: () => void;
  onUndo: () => void;
  selectionError: string | null;
  uploadError: string | null;
  downloadError: string | null;
  onChooseFile: () => void;
  onDropFile: (files: FileList) => void;
  onRetryUpload: () => void;
  onZoomChange: (zoom: number) => void;
  onRetryConnection: () => void;
  onDownload: (result: ProcessResult) => void;
};

export function Canvas({
  state,
  resultUrl,
  view,
  onViewChange,
  onSelectVersion,
  onCompareVersion,
  onSwapCompare,
  onUndo,
  selectionError,
  uploadError,
  downloadError,
  onChooseFile,
  onDropFile,
  onRetryUpload,
  onZoomChange,
  onRetryConnection,
  onDownload,
}: CanvasProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [interaction, setInteraction] = useState<{
    key: string;
    comparePosition: number;
    pan: { x: number; y: number };
  }>({ key: "", comparePosition: 50, pan: { x: 0, y: 0 } });
  const stageRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const interactionKey = `${state.previewUrl ?? "empty"}:${view}:${state.activeVersionId}`;
  const currentInteraction = interaction.key === interactionKey
    ? interaction
    : { key: interactionKey, comparePosition: 50, pan: { x: 0, y: 0 } };
  const comparePosition = currentInteraction.comparePosition;
  const pan = currentInteraction.pan;
  const hasImage = Boolean(state.previewUrl);
  const canCompare = state.versions.length > 0;
  const activeResult = getActiveVersion(state)?.result;
  const draftChanged = !configsEqual(state.config, getActiveVersion(state)?.config ?? createDefaultConfig(state.catalog ?? []));
  const imageFor = (id: string | null) => {
    const version = state.versions.find((item) => item.result.result_id === id);
    return version ? apiClient.imageUrl(version.result.url) : state.previewUrl!;
  };
  const canPan = state.zoom > 1;

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    onDropFile(event.dataTransfer.files);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canPan || !hasImage || event.button !== 0) return;
    dragOrigin.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current) return;
    const origin = dragOrigin.current;
    const stage = stageRef.current;
    const maxX = stage ? (stage.clientWidth * (state.zoom - 1)) / 2 + 120 : 600;
    const maxY = stage ? (stage.clientHeight * (state.zoom - 1)) / 2 + 120 : 600;
    setInteraction({
      ...currentInteraction,
      pan: {
        x: Math.max(-maxX, Math.min(maxX, origin.panX + event.clientX - origin.x)),
        y: Math.max(-maxY, Math.min(maxY, origin.panY + event.clientY - origin.y)),
      },
    });
  }

  function stopPanning() {
    dragOrigin.current = null;
    setIsPanning(false);
  }

  function moveDivider(clientX: number) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    setInteraction({
      ...currentInteraction,
      comparePosition: Math.max(0, Math.min(100, ((clientX - bounds.left) / bounds.width) * 100)),
    });
  }

  const imageTransform = `translate(${pan.x}px, ${pan.y}px) scale(${state.zoom})`;

  return (
    <section className="canvas-panel" aria-label="Vùng xem ảnh">
      <div className="canvas-toolbar">
        <div className="canvas-file-info">
          <span className="file-mark" aria-hidden="true">
            <FileImage size={16} />
          </span>
          <div className="file-info-copy">
            <strong>{state.file?.name ?? "Chưa có ảnh"}</strong>
            <span>
              {activeResult
                ? `${activeResult.width} × ${activeResult.height} px · ${formatBytes(activeResult.size_bytes)} · ${versionLabel(state, state.activeVersionId)}`
                : state.uploaded
                ? `${state.uploaded.width} × ${state.uploaded.height} px · ${formatBytes(state.uploaded.size_bytes)}`
                : state.file && state.previewWidth && state.previewHeight
                  ? `${state.previewWidth} × ${state.previewHeight} px · Ảnh xem trước`
                  : "Ảnh của bạn sẽ xuất hiện tại đây"}
            </span>
          </div>
        </div>
        <div className="canvas-toolbar-actions">
        <div className="canvas-view-switch" role="group" aria-label="Chế độ xem ảnh">
          <button
            type="button"
            className={view === "single" ? "view-button is-selected" : "view-button"}
            onClick={() => onViewChange("single")}
            disabled={!hasImage}
          >
            Xem một ảnh
          </button>
          <button
            type="button"
            className={view === "compare" ? "view-button is-selected" : "view-button"}
            onClick={() => onViewChange("compare")}
            disabled={!canCompare}
            title={canCompare ? "Chọn hai phiên bản để đối chiếu" : "Cần có kết quả thật để so sánh"}
          >
            <ArrowLeftRight size={14} /> So sánh
          </button>
        </div>
        <VersionHistory key={state.generation} state={state} onSelect={onSelectVersion} />
        <button type="button" className="icon-button canvas-undo" onClick={onUndo}
          disabled={state.historyIndex <= 0 || state.uploadStatus !== "uploaded" || state.processStatus === "loading" || state.adviseStatus === "loading"}
          aria-label="Hoàn tác" title="Hoàn tác thay đổi cấu hình">
          <Undo2 size={15} />
        </button>
        </div>
      </div>

      {hasImage && draftChanged && <p className="canvas-draft-note" role="status">
        Đang chỉnh: {versionLabel(state, state.activeVersionId)} · Cấu hình đã thay đổi, chưa xử lý lại.
      </p>}

      {view === "compare" && canCompare && <div className="comparison-selectors">
        {(["left", "right"] as const).map((side) => <ComparisonVersionPicker key={side}
          state={state} side={side} onSelect={(id) => onCompareVersion(side, id)} />)}
        <button type="button" className="secondary-button" onClick={onSwapCompare} aria-label="Đổi hai bên">
          <ArrowLeftRight size={14} /> Đổi bên
        </button>
        <span>Chỉ đổi ảnh đối chiếu, không đổi cấu hình hoặc ngữ cảnh AI.</span>
      </div>}

      {state.connectionStatus === "offline" && (
        <div className="canvas-notice connection-notice" role="status">
          <span>{state.connectionError?.message ?? "Chưa kết nối được máy chủ."}</span>
          <button type="button" className="text-button" onClick={onRetryConnection}>
            <RefreshCcw size={13} /> Thử kết nối lại
          </button>
        </div>
      )}
      {selectionError && (
        <div className="canvas-notice error-notice" role="alert">
          {selectionError}
        </div>
      )}
      {state.uploadStatus === "error" && uploadError && (
        <div className="canvas-notice error-notice" role="alert">
          {uploadError}
        </div>
      )}
      {downloadError && (
        <div className="canvas-notice error-notice" role="alert">
          {downloadError}
        </div>
      )}

      <div
        ref={stageRef}
        role="region"
        className={`canvas-stage${isDragging ? " is-dragging" : ""}${hasImage ? " has-image" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
        style={{ cursor: canPan ? (isPanning ? "grabbing" : "grab") : undefined }}
        aria-label={hasImage ? "Ảnh xem trước" : "Khu vực tải ảnh lên"}
      >
        {hasImage && state.previewUrl ? (
          <>
            <div className="image-viewport">
              {view === "single" && resultUrl ? (
                <img
                  className="canvas-image"
                  src={resultUrl}
                  alt={`Kết quả xử lý của ${state.file?.name ?? "ảnh gốc"}`}
                  draggable={false}
                  style={{ transform: imageTransform }}
                />
               ) : view === "compare" && canCompare ? (
                <>
                  <img
                    className="canvas-image"
                    src={imageFor(state.compareLeftId)}
                    alt={`Bên trái: ${versionLabel(state, state.compareLeftId)}`}
                    draggable={false}
                    style={{ transform: imageTransform }}
                  />
                  <div
                    className="comparison-layer"
                    style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}
                  >
                    <img
                      className="canvas-image"
                      src={imageFor(state.compareRightId)}
                      alt={`Bên phải: ${versionLabel(state, state.compareRightId)}`}
                      draggable={false}
                      style={{ transform: imageTransform }}
                    />
                  </div>
                  <div className="compare-divider" style={{ left: `${comparePosition}%` }}
                    role="slider" tabIndex={0} aria-label="Thanh phân chia ảnh"
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(comparePosition)}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      moveDivider(event.clientX);
                    }}
                    onPointerMove={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.stopPropagation();
                        moveDivider(event.clientX);
                      }
                    }}
                    onKeyDown={(event) => {
                      const delta = event.shiftKey ? 10 : 1;
                      const next = event.key === "Home" ? 0 : event.key === "End" ? 100
                        : event.key === "ArrowLeft" ? comparePosition - delta
                        : event.key === "ArrowRight" ? comparePosition + delta : null;
                      if (next === null) return;
                      event.preventDefault();
                      setInteraction({ ...currentInteraction, comparePosition: Math.max(0, Math.min(100, next)) });
                    }}>
                    <span aria-hidden="true"><ArrowLeftRight size={13} /></span>
                  </div>
                  <span className="compare-label compare-original" aria-label="Phiên bản bên trái" aria-live="polite">{versionLabel(state, state.compareLeftId)}</span>
                  <span className="compare-label compare-result" aria-label="Phiên bản bên phải" aria-live="polite">{versionLabel(state, state.compareRightId)}</span>
                </>
              ) : (
                <img
                  className="canvas-image"
                  src={state.previewUrl}
                  alt={`Ảnh gốc ${state.file?.name ?? "đã tải lên"}`}
                  draggable={false}
                  style={{ transform: imageTransform }}
                />
              )}
            </div>

            {view !== "compare" && <div className="image-status-pill" aria-live="polite">
              {state.uploadStatus === "uploading" ? (
                <><LoaderCircle className="spin" size={14} /> Đang tải ảnh lên…</>
              ) : state.uploadStatus === "error" ? (
                <><span className="status-dot is-warning" /> Chưa tải lên backend</>
              ) : activeResult ? (
                <><Check size={14} /> {versionLabel(state, state.activeVersionId)}</>
              ) : (
                <><span className="status-dot" /> Ảnh gốc</>
              )}
            </div>}

            {state.uploadStatus === "error" && (
              <button type="button" className="retry-upload" onClick={onRetryUpload}>
                <RefreshCcw size={13} /> Thử tải lại
              </button>
            )}
          </>
        ) : (
          <div className="empty-upload">
            <div className="upload-illustration" aria-hidden="true">
              <ImagePlus size={30} strokeWidth={1.55} />
              <span><Upload size={15} /></span>
            </div>
            <p className="eyebrow">KHÔI PHỤC ẢNH CŨ</p>
            <h1>Bắt đầu với bức ảnh của bạn</h1>
            <p className="empty-upload-description">
              Tải ảnh lên để xem trước và khám phá các công cụ phục hồi.
            </p>
            <button type="button" className="primary-button choose-image-button" onClick={onChooseFile}>
              <ImagePlus size={16} /> Chọn ảnh
            </button>
            <p className="file-guidance">JPG hoặc PNG <span>·</span> Tối đa 10 MB</p>
            <div className="drop-hint"><ArrowUpRight size={13} /> Hoặc kéo thả ảnh vào vùng này</div>
          </div>
        )}

        {isDragging && (
          <div className="drop-overlay" aria-live="polite">
            <Upload size={28} />
            <strong>Thả ảnh để tải lên</strong>
            <span>Chỉ nhận một ảnh JPG hoặc PNG</span>
          </div>
        )}
      </div>

      <div className="canvas-bottomline">
        <div className="canvas-caption">
          {hasImage ? (
            <span>{view === "compare" ? "Kéo thanh trượt để so sánh" : activeResult ? "Kết quả đã lưu · Chỉnh thông số rồi xử lý để tạo phiên bản mới" : "Bản xem trước không làm thay đổi ảnh gốc"}</span>
          ) : (
            <span>Không tải ảnh mẫu · Ảnh của bạn luôn được giữ nguyên</span>
          )}
        </div>
        {view === "compare" && canCompare && (
          <label className="compare-range-control">
            <span className="visually-hidden">Điều chỉnh vùng so sánh trái phải</span>
            <input
              type="range"
              min="0"
              max="100"
              value={comparePosition}
              onChange={(event) => setInteraction({
                ...currentInteraction,
                comparePosition: Number(event.target.value),
              })}
              aria-label="Điều chỉnh vùng so sánh trái phải"
            />
          </label>
        )}
        {activeResult && (
          <button type="button" className="download-inline" onClick={() => onDownload(activeResult)}>
            <Download size={14} /> Tải kết quả
          </button>
        )}
      </div>


      <div className="canvas-zoom-controls" role="group" aria-label="Điều khiển thu phóng">
        <button
          type="button"
          className="icon-button"
          onClick={() => onZoomChange(state.zoom - 0.1)}
          disabled={!hasImage || state.zoom <= 0.25}
          aria-label="Thu nhỏ"
          title="Thu nhỏ"
        ><Minus size={15} /></button>
        <span className="zoom-value">{Math.round(state.zoom * 100)}%</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => onZoomChange(state.zoom + 0.1)}
          disabled={!hasImage || state.zoom >= 3}
          aria-label="Phóng to"
          title="Phóng to"
        ><Plus size={15} /></button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="fit-button"
          onClick={() => {
            setInteraction({ ...currentInteraction, pan: { x: 0, y: 0 } });
            onZoomChange(1);
          }}
          disabled={!hasImage}
          title="Vừa khung"
        ><Maximize2 size={14} /> Vừa khung</button>
      </div>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
