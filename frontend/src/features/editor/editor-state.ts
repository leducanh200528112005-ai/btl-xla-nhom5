import { ApiError } from "@/services/api-client";
import type {
  AdviceProposal,
  AdviceResponse,
  AlgorithmDescriptor,
  ImageAsset,
  ProcessResult,
  ProcessingStep,
  ToolId,
} from "@/types/api";
import {
  cloneConfig,
  configsEqual,
  createDefaultConfig,
  type EditorConfig,
} from "./serialization";

export type ConnectionStatus = "checking" | "ready" | "offline";
export type UploadStatus = "empty" | "uploading" | "uploaded" | "error";
export type RequestStatus =
  | "idle"
  | "loading"
  | "error"
  | "not_implemented"
  | "succeeded";

export type ResultSnapshot = {
  result: ProcessResult;
  steps: ProcessingStep[];
  source: "manual" | "ai";
};

export type SavedVersion = ResultSnapshot & {
  config: EditorConfig;
  createdAt: number;
};

export type ChatEntry =
  | {
      id: string;
      kind: "user";
      text: string;
      status: "loading" | "succeeded" | "error";
      error: string | null;
      versionId?: string | null;
      excludedFromHistory?: boolean;
    }
  | { id: string; kind: "assistant"; proposal: AdviceProposal; versionId?: string | null }
  | {
      id: string;
      kind: "notice";
      decision: "answer" | "unsupported" | "off_topic";
      text: string;
      versionId?: string | null;
    }
  | { id: string; kind: "applied"; steps: ProcessingStep[] }
  | ({ id: string; kind: "processed" } & ResultSnapshot);

export type EditorState = {
  connectionStatus: ConnectionStatus;
  connectionError: ApiError | null;
  catalog: AlgorithmDescriptor[] | null;
  file: File | null;
  previewUrl: string | null;
  previewWidth: number | null;
  previewHeight: number | null;
  generation: number;
  uploaded: ImageAsset | null;
  uploadStatus: UploadStatus;
  uploadError: ApiError | null;
  config: EditorConfig;
  history: EditorConfig[];
  historyIndex: number;
  draftSyncVersion: number;
  activeTab: "tools" | "advisor";
  zoom: number;
  processStatus: RequestStatus;
  processError: ApiError | null;
  result: ProcessResult | null;
  adviseStatus: RequestStatus;
  adviseError: ApiError | null;
  proposal: AdviceProposal | null;
  chat: ChatEntry[];
  pendingAdviceId: string | null;
  latestResult: ResultSnapshot | null;
  versions: SavedVersion[];
  activeVersionId: string | null;
  compareLeftId: string | null;
  compareRightId: string | null;
  pendingAdviceVersionId: string | null;
  pendingProcessing: (Omit<ResultSnapshot, "result"> & { config: EditorConfig }) | null;
  configSource: "manual" | "ai";
};

export type EditorAction =
  | { type: "API_CHECKING" }
  | { type: "API_READY"; catalog: AlgorithmDescriptor[] }
  | { type: "API_FAILED"; error: ApiError }
  | {
      type: "FILE_SELECTED";
      file: File;
      previewUrl: string;
      width: number;
      height: number;
      generation: number;
    }
  | { type: "UPLOAD_STARTED"; generation: number }
  | { type: "UPLOAD_SUCCEEDED"; generation: number; asset: ImageAsset }
  | { type: "UPLOAD_FAILED"; generation: number; error: ApiError }
  | { type: "SET_TAB"; tab: "tools" | "advisor" }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "SELECT_VERSION"; versionId: string | null }
  | { type: "SET_COMPARE_VERSION"; side: "left" | "right"; versionId: string | null }
  | { type: "SWAP_COMPARE" }
  | { type: "SET_ENABLED"; toolId: ToolId; enabled: boolean }
  | { type: "SELECT_ALGORITHM"; toolId: ToolId; algorithmId: string }
  | { type: "SET_PARAM"; algorithmId: string; key: string; value: number }
  | { type: "RESET_CONFIG" }
  | { type: "UNDO_CONFIG" }
  | { type: "APPLY_CONFIG"; config: EditorConfig; steps: ProcessingStep[]; eventId: string }
  | { type: "PROCESS_STARTED"; generation: number; steps: ProcessingStep[] }
  | { type: "PROCESS_SUCCEEDED"; generation: number; result: ProcessResult }
  | { type: "PROCESS_FAILED"; generation: number; error: ApiError }
  | { type: "ADVISE_STARTED"; generation: number; prompt: string; requestId: string }
  | { type: "ADVISE_SUCCEEDED"; generation: number; reply: AdviceResponse }
  | { type: "ADVISE_FAILED"; generation: number; error: ApiError };

const initialConfig = createDefaultConfig([]);

