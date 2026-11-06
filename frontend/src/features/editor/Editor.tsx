"use client";

import {
  Check,
  Download,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { AdvisorPanel } from "@/features/advisor/AdvisorPanel";
import { Canvas, type CanvasView } from "@/features/editor/Canvas";
import {
  editorReducer,
  initialEditorState,
} from "@/features/editor/editor-state";
import {
  cloneConfig,
  SerializationError,
  serializeSteps,
} from "@/features/editor/serialization";
import { ToolsPanel } from "@/features/tools/ToolsPanel";
import { validateAndDecodeImage } from "@/lib/image-validation";
import { ApiError, apiClient } from "@/services/api-client";
import type { AdviceResponse } from "@/types/api";

type Operation = "connection" | "upload" | "process" | "advise" | "download";

export function Editor() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [view, setView] = useState<CanvasView>("original");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationRef = useRef(0);
  const validationToken = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const renderedPreviewUrl = useRef<string | null>(null);
  const requests = useRef<Partial<Record<Operation, AbortController>>>({});

  const abortOperation = useCallback((operation: Operation) => {
    requests.current[operation]?.abort();
    delete requests.current[operation];
  }, []);

  const abortImageRequests = useCallback(() => {
    abortOperation("upload");
    abortOperation("process");
    abortOperation("advise");
    abortOperation("download");
  }, [abortOperation]);

  const connectToBackend = useCallback(async () => {
    abortOperation("connection");
    const controller = new AbortController();
    requests.current.connection = controller;
    dispatch({ type: "API_CHECKING" });

    try {
      const [health, catalog] = await Promise.all([
        apiClient.health(controller.signal),
        apiClient.catalog(controller.signal),
      ]);
      if (health.status !== "ok") {
        throw new ApiError("Máy chủ chưa sẵn sàng.", {
          status: null,
          code: "INVALID_RESPONSE",
        });
      }
      if (controller.signal.aborted) return;
      dispatch({ type: "API_READY", catalog });
    } catch (error) {
      if (controller.signal.aborted) return;
      controller.abort();
      dispatch({ type: "API_FAILED", error: asApiError(error) });
    } finally {
      if (requests.current.connection === controller) delete requests.current.connection;
    }
  }, [abortOperation]);

  useEffect(() => {
    void connectToBackend();
    return () => {
      validationToken.current += 1;
      generationRef.current += 1;
      for (const operation of Object.keys(requests.current) as Operation[]) {
        requests.current[operation]?.abort();
      }
      requests.current = {};
      const remainingUrls = new Set([previewUrlRef.current, renderedPreviewUrl.current]);
      for (const url of remainingUrls) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [connectToBackend]);

  useEffect(() => {
    const previousUrl = renderedPreviewUrl.current;
    if (previousUrl && previousUrl !== state.previewUrl) URL.revokeObjectURL(previousUrl);
    renderedPreviewUrl.current = state.previewUrl;
  }, [state.previewUrl]);

  useEffect(() => {
    function handleUndoShortcut(event: KeyboardEvent) {
      const target = event.target;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (
        isTextEntry ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "z" ||
        event.shiftKey ||
        state.historyIndex <= 0 ||
        state.processStatus === "loading" || state.adviseStatus === "loading" ||
        state.uploadStatus !== "uploaded"
      ) {
        return;
      }
      event.preventDefault();
      dispatch({ type: "UNDO_CONFIG" });
    }

    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [state.historyIndex, state.uploadStatus, state.processStatus, state.adviseStatus]);

  const uploadFile = useCallback(async (file: File, generation: number) => {
    abortOperation("upload");
    const controller = new AbortController();
    requests.current.upload = controller;
    dispatch({ type: "UPLOAD_STARTED", generation });

    try {
      const asset = await apiClient.upload(file, controller.signal);
      if (controller.signal.aborted || generationRef.current !== generation) return;
      dispatch({ type: "UPLOAD_SUCCEEDED", generation, asset });
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      dispatch({ type: "UPLOAD_FAILED", generation, error: asApiError(error) });
    } finally {
      if (requests.current.upload === controller) delete requests.current.upload;
    }
  }, [abortOperation]);

  const acceptFile = useCallback(async (file: File) => {
    const token = ++validationToken.current;
    setSelectionError(null);

    try {
      const validatedImage = await validateAndDecodeImage(file);
      if (token !== validationToken.current) return;

      abortImageRequests();
      const generation = ++generationRef.current;
      const previewUrl = URL.createObjectURL(validatedImage.previewBlob);
      previewUrlRef.current = previewUrl;
      setView("original");
      setDownloadError(null);
      dispatch({
        type: "FILE_SELECTED",
        file,
        previewUrl,
        width: validatedImage.width,
        height: validatedImage.height,
        generation,
      });
      void uploadFile(file, generation);
    } catch (error) {
      if (token !== validationToken.current) return;
      setSelectionError(error instanceof Error ? error.message : "Không thể đọc ảnh này.");
    }
  }, [abortImageRequests, uploadFile]);

  function handleFileList(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length !== 1) {
      validationToken.current += 1;
      setSelectionError("Vui lòng chọn đúng một ảnh JPG hoặc PNG.");
      return;
    }
    void acceptFile(files[0]);
  }

  function handlePickerChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    handleFileList(files);
    event.currentTarget.value = "";
  }

  const processImage = useCallback(async () => {
    if (!state.uploaded || !state.catalog || state.processStatus === "loading" || state.adviseStatus === "loading") return;

    let steps;
    try {
      steps = serializeSteps(state.config, state.catalog);
    } catch (error) {
      dispatch({
        type: "PROCESS_FAILED",
        generation: state.generation,
        error: new ApiError(
          error instanceof SerializationError ? error.message : "Cấu hình xử lý không hợp lệ.",
          { status: null, code: "CLIENT_VALIDATION" },
        ),
      });
      return;
    }

    if (steps.length === 0) return;
    abortOperation("process");
    abortOperation("download");
    const controller = new AbortController();
    requests.current.process = controller;
    const generation = state.generation;
    dispatch({ type: "PROCESS_STARTED", generation });
    setView("original");

    try {
      const result = await apiClient.process(
        { image_id: state.uploaded.image_id, steps },
        controller.signal,
      );
      if (controller.signal.aborted || generationRef.current !== generation) return;
      if (result.image_id !== state.uploaded.image_id) {
        throw new ApiError("Kết quả máy chủ không khớp với ảnh hiện tại.", {
          status: null,
          code: "INVALID_RESPONSE",
        });
      }
      dispatch({ type: "PROCESS_SUCCEEDED", generation, result });
      setView("result");
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      dispatch({ type: "PROCESS_FAILED", generation, error: asApiError(error) });
    } finally {
      if (requests.current.process === controller) delete requests.current.process;
    }
  }, [abortOperation, state]);

  const requestAdvice = useCallback(async (prompt: string) => {
    if (!state.uploaded || !state.catalog || state.adviseStatus === "loading" || state.processStatus === "loading") return;
    if (!prompt.trim() || prompt.trim().length > 2000) return;

    let steps;
    try {
      steps = serializeSteps(state.config, state.catalog);
    } catch (error) {
      dispatch({
        type: "ADVISE_FAILED",
        generation: state.generation,
        error: new ApiError(
          error instanceof SerializationError ? error.message : "Cấu hình hiện tại không hợp lệ.",
          { status: null, code: "CLIENT_VALIDATION" },
        ),
      });
      return;
    }

    abortOperation("advise");
    const controller = new AbortController();
    requests.current.advise = controller;
    const generation = state.generation;
    dispatch({ type: "ADVISE_STARTED", generation });

    try {
      const proposal = await apiClient.advise(
        {
          image_id: state.uploaded.image_id,
          prompt: prompt.trim(),
          steps,
          current_result_id: null,
        },
        controller.signal,
      );
      if (controller.signal.aborted || generationRef.current !== generation) return;
      dispatch({ type: "ADVISE_SUCCEEDED", generation, proposal });
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      dispatch({ type: "ADVISE_FAILED", generation, error: asApiError(error) });
    } finally {
      if (requests.current.advise === controller) delete requests.current.advise;
    }
  }, [abortOperation, state]);

  const applyProposal = useCallback((proposal: AdviceResponse): string | null => {
    if (!state.catalog) return "Danh mục thuật toán chưa sẵn sàng.";
    if (proposal.steps.length > 8) return "Đề xuất vượt quá tám bước xử lý.";

    const config = cloneConfig(state.config);
    for (const toolId of Object.keys(config.enabled) as (keyof typeof config.enabled)[]) {
      config.enabled[toolId] = false;
    }
    const seenTools = new Set<string>();
    const proposalToolOrder: string[] = [];

    for (const step of proposal.steps) {
      const algorithm = state.catalog.find((item) => item.id === step.algorithm);
      if (!algorithm) return `Thuật toán “${step.algorithm}” không có trong danh mục máy chủ.`;
      if (seenTools.has(algorithm.tool_id)) return "Đề xuất có nhiều hơn một bước cho cùng công cụ.";
      seenTools.add(algorithm.tool_id);
      proposalToolOrder.push(algorithm.tool_id);

      const expectedKeys = algorithm.params.map((param) => param.key).sort();
      const actualKeys = Object.keys(step.params).sort();
      if (expectedKeys.join("\u0000") !== actualKeys.join("\u0000")) {
        return `Tham số của “${algorithm.name}” không khớp danh mục.`;
      }
      for (const parameter of algorithm.params) {
        const value = step.params[parameter.key];
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          (parameter.integer && !Number.isInteger(value)) ||
          (parameter.min !== null && value < parameter.min) ||
          (parameter.max !== null && value > parameter.max) ||
          (parameter.kind === "select" && !parameter.options.some((option) => option.value === value))
        ) {
          return `Giá trị “${parameter.label}” trong đề xuất không hợp lệ.`;
        }
      }

      config.selectedAlgorithms[algorithm.tool_id] = algorithm.id;
      config.enabled[algorithm.tool_id] = true;
      config.params[algorithm.id] = { ...step.params };
    }

    const upscaleIndex = proposalToolOrder.indexOf("upscale");
    if (upscaleIndex !== -1 && upscaleIndex !== proposalToolOrder.length - 1) {
      return "Bước nâng độ phân giải phải đứng cuối.";
    }
    dispatch({ type: "APPLY_CONFIG", config });
    return null;
  }, [state]);

  async function downloadResult(result: NonNullable<typeof state.result>) {
    abortOperation("download");
    const controller = new AbortController();
    requests.current.download = controller;
    const generation = state.generation;
    setDownloadError(null);

    try {
      const blob = await apiClient.download(result.result_id, controller.signal);
      if (controller.signal.aborted || generationRef.current !== generation) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setDownloadError(asApiError(error).message);
    } finally {
      if (requests.current.download === controller) delete requests.current.download;
    }
  }

  const retryUpload = useCallback(() => {
    if (state.file) void uploadFile(state.file, state.generation);
  }, [state.file, state.generation, uploadFile]);

  const retryConnection = useCallback(() => {
    void connectToBackend();
  }, [connectToBackend]);

  const canUndo = state.historyIndex > 0;
  const resultUrl = state.result ? apiClient.imageUrl(state.result.url) : null;
  const busy = state.processStatus === "loading" || state.adviseStatus === "loading";
  const fileStatus = state.uploadStatus === "uploaded"
    ? "Đã tải lên backend"
    : state.uploadStatus === "uploading"
      ? "Đang tải ảnh lên…"
      : state.uploadStatus === "error"
        ? "Chưa tải lên backend"
        : "Chưa có ảnh";

  return (
    <main className="editor-shell">
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        onChange={handlePickerChange}
        aria-label="Chọn một ảnh JPG hoặc PNG"
      />

      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div className="brand-copy">
            <span className="brand-name">Resim</span>
            <span className="brand-separator" />
            <span className="brand-subtitle">Khôi phục ảnh</span>
          </div>
        </div>
        <div className="header-center">
          {state.file ? (
            <>
              <span className="header-file-name" title={state.file.name}>{state.file.name}</span>
              <span className={`header-upload-status${state.uploadStatus === "error" ? " is-warning" : ""}`}>
                {state.uploadStatus === "uploading" && <LoaderCircle size={12} className="spin" />}
                {state.uploadStatus === "uploaded" && <Check size={12} />}
                {state.uploadStatus === "error" && <span className="status-dot is-warning" />}
                {state.uploadStatus === "empty" ? "Ảnh xem trước" : fileStatus}
              </span>
            </>
          ) : (
            <span className="header-document-title">Không gian chỉnh sửa</span>
          )}
        </div>
        <div className="header-actions">
          <div className={`connection-badge is-${state.connectionStatus}`} title={state.connectionError?.message}>
            {state.connectionStatus === "ready" ? <Wifi size={13} /> : state.connectionStatus === "checking" ? <LoaderCircle size={13} className="spin" /> : <WifiOff size={13} />}
            <span>{state.connectionStatus === "ready" ? "Đã kết nối" : state.connectionStatus === "checking" ? "Đang kết nối" : "Ngoại tuyến"}</span>
          </div>
          {state.connectionStatus === "offline" && (
            <button className="icon-button retry-connection-icon" type="button" onClick={retryConnection} aria-label="Thử kết nối lại" title="Thử kết nối lại">
              <RotateCcw size={14} />
            </button>
          )}
          <button
            type="button"
            className="secondary-button header-change-button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={state.file ? "Đổi ảnh" : "Chọn ảnh"}
          >
            <ImagePlus size={14} /> <span>{state.file ? "Đổi ảnh" : "Chọn ảnh"}</span>
          </button>
          <button
            type="button"
            className="primary-button header-download-button"
            disabled={!state.result}
            onClick={() => state.result && void downloadResult(state.result)}
            aria-label="Tải kết quả đã xử lý"
          ><Download size={14} /> <span>Tải kết quả</span></button>
        </div>
      </header>

      <div className="editor-workspace">
        <Canvas
          state={state}
          resultUrl={resultUrl}
          uploadError={state.uploadError?.message ?? null}
          view={state.result ? view : "original"}
          onViewChange={setView}
          selectionError={selectionError}
          downloadError={downloadError}
          onChooseFile={() => fileInputRef.current?.click()}
          onDropFile={handleFileList}
          onRetryUpload={retryUpload}
          onZoomChange={(zoom) => dispatch({ type: "SET_ZOOM", zoom })}
          onRetryConnection={retryConnection}
          onDownload={(result) => void downloadResult(result)}
        />

        <aside className="sidebar" aria-label="Bảng điều khiển">
          <div className="sidebar-tabs" role="tablist" aria-label="Bảng điều khiển editor">
            <button
              type="button"
              role="tab"
              id="tools-tab"
              aria-selected={state.activeTab === "tools"}
              aria-controls="tools-panel"
              className={`sidebar-tab${state.activeTab === "tools" ? " is-active" : ""}`}
              onClick={() => dispatch({ type: "SET_TAB", tab: "tools" })}
            ><SlidersHorizontal size={15} /> Công cụ</button>
            <button
              type="button"
              role="tab"
              id="advisor-tab"
              aria-selected={state.activeTab === "advisor"}
              aria-controls="advisor-panel"
              className={`sidebar-tab${state.activeTab === "advisor" ? " is-active" : ""}`}
              onClick={() => dispatch({ type: "SET_TAB", tab: "advisor" })}
            ><Sparkles size={15} /> AI tư vấn <span className="tab-stub-dot" /></button>
          </div>
          <div
            id="tools-panel"
            role="tabpanel"
            aria-labelledby="tools-tab"
            className="sidebar-panel-slot"
            hidden={state.activeTab !== "tools"}
          >
            <ToolsPanel state={state} dispatch={dispatch} busy={busy} onProcess={() => void processImage()} />
          </div>
          <div
            id="advisor-panel"
            role="tabpanel"
            aria-labelledby="advisor-tab"
            className="sidebar-panel-slot"
            hidden={state.activeTab !== "advisor"}
          >
            <AdvisorPanel
              key={state.generation}
              state={state}
              busy={busy}
              onAdvise={(prompt) => void requestAdvice(prompt)}
              onApplyProposal={applyProposal}
            />
          </div>
        </aside>
      </div>

      <footer className="app-footer">
        <div className="footer-image-metadata">
          <span className="footer-image-icon"><ImagePlus size={14} /></span>
          <span className="footer-file-status">{fileStatus}</span>
          {state.file && (
            <span className="footer-dimensions">
              {state.result && view !== "original"
                ? `${state.result.width} × ${state.result.height} px · Kết quả`
                : state.uploaded
                ? `${state.uploaded.width} × ${state.uploaded.height} px`
                : state.previewWidth && state.previewHeight
                  ? `${state.previewWidth} × ${state.previewHeight} px`
                  : "Ảnh xem trước"}
            </span>
          )}
        </div>
        <div className="footer-disclaimer"><span className="status-dot" /> 8 công cụ phục hồi · Phóng ảnh 2×/4×</div>
        <button
          type="button"
          className="footer-undo-button"
          disabled={!canUndo || state.uploadStatus !== "uploaded" || busy}
          onClick={() => dispatch({ type: "UNDO_CONFIG" })}
          title="Hoàn tác thay đổi cấu hình gần nhất"
        ><Undo2 size={14} /> Hoàn tác</button>
      </footer>
    </main>
  );
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    return new ApiError(error.message, { status: null, code: "CLIENT_ERROR" });
  }
  return new ApiError("Đã xảy ra lỗi không xác định.", { status: null, code: "CLIENT_ERROR" });
}
