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
} from "lucide-react";
import { useRef, useState, type DragEvent, type PointerEvent } from "react";
import type { EditorState } from "./editor-state";
import type { ProcessResult } from "@/types/api";

export type CanvasView = "original" | "compare" | "result";

type CanvasProps = {
  state: EditorState;
  resultUrl: string | null;
  view: CanvasView;
  onViewChange: (view: CanvasView) => void;
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
  const interactionKey = `${state.previewUrl ?? "empty"}:${view}`;
  const currentInteraction = interaction.key === interactionKey
    ? interaction
    : { key: interactionKey, comparePosition: 50, pan: { x: 0, y: 0 } };
  const comparePosition = currentInteraction.comparePosition;
  const pan = currentInteraction.pan;
  const hasImage = Boolean(state.previewUrl);
  const canCompare = Boolean(state.result && resultUrl);
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
              {state.result && view !== "original"
                ? `${state.result.width} × ${state.result.height} px · ${formatBytes(state.result.size_bytes)} · Kết quả`
                : state.uploaded
                ? `${state.uploaded.width} × ${state.uploaded.height} px · ${formatBytes(state.uploaded.size_bytes)}`
                : state.file && state.previewWidth && state.previewHeight
                  ? `${state.previewWidth} × ${state.previewHeight} px · Ảnh xem trước`
                  : "Ảnh của bạn sẽ xuất hiện tại đây"}
            </span>
          </div>
        </div>
        <div className="canvas-view-switch" role="group" aria-label="Chế độ xem ảnh">
          <button
            type="button"
            className={view === "original" ? "view-button is-selected" : "view-button"}
            onClick={() => onViewChange("original")}
            disabled={!hasImage}
          >
            Gốc
          </button>
          <button
            type="button"
            className={view === "compare" ? "view-button is-selected" : "view-button"}
            onClick={() => onViewChange("compare")}
            disabled={!canCompare}
            title={canCompare ? "So sánh ảnh gốc và kết quả" : "Cần có kết quả thật để so sánh"}
          >
            <ArrowLeftRight size={14} /> So sánh
          </button>
          <button
            type="button"
            className={view === "result" ? "view-button is-selected" : "view-button"}
            onClick={() => onViewChange("result")}
            disabled={!canCompare}
            title={canCompare ? "Xem kết quả xử lý" : "Chưa có kết quả xử lý"}
          >
            Kết quả
          </button>
        </div>
      </div>

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
              {view === "result" && resultUrl ? (
                <img
                  className="canvas-image"
                  src={resultUrl}
                  alt={`Kết quả xử lý của ${state.file?.name ?? "ảnh gốc"}`}
                  draggable={false}
                  style={{ transform: imageTransform }}
                />
              ) : view === "compare" && resultUrl ? (
                <>
                  <img
                    className="canvas-image"
                    src={state.previewUrl}
                    alt="Ảnh gốc"
                    draggable={false}
                    style={{ transform: imageTransform }}
                  />
                  <div
                    className="comparison-layer"
                    style={{ clipPath: `inset(0 0 0 ${comparePosition}%)` }}
                  >
                    <img
                      className="canvas-image"
                      src={resultUrl}
                      alt="Kết quả xử lý"
                      draggable={false}
                      style={{ transform: imageTransform }}
                    />
                  </div>
                  <div className="compare-divider" style={{ left: `${comparePosition}%` }}>
                    <span aria-hidden="true"><ArrowLeftRight size={13} /></span>
                  </div>
                  <span className="compare-label compare-original">Ảnh gốc</span>
                  <span className="compare-label compare-result">Kết quả</span>
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

            <div className="image-status-pill" aria-live="polite">
              {state.uploadStatus === "uploading" ? (
                <><LoaderCircle className="spin" size={14} /> Đang tải ảnh lên…</>
              ) : state.uploadStatus === "error" ? (
                <><span className="status-dot is-warning" /> Chưa tải lên backend</>
              ) : view === "result" ? (
                <><Check size={14} /> Kết quả thật</>
              ) : (
                <><span className="status-dot" /> Ảnh gốc</>
              )}
            </div>

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
            <span>{view === "compare" ? "Kéo thanh trượt để so sánh" : view === "result" ? "Kết quả từ máy chủ" : "Bản xem trước không làm thay đổi ảnh gốc"}</span>
          ) : (
            <span>Không tải ảnh mẫu · Ảnh của bạn luôn được giữ nguyên</span>
          )}
        </div>
        {view === "compare" && canCompare && (
          <label className="compare-range-control">
            <span className="visually-hidden">Điều chỉnh vùng so sánh ảnh gốc và kết quả</span>
            <input
              type="range"
              min="5"
              max="95"
              value={comparePosition}
              onChange={(event) => setInteraction({
                ...currentInteraction,
                comparePosition: Number(event.target.value),
              })}
              aria-label="Điều chỉnh vùng so sánh ảnh gốc và kết quả"
            />
          </label>
        )}
        {canCompare && (
          <button type="button" className="download-inline" onClick={() => onDownload(state.result!)}>
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