export const initialEditorState: EditorState = {
  connectionStatus: "checking",
  connectionError: null,
  catalog: null,
  file: null,
  previewUrl: null,
  previewWidth: null,
  previewHeight: null,
  generation: 0,
  uploaded: null,
  uploadStatus: "empty",
  uploadError: null,
  config: initialConfig,
  history: [initialConfig],
  historyIndex: 0,
  draftSyncVersion: 0,
  activeTab: "tools",
  zoom: 1,
  processStatus: "idle",
  processError: null,
  result: null,
  adviseStatus: "idle",
  adviseError: null,
  proposal: null,
  chat: [],
  pendingAdviceId: null,
  latestResult: null,
  versions: [],
  activeVersionId: null,
  compareLeftId: null,
  compareRightId: null,
  pendingAdviceVersionId: null,
  pendingProcessing: null,
  configSource: "manual",
};

export function getActiveVersion(state: EditorState): SavedVersion | null {
  return state.versions.find((version) => version.result.result_id === state.activeVersionId) ?? null;
}

export function versionLabel(state: EditorState, id: string | null): string {
  if (id === null) return "Ảnh gốc";
  const index = state.versions.findIndex((version) => version.result.result_id === id);
  return index < 0 ? "Phiên bản không còn trong phiên" : `Phiên bản ${index + 1}`;
}

function copySteps(steps: ProcessingStep[]): ProcessingStep[] {
  return steps.map((step) => ({ algorithm: step.algorithm, params: { ...step.params } }));
}

function appendChat(chat: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  return [...chat, entry].slice(-100);
}

function appendHistory(state: EditorState, config: EditorConfig): EditorState {
  if (configsEqual(config, state.config)) return state;

  const history = state.history
    .slice(0, state.historyIndex + 1)
    .concat(cloneConfig(config));
  const boundedHistory = history.length > 50 ? history.slice(history.length - 50) : history;

  return {
    ...state,
    config: cloneConfig(config),
    history: boundedHistory,
    historyIndex: boundedHistory.length - 1,
    result: null,
    processStatus: "idle",
    processError: null,
    configSource: "manual",
  };
}

function requestStatus(error: ApiError): RequestStatus {
  return error.status === 501 && error.code === "NOT_IMPLEMENTED" ? "not_implemented" : "error";
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "API_CHECKING":
      return { ...state, connectionStatus: "checking", connectionError: null };
    case "API_READY": {
      const config = state.catalog ? state.config : createDefaultConfig(action.catalog);
      return {
        ...state,
        connectionStatus: "ready",
        connectionError: null,
        catalog: action.catalog,
        config,
        history: state.catalog ? state.history : [cloneConfig(config)],
        historyIndex: state.catalog ? state.historyIndex : 0,
        draftSyncVersion: state.draftSyncVersion + 1,
      };
    }
    case "API_FAILED":
      return {
        ...state,
        connectionStatus: "offline",
        connectionError: action.error,
      };
    case "FILE_SELECTED": {
      const config = createDefaultConfig(state.catalog ?? []);
      return {
        ...state,
        file: action.file,
        previewUrl: action.previewUrl,
        previewWidth: action.width,
        previewHeight: action.height,
        generation: action.generation,
        uploaded: null,
        uploadStatus: "uploading",
        uploadError: null,
        config,
        history: [cloneConfig(config)],
        historyIndex: 0,
        draftSyncVersion: state.draftSyncVersion + 1,
        zoom: 1,
        processStatus: "idle",
        processError: null,
        result: null,
        adviseStatus: "idle",
        adviseError: null,
        proposal: null,
        chat: [],
        pendingAdviceId: null,
        latestResult: null,
        versions: [],
        activeVersionId: null,
        compareLeftId: null,
        compareRightId: null,
        pendingAdviceVersionId: null,
        pendingProcessing: null,
        configSource: "manual",
      };
    }
    case "UPLOAD_STARTED":
      return action.generation !== state.generation
        ? state
        : { ...state, uploadStatus: "uploading", uploadError: null };
    case "UPLOAD_SUCCEEDED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            uploaded: action.asset,
            uploadStatus: "uploaded",
            uploadError: null,
          };
    case "UPLOAD_FAILED":
      return action.generation !== state.generation
        ? state
        : { ...state, uploaded: null, uploadStatus: "error", uploadError: action.error };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_ZOOM":
      return { ...state, zoom: Math.max(0.25, Math.min(3, action.zoom)) };
    case "SELECT_VERSION": {
      if (state.processStatus === "loading") return state;
      const version = state.versions.find((item) => item.result.result_id === action.versionId);
      if (action.versionId !== null && !version) return state;
      const config = version ? version.config : createDefaultConfig(state.catalog ?? []);
      return {
        ...appendHistory(state, config),
        activeVersionId: action.versionId,
        result: version?.result ?? null,
        processStatus: "idle",
        processError: null,
        configSource: version?.source ?? "manual",
        draftSyncVersion: state.draftSyncVersion + 1,
      };
    }
    case "SET_COMPARE_VERSION":
      if (action.versionId !== null && !state.versions.some((item) => item.result.result_id === action.versionId)) return state;
      return action.side === "left"
        ? { ...state, compareLeftId: action.versionId }
        : { ...state, compareRightId: action.versionId };
    case "SWAP_COMPARE":
      return { ...state, compareLeftId: state.compareRightId, compareRightId: state.compareLeftId };
    case "SET_ENABLED": {
      const config = cloneConfig(state.config);
      config.enabled[action.toolId] = action.enabled;
      return appendHistory(state, config);
    }
    case "SELECT_ALGORITHM": {
      const config = cloneConfig(state.config);
      config.selectedAlgorithms[action.toolId] = action.algorithmId;
      return appendHistory(state, config);
    }
    case "SET_PARAM": {
      const config = cloneConfig(state.config);
      if (!config.params[action.algorithmId]) return state;
      config.params[action.algorithmId][action.key] = action.value;
      return appendHistory(state, config);
    }
    case "RESET_CONFIG": {
      const config = createDefaultConfig(state.catalog ?? []);
      return {
        ...appendHistory(state, config),
        draftSyncVersion: state.draftSyncVersion + 1,
        configSource: "manual",
      };
    }
    case "UNDO_CONFIG": {
      if (state.historyIndex <= 0) return state;
      const historyIndex = state.historyIndex - 1;
      return {
        ...state,
        config: cloneConfig(state.history[historyIndex]),
        historyIndex,
        result: null,
        processStatus: "idle",
        processError: null,
        draftSyncVersion: state.draftSyncVersion + 1,
        configSource: "manual",
      };
    }
    case "APPLY_CONFIG":
      return {
        ...appendHistory(state, action.config),
        draftSyncVersion: state.draftSyncVersion + 1,
        configSource: "ai",
        chat: appendChat(state.chat, { id: action.eventId, kind: "applied", steps: copySteps(action.steps) }),
      };
    case "PROCESS_STARTED":
      return action.generation !== state.generation
        ? state
        : {
            ...state, processStatus: "loading", processError: null, result: null,
            pendingProcessing: { steps: copySteps(action.steps), source: state.configSource, config: cloneConfig(state.config) },
          };
    case "PROCESS_SUCCEEDED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            processStatus: "succeeded",
            processError: null,
            result: action.result,
            versions: state.pendingProcessing
              ? [...state.versions, { result: { ...action.result }, ...state.pendingProcessing, createdAt: Date.now() }]
              : state.versions,
            activeVersionId: state.pendingProcessing ? action.result.result_id : state.activeVersionId,
            compareRightId: state.pendingProcessing ? action.result.result_id : state.compareRightId,
            latestResult: state.pendingProcessing
              ? { result: action.result, ...state.pendingProcessing } : state.latestResult,
            chat: state.pendingProcessing
              ? appendChat(state.chat, {
                  id: action.result.result_id, kind: "processed",
                  result: action.result, ...state.pendingProcessing,
                }) : state.chat,
            pendingProcessing: null,
          };
    case "PROCESS_FAILED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            processStatus: requestStatus(action.error),
            processError: action.error,
            result: null,
            pendingProcessing: null,
          };
    case "ADVISE_STARTED":
      return action.generation !== state.generation
        ? state
        : {
            ...state, adviseStatus: "loading", adviseError: null,
            pendingAdviceId: action.requestId,
            pendingAdviceVersionId: state.activeVersionId,
            chat: appendChat(state.chat, {
              id: action.requestId, kind: "user", text: action.prompt, status: "loading", error: null, versionId: state.activeVersionId,
            }),
          };
    case "ADVISE_SUCCEEDED":
      return action.generation !== state.generation
        ? state
        : (() => {
            const chat = state.chat.map((entry) =>
              entry.kind === "user" && entry.id === state.pendingAdviceId
                ? {
                    ...entry,
                    status: "succeeded" as const,
                    excludedFromHistory: action.reply.decision === "off_topic",
                  }
                : entry);
            if (action.reply.decision === "advise") {
              return {
                ...state,
                adviseStatus: "succeeded" as const,
                adviseError: null,
                proposal: action.reply,
                chat: appendChat(chat, {
                  id: `${state.pendingAdviceId}-reply`,
                  kind: "assistant",
                  proposal: action.reply,
                  versionId: state.pendingAdviceVersionId,
                }),
                pendingAdviceId: null,
              };
            }
            return {
              ...state,
              adviseStatus: "succeeded" as const,
              adviseError: null,
              proposal: null,
              chat: appendChat(chat, {
                id: `${state.pendingAdviceId}-notice`,
                kind: "notice",
                decision: action.reply.decision,
                text: action.reply.analysis,
                versionId: state.pendingAdviceVersionId,
              }),
              pendingAdviceId: null,
            };
          })();
    case "ADVISE_FAILED":
      return action.generation !== state.generation
        ? state
        : {
            ...state,
            adviseStatus: requestStatus(action.error),
            adviseError: action.error,
            proposal: null,
            chat: state.chat.map((entry) =>
              entry.kind === "user" && entry.id === state.pendingAdviceId
                ? { ...entry, status: "error" as const, error: action.error.message } : entry),
            pendingAdviceId: null,
          };
  }
}
